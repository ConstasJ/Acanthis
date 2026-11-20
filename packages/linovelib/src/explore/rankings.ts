import type { ExploreNovelItem, ExplorePage } from "@acanthis-dec/core";
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
	isValidLinovelibRanking,
	type LinovelibRankingOptions,
} from "./schema";

const RANKINGS_PAGE_SIZE = 30;

export function buildRankingsUrl(
	rank: string,
	full: boolean,
	page: number,
): string {
	if (!isValidLinovelibRanking(rank, full)) {
		throw new Error(
			`Invalid linovelib ranking combination: rank=${rank}, full=${String(full)}`,
		);
	}
	if (!Number.isInteger(page) || page < 1) {
		throw new Error(`Invalid linovelib ranking page: ${page}`);
	}
	const segment = full ? "topfull" : "top";
	return `${LINOVELIB_DESKTOP_BASE}/${segment}/${rank}/${page}.html`;
}

export function parseRankingsHtml(html: string, page: number): ExplorePage {
	const $ = load(html);
	const items: ExploreNovelItem[] = [];

	$(".rank_d_list").each((index, el) => {
		const $el = $(el);
		const $nameLink = $el.find(".rank_d_b_name a").first();
		const $imgLink = $el.find(".rank_d_book_img a").first();
		const id =
			extractNovelIdFromHref($nameLink.attr("href")) ??
			extractNovelIdFromHref($imgLink.attr("href"));
		if (!id) {
			return;
		}

		const title =
			cleanInlineText($nameLink.text()) ||
			cleanInlineText($el.find(".rank_d_b_name").attr("title")) ||
			cleanInlineText($el.find(".rank_d_book_img img").attr("alt"));
		if (!title) {
			return;
		}

		const coverUrl = extractImgCoverUrl(
			id,
			$el.find(".rank_d_book_img img").first(),
		);

		const cateParts = $el
			.find(".rank_d_b_cate")
			.text()
			.split("|")
			.map((part) => cleanInlineText(part));
		const author = cateParts[0] || undefined;
		const category = cateParts[1] || undefined;
		const statusText = cateParts[2];
		const status = statusText ? parseNovelStatusText(statusText) : undefined;

		const summary =
			cleanBlockText($el.find(".rank_d_b_info").text()) || undefined;

		const $lastLink = $el.find(".rank_d_b_last a").first();
		const $clonedLast = $lastLink.clone();
		$clonedLast.find(".rank_d_lastchapter").remove();
		const latestChapter = cleanInlineText($clonedLast.text()) || undefined;
		const latestChapterId =
			extractChapterIdFromHref($lastLink.attr("href"), id) ?? undefined;
		const updatedAt =
			cleanInlineText($el.find(".rank_d_b_time").text()) || undefined;

		const itemInput: Parameters<typeof buildExploreNovelItem>[0] = {
			id,
			title,
			coverUrl,
			rank: (page - 1) * RANKINGS_PAGE_SIZE + index + 1,
		};
		if (author) {
			itemInput.author = author;
		}
		if (summary) {
			itemInput.summary = summary;
		}
		if (status !== undefined) {
			itemInput.status = status;
		}
		if (category) {
			itemInput.category = category;
		}
		if (latestChapter) {
			itemInput.latestChapter = latestChapter;
		}
		if (latestChapterId) {
			itemInput.latestChapterId = latestChapterId;
		}
		if (updatedAt) {
			itemInput.updatedAt = updatedAt;
		}

		items.push(buildExploreNovelItem(itemInput));
	});

	return {
		platform: "linovelib",
		items,
		page,
		hasNextPage: items.length >= RANKINGS_PAGE_SIZE,
	};
}

export async function getRankings(
	options: LinovelibRankingOptions,
	queue: NovelExploreQueue,
): Promise<ExplorePage> {
	const full = options.full ?? false;
	const page = options.page ?? 1;
	const url = buildRankingsUrl(options.rank, full, page);
	const html = await queue.fetchPage(url);
	return parseRankingsHtml(html, page);
}
