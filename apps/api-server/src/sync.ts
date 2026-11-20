import type { BookshelfItem, ReadingProgress } from "@acanthis-dec/core";
import type {
	MergeSyncStateInput,
	StorageService,
} from "@acanthis-dec/storage";
import { Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import {
	bearerSecurity,
	internalErrorResponse,
	jsonResponse,
	unauthorizedResponse,
	validationErrorResponse,
} from "./schemas/common";
import {
	syncGetResponseSchema,
	syncPostResponseSchema,
	syncPushSchema,
	syncQuerySchema,
} from "./schemas/sync";
import { resolveHost } from "./utils";

export interface SyncRouteDeps {
	storageService: Pick<StorageService, "getSyncState" | "mergeSyncState">;
	logger: { error: (message: string) => unknown };
	host?: string | undefined;
}

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

export function createSyncRoutes(deps: SyncRouteDeps) {
	const app = new Hono();

	app.get(
		"/state",
		describeRoute({
			tags: ["Sync"],
			operationId: "getSyncState",
			summary: "拉取同步状态",
			description:
				"按增量游标（毫秒时间戳）拉取书架与阅读进度；不传或传入 0 时返回全量未删除书架与全部阅读进度",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(syncGetResponseSchema, "成功返回同步状态与最新游标"),
				400: validationErrorResponse,
				401: unauthorizedResponse,
				500: internalErrorResponse,
			},
		}),
		validator("query", syncQuerySchema),
		async (c) => {
			try {
				const { since } = c.req.valid("query");
				const host = resolveHost(c, deps.host);
				const state = await deps.storageService.getSyncState(since);
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
				deps.logger.error(
					`${error instanceof Error ? error.stack : String(error)}`,
				);
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

	app.post(
		"/state",
		describeRoute({
			tags: ["Sync"],
			operationId: "pushSyncState",
			summary: "推送并合并同步状态",
			description:
				"推送客户端书架（按 updatedAt LWW 合并并支持 deletedAt 软删除）与阅读进度，返回合并后的最新状态与 serverTime",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(
					syncPostResponseSchema,
					"成功合并并返回最新同步状态与服务端时间",
				),
				400: validationErrorResponse,
				401: unauthorizedResponse,
				500: internalErrorResponse,
			},
		}),
		validator("json", syncPushSchema),
		async (c) => {
			try {
				const { bookshelf, progress } = c.req.valid("json");
				const host = resolveHost(c, deps.host);
				const mergeInput: MergeSyncStateInput = {};
				if (bookshelf !== undefined) {
					mergeInput.bookshelf = bookshelf;
				}
				if (progress !== undefined) {
					mergeInput.progress = progress;
				}
				const merged = await deps.storageService.mergeSyncState(mergeInput);
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
				deps.logger.error(
					`${error instanceof Error ? error.stack : String(error)}`,
				);
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

	return app;
}
