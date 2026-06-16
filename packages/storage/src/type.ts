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
