import type { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
import { buildDescrambleMapping } from "@acanthis-dec/core";
import type { StorageService } from "@acanthis-dec/storage";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { getCoefficientsFromPage } from "./coefficients";
import type { NovelChapterQueue } from "./queue";
import { transformContent } from "./utils";

function extractChapterId($: cheerio.CheerioAPI): string {
	const scriptTags = $("script");
	let chapterId = "";
	scriptTags.each((_, el) => {
		const scriptContent = $(el).html();
		if (scriptContent) {
			const match = scriptContent.match(/chapterid\s*:\s*'(\d+)'/);
			if (match?.[1]) {
				chapterId = match[1];
				return false; // Break the loop
			}
		}
	});
	return chapterId;
}

async function decrypt(
	html: string,
	fetchClient: BrowserFetchClient,
	storage?: StorageService,
): Promise<string> {
	const $ = cheerio.load(html);
	const coefficients = await getCoefficientsFromPage(
		html,
		fetchClient,
		storage,
	);
	const chapterId = extractChapterId($);
	const container = $("#TextContent, #acontent");
	if (!container.length) {
		return "";
	}

	container.find("p").each((_, el) => {
		const $el = $(el);
		const innerHtml = $el.html();
		if (innerHtml) {
			const cleanedHtml = innerHtml.replace(/^\s+|(?<=>)\s+/g, "");
			$el.html(cleanedHtml);
		}
	});

	container.find("img.imagecontent").each((_, el) => {
		const imgSrc = $(el).attr("data-src") || $(el).attr("src");
		if (imgSrc) {
			$(el).attr("src", imgSrc).removeAttr("data-src");
		}
	});

	container.find("div.dag").remove();
	container.find("script").remove();

	const allChildren = container
		.contents()
		.toArray()
		.filter((node) => !(node.type === "tag" && node.tagName === "div"));
	const sortableEntries: { element: Element; originalPos: number }[] = [];
	allChildren.forEach((node, index) => {
		if (node.type === "tag" && node.tagName === "p") {
			const text = $(node).text().trim();
			if (text.length > 0) {
				sortableEntries.push({ element: node, originalPos: index });
			}
		}
	});

	const seed =
		parseInt(chapterId, 10) * coefficients.seedMultiplier +
		coefficients.seedOffset;

	const mapping = buildDescrambleMapping(
		sortableEntries.length,
		seed,
		coefficients,
		20,
	);

	const restoredChildren: (AnyNode | null)[] = [...allChildren];

	sortableEntries.forEach((entry, i) => {
		const targetIndex = mapping[i] ?? i;
		const actualSlot = sortableEntries[targetIndex]?.originalPos ?? 0;
		restoredChildren[actualSlot] = entry.element;
	});

	const newContainer = $("<div></div>");
	restoredChildren.forEach((node) => {
		if (node && node.type === "tag") {
			newContainer.append(node);
			newContainer.append("\n");
		}
	});

	return newContainer.html() || "";
}

export async function getChapter(
	id: string,
	chapterQueue: NovelChapterQueue,
	fetchClient: BrowserFetchClient,
	storage?: StorageService,
	novelId?: string,
): Promise<string | undefined> {
	let novelID: string = novelId ?? "";
	if (!storage && !novelID) {
		throw new Error(
			"Storage service is not provided, novelId must be provided to fetch chapter from website",
		);
	}
	if (storage) {
		const chapter = await storage.getChapterFromId("linovelib", id);
		if (!chapter && !novelID) {
			throw new Error(
				`Chapter with id ${id} not found in storage, and novelId is not provided`,
			);
		}
		novelID = novelID || chapter?.novelId || "";
		if (chapter) {
			const cachedContent = await storage.getNovelContent(novelID, chapter.id);
			if (cachedContent) {
				return cachedContent;
			}
		}
	}
	const firstPageHtml = await chapterQueue.fetchChapterPart(
		`https://www.linovelib.com/novel/${novelID}/${id}.html`,
	);
	let $ = cheerio.load(firstPageHtml);
	const chapterName = $("h1").text().trim();
	let nextPageId =
		$("div.mlfy_page a:last")
			.attr("href")
			?.match(/\/novel\/(\d+)\/([\d_]+)\.html/)?.[2] ||
		firstPageHtml.match(/url_next:'\/novel\/(\d+)\/([\d_]+)\.html'/)?.[2] ||
		"";
	let content = await decrypt(firstPageHtml, fetchClient, storage);
	while (nextPageId?.includes(id)) {
		const nextPageHtml = await chapterQueue.fetchChapterPart(
			`https://www.linovelib.com/novel/${novelID}/${nextPageId}.html`,
		);
		content += await decrypt(nextPageHtml, fetchClient, storage);
		$ = cheerio.load(nextPageHtml);
		nextPageId =
			$("div.mlfy_page a:last")
				.attr("href")
				?.match(/\/novel\/(\d+)\/([\d_]+)\.html/)?.[2] ||
			nextPageHtml.match(/url_next:'\/novel\/(\d+)\/([\d_]+)\.html/)?.[2] ||
			"";
	}
	content = `<h2>${chapterName}</h2>\n${transformContent(content)}`;
	if (storage) {
		await storage.setNovelContent(novelID, id, content);
	}
	return content;
}
