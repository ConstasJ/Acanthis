import {
	CloudflareBlockError,
	FlareSolverrError,
	HttpStatusError,
} from "@acanthis-dec/browser-fetch";
import type { Novel } from "@acanthis-dec/core";
import {
	extractChapterIllustrationUrls,
	rewriteChapterIllustrations,
} from "@acanthis-dec/linovelib";
import { getUrlHash } from "@acanthis-dec/storage";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import z from "zod";
import { linovelibClient, logger, storageService } from "./services";
import { type OutputStyle, outputStyleSchema } from "./types";
import {
	isUpdateNeeded,
	resolveHost,
	transformOutputStyleForNovel,
	transformOutputStyleForSearchResult,
} from "./utils";

const app = new Hono();

const inFlightIllustrations = new Map<
	string,
	Promise<{ data: Buffer; mimeType: string } | null>
>();

function handleLinovelibError(
	c: Context,
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

const chapterParamSchema = z.object({
	chapterId: z.string().min(1, "Chapter ID is required"),
});

const chapterQuerySchema = z.object({
	novelId: z.string().min(1).optional(),
});

const novelParamSchema = z.object({
	novelId: z.string().min(1, "Novel ID is required"),
});

const volumeParamSchema = z.object({
	volumeId: z.string().min(1, "Volume ID is required"),
});

const illustrationParamSchema = z.object({
	hash: z.string().regex(/^[a-f0-9]{32}$/i, "Invalid illustration hash"),
});

const novelsQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(20),
	style: outputStyleSchema.optional(),
});

const searchQuerySchema = z.object({
	keyword: z.string().min(1, "Keyword is required"),
	style: outputStyleSchema.optional(),
});

app.get(
	"/chapter/:chapterId",
	zValidator("param", chapterParamSchema),
	zValidator("query", chapterQuerySchema),
	async (c) => {
		try {
			const chapterId = c.req.param("chapterId");
			const { novelId } = c.req.valid("query");
			let chapterMeta = await storageService.getChapterFromId(
				"linovelib",
				chapterId,
			);
			if (!chapterMeta && novelId) {
				if (/^\d+$/.test(novelId)) {
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
			if (!rawHtml) {
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
			}
			const host = resolveHost(c);
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
			return handleLinovelibError(c, error);
		}
	},
);

app.get("/novels", zValidator("query", novelsQuerySchema), async (c) => {
	try {
		const { page, pageSize, style } = c.req.valid("query");
		const host = resolveHost(c);
		const paginated = await storageService.listCachedNovels("linovelib", {
			page,
			pageSize,
		});
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
		return handleLinovelibError(c, error);
	}
});

app.get(
	"/illustration/:hash",
	zValidator("param", illustrationParamSchema),
	async (c) => {
		try {
			const hash = c.req.param("hash").toLowerCase();
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
			if (!fetchPromise) {
				fetchPromise = (async () => {
					const sourceUrl = await storageService.getIllustrationSourceUrl(
						"linovelib",
						hash,
					);
					if (!sourceUrl) {
						logger.error(`Illustration source URL not found for hash: ${hash}`);
						return null;
					}

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
			return handleLinovelibError(c, error, {
				code: 10003,
				message: "Illustration not found",
			});
		}
	},
);

app.get(
	"/novel/:novelId",
	zValidator("param", novelParamSchema),
	zValidator("query", z.object({ style: outputStyleSchema.optional() })),
	async (c) => {
		try {
			const host = resolveHost(c);
			const novelId = c.req.param("novelId");
			const style = c.req.query("style") as OutputStyle | undefined;
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
				if (!updateNeeded) {
					return respondWithNovel(validCachedNovel);
				}
			}
			let novel: Novel | undefined;
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
			return handleLinovelibError(c, error);
		}
	},
);

app.get(
	"/cover/novel/:novelId",
	zValidator("param", novelParamSchema),
	async (c) => {
		try {
			const novelId = c.req.param("novelId");
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
			return handleLinovelibError(c, error, {
				code: 10001,
				message: "Cover not found",
			});
		}
	},
);

app.get(
	"/cover/volume/:volumeId",
	zValidator("param", volumeParamSchema),
	async (c) => {
		try {
			const volumeId = c.req.param("volumeId");
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
			return handleLinovelibError(c, error, {
				code: 10001,
				message: "Cover not found",
			});
		}
	},
);

app.get("/search", zValidator("query", searchQuerySchema), async (c) => {
	try {
		const host = resolveHost(c);
		const keyword = c.req.query("keyword") as string;
		const style = c.req.query("style") as OutputStyle | undefined;
		const cachedResults = await storageService.searchNovels(
			keyword,
			"linovelib",
		);
		if (cachedResults) {
			return c.json({
				code: 0,
				message: "Success",
				data: cachedResults.map((novel) => {
					novel.coverUrl = `${host}/v1/linovelib/cover/novel/${novel.id}`;
					return transformOutputStyleForSearchResult(novel, style);
				}),
			});
		}
		const results = await linovelibClient.searchNovels(keyword);
		if (results.length > 0) {
			await storageService.addSearchResult(keyword, "linovelib", results);
		}
		return c.json({
			code: 0,
			message: "Success",
			data: results.map((novel) => {
				novel.coverUrl = `${host}/v1/linovelib/cover/novel/${novel.id}`;
				return transformOutputStyleForSearchResult(novel, style);
			}),
		});
	} catch (error) {
		return handleLinovelibError(c, error);
	}
});

export default app;
