import type { Volume } from "@acanthis-dec/core";
import {
	buildNovelEpub,
	buildVolumeEpub,
	type EpubChapterData,
	type EpubImageAsset,
	type EpubVolumeData,
	type NovelEpubInput,
	type VolumeEpubInput,
} from "@acanthis-dec/epub";
import {
	isUnresolvedChapterId,
	rewriteAndExtractImgSrcUrls,
	sanitizeFilename,
} from "@/utils/epubHtml";
import {
	rebaseMediaUrlWithBase,
	stripTrailingV1Prefix,
} from "@/utils/mediaUrl";
import type {
	EpubExportStage,
	EpubWorkerRequest,
	EpubWorkerResponse,
} from "@/workers/protocol";

const MEDIA_DOWNLOAD_CONCURRENCY = 4;

interface MediaDownloadTask {
	url: string;
	isNovelCover: boolean;
	isVolumeCover: boolean;
	isIllustration: boolean;
}

interface ChapterApiEnvelope {
	code?: unknown;
	message?: unknown;
	error?: unknown;
	data?: {
		content?: unknown;
	};
}

const workerSelf = self as unknown as DedicatedWorkerGlobalScope;

function postResponse(
	response: EpubWorkerResponse,
	transfer: Transferable[] = [],
): void {
	workerSelf.postMessage(response, transfer);
}

function emitProgress(
	stage: EpubExportStage,
	completed: number,
	total: number,
	message: string,
): void {
	postResponse({
		type: "progress",
		stage,
		completed,
		total,
		message,
	});
}

function parseErrorMessage(
	bodyText: string,
	status: number,
	statusText: string,
): string {
	const trimmed = bodyText.trim();
	if (trimmed) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (typeof parsed === "object" && parsed !== null) {
				const record = parsed as Record<string, unknown>;
				if (typeof record.message === "string" && record.message.trim()) {
					return record.message;
				}
				if (typeof record.error === "string" && record.error.trim()) {
					return record.error;
				}
			}
		} catch {
			// Fall back to raw response text.
		}
		return trimmed;
	}
	return statusText ? `HTTP ${status} ${statusText}` : `HTTP ${status}`;
}

async function fetchChapterHtml(options: {
	normalizedBase: string;
	platform: string;
	novelId: string;
	chapterId: string;
	authToken: string;
}): Promise<string> {
	const url = `${options.normalizedBase}/v1/${encodeURIComponent(options.platform)}/chapter/${encodeURIComponent(options.chapterId)}?novelId=${encodeURIComponent(options.novelId)}`;
	const headers: Record<string, string> = {
		Accept: "application/json",
	};
	const trimmedToken = options.authToken.trim();
	if (trimmedToken) {
		headers.Authorization = `Bearer ${trimmedToken}`;
	}

	const response = await fetch(url, {
		method: "GET",
		headers,
	});
	const bodyText = await response.text();
	if (!response.ok) {
		throw new Error(
			`获取章节失败（${response.status}）：${parseErrorMessage(bodyText, response.status, response.statusText)}`,
		);
	}

	let parsed: ChapterApiEnvelope;
	try {
		parsed = JSON.parse(bodyText) as ChapterApiEnvelope;
	} catch {
		throw new Error(`章节接口返回了无效的 JSON：${options.chapterId}`);
	}

	if (parsed.code !== 0) {
		const msg =
			typeof parsed.message === "string" && parsed.message.trim()
				? parsed.message
				: `API 返回错误码 ${String(parsed.code)}`;
		throw new Error(msg);
	}

	if (typeof parsed.data?.content !== "string") {
		throw new Error(`章节响应缺少 content 字段：${options.chapterId}`);
	}

	return parsed.data.content;
}

async function withConcurrencyLimit<T>(
	items: readonly T[],
	concurrency: number,
	workerFn: (item: T) => Promise<void>,
): Promise<void> {
	if (items.length === 0) {
		return;
	}
	const limit = Math.max(1, Math.min(concurrency, items.length));
	let nextIndex = 0;

	const run = async (): Promise<void> => {
		while (true) {
			const current = nextIndex;
			nextIndex += 1;
			if (current >= items.length) {
				return;
			}
			const item = items[current];
			if (item !== undefined) {
				await workerFn(item);
			}
		}
	};

	await Promise.all(Array.from({ length: limit }, () => run()));
}

async function runExport(request: EpubWorkerRequest): Promise<void> {
	const { novel } = request;
	const normalizedBase = stripTrailingV1Prefix(request.apiBaseUrl);
	const selectedIdSet = new Set(request.volumeIds);
	const selectedVolumes: Volume[] = novel.volumes.filter((v) =>
		selectedIdSet.has(v.id),
	);

	if (selectedVolumes.length === 0) {
		throw new Error("未选择任何可导出的分卷");
	}

	const selectedAllVolumes =
		selectedVolumes.length === novel.volumes.length &&
		novel.volumes.every(
			(volume, index) => selectedVolumes[index]?.id === volume.id,
		);

	const resolvableChaptersPerVolume = selectedVolumes.map((volume) =>
		volume.chapters.filter((ch) => !isUnresolvedChapterId(ch.id)),
	);
	const totalChapters = resolvableChaptersPerVolume.reduce(
		(sum, list) => sum + list.length,
		0,
	);

	const epubChaptersPerVolume: EpubChapterData[][] = selectedVolumes.map(
		() => [],
	);
	const illustrationUrlsPerVolume: string[][] = selectedVolumes.map(() => []);

	if (totalChapters > 0) {
		emitProgress("chapters", 0, totalChapters, `正在准备 ${totalChapters} 个章节…`);
	}

	let completedChapters = 0;
	for (let vIdx = 0; vIdx < selectedVolumes.length; vIdx += 1) {
		const chapters = resolvableChaptersPerVolume[vIdx];
		const volumeChaptersOut = epubChaptersPerVolume[vIdx];
		const volumeIllustOut = illustrationUrlsPerVolume[vIdx];
		if (!chapters || !volumeChaptersOut || !volumeIllustOut) {
			continue;
		}

		for (const chapter of chapters) {
			const cachedHtml = Object.hasOwn(request.cachedChapters, chapter.id)
				? request.cachedChapters[chapter.id]
				: undefined;
			const rawHtml =
				typeof cachedHtml === "string" && cachedHtml.length > 0
					? cachedHtml
					: await fetchChapterHtml({
							normalizedBase,
							platform: novel.platform,
							novelId: novel.id,
							chapterId: chapter.id,
							authToken: request.authToken,
						});

			const rewritten = rewriteAndExtractImgSrcUrls(
				rawHtml,
				request.apiBaseUrl,
			);
			volumeChaptersOut.push({
				id: chapter.id,
				title: chapter.title,
				html: rewritten.html,
			});
			for (const imgUrl of rewritten.imageUrls) {
				volumeIllustOut.push(imgUrl);
			}

			completedChapters += 1;
			emitProgress(
				"chapters",
				completedChapters,
				totalChapters,
				`已获取章节 (${completedChapters}/${totalChapters})：${chapter.title}`,
			);
		}
	}

	const mediaTaskMap = new Map<string, MediaDownloadTask>();
	const registerMediaTask = (
		rebasedUrl: string,
		role: "novelCover" | "volumeCover" | "illustration",
	): void => {
		if (!rebasedUrl) {
			return;
		}
		let task = mediaTaskMap.get(rebasedUrl);
		if (!task) {
			task = {
				url: rebasedUrl,
				isNovelCover: false,
				isVolumeCover: false,
				isIllustration: false,
			};
			mediaTaskMap.set(rebasedUrl, task);
		}
		if (role === "novelCover") {
			task.isNovelCover = true;
		} else if (role === "volumeCover") {
			task.isVolumeCover = true;
		} else {
			task.isIllustration = true;
		}
	};

	const rebasedNovelCoverUrl = rebaseMediaUrlWithBase(
		novel.coverUrl,
		request.apiBaseUrl,
	);
	registerMediaTask(rebasedNovelCoverUrl, "novelCover");

	const rebasedVolumeCoverUrls = selectedVolumes.map((volume) => {
		const rebased = rebaseMediaUrlWithBase(volume.coverUrl, request.apiBaseUrl);
		registerMediaTask(rebased, "volumeCover");
		return rebased;
	});

	for (const urls of illustrationUrlsPerVolume) {
		for (const imgUrl of urls) {
			registerMediaTask(imgUrl, "illustration");
		}
	}

	const mediaTasks = [...mediaTaskMap.values()];
	const assetByUrl = new Map<string, EpubImageAsset>();
	let completedMedia = 0;

	if (mediaTasks.length > 0) {
		emitProgress(
			"images",
			0,
			mediaTasks.length,
			`正在下载 ${mediaTasks.length} 个图片资源…`,
		);

		await withConcurrencyLimit(
			mediaTasks,
			MEDIA_DOWNLOAD_CONCURRENCY,
			async (task) => {
				try {
					// Media routes (/cover/* and /illustration/*) MUST NOT send Authorization.
					const response = await fetch(task.url, { method: "GET" });
					if (!response.ok) {
						if (
							response.status === 404 &&
							task.isVolumeCover &&
							!task.isIllustration
						) {
							return;
						}
						if (task.isIllustration) {
							console.warn(
								`[epub.worker] 插图下载失败 (${response.status})，已降级跳过：${task.url}`,
							);
							return;
						}
						console.warn(
							`[epub.worker] 封面下载失败 (${response.status})，已省略：${task.url}`,
						);
						return;
					}

					const contentType = response.headers.get("content-type") ?? "";
					const mimeType =
						contentType.split(";")[0]?.trim().toLowerCase() || "image/jpeg";
					if (mimeType.includes("json")) {
						if (task.isVolumeCover && !task.isIllustration) {
							return;
						}
						console.warn(
							`[epub.worker] 媒体返回 JSON 而非图片，已忽略：${task.url}`,
						);
						return;
					}
					const arrayBuffer = await response.arrayBuffer();
					assetByUrl.set(task.url, {
						sourceUrl: task.url,
						data: new Uint8Array(arrayBuffer),
						mimeType,
					});
				} catch (error) {
					if (task.isIllustration) {
						console.warn(
							`[epub.worker] 插图请求异常，已降级跳过：${task.url}`,
							error,
						);
					} else if (!task.isVolumeCover || task.isNovelCover) {
						console.warn(
							`[epub.worker] 封面请求异常，已省略：${task.url}`,
							error,
						);
					}
				} finally {
					completedMedia += 1;
					emitProgress(
						"images",
						completedMedia,
						mediaTasks.length,
						`已下载图片 (${completedMedia}/${mediaTasks.length})`,
					);
				}
			},
		);
	}

	emitProgress("packaging", 0, 1, "正在打包 EPUB 文件…");

	const novelCover = rebasedNovelCoverUrl
		? assetByUrl.get(rebasedNovelCoverUrl)
		: undefined;
	const summaryText = novel.summary.trim() ? novel.summary : undefined;
	const genresList = novel.genres.length > 0 ? novel.genres : undefined;

	let epubBytes: Uint8Array;
	let fileName: string;

	if (request.kind === "volume") {
		const targetVolume = selectedVolumes[0];
		const chapters = epubChaptersPerVolume[0] ?? [];
		const volumeIllustUrls = illustrationUrlsPerVolume[0] ?? [];
		const rebasedVolCover = rebasedVolumeCoverUrls[0] ?? "";
		if (!targetVolume) {
			throw new Error("未找到目标分卷");
		}

		const volumeCover = rebasedVolCover
			? assetByUrl.get(rebasedVolCover)
			: undefined;
		const illustrations: EpubImageAsset[] = [];
		const seenIllustUrls = new Set<string>();
		for (const imgUrl of volumeIllustUrls) {
			if (seenIllustUrls.has(imgUrl)) {
				continue;
			}
			seenIllustUrls.add(imgUrl);
			const asset = assetByUrl.get(imgUrl);
			if (asset) {
				illustrations.push(asset);
			}
		}

		const volumeInput: VolumeEpubInput = {
			identifier: `urn:acanthis:${novel.platform}:${novel.id}:vol:${targetVolume.id}`,
			novelTitle: novel.title,
			volumeTitle: targetVolume.title,
			author: novel.author,
			summary: summaryText,
			genres: genresList,
			cover: volumeCover ?? novelCover,
			chapters,
			illustrations,
		};
		epubBytes = buildVolumeEpub(volumeInput);
		fileName = `${sanitizeFilename(`[${novel.author}] ${novel.title} - ${targetVolume.title}`)}.epub`;
	} else {
		const epubVolumes: EpubVolumeData[] = [];
		const allIllustrations: EpubImageAsset[] = [];
		const seenIllustUrls = new Set<string>();

		for (let vIdx = 0; vIdx < selectedVolumes.length; vIdx += 1) {
			const volume = selectedVolumes[vIdx];
			const chapters = epubChaptersPerVolume[vIdx];
			const volumeIllustUrls = illustrationUrlsPerVolume[vIdx];
			const rebasedVolCover = rebasedVolumeCoverUrls[vIdx] ?? "";
			if (!volume || !chapters || !volumeIllustUrls) {
				continue;
			}

			const volumeCover = rebasedVolCover
				? assetByUrl.get(rebasedVolCover)
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
				const asset = assetByUrl.get(imgUrl);
				if (asset) {
					allIllustrations.push(asset);
				}
			}
		}

		const novelInput: NovelEpubInput = {
			identifier: `urn:acanthis:${novel.platform}:${novel.id}`,
			title: novel.title,
			author: novel.author,
			summary: summaryText,
			genres: genresList,
			cover: novelCover,
			volumes: epubVolumes,
			illustrations: allIllustrations,
		};
		epubBytes = buildNovelEpub(novelInput);
		const baseName = sanitizeFilename(`[${novel.author}] ${novel.title}`);
		const suffix = selectedAllVolumes ? "" : " (选集)";
		fileName = `${baseName}${suffix}.epub`;
	}

	emitProgress("packaging", 1, 1, "EPUB 打包完成");

	const transferBuffer = new Uint8Array(epubBytes).buffer;
	postResponse(
		{
			type: "done",
			fileName,
			buffer: transferBuffer,
		},
		[transferBuffer],
	);
}

workerSelf.onmessage = (event: MessageEvent<EpubWorkerRequest>): void => {
	void runExport(event.data).catch((error: unknown) => {
		const message =
			error instanceof Error && error.message
				? error.message
				: String(error || "EPUB 导出失败");
		postResponse({
			type: "error",
			message,
		});
	});
};
