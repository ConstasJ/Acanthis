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
	platform: string;
	id: string;
	title: string;
	novelId?: string | null;
	chapters: Chapter[];
};

export type Chapter = {
	platform: string;
	id: string;
	title: string;
	novelId?: string | null;
	volumeId?: string | null;
	contentHash?: string | null;
};

export type ChapterContent = {
	title?: string;
	html: string;
};

export type NovelStatus = "ongoing" | "completed" | "unknown";
