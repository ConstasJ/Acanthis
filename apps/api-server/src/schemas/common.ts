import type {
	ContentWithResolver,
	DescribeRouteOptions,
	HeadersWithResolver,
} from "hono-openapi";
import { resolver } from "hono-openapi";
import z from "zod";

export const outputStyleSchema = z
	.enum(["acanthis", "lnreader"])
	.describe(
		"输出数据结构风格：acanthis 为默认完整格式，lnreader 为兼容 LNReader 插件的精简格式",
	);

export type OutputStyle = z.infer<typeof outputStyleSchema>;

export const apiErrorSchema = z
	.object({
		code: z
			.number()
			.int()
			.describe(
				"业务错误码：10000（章节元数据缺失）、10001（封面未找到）、10002（小说 ID 缺失）、10003（插图未找到）、20000（服务端内部错误）、20001（Cloudflare 拦截或上游限流）、20002（FlareSolverr 验证失败）、20003（上游服务/网络错误）、40100（未授权）",
			),
		message: z.string().describe("人类可读的错误描述信息"),
	})
	.meta({ id: "ApiError" });

export const legacyErrorSchema = z
	.object({
		error: z.string().describe("错误描述信息（历史接口 404 兼容响应结构）"),
	})
	.meta({ id: "LegacyError" });

export const validationErrorSchema = z
	.object({
		success: z.literal(false).describe("校验是否成功，固定为 false"),
		error: z
			.array(z.record(z.string(), z.unknown()))
			.describe("请求参数或请求体校验失败明细列表"),
		data: z.unknown().describe("触发校验失败的原始输入数据"),
	})
	.meta({ id: "ValidationError" });

export const healthResponseSchema = z
	.object({
		status: z.literal("ok").describe("服务运行状态"),
		timestamp: z.iso.datetime().describe("当前服务端 ISO 8601 时间戳"),
	})
	.meta({ id: "HealthStatus" });

export const lnReaderChapterItemSchema = z
	.object({
		name: z.string().describe("章节展示名称（格式通常为 卷名 - 章节名）"),
		path: z.string().describe("章节 ID"),
		releaseTime: z.string().nullish().describe("章节发布时间"),
		chapterNumber: z.number().optional().describe("章节序号"),
		page: z.string().optional().describe("分卷页标识"),
	})
	.meta({ id: "LNReaderChapterItem" });

export const lnReaderNovelItemSchema = z
	.object({
		name: z.string().describe("小说标题"),
		path: z.string().describe("小说 ID"),
		cover: z.string().optional().describe("小说封面代理 URL"),
	})
	.meta({ id: "LNReaderNovelItem" });

export const lnReaderNovelSchema = lnReaderNovelItemSchema
	.extend({
		genres: z.string().optional().describe("逗号分隔的分类/标签字符串"),
		summary: z.string().optional().describe("小说简介"),
		author: z.string().optional().describe("作者名称"),
		artist: z.string().optional().describe("插画师名称"),
		status: z
			.string()
			.optional()
			.describe("连载状态（Ongoing / Completed / Unknown）"),
		rating: z.number().optional().describe("评分"),
		chapters: z
			.array(lnReaderChapterItemSchema)
			.optional()
			.describe("扁平化后的章节列表"),
	})
	.meta({ id: "LNReaderNovel" });

export function createSuccessEnvelopeSchema<T extends z.ZodType>(
	dataSchema: T,
	description?: string,
) {
	return z.object({
		code: z.literal(0).describe("状态码，0 表示请求成功"),
		message: z.string().describe("状态消息，成功时为 Success"),
		data: description ? dataSchema.describe(description) : dataSchema,
	});
}

export const bearerSecurity: NonNullable<DescribeRouteOptions["security"]> = [
	{ bearerAuth: [] },
];

export function jsonResponse(
	schema: z.ZodType,
	description: string,
	headers?: HeadersWithResolver,
) {
	const content: ContentWithResolver = {
		"application/json": {
			schema: resolver(schema),
		},
	};
	return headers ? { description, headers, content } : { description, content };
}

export function binaryImageResponse(description: string) {
	return {
		description,
		headers: {
			"Cache-Control": {
				description: "客户端缓存控制策略",
				schema: {
					type: "string" as const,
					examples: ["public, max-age=86400"],
				},
			},
		},
		content: {
			"image/*": {
				schema: {
					type: "string" as const,
					format: "binary",
					description:
						"图片二进制内容（实际 Content-Type 随上游或缓存媒体类型变化）",
				},
			},
		},
	};
}

export const noStoreHeader: HeadersWithResolver = {
	"Cache-Control": {
		description: "禁止缓存失败响应",
		schema: { type: "string", examples: ["no-store"] },
	},
};

export const validationErrorResponse = jsonResponse(
	validationErrorSchema,
	"请求参数、路径参数或 JSON 请求体校验失败",
);

export const unauthorizedResponse = jsonResponse(
	apiErrorSchema,
	"未提供有效的 Bearer Token（当服务端启用 AUTH_TOKEN 时返回，code: 40100）",
);

export const internalErrorResponse = jsonResponse(
	apiErrorSchema,
	"服务端内部错误（code: 20000）",
);

export const upstreamErrorResponses = {
	502: jsonResponse(
		apiErrorSchema,
		"上游服务返回 5xx 或发生网络连接失败（code: 20003）",
		{
			"Retry-After": {
				description: "发生网络异常时建议等待的重试秒数（如 5）",
				schema: { type: "string", examples: ["5"] },
			},
			...noStoreHeader,
		},
	),
	503: jsonResponse(
		apiErrorSchema,
		"上游触发 Cloudflare 拦截、上游 429 限流（code: 20001）或 FlareSolverr 验证失败（code: 20002），建议按 Retry-After 重试",
		{
			"Retry-After": {
				description: "建议客户端等待的重试秒数（固定为 15）",
				schema: { type: "string", examples: ["15"] },
			},
			...noStoreHeader,
		},
	),
	504: jsonResponse(
		apiErrorSchema,
		"上游请求超时（code: 20003），建议按 Retry-After 重试",
		{
			"Retry-After": {
				description: "建议客户端等待的重试秒数（固定为 5）",
				schema: { type: "string", examples: ["5"] },
			},
			...noStoreHeader,
		},
	),
};
