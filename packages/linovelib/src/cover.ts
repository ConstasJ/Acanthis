import type { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
import { load } from "cheerio";
import { extractVolumesArray, parseVolumeOrChapterId } from "./novel";

export function novelIdToCoverUrl(novelId: string): string {
	const prefix = novelId.length > 3 ? novelId[0] : "0";
	return `https://www.linovelib.com/files/article/image/${prefix}/${novelId}/${novelId}s.jpg`;
}

export async function getNovelCoverUrl(
	id: string,
	fetchClient: BrowserFetchClient,
): Promise<string> {
	const novelUrl = `https://www.linovelib.com/novel/${id}.html`;
	const html = await fetchClient.text(novelUrl);
	const $ = load(html.data);
	const coverUrl = $("div.book-img img").attr("src") || novelIdToCoverUrl(id);
	return coverUrl;
}

export async function getVolumeCoverUrl(
	id: string,
	novelId: string,
	fetchClient: BrowserFetchClient,
): Promise<string> {
	const catalogUrl = `https://www.linovelib.com/novel/${novelId}/catalog`;
	const html = await fetchClient.text(catalogUrl);
	const $ = load(html.data);
	const volumes = extractVolumesArray(html.data);
	const volume = volumes.find((v) => {
		const volumeId = parseVolumeOrChapterId(
			$(v).find("h2 a").attr("href") ?? "",
		);
		return volumeId === id;
	});
	if (!volume) {
		throw new Error(`Volume not found for ID: ${id}`);
	}
	const coverUrl =
		$(volume).find("a.volume-cover img").attr("data-original") || "";
	return coverUrl;
}
