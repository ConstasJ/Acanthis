import type {
	BrowserFetchClient,
	RetryOptions,
} from "@acanthis-dec/browser-fetch";
import type { Chapter, Novel, NovelStatus, Volume } from "@acanthis-dec/core";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { novelIdToCoverUrl } from "./cover";
import type { NovelChapterQueue } from "./queue";

function extractVolumesArray(catalog: string): Element[] {
	const $ = cheerio.load(catalog);
	const results: Element[] = [];
	$("#volume-list div.volume").each((_, elem) => {
		$(elem).remove("div.volume");
		results.push(elem);
	});
	return results;
}

function processVolumeName(novelTitle: string, volumeName: string): string {
	// Remove novel title from volume name if present
	if (volumeName.startsWith(novelTitle)) {
		return volumeName.slice(novelTitle.length).trim();
	}
	if (!Number.isNaN(Number(volumeName))) {
		return `第 ${volumeName} 卷`;
	}
	return volumeName.trim();
}

function parseVolumeOrChapterId(url: string): string {
	if (url.includes("javascript:cid(0)")) {
		return "TOBEDETERMINED";
	}
	const match = url.match(/\/novel\/\d+\/(\d+|vol_\d+)\.html/);
	return match ? (match[1] ?? "") : "";
}

async function parseChapterIdFromNextChapter(
	nextChapterEl: Element,
	chapterQueue: NovelChapterQueue,
): Promise<string> {
	const nextChapterPath = nextChapterEl.attribs.href ?? "";
	const nextChapterContent = await chapterQueue.fetchChapterPart(
		`https://www.linovelib.com${nextChapterPath}`,
	);
	const $temp = cheerio.load(nextChapterContent);
	const chapterPath =
		$temp("div.mlfy_page a:first").attr("href") ??
		nextChapterContent.match(
			/url_previous:'(\/novel\/\d+\/[\d_]+\.html)'/,
		)?.[1] ??
		"";
	return parseVolumeOrChapterId(chapterPath);
}

async function getNovelVolumes(
	title: string,
	url: string,
	fetchClient: BrowserFetchClient,
	retry: RetryOptions,
	chapterQueue?: NovelChapterQueue,
): Promise<Volume[]> {
	const catalogHtml = await fetchClient.text(url, { retry });
	const volumeEls = extractVolumesArray(catalogHtml.data);
	const volumes: Volume[] = [];
	const chapterElements: Element[] = [];
	for (const volumeEl of volumeEls) {
		const volumeEl$ = cheerio.load(volumeEl);
		const volumeName = processVolumeName(title, volumeEl$("h2").text());
		const volumeId = parseVolumeOrChapterId(
			volumeEl$("h2 a").attr("href") ?? "",
		);
		const volumeCover: string =
			volumeEl$("a.volume-cover img").attr("data-original") ?? "";
		const chapterEls = volumeEl$("ul.chapter-list li a").toArray();
		const chapters: Chapter[] = [];
		for (const [index, chapterEl] of chapterEls.entries()) {
			chapterElements.push(chapterEl);
			const chapterEl$ = cheerio.load(chapterEl);
			const chapterName = chapterEl$.text().trim();
			const chapterPath = chapterEl.attribs.href ?? "";
			let chapterId = parseVolumeOrChapterId(chapterPath);
			if (chapterId === "TOBEDETERMINED" && chapterQueue) {
				const nextChapterEl = chapterEls[index + 1];
				if (nextChapterEl) {
					chapterId = await parseChapterIdFromNextChapter(nextChapterEl, chapterQueue);
				}
			}
			chapters.push({
				id: chapterId,
				platform: "linovelib",
				title: chapterName,
				volumeId,
			});
		}
		volumes.push({
			id: volumeId,
			platform: "linovelib",
			title: volumeName,
			coverUrl: volumeCover,
			chapters: chapters,
		});
	}
	return volumes;
}

export async function getNovelInfo(
	id: string,
	fetchClient: BrowserFetchClient,
	retry: RetryOptions,
	chapterQueue?: NovelChapterQueue,
): Promise<Novel | undefined> {
	const url = `https://www.linovelib.com/novel/${id}.html`;
	const html = (
		await fetchClient.text(url, {
			retry,
		})
	).data;
	const $ = cheerio.load(html);
	const title = $("h1.book-name").text().trim();
	const coverUrl = $("div.book-img img").attr("src") || novelIdToCoverUrl(id);
	const summary = (() => {
		const $container = $(".book-dec.Jbook-dec").clone();
		$container.find(".notice").remove();
		const paragraphs: string[] = [];
		$container
			.find("p")
			.not(".backupname")
			.each((_, el) => {
				paragraphs.push($(el).text().trim());
			});
		return paragraphs.join("\n");
	})();
	const author = $("div.au-name a:first").text().trim();
	const status: NovelStatus = $("div.book-label a.state")
		.text()
		.includes("完结")
		? "completed"
		: "ongoing";
	const genres = $("div.book-label span")
		.children("a")
		.map((_, el) => $(el).text())
		.toArray()
		.join(",");
	const novel: Novel = {
		id,
		platform: "linovelib",
		title,
		coverUrl,
		summary,
		author,
		status,
		genres: genres.split(",").map((g) => g.trim()),
		volumes: [], // Volumes and chapters will be fetched separately
	};
	novel.volumes = (
		await getNovelVolumes(
			title,
			`https://www.linovelib.com${$("a.read-btn").attr("href")}`,
			fetchClient,
			retry,
			chapterQueue,
		)
	).map((v) => {
		v.novelId = novel.id;
		return v;
	});
	return novel;
}

export interface NovelUpdateInfo {
	coverUrl: string;
	chapterCount: number;
}

export async function getUpdateInfo(
	id: string,
	fetchClient: BrowserFetchClient,
	retry: RetryOptions,
): Promise<NovelUpdateInfo | null> {
	const url = `https://www.linovelib.com/novel/${id}.html`;
	const html = (
		await fetchClient.text(url, {
			retry,
		})
	).data;
	const $ = cheerio.load(html);
	if ($("h1.book-name").length === 0) {
		return null;
	}
	const catalogUrl = `https://www.linovelib.com${$("a.read-btn").attr("href")}`;
	const catalogHtml = (
		await fetchClient.text(catalogUrl, {
			retry,
		})
	).data;
	const $catalog = cheerio.load(catalogHtml);
	const chapterCount = $catalog(
		"#volume-list div.volume ul.chapter-list li a",
	).length;
	const coverUrl = $("div.book-img img").attr("src") || novelIdToCoverUrl(id);
	return {
		coverUrl,
		chapterCount,
	};
}
