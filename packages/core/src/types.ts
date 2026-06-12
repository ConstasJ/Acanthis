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
	title: string;
	chapters: Chapter[];
};

export type Chapter = {
	id: string;
	title: string;
};

export type ChapterContent = {
	title?: string;
	html: string;
};

export type NovelStatus = "ongoing" | "completed" | "unknown";
