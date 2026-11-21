import type {
	BookshelfCategory,
	BookshelfItem,
	ReadingProgress,
} from "@acanthis-dec/core";
import z from "zod";
import { createSuccessEnvelopeSchema } from "./common";
import { novelStatusSchema } from "./linovelib";

export const syncQuerySchema = z.object({
	since: z
		.preprocess(
			(val) => (val === "" ? undefined : val),
			z.coerce.number().int().min(0).optional(),
		)
		.describe(
			"增量拉取游标（毫秒时间戳）；为空或不传时返回全部未删除书架、未删除自定义分类与全部阅读进度",
		),
});

export const bookshelfCategorySchema = z
	.object({
		id: z.string().min(1).describe("自定义书架 ID（客户端生成，跨端唯一）"),
		name: z.string().trim().min(1).max(32).describe("书架名称（1-32 字符）"),
		sortOrder: z.number().int().describe("排序权重（整数，升序）"),
		createdAt: z.number().finite().describe("创建时间戳（毫秒）"),
		updatedAt: z.number().finite().describe("最后修改时间戳（毫秒）"),
		deletedAt: z
			.number()
			.finite()
			.nullable()
			.describe("软删除时间戳（毫秒），未删除时为 null"),
	})
	.meta({ id: "BookshelfCategory" }) satisfies z.ZodType<BookshelfCategory>;

export const bookshelfItemSchema = z
	.object({
		platform: z.string().min(1).describe("小说源平台 ID，如 linovelib"),
		novelId: z.string().min(1).describe("小说 ID"),
		title: z.string().describe("小说标题"),
		author: z.string().describe("作者名称"),
		coverUrl: z
			.string()
			.describe("封面 URL；服务端响应中会重写为当前部署下的代理封面 URL"),
		addedAt: z.number().finite().describe("加入书架时间戳（毫秒）"),
		updatedAt: z.number().finite().describe("记录更新时间戳（毫秒）"),
		deletedAt: z
			.number()
			.finite()
			.nullable()
			.describe("软删除时间戳（毫秒），未删除时为 null"),
		categoryIds: z
			.array(z.string().min(1))
			.optional()
			.describe("所属自定义书架 ID 列表（空数组代表仅在默认书架）"),
		genres: z.array(z.string()).optional().describe("作品题材标签快照"),
		status: novelStatusSchema.optional().describe("作品连载状态快照"),
	})
	.meta({ id: "BookshelfItem" }) satisfies z.ZodType<BookshelfItem>;

export const readingProgressSchema = z
	.object({
		platform: z.string().min(1).describe("小说源平台 ID，如 linovelib"),
		novelId: z.string().min(1).describe("小说 ID"),
		novelTitle: z.string().describe("小说标题"),
		coverUrl: z
			.string()
			.describe("封面 URL；服务端响应中会重写为当前部署下的代理封面 URL"),
		volumeId: z.string().min(1).describe("分卷 ID"),
		volumeTitle: z.string().describe("分卷标题"),
		chapterId: z.string().min(1).describe("章节 ID"),
		chapterTitle: z.string().describe("章节标题"),
		paragraphIndex: z
			.number()
			.int()
			.min(0)
			.describe("当前阅读段落索引（从 0 开始）"),
		totalParagraphs: z.number().int().min(0).describe("章节总段落数"),
		deviceLabel: z.string().describe("产生该进度的客户端设备标识"),
		updatedAt: z.number().finite().describe("进度更新时间戳（毫秒）"),
		historyHiddenAt: z
			.number()
			.finite()
			.nullable()
			.optional()
			.describe(
				"历史隐藏时间戳（毫秒）；不为 null 且 >= updatedAt 时不在历史页显示",
			),
	})
	.meta({ id: "ReadingProgress" }) satisfies z.ZodType<ReadingProgress>;

export const syncPushSchema = z
	.object({
		bookshelf: z
			.array(bookshelfItemSchema)
			.optional()
			.describe("待推送到服务端进行 LWW 合并的书架条目列表"),
		progress: z
			.array(readingProgressSchema)
			.optional()
			.describe("待推送到服务端进行合并的阅读进度列表"),
		categories: z
			.array(bookshelfCategorySchema)
			.optional()
			.describe("待推送到服务端进行 LWW 合并的自定义书架列表"),
	})
	.meta({ id: "SyncPushPayload" });

export const syncGetDataSchema = z
	.object({
		bookshelf: z.array(bookshelfItemSchema).describe("书架条目列表"),
		progress: z.array(readingProgressSchema).describe("阅读进度列表"),
		categories: z.array(bookshelfCategorySchema).describe("自定义书架列表"),
		cursor: z
			.number()
			.int()
			.describe(
				"本次拉取返回的服务端游标（毫秒时间戳），可用于下次 since 参数",
			),
	})
	.meta({ id: "SyncStateData" });

export const syncPostDataSchema = z
	.object({
		bookshelf: z.array(bookshelfItemSchema).describe("合并后的书架条目列表"),
		progress: z.array(readingProgressSchema).describe("合并后的阅读进度列表"),
		categories: z
			.array(bookshelfCategorySchema)
			.describe("合并后的自定义书架列表"),
		serverTime: z
			.number()
			.int()
			.describe("服务端完成本次合并的时间戳（毫秒），可作为后续增量游标"),
	})
	.meta({ id: "SyncMergeData" });

export const syncGetResponseSchema =
	createSuccessEnvelopeSchema(syncGetDataSchema);
export const syncPostResponseSchema =
	createSuccessEnvelopeSchema(syncPostDataSchema);
