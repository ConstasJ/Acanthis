import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";
import { linovelibClient, logger, storageService } from "./services";

const app = new Hono();

const chapterParamSchema = z.object({
	novelId: z.string().min(1, "Novel ID is required"),
	chapterId: z.string().min(1, "Chapter ID is required"),
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

export default app;
