import type {
	BookshelfCategory,
	BookshelfItem,
	NovelInfo,
	NovelStatus,
	ReadingProgress,
} from "@acanthis-dec/core";

export interface DataWithUpdatedAt<T> {
	data: T;
	updatedAt: number;
}

export interface NovelCoverMetadata {
	platform: string | null;
	novelId: string | null;
	hash: string;
	contentType: string;
	originalUrl: string;
}

export interface VolumeCoverMetadata {
	platform: string | null;
	volumeId: string | null;
	hash: string;
	contentType: string;
	originalUrl: string;
}

export interface ListNovelsOptions {
	page: number;
	pageSize: number;
	genres?: string[] | undefined;
	status?: NovelStatus | undefined;
	q?: string | undefined;
}

export interface PaginatedNovels {
	items: NovelInfo[];
	total: number;
	page: number;
	pageSize: number;
}

export interface SyncStateResult {
	bookshelf: BookshelfItem[];
	progress: ReadingProgress[];
	categories: BookshelfCategory[];
	cursor: number;
}

export interface MergeSyncStateInput {
	bookshelf?: BookshelfItem[] | undefined;
	progress?: ReadingProgress[] | undefined;
	categories?: BookshelfCategory[] | undefined;
}

export interface MergeSyncStateResult {
	bookshelf: BookshelfItem[];
	progress: ReadingProgress[];
	categories: BookshelfCategory[];
	serverTime: number;
}
