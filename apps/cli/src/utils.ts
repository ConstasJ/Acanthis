import type { Volume } from "@acanthis-dec/core";

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

const PURE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const NOVEL_PATH_ID_PATTERN = /\/novel\/([^/?#.]+)(?:\.html)?(?:\/|$)/i;
const TRAILING_NUMERIC_SEGMENT_PATTERN = /^(\d+)(?:\.html)?$/i;
const RANGE_TOKEN_PATTERN = /^(\d+)-(\d+)$/;
const INTEGER_TOKEN_PATTERN = /^\d+$/;

const NAMED_HTML_ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00a0",
};

export function parseNovelIdOrUrl(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) {
		throw new Error("Novel ID or URL cannot be empty");
	}

	if (PURE_ID_PATTERN.test(trimmed)) {
		return trimmed;
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`Unrecognized novel ID or URL: "${input}"`);
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Unrecognized novel ID or URL: "${input}"`);
	}

	const novelMatch = NOVEL_PATH_ID_PATTERN.exec(parsed.pathname);
	if (novelMatch?.[1]) {
		return decodeURIComponent(novelMatch[1]);
	}

	const segments = parsed.pathname.split("/").filter(Boolean);
	const lastSegment = segments[segments.length - 1];
	if (lastSegment) {
		const trailingMatch = TRAILING_NUMERIC_SEGMENT_PATTERN.exec(lastSegment);
		if (trailingMatch?.[1]) {
			return trailingMatch[1];
		}
	}

	throw new Error(`Unrecognized novel ID or URL: "${input}"`);
}

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

export function parseVolumeSelection(
	spec: string | undefined,
	volumes: Volume[],
): Volume[] {
	if (spec === undefined || spec.trim() === "") {
		return [...volumes];
	}

	const tokens = spec.split(",");
	const selectedIndices = new Set<number>();

	for (const rawToken of tokens) {
		const token = rawToken.trim();
		if (!token) {
			throw new Error(`Invalid volume selection "${spec}": empty token`);
		}

		const rangeMatch = RANGE_TOKEN_PATTERN.exec(token);
		if (rangeMatch?.[1] && rangeMatch[2]) {
			const start = Number.parseInt(rangeMatch[1], 10);
			const end = Number.parseInt(rangeMatch[2], 10);
			if (start < 1 || end < 1 || start > end || end > volumes.length) {
				throw new Error(
					`Volume range "${token}" is out of bounds (available: 1-${volumes.length})`,
				);
			}
			for (let idx = start - 1; idx <= end - 1; idx += 1) {
				selectedIndices.add(idx);
			}
			continue;
		}

		if (INTEGER_TOKEN_PATTERN.test(token)) {
			const indexOneBased = Number.parseInt(token, 10);
			if (indexOneBased >= 1 && indexOneBased <= volumes.length) {
				selectedIndices.add(indexOneBased - 1);
				continue;
			}
			const matchedById = volumes.findIndex((volume) => volume.id === token);
			if (matchedById !== -1) {
				selectedIndices.add(matchedById);
				continue;
			}
			throw new Error(
				`Volume "${token}" is out of range (available: 1-${volumes.length})`,
			);
		}

		const matchedById = volumes.findIndex((volume) => volume.id === token);
		if (matchedById !== -1) {
			selectedIndices.add(matchedById);
			continue;
		}

		throw new Error(`Invalid or unknown volume selection "${token}"`);
	}

	const result: Volume[] = [];
	for (let i = 0; i < volumes.length; i += 1) {
		if (selectedIndices.has(i)) {
			const volume = volumes[i];
			if (volume) {
				result.push(volume);
			}
		}
	}
	return result;
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

function extractSrcAttributeFromTag(tagContent: string): string | undefined {
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

		let attrValue: string | undefined;
		if (i < len && tagContent[i] === "=") {
			i += 1;
			while (i < len && isAsciiWhitespace(tagContent[i] ?? "")) {
				i += 1;
			}
			if (i < len && (tagContent[i] === '"' || tagContent[i] === "'")) {
				const quote = tagContent[i] ?? '"';
				i += 1;
				const valStart = i;
				while (i < len && tagContent[i] !== quote) {
					i += 1;
				}
				attrValue = tagContent.slice(valStart, i);
				if (i < len && tagContent[i] === quote) {
					i += 1;
				}
			} else {
				const valStart = i;
				while (
					i < len &&
					!isAsciiWhitespace(tagContent[i] ?? "") &&
					tagContent[i] !== ">"
				) {
					i += 1;
				}
				attrValue = tagContent.slice(valStart, i);
			}
		}

		if (attrName === "src" && attrValue !== undefined) {
			const decoded = decodeHtmlAttrEntities(attrValue).trim();
			return decoded.length > 0 ? decoded : undefined;
		}
	}

	return undefined;
}

export function extractImgSrcUrls(html: string): string[] {
	const urls = new Set<string>();
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
			const attrsSlice = html.slice(lt + 4, tagEnd);
			const src = extractSrcAttributeFromTag(attrsSlice);
			if (src) {
				urls.add(src);
			}
			i = tagEnd + 1;
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

	return [...urls];
}

export async function withConcurrencyLimit<T, R>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) {
		return [];
	}

	const limit = Math.max(
		1,
		Math.floor(Number.isFinite(concurrency) ? concurrency : 1),
	);
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	let aborted = false;

	const runWorker = async (): Promise<void> => {
		while (!aborted) {
			const current = nextIndex;
			nextIndex += 1;
			if (current >= items.length) {
				return;
			}
			try {
				results[current] = await worker(items[current] as T, current);
			} catch (error) {
				aborted = true;
				throw error;
			}
		}
	};

	const workerCount = Math.min(limit, items.length);
	await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
	return results;
}
