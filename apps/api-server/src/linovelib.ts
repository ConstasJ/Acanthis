import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";
import { linovelibClient, logger, storageService } from "./services";
import { type OutputStyle, outputStyleSchema } from "./types";
import { transformOutputStyleForNovel } from "./utils";

const app = new Hono();

const chapterParamSchema = z.object({
	novelId: z.string().min(1, "Novel ID is required"),
	chapterId: z.string().min(1, "Chapter ID is required"),
});

const novelParamSchema = z.object({
	novelId: z.string().min(1, "Novel ID is required"),
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
			logger.error(error);
			return c.json({
				code: 20000,
				message: "Internal Server Error",
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
				return c.json({
					code: 0,
					message: "Success",
					data: transformOutputStyleForNovel(novel, style),
				});
			}
			return c.json({ error: "Novel not found" }, 404);
		} catch (error) {
			logger.error(error);
			return c.json({
				code: 20000,
				message: "Internal Server Error",
			});
		}
	},
);

export default app;
