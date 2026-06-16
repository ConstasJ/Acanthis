import { novelIdToCoverUrl } from "@acanthis-dec/linovelib";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";
import { config } from "./config";
import { linovelibClient, logger, storageService } from "./services";
import { type OutputStyle, outputStyleSchema } from "./types";
import {
	transformOutputStyleForNovel,
	transformOutputStyleForSearchResult,
} from "./utils";

const app = new Hono();

const chapterParamSchema = z.object({
	chapterId: z.string().min(1, "Chapter ID is required"),
});

const novelParamSchema = z.object({
	novelId: z.string().min(1, "Novel ID is required"),
});

const volumeParamSchema = z.object({
	volumeId: z.string().min(1, "Volume ID is required"),
});

const searchQuerySchema = z.object({
	keyword: z.string().min(1, "Keyword is required"),
	style: outputStyleSchema.optional(),
});

app.get(
	"/chapter/:chapterId",
	zValidator("param", chapterParamSchema),
	async (c) => {
		try {
			const chapterId = c.req.param("chapterId");
			const chapterMeta = await storageService.getChapterFromId(
				"linovelib",
				chapterId,
			);
			if (!chapterMeta) {
				logger.error(`Chapter meta not found for chapterId: ${chapterId}`);
				return c.json({
					code: 10000, 
					message: "Chapter meta not found",
				}, 404);
			}
			if (!chapterMeta.novelId) {
				logger.error(`Novel ID missing in chapter meta for chapterId: ${chapterId}`);
				return c.json({
					code: 10002, 
					message: "Novel ID missing in chapter meta"
				}, 404);
			}
			const hash = chapterMeta.contentHash;
				if (hash) {
					const cachedContent = await storageService.getNovelContent(hash);
					if (cachedContent) {
						return c.json({
							code: 0,
							message: "Success",
							data: {
								content: cachedContent,
							},
						});
					}
				}
			const content = await linovelibClient.getChapter(chapterMeta.novelId, chapterId);
			if (content) {
				const contentHash = await storageService.setNovelContent(content);
				await storageService.addNovelContentHash(
					"linovelib",
					chapterId,
					contentHash,
				);
				return c.json({
					code: 0,
					message: "Success",
					data: {
						content,
					},
				});
			}
			return c.json({ error: "Chapter not found" }, 404);
		} catch (error) {
			logger.error(`${error instanceof Error ? error.stack : String(error)}`);
			return c.json(
				{
					code: 20000,
					message: "Internal Server Error",
				},
				500,
			);
		}
	},
);

app.get(
	"/novel/:novelId",
	zValidator("param", novelParamSchema),
	zValidator("query", z.object({ style: outputStyleSchema.optional() })),
	async (c) => {
		try {
			const host = config.host ?? c.header("host") ?? "http://localhost:5301";
			const novelId = c.req.param("novelId");
			const style = c.req.query("style") as OutputStyle | undefined;
			const cachedNovel = await storageService.getNovelCache(
				"linovelib",
				novelId,
			);
			if (
				cachedNovel &&
				cachedNovel.author !== "" &&
				cachedNovel.status !== "unknown" &&
				cachedNovel.volumes.length > 0
			) {
				cachedNovel.coverUrl = `${host}/v1/linovelib/cover/novel/${novelId}`;
				cachedNovel.volumes.forEach((volume) => {
					volume.coverUrl = `${host}/v1/linovelib/cover/volume/${volume.id}`;
				});
				return c.json({
					code: 0,
					message: "Success",
					data: transformOutputStyleForNovel(cachedNovel, style),
				});
			}
			const novel = await linovelibClient.getNovelInfo(novelId);
			if (novel) {
				await storageService.addNovelCache(novel);
				novel.coverUrl = `${host}/v1/linovelib/cover/novel/${novelId}`;
				novel.volumes.forEach((volume) => {
					volume.coverUrl = `${host}/v1/linovelib/cover/volume/${volume.id}`;
				});
				return c.json({
					code: 0,
					message: "Success",
					data: transformOutputStyleForNovel(novel, style),
				});
			}
			return c.json({ error: "Novel not found" }, 404);
		} catch (error) {
			logger.error(`${error instanceof Error ? error.stack : String(error)}`);
			return c.json(
				{
					code: 20000,
					message: "Internal Server Error",
				},
				500,
			);
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
			const coverData = await linovelibClient.getNovelCover(novelId);
			if (coverData) {
				await storageService.setCoverData(
					"novel",
					novelIdToCoverUrl(novelId),
					coverData.data,
					coverData.mimeType,
					"linovelib",
					novelId,
				);
				c.header("Content-Type", coverData.mimeType);
				c.header("Cache-Control", "public, max-age=86400");
				return c.body(new Uint8Array(coverData.data));
			}
		} catch (error) {
			logger.error(`${error instanceof Error ? error.stack : String(error)}`);
			return c.json(
				{
					code: 20000,
					message: "Internal Server Error",
				},
				500,
			);
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
			const volumeInfo = await storageService.getVolumeMeta("linovelib", volumeId);
			if (volumeInfo?.coverUrl) {
				const coverData = await linovelibClient.getCover(volumeId);
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
			} else {
				logger.error(`Volume ${volumeId} not present in database or does not have a cover URL`);
				return c.json(
					{
						code: 10001,
						message: "Cover not found",
					},
					404,
				);
			}
		} catch (error) {
			logger.error(`${error instanceof Error ? error.stack : String(error)}`);
			return c.json(
				{
					code: 20000,
					message: "Internal Server Error",
				},
				500,
			);
		}
	}
);

app.get("/search", zValidator("query", searchQuerySchema), async (c) => {
	try {
		const host = config.host ?? c.header("host") ?? "http://localhost:5301";
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
		logger.error(`${error instanceof Error ? error.stack : String(error)}`);
		return c.json(
			{
				code: 20000,
				message: "Internal Server Error",
			},
			500,
		);
	}
});

export default app;
