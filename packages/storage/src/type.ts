export interface DataWithUpdatedAt<T> {
	data: T;
	updatedAt: number;
}

export interface CoverMetadata {
	platform: string | null;
	novelId: string | null;
	hash: string;
	contentType: string;
	originalUrl: string;
}
