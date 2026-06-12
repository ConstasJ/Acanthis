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
