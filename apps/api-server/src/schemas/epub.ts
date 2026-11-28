import z from "zod";
import type {
	EpubJobArtifact,
	EpubJobRecord,
	EpubJobStatus,
	EpubProfile,
	EpubTriggerSource,
	VolumeEpubStatusItem,
} from "../epub/types";
import { createSuccessEnvelopeSchema } from "./common";

export const epubProfileSchema = z
	.enum(["original", "eink"])
	.describe(
		"EPUB 图片处理预设：original 保持原图，eink 启用墨水屏灰度缩放与 mozjpeg 瘦身",
	)
	.meta({ id: "EpubProfile" }) satisfies z.ZodType<EpubProfile>;

export const epubTriggerSourceSchema = z
	.enum(["reader", "prefetch"])
	.describe("任务触发来源：reader 为阅读器实时触发，prefetch 为后台预打包")
	.meta({ id: "EpubTriggerSource" }) satisfies z.ZodType<EpubTriggerSource>;

export const epubJobStatusSchema = z
	.enum([
		"queued",
		"fetching_chapters",
		"fetching_images",
		"processing_images",
		"packing",
		"ready",
		"failed",
	])
	.describe("EPUB 构建任务状态")
	.meta({ id: "EpubJobStatus" }) satisfies z.ZodType<EpubJobStatus>;

export const epubVolumeParamSchema = z.object({
	novelId: z.string().min(1, "Novel ID is required").describe("小说 ID"),
	volumeId: z.string().min(1, "Volume ID is required").describe("分卷 ID"),
});

export const epubNovelParamSchema = z.object({
	novelId: z.string().min(1, "Novel ID is required").describe("小说 ID"),
});

export const epubJobParamSchema = z.object({
	jobId: z.string().min(1, "Job ID is required").describe("构建任务 ID"),
});

export const epubProfileQuerySchema = z.object({
	profile: epubProfileSchema.default("original"),
});

export const createEpubJobBodySchema = z
	.object({
		profile: epubProfileSchema.default("original"),
		refresh: z
			.boolean()
			.default(false)
			.describe("是否强制回源刷新小说目录并重新校验内容指纹，默认 false"),
		triggerSource: epubTriggerSourceSchema.default("reader"),
	})
	.meta({ id: "CreateEpubJobBody" });

export const epubJobArtifactSchema = z
	.object({
		contentFingerprint: z
			.string()
			.describe("EPUB 内容指纹（16 位十六进制 SHA-256 截断）"),
		sizeBytes: z.number().int().min(0).describe("EPUB 文件字节大小"),
		chapterCount: z.number().int().min(0).describe("成功打包的有效章节数量"),
		generatedAt: z.iso.datetime().describe("EPUB 生成时间（ISO 8601）"),
		downloadPath: z.string().describe("服务端流式下载相对路径"),
	})
	.meta({ id: "EpubJobArtifact" }) satisfies z.ZodType<EpubJobArtifact>;

export const epubJobRecordSchema = z
	.object({
		jobId: z.string().describe("任务唯一 ID"),
		dedupeKey: z
			.string()
			.describe("Singleflight 去重键（platform:novelId:volumeId:profile）"),
		platform: z.string().describe("小说源平台 ID"),
		novelId: z.string().describe("小说 ID"),
		volumeId: z.string().describe("分卷 ID"),
		profile: epubProfileSchema,
		triggerSource: epubTriggerSourceSchema,
		status: epubJobStatusSchema,
		phaseMessage: z.string().describe("当前阶段的可读进度提示"),
		current: z.number().int().min(0).describe("当前阶段已完成步数"),
		total: z.number().int().min(0).describe("当前阶段总步数"),
		warnings: z.array(z.string()).describe("构建过程中产生的非致命告警列表"),
		error: z
			.string()
			.optional()
			.describe("失败原因（仅 status=failed 时存在）"),
		artifact: epubJobArtifactSchema
			.optional()
			.describe("成品元信息（仅 status=ready 时存在）"),
		createdAt: z.number().int().describe("任务创建时间戳（毫秒）"),
		updatedAt: z.number().int().describe("任务最后更新时间戳（毫秒）"),
	})
	.meta({ id: "EpubJobRecord" }) satisfies z.ZodType<EpubJobRecord>;

export const volumeEpubStatusItemSchema = z
	.object({
		volumeId: z.string().describe("分卷 ID"),
		cached: z.boolean().describe("磁盘是否存在可用 .epub 缓存"),
		contentFingerprint: z
			.string()
			.nullable()
			.describe("磁盘缓存内容指纹，未缓存时为 null"),
		stale: z
			.boolean()
			.describe(
				"磁盘缓存与当前 SQLite 章节列表/哈希是否已失配；未缓存时固定为 false",
			),
		chapterCount: z
			.number()
			.int()
			.min(0)
			.describe("SQLite 当前已知的有效章节数"),
		sizeBytes: z
			.number()
			.int()
			.min(0)
			.nullable()
			.describe("缓存文件字节数，未缓存时为 null"),
		generatedAt: z.iso
			.datetime()
			.nullable()
			.describe("缓存生成时间（ISO 8601），未缓存时为 null"),
		activeJobId: z
			.string()
			.nullable()
			.describe("当前进行中的构建任务 ID，无活跃任务时为 null"),
	})
	.meta({
		id: "VolumeEpubStatusItem",
	}) satisfies z.ZodType<VolumeEpubStatusItem>;

export const epubJobResponseSchema =
	createSuccessEnvelopeSchema(epubJobRecordSchema);

export const novelEpubStatusResponseSchema = createSuccessEnvelopeSchema(
	z.array(volumeEpubStatusItemSchema),
);

export const volumeEpubStatusResponseSchema = createSuccessEnvelopeSchema(
	volumeEpubStatusItemSchema,
);

export function binaryEpubResponse(description: string) {
	return {
		description,
		headers: {
			ETag: {
				description:
					"基于内容指纹生成的强实体标签，可用于 If-None-Match 协商缓存",
				schema: {
					type: "string" as const,
					examples: ['"a1b2c3d4e5f60708"'],
				},
			},
			"Content-Length": {
				description: "EPUB 文件字节长度",
				schema: {
					type: "string" as const,
					examples: ["1548290"],
				},
			},
			"Content-Disposition": {
				description: "下载文件名提示（含安全转义的 UTF-8 filename*）",
				schema: {
					type: "string" as const,
					examples: [
						"attachment; filename=\"acanthis-2930-114514-eink.epub\"; filename*=UTF-8''...",
					],
				},
			},
			"Cache-Control": {
				description: "客户端缓存控制策略",
				schema: {
					type: "string" as const,
					examples: ["private, max-age=0, must-revalidate"],
				},
			},
		},
		content: {
			"application/epub+zip": {
				schema: {
					type: "string" as const,
					format: "binary",
					description: "按卷打包的 EPUB 二进制文件流",
				},
			},
		},
	};
}
