export function extractNovelIdFromUrl(url: string): string | undefined {
	const match = url.match(/\/novel\/(\d+)\.html/);
	return match ? match[1] : undefined;
}

export interface NovelAndChapterIds {
	novelId: string | undefined;
	chapterId: string | undefined;
}

export function extractChapterIdFromUrl(
	url: string,
): NovelAndChapterIds | undefined {
	const match = url.match(/\/novel\/(\d+)\/(\d+)\.html/);
	if (match) {
		return {
			novelId: match[1],
			chapterId: match[2],
		};
	}
	return undefined;
}
