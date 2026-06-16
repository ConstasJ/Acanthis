export interface NovelSearchResult {
	id: string;
	platform: string;
	title: string;
	coverUrl?: string;
}

export interface NovelInfo extends NovelSearchResult {
	author: string;
	summary: string;
	status: NovelStatus;
	genres: string[];
}
export interface Novel extends NovelInfo {
	volumes: Volume[];
}

export type Volume = {
	id: string;
	platform?: string | null | undefined;
	title: string;
	coverUrl?: string | null | undefined;
	novelId?: string | null | undefined;
	chapters: Chapter[];
};

export type Chapter = {
	id: string;
	platform?: string | null | undefined;
	title: string;
	novelId?: string | null | undefined;
	volumeId?: string | null | undefined;
	contentHash?: string | null | undefined;
};

export type ChapterContent = {
	title?: string;
	html: string;
};

export type NovelStatus = "ongoing" | "completed" | "unknown";
