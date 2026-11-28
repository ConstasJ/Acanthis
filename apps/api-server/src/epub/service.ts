import { createHash, randomUUID } from "node:crypto";
import {
	CloudflareBlockError,
	FlareSolverrError,
	HttpStatusError,
} from "@acanthis-dec/browser-fetch";
import type { Novel, Volume } from "@acanthis-dec/core";
import { buildVolumeEpub, type EpubImageAsset } from "@acanthis-dec/epub";
import {
	extractChapterIllustrationUrls,
	isUnresolvedChapterId,
	type LinovelibClient,
	rewriteChapterIllustrations,
} from "@acanthis-dec/linovelib";
import { getUrlHash, type StorageService } from "@acanthis-dec/storage";
import {
	computeVolumeChapterSignature,
	computeVolumeContentFingerprint,
	type EpubDiskCache,
} from "./cache";
import {
	buildEpubDedupeKey,
	buildEpubDownloadPath,
	EPUB_CONTENT_SCHEMA_VERSION,
	type EpubCachedArtifact,
	type EpubCacheKey,
	type EpubImageProcessor,
	type EpubJobRecord,
	type EpubJobStore,
	type EpubLogger,
	type EpubProfile,
	type EpubTriggerSource,
	type VolumeEpubStatusItem,
} from "./types";

const MEDIA_FETCH_CONCURRENCY = 3;

export interface CreateVolumeEpubJobOptions {
	novelId: string;
	volumeId: string;
	profile: EpubProfile;
	refresh: boolean;
	triggerSource: EpubTriggerSource;
}

export interface CreateVolumeEpubJobResult {
	hitCache: boolean;
	job: EpubJobRecord;
}

export interface VolumeEpubServiceOptions {
	platform?: string | undefined;
	linovelibClient: LinovelibClient;
	storageService: StorageService;
	jobStore: EpubJobStore;
	diskCache: EpubDiskCache;
	imageProcessor: EpubImageProcessor;
	logger: EpubLogger;
	maxConcurrentJobs: number;
}

interface QueuedBuildTask {
	jobId: string;
	novelId: string;
	volumeId: string;
	profile: EpubProfile;
	refresh: boolean;
}

interface ResolvedChapter {
	id: string;
	title: string;
	html: string;
	contentHash: string;
}

function sha256Hex16(data: Uint8Array | string): string {
	return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

function isFatalUpstreamError(error: unknown): boolean {
	if (
		error instanceof CloudflareBlockError ||
		error instanceof FlareSolverrError
	) {
		return true;
	}
	if (
		error instanceof HttpStatusError &&
		(error.status === 401 || error.status === 403 || error.status === 429)
	) {
		return true;
	}
	return false;
}

function formatErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function runWithConcurrency<T>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	if (items.length === 0) {
		return;
	}
	const limit = Math.max(1, Math.min(concurrency, items.length));
	let nextIndex = 0;

	const runWorker = async (): Promise<void> => {
		while (true) {
			const idx = nextIndex;
			nextIndex += 1;
			if (idx >= items.length) {
				return;
			}
			const item = items[idx];
			if (item !== undefined) {
				await worker(item);
			}
		}
	};

	await Promise.all(Array.from({ length: limit }, () => runWorker()));
}

export class VolumeEpubService {
	private readonly platform: string;
	private readonly linovelibClient: LinovelibClient;
	private readonly storageService: StorageService;
	private readonly jobStore: EpubJobStore;
	private readonly diskCache: EpubDiskCache;
	private readonly imageProcessor: EpubImageProcessor;
	private readonly logger: EpubLogger;
	private readonly maxConcurrentJobs: number;
	private readonly pendingQueue: QueuedBuildTask[] = [];
	private readonly inFlightCreates = new Map<
		string,
		Promise<CreateVolumeEpubJobResult>
	>();
	private runningCount = 0;

	constructor(options: VolumeEpubServiceOptions) {
		this.platform = options.platform ?? "linovelib";
		this.linovelibClient = options.linovelibClient;
		this.storageService = options.storageService;
		this.jobStore = options.jobStore;
		this.diskCache = options.diskCache;
		this.imageProcessor = options.imageProcessor;
		this.logger = options.logger;
		this.maxConcurrentJobs = Math.max(1, Math.floor(options.maxConcurrentJobs));
	}

	private buildKey(
		novelId: string,
		volumeId: string,
		profile: EpubProfile,
	): EpubCacheKey {
		return {
			platform: this.platform,
			novelId,
			volumeId,
			profile,
		};
	}

	getJob(jobId: string): EpubJobRecord | undefined {
		this.jobStore.pruneExpired(Date.now());
		return this.jobStore.get(jobId);
	}

	async getDownloadArtifact(
		novelId: string,
		volumeId: string,
		profile: EpubProfile,
	): Promise<EpubCachedArtifact | null> {
		const key = this.buildKey(novelId, volumeId, profile);
		return await this.diskCache.getArtifact(key, { touch: true });
	}

	private async computeCurrentVolumeChapterSignature(
		novelId: string,
		volume: Volume,
		profile: EpubProfile,
	): Promise<{ signature: string; validChapterCount: number }> {
		const validChapters = volume.chapters.filter(
			(chapter) => !isUnresolvedChapterId(chapter.id),
		);
		const chapterMetas = await Promise.all(
			validChapters.map((chapter) =>
				this.storageService.getChapterFromId(this.platform, chapter.id),
			),
		);
		const signature = computeVolumeChapterSignature({
			platform: this.platform,
			novelId,
			volumeId: volume.id,
			profile,
			epubSchemaVersion: EPUB_CONTENT_SCHEMA_VERSION,
			chapters: validChapters.map((chapter, index) => ({
				id: chapter.id,
				contentHash: chapterMetas[index]?.contentHash ?? "",
			})),
		});
		return {
			signature,
			validChapterCount: validChapters.length,
		};
	}

	private async buildVolumeStatusItem(
		novelId: string,
		volumeId: string,
		volume: Volume | undefined,
		profile: EpubProfile,
	): Promise<VolumeEpubStatusItem> {
		const key = this.buildKey(novelId, volumeId, profile);
		const dedupeKey = buildEpubDedupeKey(key);
		const activeJob = this.jobStore.findActiveByDedupeKey(dedupeKey);
		const validChapters = volume
			? volume.chapters.filter((chapter) => !isUnresolvedChapterId(chapter.id))
			: [];
		const cached = await this.diskCache.getArtifact(key, { touch: false });

		if (!cached) {
			return {
				volumeId,
				cached: false,
				contentFingerprint: null,
				stale: false,
				chapterCount: validChapters.length,
				sizeBytes: null,
				generatedAt: null,
				activeJobId: activeJob?.jobId ?? null,
			};
		}

		let stale = false;
		if (volume) {
			if (cached.metadata.chapterSignature) {
				const { signature } = await this.computeCurrentVolumeChapterSignature(
					novelId,
					volume,
					profile,
				);
				stale = signature !== cached.metadata.chapterSignature;
			} else {
				stale = validChapters.length !== cached.metadata.chapterCount;
			}
		}

		return {
			volumeId,
			cached: true,
			contentFingerprint: cached.metadata.contentFingerprint,
			stale,
			chapterCount: volume
				? validChapters.length
				: cached.metadata.chapterCount,
			sizeBytes: cached.sizeBytes,
			generatedAt: cached.metadata.generatedAt,
			activeJobId: activeJob?.jobId ?? null,
		};
	}

	async getNovelVolumesStatus(
		novelId: string,
		profile: EpubProfile,
	): Promise<VolumeEpubStatusItem[]> {
		this.jobStore.pruneExpired(Date.now());
		const cachedNovel = await this.storageService.getNovelCache(
			this.platform,
			novelId,
		);
		if (!cachedNovel || cachedNovel.volumes.length === 0) {
			return [];
		}

		return await Promise.all(
			cachedNovel.volumes.map((volume) =>
				this.buildVolumeStatusItem(novelId, volume.id, volume, profile),
			),
		);
	}

	async getVolumeStatus(
		novelId: string,
		volumeId: string,
		profile: EpubProfile,
	): Promise<VolumeEpubStatusItem> {
		this.jobStore.pruneExpired(Date.now());
		const cachedNovel = await this.storageService.getNovelCache(
			this.platform,
			novelId,
		);
		const volume = cachedNovel?.volumes.find((item) => item.id === volumeId);
		return await this.buildVolumeStatusItem(novelId, volumeId, volume, profile);
	}

	async createOrReuseJob(
		options: CreateVolumeEpubJobOptions,
	): Promise<CreateVolumeEpubJobResult> {
		const key = this.buildKey(
			options.novelId,
			options.volumeId,
			options.profile,
		);
		const dedupeKey = buildEpubDedupeKey(key);

		const inFlight = this.inFlightCreates.get(dedupeKey);
		if (inFlight) {
			this.logger.debug(
				`[EPUB] 复用并发创建中的任务请求: dedupeKey=${dedupeKey}`,
			);
			return await inFlight;
		}

		const createPromise = this.createOrReuseJobInternal(
			options,
			key,
			dedupeKey,
		).finally(() => {
			if (this.inFlightCreates.get(dedupeKey) === createPromise) {
				this.inFlightCreates.delete(dedupeKey);
			}
		});
		this.inFlightCreates.set(dedupeKey, createPromise);
		return await createPromise;
	}

	private async createOrReuseJobInternal(
		options: CreateVolumeEpubJobOptions,
		key: EpubCacheKey,
		dedupeKey: string,
	): Promise<CreateVolumeEpubJobResult> {
		const now = Date.now();
		this.jobStore.pruneExpired(now);

		const existingActive = this.jobStore.findActiveByDedupeKey(dedupeKey);
		if (existingActive) {
			this.logger.debug(
				`[EPUB] 复用在途构建任务: dedupeKey=${dedupeKey} jobId=${existingActive.jobId}`,
			);
			return {
				hitCache: false,
				job: existingActive,
			};
		}

		if (!options.refresh) {
			const cached = await this.diskCache.getArtifact(key, { touch: false });
			if (cached) {
				const cachedNovel = await this.storageService.getNovelCache(
					this.platform,
					options.novelId,
				);
				const volume = cachedNovel?.volumes.find(
					(item) => item.id === options.volumeId,
				);
				let canReuse = false;
				if (volume && cached.metadata.chapterSignature) {
					const { signature } = await this.computeCurrentVolumeChapterSignature(
						options.novelId,
						volume,
						options.profile,
					);
					canReuse = signature === cached.metadata.chapterSignature;
				} else if (volume) {
					const validCount = volume.chapters.filter(
						(chapter) => !isUnresolvedChapterId(chapter.id),
					).length;
					canReuse = validCount === cached.metadata.chapterCount;
				}

				if (canReuse) {
					const touched =
						(await this.diskCache.getArtifact(key, { touch: true })) ?? cached;
					const readyJob = this.jobStore.create({
						jobId: randomUUID(),
						dedupeKey,
						platform: this.platform,
						novelId: options.novelId,
						volumeId: options.volumeId,
						profile: options.profile,
						triggerSource: options.triggerSource,
						status: "ready",
						phaseMessage: "命中有效磁盘缓存",
						current: touched.metadata.chapterCount,
						total: touched.metadata.chapterCount,
						warnings: touched.metadata.warnings,
						artifact: {
							contentFingerprint: touched.metadata.contentFingerprint,
							sizeBytes: touched.sizeBytes,
							chapterCount: touched.metadata.chapterCount,
							generatedAt: touched.metadata.generatedAt,
							downloadPath: buildEpubDownloadPath(key),
						},
						createdAt: now,
						updatedAt: now,
					});
					this.logger.debug(
						`[EPUB] 命中磁盘缓存直接返回: dedupeKey=${dedupeKey} fingerprint=${touched.metadata.contentFingerprint}`,
					);
					return {
						hitCache: true,
						job: readyJob,
					};
				}
			}
		}

		const queuedJob = this.jobStore.create({
			jobId: randomUUID(),
			dedupeKey,
			platform: this.platform,
			novelId: options.novelId,
			volumeId: options.volumeId,
			profile: options.profile,
			triggerSource: options.triggerSource,
			status: "queued",
			phaseMessage: "任务已入队，等待执行",
			current: 0,
			total: 0,
			warnings: [],
			createdAt: now,
			updatedAt: now,
		});

		this.pendingQueue.push({
			jobId: queuedJob.jobId,
			novelId: options.novelId,
			volumeId: options.volumeId,
			profile: options.profile,
			refresh: options.refresh,
		});
		this.drainQueue();

		return {
			hitCache: false,
			job: this.jobStore.get(queuedJob.jobId) ?? queuedJob,
		};
	}

	private drainQueue(): void {
		while (
			this.runningCount < this.maxConcurrentJobs &&
			this.pendingQueue.length > 0
		) {
			const nextTask = this.pendingQueue.shift();
			if (!nextTask) {
				break;
			}
			this.runningCount += 1;
			void this.executeBuild(nextTask).finally(() => {
				this.runningCount -= 1;
				this.drainQueue();
			});
		}
	}

	private async resolveNovelAndVolume(
		novelId: string,
		volumeId: string,
		refresh: boolean,
	): Promise<{ novel: Novel; volume: Volume }> {
		const cachedNovel = await this.storageService.getNovelCache(
			this.platform,
			novelId,
		);
		const validCachedNovel =
			cachedNovel &&
			cachedNovel.author !== "" &&
			cachedNovel.status !== "unknown" &&
			cachedNovel.volumes.length > 0
				? cachedNovel
				: null;

		const hasVolumeInCache = Boolean(
			validCachedNovel?.volumes.some((item) => item.id === volumeId),
		);

		let novel: Novel | null = validCachedNovel;
		if (refresh || !validCachedNovel || !hasVolumeInCache) {
			let fetchedNovel: Novel | undefined;
			try {
				fetchedNovel = await this.linovelibClient.getNovelInfo(novelId);
			} catch (error) {
				if (validCachedNovel && hasVolumeInCache) {
					this.logger.warn(
						`[EPUB] 刷新小说目录失败，降级使用本地缓存: novelId=${novelId} error=${formatErrorMessage(error)}`,
					);
				} else {
					throw error;
				}
			}

			if (
				fetchedNovel &&
				fetchedNovel.title.trim() !== "" &&
				fetchedNovel.volumes.length > 0
			) {
				await this.storageService.addNovelCache(fetchedNovel);
				novel = fetchedNovel;
			}
		}

		if (!novel) {
			throw new Error(`Novel ${novelId} not found`);
		}

		const volume = novel.volumes.find((item) => item.id === volumeId);
		if (!volume) {
			throw new Error(`Volume ${volumeId} not found in novel ${novelId}`);
		}

		return { novel, volume };
	}

	private async fetchVolumeCoverAsset(
		novel: Novel,
		volume: Volume,
		warnings: string[],
	): Promise<EpubImageAsset | undefined> {
		try {
			const cachedVolCover = await this.storageService.getCoverData(
				"volume",
				this.platform,
				volume.id,
			);
			if (cachedVolCover?.data && cachedVolCover.data.byteLength > 0) {
				return {
					sourceUrl: volume.coverUrl || `volume:${volume.id}`,
					data: new Uint8Array(cachedVolCover.data),
					mimeType: cachedVolCover.mimeType || "image/jpeg",
				};
			}

			if (volume.coverUrl?.trim()) {
				const fetched = await this.linovelibClient.getCover(volume.coverUrl);
				if (fetched?.data && fetched.data.byteLength > 0) {
					const mimeType = fetched.mimeType || "image/jpeg";
					await this.storageService.setCoverData(
						"volume",
						volume.coverUrl,
						fetched.data,
						mimeType,
						this.platform,
						volume.id,
					);
					return {
						sourceUrl: volume.coverUrl,
						data: new Uint8Array(fetched.data),
						mimeType,
					};
				}
			}
		} catch (error) {
			if (isFatalUpstreamError(error)) {
				throw error;
			}
			warnings.push(
				`分卷封面获取失败，将尝试回退小说封面: ${formatErrorMessage(error)}`,
			);
		}

		try {
			const cachedNovelCover = await this.storageService.getCoverData(
				"novel",
				this.platform,
				novel.id,
			);
			if (cachedNovelCover?.data && cachedNovelCover.data.byteLength > 0) {
				return {
					sourceUrl: novel.coverUrl || `novel:${novel.id}`,
					data: new Uint8Array(cachedNovelCover.data),
					mimeType: cachedNovelCover.mimeType || "image/jpeg",
				};
			}

			if (novel.coverUrl?.trim()) {
				const fetched = await this.linovelibClient.getCover(novel.coverUrl);
				if (fetched?.data && fetched.data.byteLength > 0) {
					const mimeType = fetched.mimeType || "image/jpeg";
					await this.storageService.setCoverData(
						"novel",
						novel.coverUrl,
						fetched.data,
						mimeType,
						this.platform,
						novel.id,
					);
					return {
						sourceUrl: novel.coverUrl,
						data: new Uint8Array(fetched.data),
						mimeType,
					};
				}
			} else {
				const { data: fetched, url: coverUrl } =
					await this.linovelibClient.getNovelCover(novel.id);
				if (fetched?.data && fetched.data.byteLength > 0) {
					const mimeType = fetched.mimeType || "image/jpeg";
					await this.storageService.setCoverData(
						"novel",
						coverUrl,
						fetched.data,
						mimeType,
						this.platform,
						novel.id,
					);
					return {
						sourceUrl: coverUrl,
						data: new Uint8Array(fetched.data),
						mimeType,
					};
				}
			}
		} catch (error) {
			if (isFatalUpstreamError(error)) {
				throw error;
			}
			warnings.push(
				`小说封面获取失败，已省略封面: ${formatErrorMessage(error)}`,
			);
		}

		return undefined;
	}

	private async executeBuild(task: QueuedBuildTask): Promise<void> {
		const { jobId, novelId, volumeId, profile, refresh } = task;
		const key = this.buildKey(novelId, volumeId, profile);
		const warnings: string[] = [];

		try {
			this.jobStore.update(jobId, {
				status: "fetching_chapters",
				phaseMessage: "正在加载小说与分卷目录",
				current: 0,
				total: 0,
			});

			const { novel, volume } = await this.resolveNovelAndVolume(
				novelId,
				volumeId,
				refresh,
			);

			const totalChapterEntries = volume.chapters.length;
			this.jobStore.update(jobId, {
				status: "fetching_chapters",
				phaseMessage: `正在补齐章节正文 (0/${totalChapterEntries})`,
				current: 0,
				total: totalChapterEntries,
			});

			const resolvedChapters: ResolvedChapter[] = [];
			const illustrationUrlSet = new Set<string>();
			let processedChapters = 0;

			for (const chapter of volume.chapters) {
				if (isUnresolvedChapterId(chapter.id)) {
					warnings.push(`跳过未解析章节 "${chapter.title}" (${chapter.id})`);
					processedChapters += 1;
					this.jobStore.update(jobId, {
						status: "fetching_chapters",
						current: processedChapters,
						total: totalChapterEntries,
						phaseMessage: `正在补齐章节正文 (${processedChapters}/${totalChapterEntries})`,
						warnings,
					});
					continue;
				}

				try {
					const chapterMeta = await this.storageService.getChapterFromId(
						this.platform,
						chapter.id,
					);
					let contentHash = chapterMeta?.contentHash ?? undefined;
					let rawHtml = contentHash
						? await this.storageService.getNovelContent(contentHash)
						: undefined;

					if (!rawHtml) {
						rawHtml = await this.linovelibClient.getChapter(
							novel.id,
							chapter.id,
						);
						if (rawHtml) {
							contentHash = await this.storageService.setNovelContent(rawHtml);
							await this.storageService.addNovelContentHash(
								this.platform,
								chapter.id,
								contentHash,
							);
						}
					}

					if (!rawHtml) {
						warnings.push(`跳过空内容章节 "${chapter.title}" (${chapter.id})`);
					} else {
						const urls = extractChapterIllustrationUrls(rawHtml);
						if (urls.length > 0) {
							await this.storageService.registerIllustrations(
								this.platform,
								urls,
							);
							for (const url of urls) {
								illustrationUrlSet.add(url);
							}
						}
						const normalizedHtml = rewriteChapterIllustrations(
							rawHtml,
							(url) => url,
						);
						resolvedChapters.push({
							id: chapter.id,
							title: chapter.title,
							html: normalizedHtml,
							contentHash: contentHash ?? sha256Hex16(rawHtml),
						});
					}
				} catch (error) {
					if (isFatalUpstreamError(error)) {
						throw error;
					}
					warnings.push(
						`跳过获取失败的章节 "${chapter.title}" (${chapter.id}): ${formatErrorMessage(error)}`,
					);
				}

				processedChapters += 1;
				this.jobStore.update(jobId, {
					status: "fetching_chapters",
					current: processedChapters,
					total: totalChapterEntries,
					phaseMessage: `正在补齐章节正文 (${processedChapters}/${totalChapterEntries})`,
					warnings,
				});
			}

			if (resolvedChapters.length === 0) {
				throw new Error(
					`分卷 "${volume.title}" 没有可用的有效章节，无法生成 EPUB`,
				);
			}

			const illustrationUrls = [...illustrationUrlSet];
			const totalMediaItems = illustrationUrls.length + 1;
			this.jobStore.update(jobId, {
				status: "fetching_images",
				phaseMessage: `正在获取封面与插图 (0/${totalMediaItems})`,
				current: 0,
				total: totalMediaItems,
				warnings,
			});

			const rawCover = await this.fetchVolumeCoverAsset(
				novel,
				volume,
				warnings,
			);
			let fetchedMediaCount = 1;
			this.jobStore.update(jobId, {
				status: "fetching_images",
				phaseMessage: `正在获取封面与插图 (${fetchedMediaCount}/${totalMediaItems})`,
				current: fetchedMediaCount,
				total: totalMediaItems,
				warnings,
			});

			const fetchedIllustrationMap = new Map<string, EpubImageAsset>();
			await runWithConcurrency(
				illustrationUrls,
				MEDIA_FETCH_CONCURRENCY,
				async (sourceUrl) => {
					try {
						const urlHash = getUrlHash(sourceUrl);
						const cachedIllust = await this.storageService.getIllustrationData(
							this.platform,
							urlHash,
						);
						if (cachedIllust?.data && cachedIllust.data.byteLength > 0) {
							fetchedIllustrationMap.set(sourceUrl, {
								sourceUrl,
								data: new Uint8Array(cachedIllust.data),
								mimeType: cachedIllust.mimeType || "image/jpeg",
							});
						} else {
							const downloaded =
								await this.linovelibClient.getIllustration(sourceUrl);
							if (downloaded?.data && downloaded.data.byteLength > 0) {
								const mimeType =
									downloaded.mimeType || "application/octet-stream";
								await this.storageService.setIllustrationData(
									this.platform,
									urlHash,
									downloaded.data,
									mimeType,
								);
								fetchedIllustrationMap.set(sourceUrl, {
									sourceUrl,
									data: new Uint8Array(downloaded.data),
									mimeType,
								});
							} else {
								warnings.push(`插图下载为空，已替换为占位文本: ${sourceUrl}`);
							}
						}
					} catch (error) {
						warnings.push(
							`插图获取失败，已替换为占位文本 (${sourceUrl}): ${formatErrorMessage(error)}`,
						);
					} finally {
						fetchedMediaCount += 1;
						this.jobStore.update(jobId, {
							status: "fetching_images",
							phaseMessage: `正在获取封面与插图 (${fetchedMediaCount}/${totalMediaItems})`,
							current: fetchedMediaCount,
							total: totalMediaItems,
							warnings,
						});
					}
				},
			);

			const rawIllustrations: EpubImageAsset[] = [];
			for (const url of illustrationUrls) {
				const asset = fetchedIllustrationMap.get(url);
				if (asset) {
					rawIllustrations.push(asset);
				}
			}

			const chapterEntries = resolvedChapters.map((chapter) => ({
				id: chapter.id,
				contentHash: chapter.contentHash,
			}));
			const coverHash = rawCover ? sha256Hex16(rawCover.data) : "none";
			const chapterSignature = computeVolumeChapterSignature({
				platform: this.platform,
				novelId: novel.id,
				volumeId: volume.id,
				profile,
				epubSchemaVersion: EPUB_CONTENT_SCHEMA_VERSION,
				chapters: chapterEntries,
			});
			const contentFingerprint = computeVolumeContentFingerprint({
				platform: this.platform,
				novelId: novel.id,
				volumeId: volume.id,
				profile,
				epubSchemaVersion: EPUB_CONTENT_SCHEMA_VERSION,
				coverHash,
				chapters: chapterEntries,
			});

			const existingArtifact = await this.diskCache.getArtifact(key, {
				touch: false,
			});
			if (
				existingArtifact &&
				existingArtifact.metadata.contentFingerprint === contentFingerprint
			) {
				const touched =
					(await this.diskCache.getArtifact(key, { touch: true })) ??
					existingArtifact;
				this.jobStore.update(jobId, {
					status: "ready",
					phaseMessage: "内容指纹未变更，复用现有磁盘缓存",
					current: 1,
					total: 1,
					warnings,
					artifact: {
						contentFingerprint: touched.metadata.contentFingerprint,
						sizeBytes: touched.sizeBytes,
						chapterCount: touched.metadata.chapterCount,
						generatedAt: touched.metadata.generatedAt,
						downloadPath: buildEpubDownloadPath(key),
					},
				});
				return;
			}

			const totalImagesToProcess = (rawCover ? 1 : 0) + rawIllustrations.length;
			let processedImages = 0;
			let finalCover = rawCover;
			const finalIllustrations: EpubImageAsset[] = [];

			if (totalImagesToProcess > 0) {
				this.jobStore.update(jobId, {
					status: "processing_images",
					phaseMessage: `正在处理图片 (0/${totalImagesToProcess})`,
					current: 0,
					total: totalImagesToProcess,
					warnings,
				});

				if (rawCover) {
					finalCover = await this.imageProcessor.process(rawCover, profile);
					processedImages += 1;
					this.jobStore.update(jobId, {
						status: "processing_images",
						phaseMessage: `正在处理图片 (${processedImages}/${totalImagesToProcess})`,
						current: processedImages,
						total: totalImagesToProcess,
						warnings,
					});
				}

				for (const asset of rawIllustrations) {
					const processed = await this.imageProcessor.process(asset, profile);
					finalIllustrations.push(processed);
					processedImages += 1;
					this.jobStore.update(jobId, {
						status: "processing_images",
						phaseMessage: `正在处理图片 (${processedImages}/${totalImagesToProcess})`,
						current: processedImages,
						total: totalImagesToProcess,
						warnings,
					});
				}
			}

			this.jobStore.update(jobId, {
				status: "packing",
				phaseMessage: "正在打包并写入 EPUB 缓存",
				current: 0,
				total: 1,
				warnings,
			});

			const generatedAt = new Date().toISOString();
			const epubBytes = buildVolumeEpub({
				identifier: `urn:acanthis:${this.platform}:${novel.id}:vol:${volume.id}`,
				novelTitle: novel.title,
				volumeTitle: volume.title,
				author: novel.author,
				summary: novel.summary.trim() || undefined,
				genres: novel.genres.length > 0 ? novel.genres : undefined,
				cover: finalCover,
				chapters: resolvedChapters.map((chapter) => ({
					id: chapter.id,
					title: chapter.title,
					html: chapter.html,
				})),
				illustrations: finalIllustrations,
				syncMetadata: {
					platform: this.platform,
					novelId: novel.id,
					volumeId: volume.id,
					profile,
					contentFingerprint,
				},
			});

			const savedMeta = await this.diskCache.writeArtifact(key, epubBytes, {
				contentFingerprint,
				chapterCount: resolvedChapters.length,
				generatedAt,
				warnings,
				novelTitle: novel.title,
				volumeTitle: volume.title,
				author: novel.author,
				chapterSignature,
			});

			this.jobStore.update(jobId, {
				status: "ready",
				phaseMessage: "EPUB 构建完成",
				current: 1,
				total: 1,
				warnings,
				artifact: {
					contentFingerprint: savedMeta.contentFingerprint,
					sizeBytes: savedMeta.sizeBytes,
					chapterCount: savedMeta.chapterCount,
					generatedAt: savedMeta.generatedAt,
					downloadPath: buildEpubDownloadPath(key),
				},
			});
		} catch (error) {
			const message = formatErrorMessage(error);
			this.logger.error(
				`[EPUB] 构建任务失败: jobId=${jobId} novelId=${novelId} volumeId=${volumeId} profile=${profile} error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
			);
			this.jobStore.update(jobId, {
				status: "failed",
				phaseMessage: "EPUB 构建失败",
				warnings,
				error: message,
			});
		}
	}
}
