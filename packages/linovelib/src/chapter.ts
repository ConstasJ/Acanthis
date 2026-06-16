import type { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
import {
	buildDescrambleMapping,
	type DescrambleCoefficients,
} from "@acanthis-dec/core";
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

export interface DecryptResult {
	content: string;
	version: string;
	coefficients: DescrambleCoefficients;
}

async function decrypt(
	html: string,
	fetchClient: BrowserFetchClient,
	cachedJsVersion?: string,
	cachedCoefficients?: DescrambleCoefficients,
): Promise<DecryptResult> {
	const $ = cheerio.load(html);
	const coefficientResult = await getCoefficientsFromPage(
		html,
		fetchClient,
		cachedJsVersion,
	);
	const version = coefficientResult?.version || cachedJsVersion;
	const coefficients = coefficientResult?.coefficients || cachedCoefficients;
	if (!version) {
		throw new Error("Failed to determine chapterlog.js version");
	}
	if (!coefficients) {
		throw new Error("Failed to obtain descrambling coefficients");
	}
	const chapterId = extractChapterId($);
	const container = $("#TextContent, #acontent");
	if (!container.length) {
		return {
			content: "",
			version,
			coefficients: coefficients,
		};
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
		parseInt(chapterId, 10) * coefficients?.seedMultiplier +
		coefficients?.seedOffset;

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

	return {
		content: newContainer.html() || "",
		version,
		coefficients: coefficients,
	};
}

export async function getChapter(
	id: string,
	novelId: string,
	chapterQueue: NovelChapterQueue,
	fetchClient: BrowserFetchClient,
	cachedJsVersion?: string,
	cachedCoefficients?: DescrambleCoefficients,
): Promise<DecryptResult | undefined> {
	const firstPageHtml = await chapterQueue.fetchChapterPart(
		`https://www.linovelib.com/novel/${novelId}/${id}.html`,
	);
	let $ = cheerio.load(firstPageHtml);
	const chapterName = $("h1").text().trim();
	let nextPageId =
		$("div.mlfy_page a:last")
			.attr("href")
			?.match(/\/novel\/(\d+)\/([\d_]+)\.html/)?.[2] ||
		firstPageHtml.match(/url_next:'\/novel\/(\d+)\/([\d_]+)\.html'/)?.[2] ||
		"";
	let content = await decrypt(
		firstPageHtml,
		fetchClient,
		cachedJsVersion,
		cachedCoefficients,
	);
	while (nextPageId?.includes(id)) {
		const nextPageHtml = await chapterQueue.fetchChapterPart(
			`https://www.linovelib.com/novel/${novelId}/${nextPageId}.html`,
		);
		const nextContent = await decrypt(
			nextPageHtml,
			fetchClient,
			cachedJsVersion,
			cachedCoefficients,
		);
		content = {
			...content,
			content: content.content + nextContent.content,
		};
		$ = cheerio.load(nextPageHtml);
		nextPageId =
			$("div.mlfy_page a:last")
				.attr("href")
				?.match(/\/novel\/(\d+)\/([\d_]+)\.html/)?.[2] ||
			nextPageHtml.match(/url_next:'\/novel\/(\d+)\/([\d_]+)\.html/)?.[2] ||
			"";
	}
	// content = `<h2>${chapterName}</h2>\n${transformContent(content)}`;
	content = {
		...content,
		content: `<h2>${chapterName}</h2>\n${transformContent(content.content)}`,
	};
	return content;
}
