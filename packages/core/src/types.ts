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

export type SourceCapability =
	| "search"
	| "novels"
	| "illustrations"
	| "explore";

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

export interface ExploreFilterOption {
	value: string;
	label: string;
}

export interface ExploreFilterGroup {
	key: string;
	label: string;
	defaultValue: string;
	options: ExploreFilterOption[];
}

export interface ExploreChannelOption {
	id: string;
	label: string;
	requiresChallenge?: boolean;
}

export interface ExploreRankingOption {
	id: string;
	label: string;
	supportsAll: boolean;
	supportsFull: boolean;
}

export interface ExploreSchema {
	platform: string;
	supportsHome: boolean;
	channels: ExploreChannelOption[];
	rankings: ExploreRankingOption[];
	catalogRequiresChallenge?: boolean;
	catalogFilters: ExploreFilterGroup[];
}

export interface ExploreNovelItem {
	id: string;
	platform: string;
	title: string;
	coverUrl?: string;
	author?: string;
	summary?: string;
	status?: NovelStatus;
	category?: string;
	genres?: string[];
	latestChapter?: string;
	latestChapterId?: string;
	wordCount?: string;
	updatedAt?: string;
	rank?: number;
}

export type ExploreSectionLayout = "featured" | "grid" | "rank" | "updates";

export interface ExploreSectionMoreTarget {
	type: "ranking" | "catalog" | "channel";
	params: Record<string, string>;
}

export interface ExploreSection {
	id: string;
	title: string;
	layout: ExploreSectionLayout;
	items: ExploreNovelItem[];
	more?: ExploreSectionMoreTarget;
}

export interface ExploreHomeData {
	platform: string;
	channel: string;
	title: string;
	sections: ExploreSection[];
}

export interface ExplorePage {
	platform: string;
	items: ExploreNovelItem[];
	page: number;
	totalPages?: number;
	hasNextPage: boolean;
}
