export type Novel = {
	id: string;
	title: string;
	author?: string;
	summary?: string;
	cover?: string;
	status?: NovelStatus;
	genres: string[];
	volumes: Volume[];
};

export type Volume = {
	title: string;
	chapters: Chapter[];
};

export type Chapter = {
	id: string;
	title: string;
	path?: string;
};

export type ChapterContent = {
	title?: string;
	html: string;
};

export type NovelStatus = "ongoing" | "completed" | "unknown";
