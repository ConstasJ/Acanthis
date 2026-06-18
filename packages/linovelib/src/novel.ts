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

interface FixTask {
	chapter: Chapter; // 引用待修改的章节对象
	nextChapterEl: Element; // 依赖的下一个章节 DOM 节点
}

export function parseVolumeOrChapterId(url: string): string {
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
	const fixTasks: FixTask[] = [];

	// --- 第一步：同步解析整个 DOM 树，建立完整的目录结构 ---
	// 预先将所有的 volumeEl 加载好，方便跨卷时能够安全地索引
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
		const vData = parsedVolumes[vIndex] as {
			$: cheerio.CheerioAPI;
			volumeName: string;
			volumeId: string;
			volumeCover: string;
			chapterEls: Element[];
		};
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

			// 如果需要后续修复，寻找它的下一个章节节点
			if (chapterId === "TOBEDETERMINED" && chapterQueue) {
				let nextChapterEl: Element | null = null;

				if (cIndex < vData.chapterEls.length - 1) {
					// 情况 A：本卷还有下一章
					const potentialNextEl = vData.chapterEls[cIndex + 1];
					if (potentialNextEl) {
						nextChapterEl = potentialNextEl;
					}
				} else if (vIndex < parsedVolumes.length - 1) {
					// 情况 B：本卷结束了，去找下一卷的第一章
					const nextVolData = parsedVolumes[vIndex + 1];
					if (nextVolData) {
						if (nextVolData.chapterEls.length > 0) {
							const potentialNextEl = nextVolData.chapterEls[0];
							if (potentialNextEl) {
								nextChapterEl = potentialNextEl;
							}
						}
					}
				}

				// 如果找到了合法的下一章，扔进任务清单
				if (nextChapterEl) {
					fixTasks.push({
						chapter: chapterObj, // JS 对象引用，后续直接修改 id
						nextChapterEl,
					});
				}
			}
		}

		volumes.push({
			id: vData.volumeId,
			platform: "linovelib",
			title: vData.volumeName,
			coverUrl: vData.volumeCover,
			chapters: chapters,
		});
	}

	// --- 第二步：集中并发/队列处理，回填数据 ---
	if (fixTasks.length > 0 && chapterQueue) {
		// 使用 Promise.all 配合你的 p-queue (concurrency=1)
		await Promise.all(
			fixTasks.map(async (task) => {
				// 此时推入 MQ，由 MQ 内部控制并发率和流控
				const realId = await parseChapterIdFromNextChapter(
					task.nextChapterEl,
					chapterQueue,
				);
				if (realId) {
					task.chapter.id = realId; // 利用引用直接修改 volumes 数组内部的值
				}
			}),
		);
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
