import type {
	ExploreNovelItem,
	ExplorePage,
	NovelStatus,
} from "@acanthis-dec/core";
import { load } from "cheerio";
import type { NovelExploreQueue } from "../queue";
import {
	buildExploreNovelItem,
	cleanBlockText,
	cleanInlineText,
	extractChapterIdFromHref,
	extractImgCoverUrl,
	extractNovelIdFromHref,
	LINOVELIB_DESKTOP_BASE,
	parseNovelStatusText,
} from "./common";
import {
	type LinovelibCatalogOptions,
	normalizeCatalogOptions,
} from "./schema";

export function buildCatalogUrl(
	options: Required<LinovelibCatalogOptions>,
): string {
	const normalized = normalizeCatalogOptions(options);
	return `${LINOVELIB_DESKTOP_BASE}/wenku/${normalized.sort}_${normalized.tag}_${normalized.progress}_${normalized.anime}_${normalized.region}_0_0_${normalized.words}_${normalized.page}_${normalized.updated}.html`;
}

function parseBookilnkMeta(
	spans: string[],
	fallbackText: string,
): {
	author?: string;
	category?: string;
	status?: NovelStatus;
	updatedAt?: string;
} {
	const parts =
		spans.length > 0
			? spans
			: fallbackText
					.split(/[|/]/)
					.map((s) => cleanInlineText(s))
					.filter((s) => s.length > 0);

	if (parts.length === 0) {
		return {};
	}

	const result: {
		author?: string;
		category?: string;
		status?: NovelStatus;
		updatedAt?: string;
	} = {};

	if (parts[0]) {
		result.author = parts[0];
	}
	if (parts[1]) {
		result.category = parts[1];
	}

	if (parts.length >= 4) {
		if (parts[2]) {
			result.status = parseNovelStatusText(parts[2]);
		}
		if (parts[3]) {
			result.updatedAt = parts[3];
		}
	} else if (parts.length === 3 && parts[2]) {
		if (/^\d{2,4}[-/]\d{2}(?:[-/]\d{2})?/.test(parts[2])) {
			result.updatedAt = parts[2];
		} else {
			result.status = parseNovelStatusText(parts[2]);
		}
	}

	return result;
}

export function parseCatalogHtml(html: string, page: number): ExplorePage {
	const $ = load(html);
	const items: ExploreNovelItem[] = [];

	$(".store_collist .bookbox").each((_, el) => {
		const $el = $(el);
		const $bookNameLink = $el.find(".bookname a").first();
		const $bookImgLink = $el.find(".bookimg a").first();
		const $fallbackLink = $el.find("a[href*='/novel/']").first();

		const id =
			extractNovelIdFromHref($bookNameLink.attr("href")) ??
			extractNovelIdFromHref($bookImgLink.attr("href")) ??
			extractNovelIdFromHref($fallbackLink.attr("href"));
		if (!id) {
			return;
		}

		const title =
			cleanInlineText($bookNameLink.text()) ||
			cleanInlineText($el.find(".bookname").text()) ||
			cleanInlineText($el.find(".bookimg img").attr("alt")) ||
			cleanInlineText($fallbackLink.text());
		if (!title) {
			return;
		}

		const $img = $el.find(".bookimg img, img").first();
		const coverUrl = extractImgCoverUrl(id, $img);

		const spans = $el
			.find(".bookilnk span")
			.map((__, span) => cleanInlineText($(span).text()))
			.get()
			.filter((s) => s.length > 0);
		const meta = parseBookilnkMeta(spans, $el.find(".bookilnk").text());

		const summary = cleanBlockText($el.find(".bookintro").text()) || undefined;

		const genresText = $el
			.find(".bookupdate b")
			.map((__, b) => $(b).text())
			.get()
			.join(" ");
		const genres = genresText
			.split(/\s+/)
			.map((g) => g.trim())
			.filter((g) => g.length > 0);

		const $chapterLink = $el
			.find(".bookupdate a[href*='/novel/'], a[href*='/novel/']")
			.filter(
				(__, a) => extractChapterIdFromHref($(a).attr("href"), id) !== null,
			)
			.first();
		const latestChapterId =
			extractChapterIdFromHref($chapterLink.attr("href"), id) ?? undefined;
		const latestChapter = latestChapterId
			? cleanInlineText($chapterLink.text()) || undefined
			: undefined;

		const itemInput: Parameters<typeof buildExploreNovelItem>[0] = {
			id,
			title,
			coverUrl,
		};
		if (meta.author) {
			itemInput.author = meta.author;
		}
		if (summary) {
			itemInput.summary = summary;
		}
		if (meta.status !== undefined) {
			itemInput.status = meta.status;
		}
		if (meta.category) {
			itemInput.category = meta.category;
		}
		if (genres.length > 0) {
			itemInput.genres = genres;
		}
		if (latestChapter) {
			itemInput.latestChapter = latestChapter;
		}
		if (latestChapterId) {
			itemInput.latestChapterId = latestChapterId;
		}
		if (meta.updatedAt) {
			itemInput.updatedAt = meta.updatedAt;
		}

		items.push(buildExploreNovelItem(itemInput));
	});

	const pagestatsText = cleanInlineText($("#pagestats").text());
	const pageMatch = pagestatsText.match(/(\d+)\s*\/\s*(\d+)/);
	if (!pageMatch) {
		if (items.length === 0) {
			return {
				platform: "linovelib",
				items: [],
				page,
				totalPages: 1,
				hasNextPage: false,
			};
		}
		return {
			platform: "linovelib",
			items,
			page,
			totalPages: page,
			hasNextPage: false,
		};
	}

	const parsedTotalPages = Number(pageMatch[2]);
	const totalPages =
		Number.isInteger(parsedTotalPages) && parsedTotalPages >= 1
			? parsedTotalPages
			: 1;

	return {
		platform: "linovelib",
		items,
		page,
		totalPages,
		hasNextPage: items.length > 0 && page < totalPages,
	};
}

export async function getCatalog(
	options: LinovelibCatalogOptions | undefined,
	queue: NovelExploreQueue,
): Promise<ExplorePage> {
	const normalized = normalizeCatalogOptions(options);
	const url = buildCatalogUrl(normalized);
	const html = await queue.fetchPage(url);
	return parseCatalogHtml(html, normalized.page);
}
