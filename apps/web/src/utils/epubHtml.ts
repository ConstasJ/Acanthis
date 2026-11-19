import { rebaseMediaUrlWithBase } from "@/utils/mediaUrl";

const INVALID_FILENAME_CHARS = new Set([
	"<",
	">",
	":",
	'"',
	"/",
	"\\",
	"|",
	"?",
	"*",
]);

const NAMED_HTML_ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00a0",
};

export function isUnresolvedChapterId(chapterId: string): boolean {
	return chapterId.startsWith("TOBEDETERMINED");
}

export function sanitizeFilename(name: string): string {
	let stripped = "";
	for (let i = 0; i < name.length; i += 1) {
		const ch = name[i] ?? "";
		const code = name.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f || INVALID_FILENAME_CHARS.has(ch)) {
			continue;
		}
		stripped += ch;
	}

	const normalized = stripped
		.replace(/\s+/g, " ")
		.replace(/^\s+/, "")
		.replace(/[. ]+$/g, "");

	return normalized.length > 0 ? normalized : "untitled";
}

function decodeHtmlAttrEntities(value: string): string {
	return value.replace(
		/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g,
		(full, entity: string) => {
			if (entity.startsWith("#x") || entity.startsWith("#X")) {
				const cp = Number.parseInt(entity.slice(2), 16);
				return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff
					? String.fromCodePoint(cp)
					: full;
			}
			if (entity.startsWith("#")) {
				const cp = Number.parseInt(entity.slice(1), 10);
				return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff
					? String.fromCodePoint(cp)
					: full;
			}
			return NAMED_HTML_ENTITIES[entity.toLowerCase()] ?? full;
		},
	);
}

function escapeHtmlAttrValue(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function isAsciiWhitespace(ch: string): boolean {
	return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

function isTagNameBoundary(ch: string | undefined): boolean {
	return ch === undefined || isAsciiWhitespace(ch) || ch === ">" || ch === "/";
}

function findTagEnd(html: string, startIndex: number): number {
	let quote: string | undefined;
	for (let i = startIndex; i < html.length; i += 1) {
		const ch = html[i] ?? "";
		if (quote !== undefined) {
			if (ch === quote) {
				quote = undefined;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === ">") {
			return i;
		}
	}
	return html.length;
}

interface SrcSpanMatch {
	valueStart: number;
	valueEnd: number;
	decodedSrc: string;
}

function findSrcAttributeSpan(tagContent: string): SrcSpanMatch | undefined {
	let i = 0;
	const len = tagContent.length;

	while (i < len) {
		while (i < len && isAsciiWhitespace(tagContent[i] ?? "")) {
			i += 1;
		}
		if (i >= len || tagContent[i] === "/") {
			break;
		}

		const nameStart = i;
		while (
			i < len &&
			!isAsciiWhitespace(tagContent[i] ?? "") &&
			tagContent[i] !== "=" &&
			tagContent[i] !== "/"
		) {
			i += 1;
		}
		const attrName = tagContent.slice(nameStart, i).toLowerCase();

		while (i < len && isAsciiWhitespace(tagContent[i] ?? "")) {
			i += 1;
		}

		let rawValue: string | undefined;
		let tokenStart = i;
		let tokenEnd = i;

		if (i < len && tagContent[i] === "=") {
			i += 1;
			while (i < len && isAsciiWhitespace(tagContent[i] ?? "")) {
				i += 1;
			}
			tokenStart = i;
			if (i < len && (tagContent[i] === '"' || tagContent[i] === "'")) {
				const quote = tagContent[i] ?? '"';
				i += 1;
				const valStart = i;
				while (i < len && tagContent[i] !== quote) {
					i += 1;
				}
				rawValue = tagContent.slice(valStart, i);
				if (i < len && tagContent[i] === quote) {
					i += 1;
				}
				tokenEnd = i;
			} else {
				const valStart = i;
				while (
					i < len &&
					!isAsciiWhitespace(tagContent[i] ?? "") &&
					tagContent[i] !== ">"
				) {
					i += 1;
				}
				rawValue = tagContent.slice(valStart, i);
				tokenEnd = i;
			}
		}

		if (attrName === "src" && rawValue !== undefined) {
			const decoded = decodeHtmlAttrEntities(rawValue).trim();
			if (!decoded) {
				return undefined;
			}
			return {
				valueStart: tokenStart,
				valueEnd: tokenEnd,
				decodedSrc: decoded,
			};
		}
	}

	return undefined;
}

export function rewriteAndExtractImgSrcUrls(
	html: string,
	apiBaseUrl: string,
): { html: string; imageUrls: string[] } {
	const urls = new Set<string>();
	const chunks: string[] = [];
	let cursor = 0;
	let i = 0;
	const len = html.length;

	while (i < len) {
		const lt = html.indexOf("<", i);
		if (lt === -1) {
			break;
		}

		if (html.startsWith("<!--", lt)) {
			const commentEnd = html.indexOf("-->", lt + 4);
			i = commentEnd === -1 ? len : commentEnd + 3;
			continue;
		}

		if (
			html.slice(lt + 1, lt + 4).toLowerCase() === "img" &&
			isTagNameBoundary(html[lt + 4])
		) {
			const tagEnd = findTagEnd(html, lt + 4);
			const attrsSliceStart = lt + 4;
			const attrsSlice = html.slice(attrsSliceStart, tagEnd);
			const srcMatch = findSrcAttributeSpan(attrsSlice);
			if (srcMatch) {
				const rebased = rebaseMediaUrlWithBase(srcMatch.decodedSrc, apiBaseUrl);
				if (rebased) {
					urls.add(rebased);
					const absStart = attrsSliceStart + srcMatch.valueStart;
					const absEnd = attrsSliceStart + srcMatch.valueEnd;
					chunks.push(html.slice(cursor, absStart));
					chunks.push(`"${escapeHtmlAttrValue(rebased)}"`);
					cursor = absEnd;
				}
			}
			i = tagEnd < len ? tagEnd + 1 : len;
			continue;
		}

		const nextChars = html.slice(lt + 1, lt + 8).toLowerCase();
		if (nextChars.startsWith("script") && isTagNameBoundary(html[lt + 7])) {
			const tagEnd = findTagEnd(html, lt + 7);
			const closeIdx = html.toLowerCase().indexOf("</script", tagEnd + 1);
			if (closeIdx === -1) {
				i = len;
			} else {
				const closeEnd = html.indexOf(">", closeIdx + 8);
				i = closeEnd === -1 ? len : closeEnd + 1;
			}
			continue;
		}

		if (nextChars.startsWith("style") && isTagNameBoundary(html[lt + 6])) {
			const tagEnd = findTagEnd(html, lt + 6);
			const closeIdx = html.toLowerCase().indexOf("</style", tagEnd + 1);
			if (closeIdx === -1) {
				i = len;
			} else {
				const closeEnd = html.indexOf(">", closeIdx + 7);
				i = closeEnd === -1 ? len : closeEnd + 1;
			}
			continue;
		}

		i = lt + 1;
	}

	if (cursor === 0) {
		return { html, imageUrls: [...urls] };
	}

	chunks.push(html.slice(cursor));
	return {
		html: chunks.join(""),
		imageUrls: [...urls],
	};
}
