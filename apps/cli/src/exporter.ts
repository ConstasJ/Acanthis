import fs from "node:fs/promises";
import path from "node:path";
import type { Volume } from "@acanthis-dec/core";
import {
	buildNovelEpub,
	buildVolumeEpub,
	type EpubChapterData,
	type EpubImageAsset,
	type EpubVolumeData,
} from "@acanthis-dec/epub";
import { type AcanthisApiClient, ApiClientError } from "./client";
import type { ExportFileResult, ExportOptions, ExportSummary } from "./types";
import {
	extractImgSrcUrls,
	isUnresolvedChapterId,
	parseNovelIdOrUrl,
	parseVolumeSelection,
	sanitizeFilename,
	withConcurrencyLimit,
} from "./utils";

const RETRY_DELAYS_MS = [500, 1000, 2000] as const;
const MEDIA_DOWNLOAD_CONCURRENCY = 4;

export interface ExportProgressEvent {
	phase: "novel" | "chapters" | "images" | "pack" | "write";
	current: number;
	total: number;
	message: string;
}

export interface ExportRunnerCallbacks {
	onProgress?: ((event: ExportProgressEvent) => void) | undefined;
	onWarning?: ((message: string) => void) | undefined;
}

interface MediaDownloadTask {
	rawUrl: string;
	isNovelCover: boolean;
	isVolumeCover: boolean;
	isIllustration: boolean;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function isAuthError(error: unknown): boolean {
	return (
		error instanceof ApiClientError &&
		(error.status === 401 || error.code === 40100)
	);
}

function isNotFoundError(error: unknown): boolean {
	return error instanceof ApiClientError && error.status === 404;
}

function formatErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function withExponentialBackoff<T>(
	operation: () => Promise<T>,
	shouldAbortRetry?: (error: unknown) => boolean,
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (isAuthError(error) || shouldAbortRetry?.(error)) {
				throw error;
			}
			const delayMs = RETRY_DELAYS_MS[attempt];
			if (delayMs === undefined) {
				break;
			}
			await sleep(delayMs);
		}
	}
	throw lastError;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function runExport(
	client: AcanthisApiClient,
	options: ExportOptions,
	callbacks?: ExportRunnerCallbacks,
): Promise<ExportSummary> {
	const warnings: string[] = [];
	const emitProgress = (event: ExportProgressEvent): void => {
		callbacks?.onProgress?.(event);
	};
	const emitWarning = (message: string): void => {
		warnings.push(message);
		callbacks?.onWarning?.(message);
	};

	const novelId = parseNovelIdOrUrl(options.novelIdOrUrl);
	emitProgress({
		phase: "novel",
		current: 0,
		total: 1,
		message: `Fetching novel ${novelId}`,
	});
	const novel = await client.getNovel(options.source, novelId);
	emitProgress({
		phase: "novel",
		current: 1,
		total: 1,
		message: `Loaded novel: ${novel.title}`,
	});

	const selectedVolumes: Volume[] = parseVolumeSelection(
		options.volumes,
		novel.volumes,
	);
	if (selectedVolumes.length === 0) {
		throw new Error(`No volumes selected for novel "${novel.title}"`);
	}

	const selectedAllVolumes =
		selectedVolumes.length === novel.volumes.length &&
		novel.volumes.every(
			(volume, index) => selectedVolumes[index]?.id === volume.id,
		);

	const totalChapters = selectedVolumes.reduce(
		(sum, volume) => sum + volume.chapters.length,
		0,
	);
	const fetchedChaptersPerVolume: EpubChapterData[][] = selectedVolumes.map(
		() => [],
	);
	const illustrationUrlsPerVolume: string[][] = selectedVolumes.map(() => []);

	let processedChapters = 0;
	for (let vIdx = 0; vIdx < selectedVolumes.length; vIdx += 1) {
		const volume = selectedVolumes[vIdx];
		const volumeChapters = fetchedChaptersPerVolume[vIdx];
		const volumeIllustUrls = illustrationUrlsPerVolume[vIdx];
		if (!volume || !volumeChapters || !volumeIllustUrls) {
			continue;
		}

		for (const chapter of volume.chapters) {
			processedChapters += 1;

			if (isUnresolvedChapterId(chapter.id)) {
				const msg = `Unresolved chapter "${chapter.title}" (${chapter.id}) in volume "${volume.title}"`;
				if (options.strict) {
					throw new Error(`Strict mode aborted: ${msg}`);
				}
				emitWarning(`Skipped ${msg}`);
				emitProgress({
					phase: "chapters",
					current: processedChapters,
					total: totalChapters,
					message: `Skipped unresolved chapter: ${chapter.title}`,
				});
				continue;
			}

			try {
				const content = await withExponentialBackoff(() =>
					client.getChapterContent(options.source, chapter.id, novel.id),
				);
				volumeChapters.push({
					id: chapter.id,
					title: chapter.title,
					html: content.content,
				});
				if (options.illustrations !== false) {
					for (const imgUrl of extractImgSrcUrls(content.content)) {
						volumeIllustUrls.push(imgUrl);
					}
				}
				emitProgress({
					phase: "chapters",
					current: processedChapters,
					total: totalChapters,
					message: `Fetched chapter: ${chapter.title}`,
				});
			} catch (error) {
				if (isAuthError(error) || options.strict) {
					throw error;
				}
				emitWarning(
					`Skipped chapter "${chapter.title}" (${chapter.id}): ${formatErrorMessage(error)}`,
				);
				emitProgress({
					phase: "chapters",
					current: processedChapters,
					total: totalChapters,
					message: `Failed chapter: ${chapter.title}`,
				});
			}
		}
	}

	const mediaTaskMap = new Map<string, MediaDownloadTask>();
	const registerMediaTask = (
		rawUrl: string | null | undefined,
		role: "novelCover" | "volumeCover" | "illustration",
	): void => {
		const trimmed = rawUrl?.trim();
		if (!trimmed) {
			return;
		}
		let task = mediaTaskMap.get(trimmed);
		if (!task) {
			task = {
				rawUrl: trimmed,
				isNovelCover: false,
				isVolumeCover: false,
				isIllustration: false,
			};
			mediaTaskMap.set(trimmed, task);
		}
		if (role === "novelCover") {
			task.isNovelCover = true;
		} else if (role === "volumeCover") {
			task.isVolumeCover = true;
		} else {
			task.isIllustration = true;
		}
	};

	registerMediaTask(novel.coverUrl, "novelCover");
	for (const volume of selectedVolumes) {
		registerMediaTask(volume.coverUrl, "volumeCover");
	}
	if (options.illustrations !== false) {
		for (const urls of illustrationUrlsPerVolume) {
			for (const imgUrl of urls) {
				registerMediaTask(imgUrl, "illustration");
			}
		}
	}

	const mediaTasks = [...mediaTaskMap.values()];
	const assetByRawUrl = new Map<string, EpubImageAsset>();
	let downloadedMediaCount = 0;

	if (mediaTasks.length > 0) {
		emitProgress({
			phase: "images",
			current: 0,
			total: mediaTasks.length,
			message: `Downloading ${mediaTasks.length} media assets`,
		});

		await withConcurrencyLimit(
			mediaTasks,
			MEDIA_DOWNLOAD_CONCURRENCY,
			async (task) => {
				try {
					const binary = await withExponentialBackoff(
						() => client.fetchBinary(task.rawUrl),
						(error) =>
							task.isVolumeCover &&
							!task.isIllustration &&
							isNotFoundError(error),
					);
					assetByRawUrl.set(task.rawUrl, {
						sourceUrl: task.rawUrl,
						data: binary.data,
						mimeType: binary.mimeType,
					});
				} catch (error) {
					if (isAuthError(error)) {
						throw error;
					}
					if (
						task.isVolumeCover &&
						!task.isIllustration &&
						isNotFoundError(error)
					) {
						return;
					}
					if (task.isIllustration && options.strict) {
						throw new Error(
							`Strict mode aborted: failed to download illustration "${task.rawUrl}": ${formatErrorMessage(error)}`,
							{ cause: error },
						);
					}
					emitWarning(
						`Omitted media "${task.rawUrl}": ${formatErrorMessage(error)}`,
					);
				} finally {
					downloadedMediaCount += 1;
					emitProgress({
						phase: "images",
						current: downloadedMediaCount,
						total: mediaTasks.length,
						message: `Downloaded media (${downloadedMediaCount}/${mediaTasks.length})`,
					});
				}
			},
		);
	}

	const novelCover = novel.coverUrl?.trim()
		? assetByRawUrl.get(novel.coverUrl.trim())
		: undefined;
	const summaryText = novel.summary.trim() ? novel.summary : undefined;
	const genresList = novel.genres.length > 0 ? novel.genres : undefined;

	await fs.mkdir(options.outputDir, { recursive: true });
	const files: ExportFileResult[] = [];

	if (options.mode === "split") {
		const totalSteps = selectedVolumes.length;
		for (let vIdx = 0; vIdx < selectedVolumes.length; vIdx += 1) {
			const volume = selectedVolumes[vIdx];
			const chapters = fetchedChaptersPerVolume[vIdx];
			const volumeIllustUrls = illustrationUrlsPerVolume[vIdx];
			if (!volume || !chapters || !volumeIllustUrls) {
				continue;
			}

			const baseName = sanitizeFilename(
				`[${novel.author}] ${novel.title} - ${volume.title}`,
			);
			const targetPath = path.join(options.outputDir, `${baseName}.epub`);
			const displayTitle = `${novel.title} - ${volume.title}`;

			if (!options.overwrite && (await fileExists(targetPath))) {
				emitWarning(`Skipped existing file: ${targetPath}`);
				files.push({
					path: targetPath,
					title: displayTitle,
					volumeId: volume.id,
					chapterCount: chapters.length,
					skipped: true,
				});
				continue;
			}

			emitProgress({
				phase: "pack",
				current: vIdx + 1,
				total: totalSteps,
				message: `Packing volume: ${volume.title}`,
			});

			const volumeCover = volume.coverUrl?.trim()
				? assetByRawUrl.get(volume.coverUrl.trim())
				: undefined;
			const volumeIllustrations: EpubImageAsset[] = [];
			const seenIllustUrls = new Set<string>();
			for (const imgUrl of volumeIllustUrls) {
				if (seenIllustUrls.has(imgUrl)) {
					continue;
				}
				seenIllustUrls.add(imgUrl);
				const asset = assetByRawUrl.get(imgUrl);
				if (asset) {
					volumeIllustrations.push(asset);
				}
			}

			const epubBytes = buildVolumeEpub({
				identifier: `urn:acanthis:${options.source}:${novel.id}:vol:${volume.id}`,
				novelTitle: novel.title,
				volumeTitle: volume.title,
				author: novel.author,
				summary: summaryText,
				genres: genresList,
				cover: volumeCover ?? novelCover,
				chapters,
				illustrations: volumeIllustrations,
			});

			emitProgress({
				phase: "write",
				current: vIdx + 1,
				total: totalSteps,
				message: `Writing ${targetPath}`,
			});
			await fs.writeFile(targetPath, epubBytes);

			files.push({
				path: targetPath,
				title: displayTitle,
				volumeId: volume.id,
				chapterCount: chapters.length,
				skipped: false,
			});
		}
	} else {
		const baseName = sanitizeFilename(`[${novel.author}] ${novel.title}`);
		const suffix = selectedAllVolumes ? "" : " (选集)";
		const targetPath = path.join(
			options.outputDir,
			`${baseName}${suffix}.epub`,
		);
		const totalChapterCount = fetchedChaptersPerVolume.reduce(
			(sum, list) => sum + list.length,
			0,
		);

		if (!options.overwrite && (await fileExists(targetPath))) {
			emitWarning(`Skipped existing file: ${targetPath}`);
			files.push({
				path: targetPath,
				title: novel.title,
				chapterCount: totalChapterCount,
				skipped: true,
			});
		} else {
			emitProgress({
				phase: "pack",
				current: 1,
				total: 1,
				message: `Packing novel: ${novel.title}`,
			});

			const epubVolumes: EpubVolumeData[] = [];
			const allIllustrations: EpubImageAsset[] = [];
			const seenIllustUrls = new Set<string>();

			for (let vIdx = 0; vIdx < selectedVolumes.length; vIdx += 1) {
				const volume = selectedVolumes[vIdx];
				const chapters = fetchedChaptersPerVolume[vIdx];
				const volumeIllustUrls = illustrationUrlsPerVolume[vIdx];
				if (!volume || !chapters || !volumeIllustUrls) {
					continue;
				}

				const volumeCover = volume.coverUrl?.trim()
					? assetByRawUrl.get(volume.coverUrl.trim())
					: undefined;

				epubVolumes.push({
					id: volume.id,
					title: volume.title,
					cover: volumeCover,
					chapters,
				});

				for (const imgUrl of volumeIllustUrls) {
					if (seenIllustUrls.has(imgUrl)) {
						continue;
					}
					seenIllustUrls.add(imgUrl);
					const asset = assetByRawUrl.get(imgUrl);
					if (asset) {
						allIllustrations.push(asset);
					}
				}
			}

			const epubBytes = buildNovelEpub({
				identifier: `urn:acanthis:${options.source}:${novel.id}`,
				title: novel.title,
				author: novel.author,
				summary: summaryText,
				genres: genresList,
				cover: novelCover,
				volumes: epubVolumes,
				illustrations: allIllustrations,
			});

			emitProgress({
				phase: "write",
				current: 1,
				total: 1,
				message: `Writing ${targetPath}`,
			});
			await fs.writeFile(targetPath, epubBytes);

			files.push({
				path: targetPath,
				title: novel.title,
				chapterCount: totalChapterCount,
				skipped: false,
			});
		}
	}

	return {
		novelId: novel.id,
		novelTitle: novel.title,
		source: options.source,
		mode: options.mode,
		files,
		warnings,
	};
}
