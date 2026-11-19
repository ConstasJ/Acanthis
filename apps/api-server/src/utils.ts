import type { Novel, NovelSearchResult, NovelStatus } from "@acanthis-dec/core";
import type { LinovelibClient } from "@acanthis-dec/linovelib";
import type { Context } from "hono";
import { config } from "./config";
import type { LNReaderNovel, LNReaderNovelItem, OutputStyle } from "./types";

export function resolveHost(
	c: Context,
	configuredHost: string | undefined = config.host,
): string {
	const rawHost =
		configuredHost?.trim() ||
		c.req.header("host")?.trim() ||
		"http://localhost:5301";
	const proto =
		c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
	const hostWithProtocol = /^https?:\/\//i.test(rawHost)
		? rawHost
		: `${proto}://${rawHost}`;
	return hostWithProtocol.replace(/\/+$/, "");
}

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
			const novelStatusTransformer = (status: NovelStatus) => {
				switch (status) {
					case "ongoing":
						return "Ongoing";
					case "completed":
						return "Completed";
					default:
						return "Unknown";
				}
			};
			const lnReaderNovel: LNReaderNovel = {
				name: novel.title,
				path: novel.id,
				cover: novel.coverUrl,
				genres: novel.genres?.join(","),
				summary: novel.summary,
				author: novel.author,
				status: novelStatusTransformer(novel.status),
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

export function transformOutputStyleForSearchResult<
	T extends NovelSearchResult,
>(result: T, style: OutputStyle | undefined): T | LNReaderNovelItem {
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
	const chapterCount = novel.volumes.reduce(
		(count, volume) => count + volume.chapters.length,
		0,
	);
	return (
		chapterCount !== updateInfo.chapterCount ||
		novel.coverUrl !== updateInfo.coverUrl
	);
}
