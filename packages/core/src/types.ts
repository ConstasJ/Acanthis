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

export type SourceCapability = "search" | "novels" | "illustrations";

export interface NovelSourceDescriptor {
	id: string;
	name: string;
	capabilities: SourceCapability[];
}

export interface BookshelfItem {
	platform: string;
	novelId: string;
	title: string;
	author: string;
	coverUrl: string;
	addedAt: number;
	updatedAt: number;
	deletedAt: number | null;
}

export interface ReadingProgress {
	platform: string;
	novelId: string;
	novelTitle: string;
	coverUrl: string;
	volumeId: string;
	volumeTitle: string;
	chapterId: string;
	chapterTitle: string;
	paragraphIndex: number;
	totalParagraphs: number;
	deviceLabel: string;
	updatedAt: number;
}
