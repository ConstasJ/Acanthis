import { z } from "zod";
import type {
	ChapterTable,
	CookieCache,
	CoverMetadata,
	GeneralCache,
	GenreTable,
	KeywordNovel,
	KeywordSearch,
	NovelGenreTable,
	NovelTable,
	VolumeTable,
} from "./types.js";

export const NovelTableSchema: z.ZodType<NovelTable> = z.object({
	id: z.string(),
	title: z.string(),
	author: z.string().nullish(),
	summary: z.string().nullish(),
	cover: z.string().nullish(),
	status: z.enum(["ongoing", "completed", "unknown"]).nullish(),
});

export const GenreTableSchema: z.ZodType<GenreTable> = z.object({
	id: z.number(),
	name: z.string(),
});

export const NovelGenreTableSchema: z.ZodType<NovelGenreTable> = z.object({
	novelId: z.string(),
	genreId: z.number(),
});

export const VolumeTableSchema: z.ZodType<VolumeTable> = z.object({
	id: z.number(),
	novelId: z.string(),
	title: z.string(),
});

export const ChapterTableSchema: z.ZodType<ChapterTable> = z.object({
	id: z.string(),
	novelId: z.string(),
	volumeId: z.string(),
	name: z.string(),
});

export const KeywordSearchSchema: z.ZodType<KeywordSearch> = z.object({
	keyword: z.string(),
	queryTime: z.number(),
	total: z.number(),
});

export const KeywordNovelSchema: z.ZodType<KeywordNovel> = z.object({
	keyword: z.string(),
	novelId: z.array(z.string()),
});

export const CoverMetadataSchema: z.ZodType<CoverMetadata> = z.object({
	hash: z.string(),
	contentType: z.string(),
	originalUrl: z.string(),
	ext: z.string(),
});

export const GeneralCacheSchema: z.ZodType<GeneralCache> = z.object({
	key: z.string(),
	value: z.string(),
});

export const CookieCacheSchema: z.ZodType<CookieCache> = z.object({
	id: z.number(),
	domain: z.string(),
	path: z.string(),
	name: z.string(),
	value: z.string(),
});
