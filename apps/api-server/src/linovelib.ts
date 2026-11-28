import {
	CloudflareBlockError,
	FlareSolverrError,
	HttpStatusError,
	NetworkError,
} from "@acanthis-dec/browser-fetch";
import type {
	ExploreHomeData,
	ExploreNovelItem,
	ExplorePage,
	Novel,
	NovelSearchResult,
} from "@acanthis-dec/core";
import {
	extractChapterIllustrationUrls,
	type LinovelibClient,
	rewriteChapterIllustrations,
	SearchRateLimitError,
	SearchVerificationError,
} from "@acanthis-dec/linovelib";
import {
	getUrlHash,
	type ListNovelsOptions,
	type StorageService,
} from "@acanthis-dec/storage";
import { type Context, Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import z from "zod";
import { MemoryTtlCache } from "./cache";
import { createEpubRoutes } from "./epub";
import type { VolumeEpubService } from "./epub/service";
import {
	apiErrorSchema,
	bearerSecurity,
	binaryImageResponse,
	internalErrorResponse,
	jsonResponse,
	legacyErrorSchema,
	noStoreHeader,
	unauthorizedResponse,
	upstreamErrorResponses,
	validationErrorResponse,
} from "./schemas/common";
import {
	cachedGenresResponseSchema,
	catalogQuerySchema,
	catalogResponseSchema,
	chapterParamSchema,
	chapterQuerySchema,
	chapterResponseSchema,
	exploreHomeResponseSchema,
	exploreSchemaResponseSchema,
	homeQuerySchema,
	illustrationParamSchema,
	novelDetailResponseSchema,
	novelParamSchema,
	novelStyleQuerySchema,
	novelsQuerySchema,
	novelsResponseSchema,
	rankingsQuerySchema,
	rankingsResponseSchema,
	searchQuerySchema,
	searchResponseSchema,
	volumeParamSchema,
} from "./schemas/linovelib";
import {
	isUpdateNeeded,
	resolveHost,
	transformOutputStyleForNovel,
	transformOutputStyleForSearchResult,
} from "./utils";

export interface LinovelibRouteDeps {
	linovelibClient: LinovelibClient;
	storageService: StorageService;
	volumeEpubService: VolumeEpubService;
	logger: {
		debug: (message: string) => unknown;
		info: (message: string) => unknown;
		warn: (message: string) => unknown;
		error: (message: string) => unknown;
	};
	host?: string | undefined;
}

function buildProxiedNovelCoverUrl(novelId: string, host: string): string {
	return `${host}/v1/linovelib/cover/novel/${novelId}`;
}

function rewriteExploreItemCover(
	item: ExploreNovelItem,
	host: string,
): ExploreNovelItem {
	return {
		...item,
		coverUrl: buildProxiedNovelCoverUrl(item.id, host),
	};
}

function rewriteExploreHomeCovers(
	home: ExploreHomeData,
	host: string,
): ExploreHomeData {
	return {
		...home,
		sections: home.sections.map((section) => ({
			...section,
			items: section.items.map((item) => rewriteExploreItemCover(item, host)),
		})),
	};
}

function rewriteExplorePageCovers(
	page: ExplorePage,
	host: string,
): ExplorePage {
	return {
		...page,
		items: page.items.map((item) => rewriteExploreItemCover(item, host)),
	};
}

function handleLinovelibError(
	c: Context,
	logger: LinovelibRouteDeps["logger"],
	error: unknown,
	notFound?: { code: number; message: string },
) {
	if (error instanceof CloudflareBlockError) {
		logger.warn(`Cloudflare blocked upstream request: ${error.url}`);
		return c.json(
			{
				code: 20001,
				message: "Upstream request blocked by Cloudflare, please retry later",
			},
			503,
			{
				"Retry-After": "15",
				"Cache-Control": "no-store",
			},
		);
	}
	if (error instanceof FlareSolverrError) {
		logger.warn(
			`FlareSolverr failed for endpoint ${error.endpoint}: ${error.responseText}`,
		);
		return c.json(
			{
				code: 20002,
				message: "Upstream Cloudflare challenge failed, please retry later",
			},
			503,
			{
				"Retry-After": "15",
				"Cache-Control": "no-store",
			},
		);
	}
	if (error instanceof SearchRateLimitError) {
		logger.warn(`Upstream search rate limited: ${error.message}`);
		return c.json(
			{
				code: 20001,
				message: "Upstream search rate limited, please retry later",
			},
			503,
			{
				"Retry-After": "15",
				"Cache-Control": "no-store",
			},
		);
	}
	if (error instanceof SearchVerificationError) {
		logger.warn(`Upstream search verification failed: ${error.message}`);
		return c.json(
			{
				code: 20002,
				message: "Upstream search verification failed, please retry later",
			},
			503,
			{
				"Retry-After": "15",
				"Cache-Control": "no-store",
			},
		);
	}
	if (error instanceof HttpStatusError) {
		if (error.status === 404 && notFound) {
			logger.warn(`Upstream returned 404 for ${error.url}`);
			return c.json(notFound, 404, {
				"Cache-Control": "no-store",
			});
		}
		if (error.status === 429) {
			logger.warn(`Upstream rate limited request: ${error.url}`);
			return c.json(
				{
					code: 20001,
					message: "Upstream rate limited, please retry later",
				},
				503,
				{
					"Retry-After": "15",
					"Cache-Control": "no-store",
				},
			);
		}
		if (error.status >= 500) {
			logger.warn(`Upstream returned ${error.status} for ${error.url}`);
			return c.json(
				{
					code: 20003,
					message: "Upstream service error",
				},
				502,
				{
					"Cache-Control": "no-store",
				},
			);
		}
	}
	if (error instanceof NetworkError) {
		logger.warn(`Upstream network error for ${error.url}: ${error.message}`);
		const isTimeout = /timeout|timed out/i.test(error.message);
		return c.json(
			{
				code: 20003,
				message: isTimeout
					? "Upstream request timed out, please retry later"
					: "Upstream network error, please retry later",
			},
			isTimeout ? 504 : 502,
			{
				"Retry-After": "5",
				"Cache-Control": "no-store",
			},
		);
	}
	logger.error(`${error instanceof Error ? error.stack : String(error)}`);
	return c.json(
		{
			code: 20000,
			message: "Internal Server Error",
		},
		500,
		{
			"Cache-Control": "no-store",
		},
	);
}

export function createLinovelibRoutes(deps: LinovelibRouteDeps) {
	const { linovelibClient, storageService, logger } = deps;
	const app = new Hono();

	const inFlightIllustrations = new Map<
		string,
		Promise<{ data: Buffer; mimeType: string } | null>
	>();
	const inFlightSearches = new Map<string, Promise<NovelSearchResult[]>>();
	const emptySearchCache = new MemoryTtlCache<true>({
		ttlMs: 2 * 60 * 1000,
		maxEntries: 200,
		name: "emptySearch",
		logger,
	});
	const homeCache = new MemoryTtlCache<ExploreHomeData>({
		name: "home",
		logger,
	});
	const rankingsCache = new MemoryTtlCache<ExplorePage>({
		name: "rankings",
		logger,
	});
	const catalogCache = new MemoryTtlCache<ExplorePage>({
		name: "catalog",
		logger,
	});

	app.get(
		"/explore/schema",
		describeRoute({
			tags: ["Linovelib"],
			operationId: "getLinovelibExploreSchema",
			summary: "获取发现页与书库筛选 Schema",
			description:
				"返回哔哩轻小说支持的频道列表、排行榜定义及书库多维筛选项，供客户端动态渲染发现页与筛选条件",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(
					exploreSchemaResponseSchema,
					"成功返回频道、榜单及书库筛选定义",
					{
						"Cache-Control": {
							description: "客户端缓存控制策略",
							schema: { type: "string", examples: ["public, max-age=3600"] },
						},
					},
				),
				401: unauthorizedResponse,
			},
		}),
		(c) => {
			return c.json(
				{
					code: 0,
					message: "Success",
					data: linovelibClient.getExploreSchema(),
				},
				200,
				{
					"Cache-Control": "public, max-age=3600",
				},
			);
		},
	);

	app.get(
		"/home",
		describeRoute({
			tags: ["Linovelib"],
			operationId: "getLinovelibHome",
			summary: "获取发现频道首页推荐",
			description:
				"按频道 ID 获取哔哩轻小说首页推荐栏目及重写封面代理后的条目列表",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(exploreHomeResponseSchema, "成功返回频道推荐栏目"),
				400: validationErrorResponse,
				401: unauthorizedResponse,
				500: internalErrorResponse,
				...upstreamErrorResponses,
			},
		}),
		validator("query", homeQuerySchema),
		async (c) => {
			try {
				const { channel } = c.req.valid("query");
				const host = resolveHost(c, deps.host);
				const data = await homeCache.getOrLoad(`home:${channel}`, () =>
					linovelibClient.getExploreHome(channel),
				);
				return c.json({
					code: 0,
					message: "Success",
					data: rewriteExploreHomeCovers(data, host),
				});
			} catch (error) {
				return handleLinovelibError(c, logger, error);
			}
		},
	);

	app.get(
		"/rankings",
		describeRoute({
			tags: ["Linovelib"],
			operationId: "getLinovelibRankings",
			summary: "获取排行榜小说列表",
			description:
				"按榜单 ID、是否完整榜与页码获取排行结果；部分榜单仅支持 full=true；支持通过 style=acanthis|lnreader 切换返回结构",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(rankingsResponseSchema, "成功返回排行榜数据"),
				400: validationErrorResponse,
				401: unauthorizedResponse,
				500: internalErrorResponse,
				...upstreamErrorResponses,
			},
		}),
		validator("query", rankingsQuerySchema),
		async (c) => {
			try {
				const { rank, full, page, style } = c.req.valid("query");
				const host = resolveHost(c, deps.host);
				const cacheKey = `rankings:${rank}:${full ? "full" : "all"}:${page}`;
				const data = await rankingsCache.getOrLoad(cacheKey, () =>
					linovelibClient.getRankings({ rank, full, page }),
				);
				const rewritten = rewriteExplorePageCovers(data, host);
				return c.json({
					code: 0,
					message: "Success",
					data:
						style === "lnreader"
							? rewritten.items.map((item) =>
									transformOutputStyleForSearchResult(item, style),
								)
							: rewritten,
				});
			} catch (error) {
				return handleLinovelibError(c, logger, error);
			}
		},
	);

	app.get(
		"/catalog",
		describeRoute({
			tags: ["Linovelib"],
			operationId: "getLinovelibCatalog",
			summary: "按组合条件筛选书库",
			description:
				"按排序、地区/文库、题材标签、连载状态、动画化、字数与更新时间组合分页筛选书库；支持 style=acanthis|lnreader 切换返回结构",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(catalogResponseSchema, "成功返回书库分页数据"),
				400: validationErrorResponse,
				401: unauthorizedResponse,
				500: internalErrorResponse,
				...upstreamErrorResponses,
			},
		}),
		validator("query", catalogQuerySchema),
		async (c) => {
			try {
				const {
					sort,
					region,
					tag,
					progress,
					anime,
					words,
					updated,
					page,
					style,
				} = c.req.valid("query");
				const host = resolveHost(c, deps.host);
				const cacheKey = `catalog:${sort}:${region}:${tag}:${progress}:${anime}:${words}:${updated}:${page}`;
				const data = await catalogCache.getOrLoad(cacheKey, () =>
					linovelibClient.getCatalog({
						sort,
						region,
						tag,
						progress,
						anime,
						words,
						updated,
						page,
					}),
				);
				const rewritten = rewriteExplorePageCovers(data, host);
				return c.json({
					code: 0,
					message: "Success",
					data:
						style === "lnreader"
							? rewritten.items.map((item) =>
									transformOutputStyleForSearchResult(item, style),
								)
							: rewritten,
				});
			} catch (error) {
				return handleLinovelibError(c, logger, error);
			}
		},
	);

	app.get(
		"/chapter/:chapterId",
		describeRoute({
			tags: ["Linovelib"],
			operationId: "getLinovelibChapter",
			summary: "获取解扰后的章节正文 HTML",
			description:
				"获取指定章节的解扰正文 HTML，并将插图 img[src] 重写为 /v1/linovelib/illustration/{hash} 代理路径；若本地尚未缓存该章节元数据，可传入纯数字 novelId 触发小说目录回源兜底",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(chapterResponseSchema, "成功返回章节正文 HTML"),
				400: validationErrorResponse,
				401: unauthorizedResponse,
				404: jsonResponse(
					z.union([apiErrorSchema, legacyErrorSchema]),
					"章节元数据缺失（code: 10000）、小说 ID 缺失（code: 10002）或上游未返回章节正文（{ error: 'Chapter not found' }）",
				),
				500: internalErrorResponse,
				...upstreamErrorResponses,
			},
		}),
		validator("param", chapterParamSchema),
		validator("query", chapterQuerySchema),
		async (c) => {
			try {
				const startAt = Date.now();
				const { chapterId } = c.req.valid("param");
				const { novelId } = c.req.valid("query");
				let chapterMeta = await storageService.getChapterFromId(
					"linovelib",
					chapterId,
				);
				if (!chapterMeta && novelId) {
					if (/^\d+$/.test(novelId)) {
						logger.debug(
							`[Chapter] 本地章节元数据缺失，尝试通过 novelId 回源补齐目录: chapterId=${chapterId} novelId=${novelId}`,
						);
						try {
							const novel = await linovelibClient.getNovelInfo(novelId);
							if (
								novel &&
								novel.title.trim() !== "" &&
								novel.volumes.length > 0
							) {
								await storageService.addNovelCache(novel);
								chapterMeta = await storageService.getChapterFromId(
									"linovelib",
									chapterId,
								);
							} else {
								logger.warn(
									`Novel fallback returned empty/invalid novel for novelId: ${novelId}`,
								);
							}
						} catch (fallbackError) {
							logger.warn(
								`Novel fallback failed for novelId ${novelId}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
							);
						}
					} else {
						logger.warn(
							`Ignored non-numeric novelId for chapter fallback: ${novelId}`,
						);
					}
				}
				if (!chapterMeta) {
					logger.error(`Chapter meta not found for chapterId: ${chapterId}`);
					return c.json(
						{
							code: 10000,
							message: "Chapter meta not found",
						},
						404,
					);
				}
				if (!chapterMeta.novelId) {
					logger.error(
						`Novel ID missing in chapter meta for chapterId: ${chapterId}`,
					);
					return c.json(
						{
							code: 10002,
							message: "Novel ID missing in chapter meta",
						},
						404,
					);
				}
				const hash = chapterMeta.contentHash;
				let rawHtml = hash
					? await storageService.getNovelContent(hash)
					: undefined;
				if (rawHtml) {
					logger.debug(
						`[Chapter] 命中本地章节正文缓存: chapterId=${chapterId} novelId=${chapterMeta.novelId} duration=${Date.now() - startAt}ms`,
					);
				} else {
					logger.debug(
						`[Chapter] 章节正文缓存未命中，开始回源抓取: chapterId=${chapterId} novelId=${chapterMeta.novelId}`,
					);
					const upstreamStartAt = Date.now();
					rawHtml = await linovelibClient.getChapter(
						chapterMeta.novelId,
						chapterId,
					);
					if (rawHtml) {
						const contentHash = await storageService.setNovelContent(rawHtml);
						await storageService.addNovelContentHash(
							"linovelib",
							chapterId,
							contentHash,
						);
						logger.debug(
							`[Chapter] 章节回源抓取完成并写入缓存: chapterId=${chapterId} novelId=${chapterMeta.novelId} upstreamDuration=${Date.now() - upstreamStartAt}ms`,
						);
					}
				}
				if (!rawHtml) {
					return c.json({ error: "Chapter not found" }, 404);
				}

				const illustrationUrls = extractChapterIllustrationUrls(rawHtml);
				if (illustrationUrls.length > 0) {
					await storageService.registerIllustrations(
						"linovelib",
						illustrationUrls,
					);
					logger.debug(
						`[Chapter] 已注册章节插图映射: chapterId=${chapterId} count=${illustrationUrls.length}`,
					);
				}
				const host = resolveHost(c, deps.host);
				const content = rewriteChapterIllustrations(
					rawHtml,
					(url) => `${host}/v1/linovelib/illustration/${getUrlHash(url)}`,
				);
				return c.json({
					code: 0,
					message: "Success",
					data: {
						content,
					},
				});
			} catch (error) {
				return handleLinovelibError(c, logger, error);
			}
		},
	);

	app.get(
		"/novels",
		describeRoute({
			tags: ["Linovelib"],
			operationId: "listLinovelibCachedNovels",
			summary: "分页查询本地已缓存小说",
			description:
				"从本地数据库分页读取已缓存小说列表（不触发上游抓取），支持按 genres（逗号分隔 AND 交集）、status、q（书名/作者关键词）筛选以及 style=acanthis|lnreader 切换条目结构",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(novelsResponseSchema, "成功返回分页缓存小说列表"),
				400: validationErrorResponse,
				401: unauthorizedResponse,
				500: internalErrorResponse,
			},
		}),
		validator("query", novelsQuerySchema),
		async (c) => {
			try {
				const { page, pageSize, style, genres, status, q } =
					c.req.valid("query");
				const host = resolveHost(c, deps.host);
				const listOptions: ListNovelsOptions = {
					page,
					pageSize,
				};
				if (genres !== undefined) {
					const parsedGenres = Array.from(
						new Set(
							genres
								.split(",")
								.map((item) => item.trim())
								.filter((item) => item.length > 0),
						),
					);
					if (parsedGenres.length > 0) {
						listOptions.genres = parsedGenres;
					}
				}
				if (status !== undefined) {
					listOptions.status = status;
				}
				if (q && q.length > 0) {
					listOptions.q = q;
				}
				const paginated = await storageService.listCachedNovels(
					"linovelib",
					listOptions,
				);
				const items = paginated.items.map((novel) =>
					transformOutputStyleForSearchResult(
						{
							...novel,
							coverUrl: `${host}/v1/linovelib/cover/novel/${novel.id}`,
						},
						style,
					),
				);
				return c.json({
					code: 0,
					message: "Success",
					data: {
						items,
						total: paginated.total,
						page: paginated.page,
						pageSize: paginated.pageSize,
					},
				});
			} catch (error) {
				return handleLinovelibError(c, logger, error);
			}
		},
	);

	app.get(
		"/genres",
		describeRoute({
			tags: ["Linovelib"],
			operationId: "getLinovelibCachedGenres",
			summary: "获取本地已缓存小说的题材标签统计",
			description:
				"统计当前平台本地已缓存小说中出现过的所有题材标签及其作品数量，按作品数降序、标签名升序返回",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(
					cachedGenresResponseSchema,
					"成功返回已缓存小说的题材标签及计数列表",
				),
				401: unauthorizedResponse,
				500: internalErrorResponse,
			},
		}),
		async (c) => {
			try {
				const data = await storageService.listCachedGenres("linovelib");
				return c.json({
					code: 0,
					message: "Success",
					data,
				});
			} catch (error) {
				return handleLinovelibError(c, logger, error);
			}
		},
	);

	app.get(
		"/illustration/:hash",
		describeRoute({
			tags: ["Linovelib"],
			operationId: "getLinovelibIllustration",
			summary: "获取章节插图图片代理",
			description:
				"根据章节 HTML 中重写后的 32 位 MD5 哈希返回插图二进制流并持久化缓存；在服务端启用 AUTH_TOKEN 时该 GET 接口默认公开可访问",
			responses: {
				200: binaryImageResponse("成功返回插图图片二进制流"),
				400: validationErrorResponse,
				404: jsonResponse(
					apiErrorSchema,
					"插图哈希未注册或回源抓取失败（code: 10003）",
					noStoreHeader,
				),
				500: internalErrorResponse,
				...upstreamErrorResponses,
			},
		}),
		validator("param", illustrationParamSchema),
		async (c) => {
			try {
				const { hash: rawHash } = c.req.valid("param");
				const hash = rawHash.toLowerCase();
				const cached = await storageService.getIllustrationData(
					"linovelib",
					hash,
				);
				if (cached) {
					return c.body(new Uint8Array(cached.data), 200, {
						"Content-Type": cached.mimeType,
						"Cache-Control": "public, max-age=86400",
					});
				}

				let fetchPromise = inFlightIllustrations.get(hash);
				if (fetchPromise) {
					logger.debug(`[Illustration] 复用在途回源请求: hash=${hash}`);
				} else {
					fetchPromise = (async () => {
						const sourceUrl = await storageService.getIllustrationSourceUrl(
							"linovelib",
							hash,
						);
						if (!sourceUrl) {
							logger.error(
								`Illustration source URL not found for hash: ${hash}`,
							);
							return null;
						}

						logger.debug(
							`[Illustration] 缓存未命中，开始回源获取: hash=${hash} url=${sourceUrl}`,
						);
						const illustrationData =
							await linovelibClient.getIllustration(sourceUrl);
						if (!illustrationData?.data) {
							logger.error(
								`Failed to fetch illustration from source URL: ${sourceUrl}`,
							);
							return null;
						}

						const contentType =
							illustrationData.mimeType || "application/octet-stream";
						await storageService.setIllustrationData(
							"linovelib",
							hash,
							illustrationData.data,
							contentType,
						);
						return {
							data: illustrationData.data,
							mimeType: contentType,
						};
					})().finally(() => {
						inFlightIllustrations.delete(hash);
					});
					inFlightIllustrations.set(hash, fetchPromise);
				}

				const fetched = await fetchPromise;
				if (!fetched) {
					return c.json(
						{
							code: 10003,
							message: "Illustration not found",
						},
						404,
						{
							"Cache-Control": "no-store",
						},
					);
				}

				return c.body(new Uint8Array(fetched.data), 200, {
					"Content-Type": fetched.mimeType,
					"Cache-Control": "public, max-age=86400",
				});
			} catch (error) {
				return handleLinovelibError(c, logger, error, {
					code: 10003,
					message: "Illustration not found",
				});
			}
		},
	);

	app.get(
		"/novel/:novelId",
		describeRoute({
			tags: ["Linovelib"],
			operationId: "getLinovelibNovel",
			summary: "获取小说详情与分卷章节目录",
			description:
				"获取小说元数据与完整分卷章节目录；已缓存书籍默认会自动对比上游章节数决定是否刷新（更新失败时优雅降级返回缓存）；传入 cachedOnly=true 时若本地已有完整缓存将跳过上游检查直接返回；支持 style=acanthis|lnreader",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(novelDetailResponseSchema, "成功返回小说详情与目录"),
				400: validationErrorResponse,
				401: unauthorizedResponse,
				404: jsonResponse(
					legacyErrorSchema,
					"小说不存在或回源返回空结果（{ error: 'Novel not found' }）",
				),
				500: internalErrorResponse,
				...upstreamErrorResponses,
			},
		}),
		validator("param", novelParamSchema),
		validator("query", novelStyleQuerySchema),
		async (c) => {
			try {
				const startAt = Date.now();
				const host = resolveHost(c, deps.host);
				const { novelId } = c.req.valid("param");
				const { style, cachedOnly } = c.req.valid("query");
				const cachedNovel = await storageService.getNovelCache(
					"linovelib",
					novelId,
				);
				const validCachedNovel =
					cachedNovel &&
					cachedNovel.author !== "" &&
					cachedNovel.status !== "unknown" &&
					cachedNovel.volumes.length > 0
						? cachedNovel
						: null;
				const respondWithNovel = (novelData: Novel) => {
					novelData.coverUrl = `${host}/v1/linovelib/cover/novel/${novelId}`;
					novelData.volumes.forEach((volume) => {
						volume.coverUrl = `${host}/v1/linovelib/cover/volume/${volume.id}`;
					});
					return c.json({
						code: 0,
						message: "Success",
						data: transformOutputStyleForNovel(novelData, style),
					});
				};
				if (validCachedNovel) {
					if (cachedOnly) {
						logger.debug(
							`[Novel] cachedOnly=true 命中本地小说缓存，跳过上游更新检查: novelId=${novelId} duration=${Date.now() - startAt}ms`,
						);
						return respondWithNovel(validCachedNovel);
					}
					let updateNeeded = false;
					try {
						updateNeeded = await isUpdateNeeded(
							validCachedNovel,
							linovelibClient,
							(updateError) => {
								logger.warn(
									`Update check failed for cached novel ${novelId}, serving cached novel: ${updateError instanceof Error ? updateError.message : String(updateError)}`,
								);
							},
						);
					} catch (updateError) {
						logger.warn(
							`Update check failed for cached novel ${novelId}, serving cached novel: ${updateError instanceof Error ? updateError.message : String(updateError)}`,
						);
					}
					logger.debug(
						`[Novel] 命中本地小说缓存: novelId=${novelId} updateNeeded=${updateNeeded} duration=${Date.now() - startAt}ms`,
					);
					if (!updateNeeded) {
						return respondWithNovel(validCachedNovel);
					}
				} else {
					logger.debug(
						`[Novel] 本地小说缓存未命中或信息不完整，开始回源抓取: novelId=${novelId}`,
					);
				}
				let novel: Novel | undefined;
				const upstreamStartAt = Date.now();
				try {
					novel = await linovelibClient.getNovelInfo(novelId);
				} catch (fetchError) {
					if (validCachedNovel) {
						logger.warn(
							`Novel refresh failed for cached novel ${novelId}, serving cached novel: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
						);
						return respondWithNovel(validCachedNovel);
					}
					throw fetchError;
				}
				if (
					novel &&
					(!validCachedNovel ||
						(novel.title.trim() !== "" && novel.volumes.length > 0))
				) {
					await storageService.addNovelCache(novel);
					logger.debug(
						`[Novel] 小说回源抓取完成并写入缓存: novelId=${novelId} volumes=${novel.volumes.length} upstreamDuration=${Date.now() - upstreamStartAt}ms`,
					);
					return respondWithNovel(novel);
				}
				if (validCachedNovel) {
					logger.warn(
						`Novel refresh returned empty result for cached novel ${novelId}, serving cached novel`,
					);
					return respondWithNovel(validCachedNovel);
				}
				return c.json({ error: "Novel not found" }, 404);
			} catch (error) {
				return handleLinovelibError(c, logger, error);
			}
		},
	);

	app.get(
		"/cover/novel/:novelId",
		describeRoute({
			tags: ["Linovelib"],
			operationId: "getLinovelibNovelCover",
			summary: "获取小说封面图片代理",
			description:
				"返回指定小说的封面二进制图片并持久化缓存；在服务端启用 AUTH_TOKEN 时该 GET 接口默认公开可访问",
			responses: {
				200: binaryImageResponse("成功返回小说封面二进制流"),
				400: validationErrorResponse,
				404: jsonResponse(
					apiErrorSchema,
					"小说封面未找到或回源失败（code: 10001）",
					noStoreHeader,
				),
				500: internalErrorResponse,
				...upstreamErrorResponses,
			},
		}),
		validator("param", novelParamSchema),
		async (c) => {
			try {
				const { novelId } = c.req.valid("param");
				const cachedCover = await storageService.getCoverData(
					"novel",
					"linovelib",
					novelId,
				);
				if (cachedCover) {
					c.header("Content-Type", cachedCover.mimeType);
					c.header("Cache-Control", "public, max-age=86400");
					return c.body(new Uint8Array(cachedCover.data));
				}
				const novelInfo = await storageService.getNovelCache(
					"linovelib",
					novelId,
				);
				if (novelInfo?.coverUrl) {
					logger.debug(
						`[Cover] 小说封面缓存未命中，使用元数据 URL 回源: novelId=${novelId} url=${novelInfo.coverUrl}`,
					);
					const coverData = await linovelibClient.getCover(novelInfo.coverUrl);
					if (coverData) {
						await storageService.setCoverData(
							"novel",
							novelInfo.coverUrl,
							coverData.data,
							coverData.mimeType,
							"linovelib",
							novelId,
						);
						c.header("Content-Type", coverData.mimeType);
						c.header("Cache-Control", "public, max-age=86400");
						return c.body(new Uint8Array(coverData.data));
					}
				} else {
					logger.debug(
						`[Cover] 小说封面缓存未命中且无元数据 URL，按规则拼接回源: novelId=${novelId}`,
					);
					const { data: coverData, url: coverUrl } =
						await linovelibClient.getNovelCover(novelId);
					if (coverData) {
						await storageService.setCoverData(
							"novel",
							coverUrl,
							coverData.data,
							coverData.mimeType,
							"linovelib",
							novelId,
						);
						c.header("Content-Type", coverData.mimeType);
						c.header("Cache-Control", "public, max-age=86400");
						return c.body(new Uint8Array(coverData.data));
					}
				}
				logger.error(
					`Novel ${novelId} not present in database or does not have a cover URL, and failed to fetch cover from source`,
				);
				return c.json(
					{
						code: 10001,
						message: "Cover not found",
					},
					404,
					{
						"Cache-Control": "no-store",
					},
				);
			} catch (error) {
				return handleLinovelibError(c, logger, error, {
					code: 10001,
					message: "Cover not found",
				});
			}
		},
	);

	app.get(
		"/cover/volume/:volumeId",
		describeRoute({
			tags: ["Linovelib"],
			operationId: "getLinovelibVolumeCover",
			summary: "获取分卷封面图片代理",
			description:
				"返回指定分卷的封面二进制图片并持久化缓存；在服务端启用 AUTH_TOKEN 时该 GET 接口默认公开可访问",
			responses: {
				200: binaryImageResponse("成功返回分卷封面二进制流"),
				400: validationErrorResponse,
				404: jsonResponse(
					apiErrorSchema,
					"分卷元数据缺失或封面未找到（code: 10001）",
					noStoreHeader,
				),
				500: internalErrorResponse,
				...upstreamErrorResponses,
			},
		}),
		validator("param", volumeParamSchema),
		async (c) => {
			try {
				const { volumeId } = c.req.valid("param");
				const cachedCover = await storageService.getCoverData(
					"volume",
					"linovelib",
					volumeId,
				);
				if (cachedCover) {
					c.header("Content-Type", cachedCover.mimeType);
					c.header("Cache-Control", "public, max-age=86400");
					return c.body(new Uint8Array(cachedCover.data));
				}
				const volumeInfo = await storageService.getVolumeMeta(
					"linovelib",
					volumeId,
				);
				if (volumeInfo?.coverUrl) {
					logger.debug(
						`[Cover] 分卷封面缓存未命中，开始回源: volumeId=${volumeId} url=${volumeInfo.coverUrl}`,
					);
					const coverData = await linovelibClient.getCover(volumeInfo.coverUrl);
					if (coverData) {
						await storageService.setCoverData(
							"volume",
							volumeInfo.coverUrl,
							coverData.data,
							coverData.mimeType,
							"linovelib",
							volumeId,
						);
						c.header("Content-Type", coverData.mimeType);
						c.header("Cache-Control", "public, max-age=86400");
						return c.body(new Uint8Array(coverData.data));
					}
				}
				logger.error(
					`Volume ${volumeId} not present in database or does not have a cover URL`,
				);
				return c.json(
					{
						code: 10001,
						message: "Cover not found",
					},
					404,
					{
						"Cache-Control": "no-store",
					},
				);
			} catch (error) {
				return handleLinovelibError(c, logger, error, {
					code: 10001,
					message: "Cover not found",
				});
			}
		},
	);

	app.get(
		"/search",
		describeRoute({
			tags: ["Linovelib"],
			operationId: "searchLinovelibNovels",
			summary: "按关键词搜索轻小说",
			description:
				"按关键词检索哔哩轻小说，优先命中本地缓存，未命中时回源抓取（自动识别搜索验证码）；支持 style=acanthis|lnreader 切换返回结构",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(searchResponseSchema, "成功返回搜索结果列表"),
				400: validationErrorResponse,
				401: unauthorizedResponse,
				500: internalErrorResponse,
				...upstreamErrorResponses,
			},
		}),
		validator("query", searchQuerySchema),
		async (c) => {
			const startAt = Date.now();
			let searchKeyword: string | undefined;
			try {
				const host = resolveHost(c, deps.host);
				const { keyword, style } = c.req.valid("query");
				searchKeyword = keyword;
				logger.debug(
					`[Search] 收到搜索请求: keyword=${JSON.stringify(keyword)} style=${style}`,
				);
				const formatSearchResults = (items: NovelSearchResult[]) =>
					items.map((novel) =>
						transformOutputStyleForSearchResult(
							{
								...novel,
								coverUrl: `${host}/v1/linovelib/cover/novel/${novel.id}`,
							},
							style,
						),
					);
				const cachedResults = await storageService.searchNovels(
					keyword,
					"linovelib",
				);
				if (cachedResults) {
					logger.debug(
						`[Search] 命中本地搜索缓存: keyword=${JSON.stringify(keyword)} count=${cachedResults.length} duration=${Date.now() - startAt}ms`,
					);
					return c.json({
						code: 0,
						message: "Success",
						data: formatSearchResults(cachedResults),
					});
				}
				if (emptySearchCache.get(keyword)) {
					logger.debug(
						`[Search] 命中短期空结果负缓存: keyword=${JSON.stringify(keyword)} duration=${Date.now() - startAt}ms`,
					);
					return c.json({
						code: 0,
						message: "Success",
						data: [],
					});
				}
				let searchPromise = inFlightSearches.get(keyword);
				if (searchPromise) {
					logger.debug(
						`[Search] 复用同关键词在途回源请求: keyword=${JSON.stringify(keyword)}`,
					);
				} else {
					logger.debug(
						`[Search] 本地搜索缓存未命中，开始回源抓取: keyword=${JSON.stringify(keyword)}`,
					);
					const upstreamStartAt = Date.now();
					searchPromise = (async () => {
						const upstreamResults = await linovelibClient.searchNovels(keyword);
						logger.debug(
							`[Search] 回源搜索完成: keyword=${JSON.stringify(keyword)} count=${upstreamResults.length} upstreamDuration=${Date.now() - upstreamStartAt}ms`,
						);
						if (upstreamResults.length > 0) {
							await storageService.addSearchResult(
								keyword,
								"linovelib",
								upstreamResults,
							);
							logger.debug(
								`[Search] 搜索结果已写入本地缓存: keyword=${JSON.stringify(keyword)} count=${upstreamResults.length} totalDuration=${Date.now() - startAt}ms`,
							);
						} else {
							emptySearchCache.set(keyword, true);
							logger.debug(
								`[Search] 回源搜索结果为空，已写入短期负缓存: keyword=${JSON.stringify(keyword)} totalDuration=${Date.now() - startAt}ms`,
							);
						}
						return upstreamResults;
					})().finally(() => {
						if (inFlightSearches.get(keyword) === searchPromise) {
							inFlightSearches.delete(keyword);
						}
					});
					inFlightSearches.set(keyword, searchPromise);
				}
				const results = await searchPromise;
				return c.json({
					code: 0,
					message: "Success",
					data: formatSearchResults(results),
				});
			} catch (error) {
				logger.debug(
					`[Search] 搜索请求异常: keyword=${JSON.stringify(searchKeyword ?? "")} duration=${Date.now() - startAt}ms error=${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
				);
				return handleLinovelibError(c, logger, error);
			}
		},
	);

	app.route(
		"/epub",
		createEpubRoutes({
			volumeEpubService: deps.volumeEpubService,
			logger,
		}),
	);

	return app;
}
