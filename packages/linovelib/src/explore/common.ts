import type { ExploreNovelItem, NovelStatus } from "@acanthis-dec/core";
import type { Cheerio } from "cheerio";
import type { Element } from "domhandler";
import { novelIdToCoverUrl } from "../cover";

export const LINOVELIB_DESKTOP_BASE = "https://www.linovelib.com";

export function cleanInlineText(raw: string | undefined): string {
	return (raw ?? "").replace(/\s+/g, " ").trim();
}

export function cleanBlockText(raw: string | undefined): string {
	return (raw ?? "")
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[ \t]+/g, " ").trim())
		.filter((line) => line.length > 0)
		.join("\n")
		.trim();
}

export function extractNovelIdFromHref(
	href: string | undefined,
): string | null {
	if (!href) {
		return null;
	}
	const trimmed = href.trim();
	const match = trimmed.match(/(?:^|\/)novel\/(\d+)\.html(?:[?#]|$)/);
	return match?.[1] ?? null;
}

export function extractChapterIdFromHref(
	href: string | undefined,
	novelId?: string,
): string | null {
	if (!href) {
		return null;
	}
	const match = href
		.trim()
		.match(/(?:^|\/)novel\/(\d+)\/(\d+)(?:_\d+)?\.html(?:[?#]|$)/);
	if (!match) {
		return null;
	}
	if (novelId && match[1] !== novelId) {
		return null;
	}
	return match[2] ?? null;
}

function isPlaceholderCoverUrl(rawSrc: string | undefined): boolean {
	if (!rawSrc) {
		return true;
	}
	const lower = rawSrc.trim().toLowerCase();
	return (
		lower.length === 0 ||
		lower.includes("book-cover-no.svg") ||
		lower.startsWith("data:")
	);
}

export function resolveDesktopCoverUrl(
	novelId: string,
	rawSrc?: string,
): string {
	if (!rawSrc || isPlaceholderCoverUrl(rawSrc)) {
		return novelIdToCoverUrl(novelId);
	}
	const trimmed = rawSrc.trim();
	if (trimmed.startsWith("//")) {
		return `https:${trimmed}`;
	}
	if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
		return trimmed;
	}
	if (trimmed.startsWith("/")) {
		return `${LINOVELIB_DESKTOP_BASE}${trimmed}`;
	}
	return novelIdToCoverUrl(novelId);
}

export function extractImgCoverUrl(
	novelId: string,
	$img: Cheerio<Element>,
): string {
	const dataOriginal = $img.attr("data-original");
	if (!isPlaceholderCoverUrl(dataOriginal)) {
		return resolveDesktopCoverUrl(novelId, dataOriginal);
	}
	const src = $img.attr("src");
	return resolveDesktopCoverUrl(novelId, src);
}

export function parseNovelStatusText(raw: string | undefined): NovelStatus {
	const text = cleanInlineText(raw);
	if (text.includes("完结") || text.includes("完本")) {
		return "completed";
	}
	if (text.includes("连载")) {
		return "ongoing";
	}
	return "unknown";
}

export interface BuildExploreItemInput {
	id: string;
	title: string;
	coverUrl?: string;
	author?: string;
	summary?: string;
	status?: NovelStatus;
	category?: string;
	genres?: string[];
	latestChapter?: string;
	latestChapterId?: string;
	wordCount?: string;
	updatedAt?: string;
	rank?: number;
}

export function buildExploreNovelItem(
	input: BuildExploreItemInput,
): ExploreNovelItem {
	const item: ExploreNovelItem = {
		id: input.id,
		platform: "linovelib",
		title: input.title,
		coverUrl: input.coverUrl ?? novelIdToCoverUrl(input.id),
	};
	if (input.author) {
		item.author = input.author;
	}
	if (input.summary) {
		item.summary = input.summary;
	}
	if (input.status !== undefined) {
		item.status = input.status;
	}
	if (input.category) {
		item.category = input.category;
	}
	if (input.genres && input.genres.length > 0) {
		item.genres = input.genres;
	}
	if (input.latestChapter) {
		item.latestChapter = input.latestChapter;
	}
	if (input.latestChapterId) {
		item.latestChapterId = input.latestChapterId;
	}
	if (input.wordCount) {
		item.wordCount = input.wordCount;
	}
	if (input.updatedAt) {
		item.updatedAt = input.updatedAt;
	}
	if (input.rank !== undefined) {
		item.rank = input.rank;
	}
	return item;
}
