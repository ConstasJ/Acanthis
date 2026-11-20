import type {
	ExploreChannelOption,
	ExploreFilterGroup,
	ExploreFilterOption,
	ExploreRankingOption,
	ExploreSchema,
} from "@acanthis-dec/core";

const CHANNELS: ExploreChannelOption[] = [
	{ id: "home", label: "全站首页", requiresChallenge: false },
	{ id: "dengekibunko", label: "电击文库", requiresChallenge: true },
	{ id: "fujimibunko", label: "富士见文库", requiresChallenge: true },
	{ id: "kadokawabunko", label: "角川文库", requiresChallenge: true },
	{ id: "emuefubunkojei", label: "MF文库J", requiresChallenge: true },
	{ id: "famitsubunko", label: "Fami通文库", requiresChallenge: true },
	{ id: "gagraphicbunko", label: "GA文库", requiresChallenge: true },
	{ id: "hobbyjapanbunko", label: "HJ文库", requiresChallenge: true },
	{ id: "ichijinsha", label: "一迅社", requiresChallenge: true },
	{ id: "shueisha", label: "集英社", requiresChallenge: true },
	{ id: "shogakukan", label: "小学馆", requiresChallenge: true },
	{ id: "kodansha", label: "讲谈社", requiresChallenge: true },
	{ id: "teenagebunko", label: "少女文库", requiresChallenge: true },
	{ id: "other", label: "其他文库", requiresChallenge: true },
	{ id: "chineselightnovel", label: "华文轻小说", requiresChallenge: true },
	{ id: "weblightnovel", label: "Web轻小说", requiresChallenge: true },
	{ id: "koreanlightnovel", label: "韩国轻小说", requiresChallenge: true },
];

const RANKINGS: ExploreRankingOption[] = [
	{
		id: "monthvisit",
		label: "月点击榜",
		supportsAll: true,
		supportsFull: true,
	},
	{ id: "weekvisit", label: "周点击榜", supportsAll: true, supportsFull: true },
	{ id: "monthvote", label: "月推荐榜", supportsAll: true, supportsFull: true },
	{ id: "weekvote", label: "周推荐榜", supportsAll: true, supportsFull: true },
	{
		id: "monthflower",
		label: "月鲜花榜",
		supportsAll: true,
		supportsFull: true,
	},
	{
		id: "weekflower",
		label: "周鲜花榜",
		supportsAll: true,
		supportsFull: true,
	},
	{ id: "monthegg", label: "月鸡蛋榜", supportsAll: true, supportsFull: true },
	{ id: "weekegg", label: "周鸡蛋榜", supportsAll: true, supportsFull: true },
	{
		id: "lastupdate",
		label: "最近更新",
		supportsAll: true,
		supportsFull: true,
	},
	{ id: "postdate", label: "最新入库", supportsAll: true, supportsFull: true },
	{ id: "goodnum", label: "收藏榜", supportsAll: true, supportsFull: true },
	{ id: "newhot", label: "新书榜", supportsAll: true, supportsFull: true },
	{ id: "allvisit", label: "总点击榜", supportsAll: false, supportsFull: true },
];

const SORT_OPTIONS: ExploreFilterOption[] = [
	{ value: "lastupdate", label: "更新时间" },
	{ value: "weekvisit", label: "周点击" },
	{ value: "monthvisit", label: "月点击" },
	{ value: "weekvote", label: "周推荐" },
	{ value: "monthvote", label: "月推荐" },
	{ value: "weekflower", label: "周鲜花" },
	{ value: "monthflower", label: "月鲜花" },
	{ value: "goodnum", label: "收藏数" },
	{ value: "postdate", label: "入库时间" },
];

const REGION_OPTIONS: ExploreFilterOption[] = [
	{ value: "0", label: "不限" },
	{ value: "1", label: "日本轻小说" },
	{ value: "2", label: "华文轻小说" },
	{ value: "3", label: "Web轻小说" },
	{ value: "4", label: "轻改漫画" },
	{ value: "5", label: "韩国轻小说" },
];

const TAG_OPTIONS: ExploreFilterOption[] = [
	{ value: "0", label: "不限" },
	{ value: "64", label: "恋爱" },
	{ value: "48", label: "后宫" },
	{ value: "63", label: "校园" },
	{ value: "27", label: "百合" },
	{ value: "26", label: "转生" },
	{ value: "47", label: "异世界" },
	{ value: "15", label: "奇幻" },
	{ value: "61", label: "冒险" },
	{ value: "222", label: "欢乐向" },
	{ value: "231", label: "女性视角" },
	{ value: "219", label: "龙傲天" },
	{ value: "96", label: "魔法" },
	{ value: "67", label: "青春" },
	{ value: "31", label: "性转" },
	{ value: "198", label: "病娇" },
	{ value: "217", label: "妹妹" },
	{ value: "225", label: "青梅竹马" },
	{ value: "18", label: "战斗" },
	{ value: "256", label: "NTR" },
	{ value: "223", label: "人外" },
	{ value: "227", label: "大小姐" },
	{ value: "189", label: "黑暗" },
	{ value: "68", label: "悬疑" },
	{ value: "56", label: "科幻" },
	{ value: "201", label: "伪娘" },
	{ value: "55", label: "战争" },
	{ value: "185", label: "萝莉" },
	{ value: "229", label: "复仇" },
	{ value: "199", label: "斗智" },
	{ value: "131", label: "异能" },
	{ value: "241", label: "猎奇" },
	{ value: "191", label: "轻文学" },
	{ value: "60", label: "职场" },
	{ value: "226", label: "经营" },
	{ value: "246", label: "JK" },
	{ value: "135", label: "机战" },
	{ value: "261", label: "女儿" },
	{ value: "221", label: "末日" },
	{ value: "220", label: "犯罪" },
	{ value: "239", label: "旅行" },
	{ value: "124", label: "惊悚" },
	{ value: "98", label: "治愈" },
	{ value: "97", label: "推理" },
	{ value: "205", label: "日本文学" },
	{ value: "248", label: "游戏" },
	{ value: "228", label: "耽美" },
	{ value: "211", label: "美食" },
	{ value: "245", label: "群像" },
	{ value: "249", label: "大逃杀" },
	{ value: "233", label: "音乐" },
	{ value: "132", label: "格斗" },
	{ value: "28", label: "热血" },
	{ value: "180", label: "温馨" },
	{ value: "224", label: "脑洞" },
	{ value: "328", label: "恶役" },
	{ value: "304", label: "JC" },
	{ value: "254", label: "间谍" },
	{ value: "146", label: "竞技" },
	{ value: "263", label: "宅文化" },
	{ value: "333", label: "同人" },
];

const PROGRESS_OPTIONS: ExploreFilterOption[] = [
	{ value: "0", label: "不限" },
	{ value: "1", label: "新书上传" },
	{ value: "2", label: "情节展开" },
	{ value: "3", label: "精彩纷呈" },
	{ value: "4", label: "接近尾声" },
	{ value: "5", label: "已经完本" },
];

const ANIME_OPTIONS: ExploreFilterOption[] = [
	{ value: "0", label: "不限" },
	{ value: "1", label: "已动画化" },
	{ value: "2", label: "未动画化" },
];

const WORDS_OPTIONS: ExploreFilterOption[] = [
	{ value: "0", label: "不限" },
	{ value: "1", label: "30万以下" },
	{ value: "2", label: "30-50万" },
	{ value: "3", label: "50-100万" },
	{ value: "4", label: "100-200万" },
	{ value: "5", label: "200万以上" },
];

const UPDATED_OPTIONS: ExploreFilterOption[] = [
	{ value: "0", label: "不限" },
	{ value: "1", label: "三日内" },
	{ value: "2", label: "七日内" },
	{ value: "3", label: "半月内" },
	{ value: "4", label: "一月内" },
];

const CATALOG_FILTERS: ExploreFilterGroup[] = [
	{
		key: "sort",
		label: "排序方式",
		defaultValue: "lastupdate",
		options: SORT_OPTIONS,
	},
	{
		key: "region",
		label: "文库地区",
		defaultValue: "0",
		options: REGION_OPTIONS,
	},
	{
		key: "tag",
		label: "作品主题",
		defaultValue: "0",
		options: TAG_OPTIONS,
	},
	{
		key: "progress",
		label: "写作进度",
		defaultValue: "0",
		options: PROGRESS_OPTIONS,
	},
	{
		key: "anime",
		label: "是否动画化",
		defaultValue: "0",
		options: ANIME_OPTIONS,
	},
	{
		key: "words",
		label: "作品字数",
		defaultValue: "0",
		options: WORDS_OPTIONS,
	},
	{
		key: "updated",
		label: "更新时间",
		defaultValue: "0",
		options: UPDATED_OPTIONS,
	},
];

export const LINOVELIB_EXPLORE_SCHEMA: ExploreSchema = {
	platform: "linovelib",
	supportsHome: true,
	channels: CHANNELS,
	rankings: RANKINGS,
	catalogRequiresChallenge: true,
	catalogFilters: CATALOG_FILTERS,
};

export const LINOVELIB_CHANNEL_IDS: ReadonlySet<string> = new Set(
	CHANNELS.map((c) => c.id),
);

export const LINOVELIB_RANKING_IDS: ReadonlySet<string> = new Set(
	RANKINGS.map((r) => r.id),
);

export const LINOVELIB_CATALOG_SORT_IDS: ReadonlySet<string> = new Set(
	SORT_OPTIONS.map((o) => o.value),
);

export const LINOVELIB_CATALOG_REGION_IDS: ReadonlySet<string> = new Set(
	REGION_OPTIONS.map((o) => o.value),
);

export const LINOVELIB_CATALOG_TAG_IDS: ReadonlySet<string> = new Set(
	TAG_OPTIONS.map((o) => o.value),
);

export const LINOVELIB_CATALOG_PROGRESS_IDS: ReadonlySet<string> = new Set(
	PROGRESS_OPTIONS.map((o) => o.value),
);

export const LINOVELIB_CATALOG_ANIME_IDS: ReadonlySet<string> = new Set(
	ANIME_OPTIONS.map((o) => o.value),
);

export const LINOVELIB_CATALOG_WORDS_IDS: ReadonlySet<string> = new Set(
	WORDS_OPTIONS.map((o) => o.value),
);

export const LINOVELIB_CATALOG_UPDATED_IDS: ReadonlySet<string> = new Set(
	UPDATED_OPTIONS.map((o) => o.value),
);

const RANKING_MAP = new Map<string, ExploreRankingOption>(
	RANKINGS.map((r) => [r.id, r]),
);

const CHANNEL_MAP = new Map<string, ExploreChannelOption>(
	CHANNELS.map((c) => [c.id, c]),
);

export interface LinovelibRankingOptions {
	rank: string;
	full?: boolean;
	page?: number;
}

export interface LinovelibCatalogOptions {
	sort?: string;
	region?: string;
	tag?: string;
	progress?: string;
	anime?: string;
	words?: string;
	updated?: string;
	page?: number;
}

export function getLinovelibChannelOption(
	channel: string,
): ExploreChannelOption | undefined {
	return CHANNEL_MAP.get(channel);
}

export function isValidLinovelibChannel(channel: string): boolean {
	return LINOVELIB_CHANNEL_IDS.has(channel);
}

export function isValidLinovelibRanking(rank: string, full: boolean): boolean {
	const option = RANKING_MAP.get(rank);
	if (!option) {
		return false;
	}
	return full ? option.supportsFull : option.supportsAll;
}

function assertAllowedOption(
	key: string,
	value: string,
	allowed: ReadonlySet<string>,
): string {
	if (!allowed.has(value)) {
		throw new Error(`Invalid linovelib catalog ${key}: ${value}`);
	}
	return value;
}

export function normalizeCatalogOptions(
	options?: LinovelibCatalogOptions,
): Required<LinovelibCatalogOptions> {
	const sort = assertAllowedOption(
		"sort",
		options?.sort ?? "lastupdate",
		LINOVELIB_CATALOG_SORT_IDS,
	);
	const region = assertAllowedOption(
		"region",
		options?.region ?? "0",
		LINOVELIB_CATALOG_REGION_IDS,
	);
	const tag = assertAllowedOption(
		"tag",
		options?.tag ?? "0",
		LINOVELIB_CATALOG_TAG_IDS,
	);
	const progress = assertAllowedOption(
		"progress",
		options?.progress ?? "0",
		LINOVELIB_CATALOG_PROGRESS_IDS,
	);
	const anime = assertAllowedOption(
		"anime",
		options?.anime ?? "0",
		LINOVELIB_CATALOG_ANIME_IDS,
	);
	const words = assertAllowedOption(
		"words",
		options?.words ?? "0",
		LINOVELIB_CATALOG_WORDS_IDS,
	);
	const updated = assertAllowedOption(
		"updated",
		options?.updated ?? "0",
		LINOVELIB_CATALOG_UPDATED_IDS,
	);
	const page = options?.page ?? 1;
	if (!Number.isInteger(page) || page < 1) {
		throw new Error(`Invalid linovelib catalog page: ${page}`);
	}
	return {
		sort,
		region,
		tag,
		progress,
		anime,
		words,
		updated,
		page,
	};
}
