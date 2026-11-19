import type {
	BrowserFetchClient,
	RetryOptions,
} from "@acanthis-dec/browser-fetch";
import type { Chapter, Novel, NovelStatus, Volume } from "@acanthis-dec/core";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { novelIdToCoverUrl } from "./cover";
import type { NovelChapterQueue } from "./queue";

export function extractVolumesArray(catalog: string): Element[] {
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

export function isUnresolvedChapterId(id: string): boolean {
	return id.startsWith("TOBEDETERMINED");
}

export function parseVolumeOrChapterId(url: string): string {
	if (url.includes("javascript:cid(0)")) {
		return "TOBEDETERMINED";
	}
	const match = url.match(/\/novel\/\d+\/(\d+|vol_\d+)\.html/);
	return match ? (match[1] ?? "") : "";
}

function extractChapterIdFromLink(
	href: string | undefined,
	novelId: string,
): string {
	if (!href) {
		return "";
	}
	const match = href.match(/\/novel\/(\d+)\/(\d+)(?:_\d+)?\.html/);
	if (!match || match[1] !== novelId) {
		return "";
	}
	const chapterId = match[2] ?? "";
	return /^\d+$/.test(chapterId) ? chapterId : "";
}

async function parseChapterIdFromNextChapter(
	novelId: string,
	nextChapterId: string,
	chapterQueue: NovelChapterQueue,
): Promise<string> {
	if (!/^\d+$/.test(nextChapterId)) {
		return "";
	}
	try {
		const nextChapterContent = await chapterQueue.fetchChapterPart(
			`https://www.linovelib.com/novel/${novelId}/${nextChapterId}.html`,
		);
		const $temp = cheerio.load(nextChapterContent);
		const domHref = $temp("div.mlfy_page a:first").attr("href");
		const domChapterId = extractChapterIdFromLink(domHref, novelId);
		if (domChapterId) {
			return domChapterId;
		}
		const scriptHref = nextChapterContent.match(
			/url_previous\s*:\s*['"](\/novel\/\d+\/[\d_]+\.html)['"]/,
		)?.[1];
		return extractChapterIdFromLink(scriptHref, novelId);
	} catch {
		return "";
	}
}

export async function parseNextChapterIdFromPrevChapter(
	novelId: string,
	prevChapterId: string,
	chapterQueue: NovelChapterQueue,
): Promise<string> {
	if (!/^\d+$/.test(prevChapterId)) {
		return "";
	}
	const MAX_PAGES = 50;
	const visited = new Set<string>();
	let currentPageId = prevChapterId;

	for (let page = 0; page < MAX_PAGES; page++) {
		if (visited.has(currentPageId)) {
			return "";
		}
		visited.add(currentPageId);

		let html = "";
		try {
			html = await chapterQueue.fetchChapterPart(
				`https://www.linovelib.com/novel/${novelId}/${currentPageId}.html`,
			);
		} catch {
			return "";
		}

		const $ = cheerio.load(html);
		const domMatch = $("div.mlfy_page a:last")
			.attr("href")
			?.match(/\/novel\/(\d+)\/([\d_]+)\.html/);
		const scriptMatch = html.match(
			/url_next\s*:\s*['"]\/novel\/(\d+)\/([\d_]+)\.html['"]/,
		);
		const nextPageId =
			(domMatch?.[1] === novelId ? domMatch[2] : undefined) ??
			(scriptMatch?.[1] === novelId ? scriptMatch[2] : undefined) ??
			"";

		if (!nextPageId || visited.has(nextPageId)) {
			return "";
		}
		if (nextPageId.startsWith(`${prevChapterId}_`)) {
			currentPageId = nextPageId;
			continue;
		}
		if (/^\d+$/.test(nextPageId) && nextPageId !== prevChapterId) {
			return nextPageId;
		}
		return "";
	}

	return "";
}

export async function getNovelVolumes(
	novelId: string,
	title: string,
	url: string,
	fetchClient: BrowserFetchClient,
	retry: RetryOptions,
	chapterQueue?: NovelChapterQueue,
): Promise<Volume[]> {
	const catalogHtml = await fetchClient.text(url, { retry });
	const volumeEls = extractVolumesArray(catalogHtml.data);

	const volumes: Volume[] = [];
	const flatChapters: Array<{
		chapter: Chapter;
		vIndex: number;
		cIndex: number;
	}> = [];

	// --- 第一步：同步解析整个 DOM 树，建立完整的目录结构 ---
	const parsedVolumes = volumeEls.map((el) => {
		const $ = cheerio.load(el);
		return {
			$,
			volumeName: processVolumeName(title, $("h2").text()),
			volumeId: parseVolumeOrChapterId($("h2 a").attr("href") ?? ""),
			volumeCover: $("a.volume-cover img").attr("data-original") ?? "",
			chapterEls: $("ul.chapter-list li a").toArray(),
		};
	});

	for (let vIndex = 0; vIndex < parsedVolumes.length; vIndex++) {
		const vData = parsedVolumes[vIndex];
		if (!vData) {
			continue;
		}
		const chapters: Chapter[] = [];

		for (let cIndex = 0; cIndex < vData.chapterEls.length; cIndex++) {
			const chapterEl = vData.chapterEls[cIndex];
			if (!chapterEl) {
				continue; // 这个章节节点不存在，跳过
			}
			const $chapter = cheerio.load(chapterEl);

			const chapterName = $chapter.text().trim();
			const chapterPath = chapterEl.attribs.href ?? "";
			const chapterId = parseVolumeOrChapterId(chapterPath);

			const chapterObj: Chapter = {
				id: chapterId,
				platform: "linovelib",
				title: chapterName,
				volumeId: vData.volumeId,
			};
			chapters.push(chapterObj);
			flatChapters.push({
				chapter: chapterObj,
				vIndex,
				cIndex: chapters.length - 1,
			});
		}

		volumes.push({
			id: vData.volumeId,
			platform: "linovelib",
			title: vData.volumeName,
			coverUrl: vData.volumeCover,
			chapters,
		});
	}

	// --- 第二步：两阶段双向推导隐藏章节 ID ---
	if (chapterQueue) {
		// 第一阶段：反向单跳推导（仅当紧邻下一章已有合法纯数字 ID 时请求）
		const phase1Tasks: Array<Promise<void>> = [];
		for (let i = 0; i < flatChapters.length; i++) {
			const current = flatChapters[i];
			const next = flatChapters[i + 1];
			if (
				current &&
				next &&
				current.chapter.id === "TOBEDETERMINED" &&
				/^\d+$/.test(next.chapter.id)
			) {
				const nextChapterId = next.chapter.id;
				phase1Tasks.push(
					(async () => {
						const realId = await parseChapterIdFromNextChapter(
							novelId,
							nextChapterId,
							chapterQueue,
						);
						if (/^\d+$/.test(realId) && realId !== nextChapterId) {
							current.chapter.id = realId;
						}
					})(),
				);
			}
		}
		if (phase1Tasks.length > 0) {
			await Promise.all(phase1Tasks);
		}

		// 第二阶段：正向链式推导兜底（按顺序从前往后解锁连续隐藏章节与全书末章）
		for (let i = 0; i < flatChapters.length; i++) {
			const current = flatChapters[i];
			const prev = flatChapters[i - 1];
			if (
				current &&
				prev &&
				current.chapter.id === "TOBEDETERMINED" &&
				/^\d+$/.test(prev.chapter.id)
			) {
				const realId = await parseNextChapterIdFromPrevChapter(
					novelId,
					prev.chapter.id,
					chapterQueue,
				);
				if (/^\d+$/.test(realId) && realId !== prev.chapter.id) {
					current.chapter.id = realId;
				}
			}
		}
	}

	// --- 第三步：未决章节唯一占位符兜底 ---
	for (const entry of flatChapters) {
		if (entry.chapter.id === "TOBEDETERMINED" || entry.chapter.id === "") {
			entry.chapter.id = `TOBEDETERMINED_${entry.vIndex}_${entry.cIndex}`;
		}
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
			id,
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
