import type { BookshelfItem, ReadingProgress } from "@acanthis-dec/core";
import type { MergeSyncStateInput } from "@acanthis-dec/storage";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";
import { config } from "./config";
import { logger, storageService } from "./services";
import { resolveHost } from "./utils";

const app = new Hono();

const syncQuerySchema = z.object({
	since: z.preprocess(
		(val) => (val === "" ? undefined : val),
		z.coerce.number().int().min(0).optional(),
	),
});

const bookshelfItemSchema = z.object({
	platform: z.string().min(1),
	novelId: z.string().min(1),
	title: z.string(),
	author: z.string(),
	coverUrl: z.string(),
	addedAt: z.number().finite(),
	updatedAt: z.number().finite(),
	deletedAt: z.number().finite().nullable(),
});

const readingProgressSchema = z.object({
	platform: z.string().min(1),
	novelId: z.string().min(1),
	novelTitle: z.string(),
	coverUrl: z.string(),
	volumeId: z.string().min(1),
	volumeTitle: z.string(),
	chapterId: z.string().min(1),
	chapterTitle: z.string(),
	paragraphIndex: z.number().int().min(0),
	totalParagraphs: z.number().int().min(0),
	deviceLabel: z.string(),
	updatedAt: z.number().finite(),
});

const syncPushSchema = z.object({
	bookshelf: z.array(bookshelfItemSchema).optional(),
	progress: z.array(readingProgressSchema).optional(),
});

function normalizeCoverUrl(
	host: string,
	platform: string,
	novelId: string,
): string {
	return `${host}/v1/${encodeURIComponent(platform)}/cover/novel/${encodeURIComponent(novelId)}`;
}

function normalizeBookshelfCover(
	host: string,
	item: BookshelfItem,
): BookshelfItem {
	return {
		...item,
		coverUrl: normalizeCoverUrl(host, item.platform, item.novelId),
	};
}

function normalizeProgressCover(
	host: string,
	item: ReadingProgress,
): ReadingProgress {
	return {
		...item,
		coverUrl: normalizeCoverUrl(host, item.platform, item.novelId),
	};
}

app.get("/state", zValidator("query", syncQuerySchema), async (c) => {
	try {
		const { since } = c.req.valid("query");
		const host = resolveHost(c, config.host);
		const state = await storageService.getSyncState(since);
		return c.json({
			code: 0,
			message: "Success",
			data: {
				bookshelf: state.bookshelf.map((item) =>
					normalizeBookshelfCover(host, item),
				),
				progress: state.progress.map((item) =>
					normalizeProgressCover(host, item),
				),
				cursor: state.cursor,
			},
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

app.post("/state", zValidator("json", syncPushSchema), async (c) => {
	try {
		const { bookshelf, progress } = c.req.valid("json");
		const host = resolveHost(c, config.host);
		const mergeInput: MergeSyncStateInput = {};
		if (bookshelf !== undefined) {
			mergeInput.bookshelf = bookshelf;
		}
		if (progress !== undefined) {
			mergeInput.progress = progress;
		}
		const merged = await storageService.mergeSyncState(mergeInput);
		return c.json({
			code: 0,
			message: "Success",
			data: {
				bookshelf: merged.bookshelf.map((item) =>
					normalizeBookshelfCover(host, item),
				),
				progress: merged.progress.map((item) =>
					normalizeProgressCover(host, item),
				),
				serverTime: merged.serverTime,
			},
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
