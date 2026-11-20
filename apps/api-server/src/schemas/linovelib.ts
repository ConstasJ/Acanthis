import type {
	Chapter,
	ExploreChannelOption,
	ExploreFilterGroup,
	ExploreFilterOption,
	ExploreHomeData,
	ExploreNovelItem,
	ExplorePage,
	ExploreRankingOption,
	ExploreSchema,
	ExploreSection,
	ExploreSectionLayout,
	ExploreSectionMoreTarget,
	Novel,
	NovelInfo,
	NovelSearchResult,
	NovelStatus,
	Volume,
} from "@acanthis-dec/core";
import {
	isValidLinovelibRanking,
	LINOVELIB_CATALOG_ANIME_IDS,
	LINOVELIB_CATALOG_PROGRESS_IDS,
	LINOVELIB_CATALOG_REGION_IDS,
	LINOVELIB_CATALOG_SORT_IDS,
	LINOVELIB_CATALOG_TAG_IDS,
	LINOVELIB_CATALOG_UPDATED_IDS,
	LINOVELIB_CATALOG_WORDS_IDS,
	LINOVELIB_CHANNEL_IDS,
	LINOVELIB_RANKING_IDS,
} from "@acanthis-dec/linovelib";
import z from "zod";
import {
	createSuccessEnvelopeSchema,
	lnReaderNovelItemSchema,
	lnReaderNovelSchema,
	outputStyleSchema,
} from "./common";

type AssertSameKeys<A, B> = [
	Exclude<keyof A, keyof B>,
	Exclude<keyof B, keyof A>,
] extends [never, never]
	? true
	: never;

function createAllowedEnumSchema(
	allowed: ReadonlySet<string>,
	defaultValue: string,
	fieldName: string,
	description: string,
) {
	const values = [...allowed];
	if (values.length === 0) {
		throw new Error(`Allowed enum set for ${fieldName} cannot be empty`);
	}
	return z
		.enum(values as [string, ...string[]], {
			error: `Invalid ${fieldName}`,
		})
		.default(defaultValue)
		.describe(description);
}

const queryBooleanSchema = z
	.union([z.boolean(), z.enum(["true", "false", "1", "0"])])
	.transform((val) => val === true || val === "true" || val === "1")
	.default(false)
	.meta({ default: false });

export const chapterParamSchema = z.object({
	chapterId: z.string().min(1, "Chapter ID is required").describe("章节 ID"),
});

export const chapterQuerySchema = z.object({
	novelId: z
		.string()
		.min(1)
		.optional()
		.describe(
			"可选的小说 ID；当本地尚无该章节元数据时，传入纯数字 novelId 可触发小说目录回源兜底",
		),
});

export const novelParamSchema = z.object({
	novelId: z.string().min(1, "Novel ID is required").describe("小说 ID"),
});

export const novelStyleQuerySchema = z.object({
	style: outputStyleSchema.optional(),
});

export const volumeParamSchema = z.object({
	volumeId: z.string().min(1, "Volume ID is required").describe("分卷 ID"),
});

export const illustrationParamSchema = z.object({
	hash: z
		.string()
		.regex(/^[a-f0-9]{32}$/i, "Invalid illustration hash")
		.describe("插图原图 URL 的 32 位十六进制 MD5 哈希"),
});

export const novelsQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1).describe("页码（从 1 开始）"),
	pageSize: z.coerce
		.number()
		.int()
		.min(1)
		.max(100)
		.default(20)
		.describe("每页数量（1-100）"),
	style: outputStyleSchema.optional(),
});

export const searchQuerySchema = z.object({
	keyword: z.string().min(1, "Keyword is required").describe("搜索关键词"),
	style: outputStyleSchema.optional(),
});

export const homeQuerySchema = z.object({
	channel: createAllowedEnumSchema(
		LINOVELIB_CHANNEL_IDS,
		"home",
		"explore channel",
		"发现页频道 ID",
	),
});

export const rankingsQuerySchema = z
	.object({
		rank: createAllowedEnumSchema(
			LINOVELIB_RANKING_IDS,
			"monthvisit",
			"ranking id",
			"排行榜 ID",
		),
		full: queryBooleanSchema.describe(
			"是否请求完整榜单（true/1 为完整榜，false/0 为总榜）；部分榜单仅支持 full=true",
		),
		page: z.coerce
			.number()
			.int()
			.min(1)
			.default(1)
			.describe("页码（从 1 开始）"),
		style: outputStyleSchema.optional(),
	})
	.refine((val) => isValidLinovelibRanking(val.rank, val.full), {
		message: "Selected ranking does not support full=false",
		path: ["rank"],
	});

export const catalogQuerySchema = z.object({
	sort: createAllowedEnumSchema(
		LINOVELIB_CATALOG_SORT_IDS,
		"lastupdate",
		"catalog sort",
		"书库排序字段",
	),
	region: createAllowedEnumSchema(
		LINOVELIB_CATALOG_REGION_IDS,
		"0",
		"catalog region",
		"地区/文库筛选值",
	),
	tag: createAllowedEnumSchema(
		LINOVELIB_CATALOG_TAG_IDS,
		"0",
		"catalog tag",
		"题材标签筛选值",
	),
	progress: createAllowedEnumSchema(
		LINOVELIB_CATALOG_PROGRESS_IDS,
		"0",
		"catalog progress",
		"连载进度筛选值",
	),
	anime: createAllowedEnumSchema(
		LINOVELIB_CATALOG_ANIME_IDS,
		"0",
		"catalog anime",
		"动画化筛选值",
	),
	words: createAllowedEnumSchema(
		LINOVELIB_CATALOG_WORDS_IDS,
		"0",
		"catalog words",
		"字数区间筛选值",
	),
	updated: createAllowedEnumSchema(
		LINOVELIB_CATALOG_UPDATED_IDS,
		"0",
		"catalog updated",
		"更新时间筛选值",
	),
	page: z.coerce.number().int().min(1).default(1).describe("页码（从 1 开始）"),
	style: outputStyleSchema.optional(),
});

export const novelStatusSchema = z
	.enum(["ongoing", "completed", "unknown"])
	.describe("小说连载状态") satisfies z.ZodType<NovelStatus>;

export const novelSearchResultSchema = z
	.object({
		id: z.string().describe("小说 ID"),
		platform: z.string().describe("小说源平台 ID"),
		title: z.string().describe("小说标题"),
		coverUrl: z.string().optional().describe("封面代理 URL"),
	})
	.meta({
		id: "NovelSearchResult",
	});

export const novelInfoSchema = novelSearchResultSchema
	.extend({
		author: z.string().describe("作者名称"),
		summary: z.string().describe("小说简介"),
		status: novelStatusSchema,
		genres: z.array(z.string()).describe("分类标签列表"),
	})
	.meta({ id: "NovelInfo" });

export const chapterSchema = z
	.object({
		id: z.string().describe("章节 ID"),
		platform: z.string().nullish().describe("平台标识（详情接口中会省略）"),
		title: z.string().describe("章节标题"),
		novelId: z.string().nullish().describe("所属小说 ID"),
		volumeId: z.string().nullish().describe("所属分卷 ID"),
		contentHash: z.string().nullish().describe("正文内容缓存哈希"),
	})
	.meta({ id: "Chapter" });

export const volumeSchema = z
	.object({
		id: z.string().describe("分卷 ID"),
		platform: z.string().nullish().describe("平台标识（详情接口中会省略）"),
		title: z.string().describe("分卷标题"),
		coverUrl: z.string().nullish().describe("分卷封面代理 URL"),
		novelId: z.string().nullish().describe("所属小说 ID"),
		chapters: z.array(chapterSchema).describe("分卷内章节列表"),
	})
	.meta({ id: "Volume" });

export const novelSchema = novelInfoSchema
	.extend({
		volumes: z.array(volumeSchema).describe("分卷及目录结构"),
	})
	.meta({ id: "Novel" });

export const exploreFilterOptionSchema = z
	.object({
		value: z.string().describe("筛选项传参值"),
		label: z.string().describe("筛选项展示名称"),
	})
	.meta({ id: "ExploreFilterOption" }) satisfies z.ZodType<ExploreFilterOption>;

export const exploreFilterGroupSchema = z
	.object({
		key: z.string().describe("对应 /catalog 的查询参数键名"),
		label: z.string().describe("筛选分组展示名称"),
		defaultValue: z.string().describe("默认筛选值"),
		options: z.array(exploreFilterOptionSchema).describe("可选项列表"),
	})
	.meta({ id: "ExploreFilterGroup" }) satisfies z.ZodType<ExploreFilterGroup>;

export const exploreChannelOptionSchema = z
	.object({
		id: z.string().describe("频道 ID，传入 /home?channel="),
		label: z.string().describe("频道展示名称"),
		requiresChallenge: z
			.boolean()
			.optional()
			.describe("该频道上游是否常触发 Cloudflare 验证"),
	})
	.meta({
		id: "ExploreChannelOption",
	});

export const exploreRankingOptionSchema = z
	.object({
		id: z.string().describe("榜单 ID，传入 /rankings?rank="),
		label: z.string().describe("榜单展示名称"),
		supportsAll: z.boolean().describe("是否支持 full=false 总榜"),
		supportsFull: z.boolean().describe("是否支持 full=true 完整榜"),
	})
	.meta({
		id: "ExploreRankingOption",
	}) satisfies z.ZodType<ExploreRankingOption>;

export const exploreSchemaDataSchema = z
	.object({
		platform: z.string().describe("平台 ID，如 linovelib"),
		supportsHome: z.boolean().describe("是否支持首页推荐接口"),
		channels: z.array(exploreChannelOptionSchema).describe("支持的频道列表"),
		rankings: z.array(exploreRankingOptionSchema).describe("支持的排行榜列表"),
		catalogRequiresChallenge: z
			.boolean()
			.optional()
			.describe("书库页上游是否常触发 Cloudflare 验证"),
		catalogFilters: z
			.array(exploreFilterGroupSchema)
			.describe("书库组合筛选分组定义"),
	})
	.meta({
		id: "ExploreSchema",
	});

export const exploreNovelItemSchema = z
	.object({
		id: z.string().describe("小说 ID"),
		platform: z.string().describe("平台 ID"),
		title: z.string().describe("小说标题"),
		coverUrl: z.string().optional().describe("封面代理 URL"),
		author: z.string().optional().describe("作者名称"),
		summary: z.string().optional().describe("小说简介"),
		status: novelStatusSchema.optional(),
		category: z.string().optional().describe("分类名称"),
		genres: z.array(z.string()).optional().describe("标签列表"),
		latestChapter: z.string().optional().describe("最新章节标题"),
		latestChapterId: z.string().optional().describe("最新章节 ID"),
		wordCount: z.string().optional().describe("字数描述"),
		updatedAt: z.string().optional().describe("最近更新时间文本"),
		rank: z.number().optional().describe("榜单排名"),
	})
	.meta({
		id: "ExploreNovelItem",
	});

export const exploreSectionLayoutSchema = z
	.enum(["featured", "grid", "rank", "updates"])
	.describe("栏目推荐展示布局提示") satisfies z.ZodType<ExploreSectionLayout>;

export const exploreSectionMoreTargetSchema = z
	.object({
		type: z
			.enum(["ranking", "catalog", "channel"])
			.describe("更多跳转目标类型"),
		params: z
			.record(z.string(), z.string())
			.describe("跳转目标对应的查询参数键值对"),
	})
	.meta({
		id: "ExploreSectionMoreTarget",
	}) satisfies z.ZodType<ExploreSectionMoreTarget>;

export const exploreSectionSchema = z
	.object({
		id: z.string().describe("栏目标识"),
		title: z.string().describe("栏目标题"),
		layout: exploreSectionLayoutSchema,
		items: z.array(exploreNovelItemSchema).describe("栏目内小说列表"),
		more: exploreSectionMoreTargetSchema
			.optional()
			.describe("查看更多跳转参数"),
	})
	.meta({
		id: "ExploreSection",
	});

export const exploreHomeDataSchema = z
	.object({
		platform: z.string().describe("平台 ID"),
		channel: z.string().describe("当前频道 ID"),
		title: z.string().describe("频道页面标题"),
		sections: z.array(exploreSectionSchema).describe("频道内各推荐栏目"),
	})
	.meta({
		id: "ExploreHomeData",
	});

export const explorePageSchema = z
	.object({
		platform: z.string().describe("平台 ID"),
		items: z.array(exploreNovelItemSchema).describe("当前页小说条目列表"),
		page: z.number().int().min(1).describe("当前页码"),
		totalPages: z.number().int().min(1).optional().describe("总页数"),
		hasNextPage: z.boolean().describe("是否存在下一页"),
	})
	.meta({ id: "ExplorePage" });

export type _CoreSchemaKeyChecks = [
	AssertSameKeys<z.infer<typeof novelSearchResultSchema>, NovelSearchResult>,
	AssertSameKeys<z.infer<typeof novelInfoSchema>, NovelInfo>,
	AssertSameKeys<z.infer<typeof chapterSchema>, Chapter>,
	AssertSameKeys<z.infer<typeof volumeSchema>, Volume>,
	AssertSameKeys<z.infer<typeof novelSchema>, Novel>,
	AssertSameKeys<
		z.infer<typeof exploreChannelOptionSchema>,
		ExploreChannelOption
	>,
	AssertSameKeys<z.infer<typeof exploreSchemaDataSchema>, ExploreSchema>,
	AssertSameKeys<z.infer<typeof exploreNovelItemSchema>, ExploreNovelItem>,
	AssertSameKeys<z.infer<typeof exploreSectionSchema>, ExploreSection>,
	AssertSameKeys<z.infer<typeof exploreHomeDataSchema>, ExploreHomeData>,
	AssertSameKeys<z.infer<typeof explorePageSchema>, ExplorePage>,
];

export const paginatedNovelsDataSchema = z
	.object({
		items: z
			.union([z.array(novelInfoSchema), z.array(lnReaderNovelItemSchema)])
			.describe(
				"当 style=lnreader 时为 LNReaderNovelItem[]，否则为 NovelInfo[]",
			),
		total: z.number().int().min(0).describe("已缓存小说总数"),
		page: z.number().int().min(1).describe("当前页码"),
		pageSize: z.number().int().min(1).describe("每页数量"),
	})
	.meta({ id: "PaginatedNovelsData" });

export const chapterContentDataSchema = z
	.object({
		content: z
			.string()
			.describe(
				"已解扰并将插图 img[src] 重写为 /v1/linovelib/illustration/{hash} 代理地址的章节 HTML 正文",
			),
	})
	.meta({ id: "ChapterContentData" });

export const exploreSchemaResponseSchema = createSuccessEnvelopeSchema(
	exploreSchemaDataSchema,
);

export const exploreHomeResponseSchema = createSuccessEnvelopeSchema(
	exploreHomeDataSchema,
);

export const rankingsResponseSchema = createSuccessEnvelopeSchema(
	z
		.union([explorePageSchema, z.array(lnReaderNovelItemSchema)])
		.describe("当 style=lnreader 时为 LNReaderNovelItem[]，否则为 ExplorePage"),
);

export const catalogResponseSchema = createSuccessEnvelopeSchema(
	z
		.union([explorePageSchema, z.array(lnReaderNovelItemSchema)])
		.describe("当 style=lnreader 时为 LNReaderNovelItem[]，否则为 ExplorePage"),
);

export const chapterResponseSchema = createSuccessEnvelopeSchema(
	chapterContentDataSchema,
);

export const novelsResponseSchema = createSuccessEnvelopeSchema(
	paginatedNovelsDataSchema,
);

export const novelDetailResponseSchema = createSuccessEnvelopeSchema(
	z
		.union([novelSchema, lnReaderNovelSchema])
		.describe("当 style=lnreader 时为 LNReaderNovel，否则为完整 Novel"),
);

export const searchResponseSchema = createSuccessEnvelopeSchema(
	z
		.union([z.array(novelSearchResultSchema), z.array(lnReaderNovelItemSchema)])
		.describe(
			"当 style=lnreader 时为 LNReaderNovelItem[]，否则为 NovelSearchResult[]",
		),
);
