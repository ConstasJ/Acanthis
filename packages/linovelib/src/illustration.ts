import { load } from "cheerio";

function normalizeIllustrationUrl(
	rawSrc: string | undefined,
): string | undefined {
	if (!rawSrc) {
		return undefined;
	}
	const trimmed = rawSrc.trim();
	if (!trimmed) {
		return undefined;
	}
	const normalized = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
	if (
		!normalized.startsWith("http://") &&
		!normalized.startsWith("https://")
	) {
		return undefined;
	}
	return normalized;
}

export function extractChapterIllustrationUrls(html: string): string[] {
	const $ = load(html, null, false);
	const urls = new Set<string>();
	$("img").each((_, el) => {
		const normalized = normalizeIllustrationUrl($(el).attr("src"));
		if (normalized) {
			urls.add(normalized);
		}
	});
	return [...urls];
}

export function rewriteChapterIllustrations(
	html: string,
	mapUrl: (originalUrl: string) => string,
): string {
	const $ = load(html, null, false);
	$("img").each((_, el) => {
		const $el = $(el);
		const normalized = normalizeIllustrationUrl($el.attr("src"));
		if (normalized) {
			$el.attr("src", mapUrl(normalized));
		}
	});
	return $.html();
}
