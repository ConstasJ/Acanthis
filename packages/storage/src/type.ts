export interface DataWithUpdatedAt<T> {
	data: T;
	updatedAt: number;
}

export interface ChapterWithNovelId {
	novelId: string;
	volumeId: string;
	name: string;
	id: string;
}

export interface CoverMetadata {
	platform: string | null;
	novelId: string | null;
	hash: string;
	contentType: string;
	originalUrl: string;
	ext: string;
}