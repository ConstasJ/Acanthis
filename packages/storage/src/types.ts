import type { NovelStatus } from "@acanthis-dec/core";

export type NovelTable = {
	id: string;
	title: string;
	author?: string | null | undefined;
	summary?: string | null | undefined;
	cover?: string | null | undefined;
	status?: NovelStatus | null | undefined;
};

export type GenreTable = {
	id: number;
	name: string;
};

export type NovelGenreTable = {
	novelId: string;
	genreId: number;
};

export type VolumeTable = {
	id: number;
	novelId: string;
	title: string;
};

export type ChapterTable = {
	id: string;
	novelId: string;
	volumeId: string;
	name: string;
};

export type KeywordSearch = {
	keyword: string;
	queryTime: number;
	total: number;
};

export type KeywordNovel = {
	keyword: string;
	novelId: string[];
};

export type CoverMetadata = {
	hash: string;
	contentType: string;
	originalUrl: string;
	ext: string;
};

export type GeneralCache = {
	key: string;
	value: string;
};

export type CookieCache = {
	id: number;
	domain: string;
	path: string;
	name: string;
	value: string;
};
