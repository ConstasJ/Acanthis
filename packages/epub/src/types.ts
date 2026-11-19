export interface EpubImageAsset {
	/** 原始或服务端重写后的匹配键 URL（与章节 HTML 中 <img src> 一致） */
	sourceUrl: string;
	data: Uint8Array;
	mimeType: string;
}

export interface EpubChapterData {
	id: string;
	title: string;
	html: string;
}

export interface EpubVolumeData {
	id: string;
	title: string;
	cover?: EpubImageAsset | undefined;
	chapters: EpubChapterData[];
}

export interface VolumeEpubInput {
	identifier: string;
	novelTitle: string;
	volumeTitle: string;
	author: string;
	language?: string | undefined;
	summary?: string | undefined;
	genres?: string[] | undefined;
	modifiedAt?: Date | undefined;
	cover?: EpubImageAsset | undefined;
	chapters: EpubChapterData[];
	illustrations: EpubImageAsset[];
}

export interface NovelEpubInput {
	identifier: string;
	title: string;
	author: string;
	language?: string | undefined;
	summary?: string | undefined;
	genres?: string[] | undefined;
	modifiedAt?: Date | undefined;
	cover?: EpubImageAsset | undefined;
	volumes: EpubVolumeData[];
	illustrations: EpubImageAsset[];
}
