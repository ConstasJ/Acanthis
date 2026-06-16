import type { Novel, NovelSearchResult } from "@acanthis-dec/core";
import type { LNReaderNovel, LNReaderNovelItem, OutputStyle } from "./types";
import type { StorageService } from "@acanthis-dec/storage";
import type { LinovelibClient } from "@acanthis-dec/linovelib";

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
			return {
				...novel,
				volumes: novel.volumes.map((volume) => {
					volume.platform = undefined;
					volume.chapters = volume.chapters.map((chapter) => {
						chapter.platform = undefined;
						return chapter;
					});
					return volume;
				}),
			};
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

export async function isUpdateNeeded(
	novel: Novel,
	linovelibClient: LinovelibClient,
): Promise<boolean> {
	const updateInfo = await linovelibClient.getNovelUpdateInfo(novel.id);
	if (!updateInfo) {
		return true;
	}
	const chapterCount = novel.volumes.reduce((count, volume) => count + volume.chapters.length, 0);
	return chapterCount !== updateInfo.chapterCount || novel.coverUrl !== updateInfo.coverUrl;
}