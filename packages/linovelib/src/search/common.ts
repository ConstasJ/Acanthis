import type { NovelSearchResult } from "@acanthis-dec/core";
import type * as cheerio from "cheerio";
import { extractNovelIdFromUrl } from "../utils";

export function parseSearchHtml($: cheerio.CheerioAPI): NovelSearchResult[] {
	const results: NovelSearchResult[] = [];
	$("div.search-html-box div.search-result-list").each((_, el) => {
		const $el = $(el);
		const title = $el.find("h2").text().trim();
		const url = $el.find("h2 a").attr("href") || "";
		const id = extractNovelIdFromUrl(url) ?? "";
		const coverUrl = $el.find("img").attr("src") || "";
		results.push({
			title,
			platform: "linovelib",
			id,
			coverUrl,
		});
	});
	return results;
}

export function parseBookHtml($: cheerio.CheerioAPI): NovelSearchResult {
	return {
		title: $("h1.book-name").text().trim(),
		platform: "linovelib",
		id: extractNovelIdFromUrl($("meta[name=url]").attr("content") ?? "") || "",
		coverUrl: $("div.book-img img").attr("src") || "",
	};
}
