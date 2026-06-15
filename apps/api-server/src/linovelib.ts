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
	novelId: z.string().min(1, "Novel ID is required"),
	chapterId: z.string().min(1, "Chapter ID is required"),
});

const novelParamSchema = z.object({
	novelId: z.string().min(1, "Novel ID is required"),
});

const searchQuerySchema = z.object({
	keyword: z.string().min(1, "Keyword is required"),
	style: outputStyleSchema.optional(),
});

app.get(
	"/chapter/:novelId/:chapterId",
	zValidator("param", chapterParamSchema),
	async (c) => {
		try {
			const novelId = c.req.param("novelId");
			const chapterId = c.req.param("chapterId");
			const cachedChapter = await storageService.getNovelContent(
				novelId,
				chapterId,
			);
			if (cachedChapter) {
				return c.json({
					code: 0,
					message: "Success",
					data: {
						content: cachedChapter,
					},
				});
			}
			const content = await linovelibClient.getChapter(novelId, chapterId);
			if (content) {
				await storageService.setNovelContent(novelId, chapterId, content);
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
			if (cachedNovel) {
				return c.json({
					code: 0,
					message: "Success",
					data: transformOutputStyleForNovel(cachedNovel, style),
				});
			}
			const novel = await linovelibClient.getNovelInfo(novelId);
			if (novel) {
				await storageService.addNovelCache(novel);
				novel.coverUrl = `${host}/v1/linovelib/novel/${novelId}/cover`;
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
	"/novel/:novelId/cover",
	zValidator("param", novelParamSchema),
	async (c) => {
		try {
			const novelId = c.req.param("novelId");
			const cachedCover = await storageService.getCoverData(
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
					novel.coverUrl = `${host}/v1/linovelib/novel/${novel.id}/cover`;
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
				novel.coverUrl = `${host}/v1/linovelib/novel/${novel.id}/cover`;
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
