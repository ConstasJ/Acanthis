import type {
	NovelSourceDescriptor,
	SourceCapability,
} from "@acanthis-dec/core";
import z from "zod";
import { createSuccessEnvelopeSchema } from "./common";

export const sourceCapabilitySchema = z
	.enum(["search", "novels", "illustrations", "explore"])
	.describe("小说源支持的接口能力") satisfies z.ZodType<SourceCapability>;

export const novelSourceDescriptorSchema = z
	.object({
		id: z
			.string()
			.describe("小说源唯一标识（用于对应 /v1/{platform}/... 路由前缀）"),
		name: z.string().describe("小说源展示名称"),
		capabilities: z
			.array(sourceCapabilitySchema)
			.describe("当前小说源支持的功能能力列表"),
	})
	.meta({
		id: "NovelSourceDescriptor",
	}) satisfies z.ZodType<NovelSourceDescriptor>;

export const sourcesResponseSchema = createSuccessEnvelopeSchema(
	z.array(novelSourceDescriptorSchema),
	"已接入的小说源描述列表",
);
