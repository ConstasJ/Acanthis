import type { Novel, NovelSearchResult } from "@acanthis-dec/core";
import type { LNReaderNovel, LNReaderNovelItem, OutputStyle } from "./types";

export function transformOutputStyleForNovel(
	novel: Novel,
	style: OutputStyle | undefined,
): Novel | LNReaderNovel {
	switch (style) {
		case "lnreader": {
			const chapters = novel.volumes.flatMap((volume) =>
				volume.chapters.map((chapter) => ({
					name: `${volume.title} - ${chapter.title}`,
					path: chapter.id,
				})),
			);
			const lnReaderNovel: LNReaderNovel = {
				name: novel.title,
				path: novel.id,
				cover: novel.coverUrl,
				genres: novel.genres?.join(","),
				summary: novel.summary,
				author: novel.author,
				status: novel.status,
				chapters,
			};
			return lnReaderNovel;
		}
		default:
			return novel;
	}
}

export function transformOutputStyleForSearchResult(
	result: NovelSearchResult,
	style: OutputStyle | undefined,
): NovelSearchResult | LNReaderNovelItem {
	switch (style) {
		case "lnreader": {
			const lnReaderResult: LNReaderNovelItem = {
				name: result.title,
				path: result.id,
				cover: result.coverUrl,
			};
			return lnReaderResult;
		}
		default:
			return result;
	}
}
