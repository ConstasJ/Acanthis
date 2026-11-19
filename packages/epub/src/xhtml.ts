import render from "dom-serializer";
import {
	type ChildNode,
	Element,
	isComment,
	isDirective,
	isTag,
	isText,
	Text,
} from "domhandler";
import { parseDocument } from "htmlparser2";
import type { EpubChapterData } from "./types";

const DEFAULT_LANGUAGE = "zh-CN";

const MIME_TO_EXTENSION: Readonly<Record<string, string>> = {
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/svg+xml": "svg",
	"image/avif": "avif",
};

const KNOWN_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
	jpg: "jpg",
	jpeg: "jpg",
	png: "png",
	webp: "webp",
	gif: "gif",
	svg: "svg",
	avif: "avif",
};

const REMOVED_TAG_NAMES = new Set([
	"script",
	"iframe",
	"style",
	"noscript",
	"object",
	"embed",
]);

const HEADING_TAG_NAMES = new Set(["h1", "h2", "h3"]);

const URI_ATTRIBUTE_NAMES = new Set([
	"href",
	"src",
	"xlink:href",
	"action",
	"formaction",
	"poster",
	"data",
	"cite",
	"background",
	"srcset",
]);

const VALID_XML_NCNAME = /^[A-Za-z_][A-Za-z0-9._-]*$/;

const ALLOWED_ATTR_NAMESPACE_PREFIXES = new Set(["xml", "epub"]);

function isAllowedXmlAttributeName(name: string): boolean {
	const colonIndex = name.indexOf(":");
	if (colonIndex === -1) {
		return VALID_XML_NCNAME.test(name);
	}
	if (name.indexOf(":", colonIndex + 1) !== -1) {
		return false;
	}
	const prefix = name.slice(0, colonIndex);
	const localName = name.slice(colonIndex + 1);
	if (!VALID_XML_NCNAME.test(prefix) || !VALID_XML_NCNAME.test(localName)) {
		return false;
	}
	if (name === "xmlns:epub") {
		return true;
	}
	return ALLOWED_ATTR_NAMESPACE_PREFIXES.has(prefix);
}

const XML_ESCAPE_MAP: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

export function escapeXml(text: string): string {
	return stripInvalidXmlControlChars(text).replace(
		/[&<>"']/g,
		(char) => XML_ESCAPE_MAP[char] ?? char,
	);
}

function extractExtensionFromUrl(sourceUrl?: string): string | undefined {
	if (!sourceUrl) {
		return undefined;
	}
	const trimmed = sourceUrl.trim();
	if (!trimmed) {
		return undefined;
	}

	let pathname = trimmed;
	try {
		pathname = new URL(trimmed, "https://example.invalid").pathname;
	} catch {
		const withoutHash = trimmed.split("#")[0] ?? trimmed;
		pathname = withoutHash.split("?")[0] ?? withoutHash;
	}

	const lastSegment = pathname.split("/").pop() ?? "";
	const match = /\.([a-z0-9]+)$/i.exec(lastSegment);
	if (!match?.[1]) {
		return undefined;
	}
	return KNOWN_IMAGE_EXTENSIONS[match[1].toLowerCase()];
}

export function resolveImageExtension(
	mimeType: string,
	sourceUrl?: string,
): string {
	const normalizedMime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
	const mapped = MIME_TO_EXTENSION[normalizedMime];
	if (mapped) {
		return mapped;
	}
	return extractExtensionFromUrl(sourceUrl) ?? "jpg";
}

function stripWhitespaceAndControl(value: string): string {
	const withoutWhitespace = value.replace(/\s+/g, "");
	let result = "";
	for (let i = 0; i < withoutWhitespace.length; i += 1) {
		const code = withoutWhitespace.charCodeAt(i);
		if (code <= 0x20 || code === 0x7f) {
			continue;
		}
		result += withoutWhitespace[i] ?? "";
	}
	return result;
}

function isUnsafeUri(value: string): boolean {
	// Strip Unicode whitespace and ASCII control characters before checking URI scheme
	const normalized = stripWhitespaceAndControl(value).toLowerCase();
	return (
		normalized.startsWith("javascript:") ||
		normalized.startsWith("vbscript:") ||
		normalized.startsWith("data:text/html")
	);
}

function sanitizeElementAttributes(element: Element): void {
	const cleaned: Record<string, string> = {};
	for (const [rawKey, rawValue] of Object.entries(element.attribs)) {
		const key = rawKey.trim();
		if (!key || !isAllowedXmlAttributeName(key)) {
			continue;
		}
		const lowerKey = key.toLowerCase();
		if (lowerKey.startsWith("on") || lowerKey === "srcdoc") {
			continue;
		}
		if (URI_ATTRIBUTE_NAMES.has(lowerKey) && isUnsafeUri(rawValue)) {
			continue;
		}
		cleaned[key] = rawValue;
	}
	element.attribs = cleaned;
}

function sanitizeNodeList(
	nodes: ChildNode[],
	imageHrefBySourceUrl: ReadonlyMap<string, string>,
): ChildNode[] {
	const result: ChildNode[] = [];

	for (const node of nodes) {
		if (isComment(node) || isDirective(node)) {
			continue;
		}

		if (!isTag(node)) {
			result.push(node);
			continue;
		}

		const tagName = node.name.toLowerCase();
		if (REMOVED_TAG_NAMES.has(tagName)) {
			continue;
		}

		if (tagName.includes(":")) {
			const unwrappedChildren = sanitizeNodeList(
				node.children,
				imageHrefBySourceUrl,
			);
			for (const child of unwrappedChildren) {
				child.parent = node.parent;
				result.push(child);
			}
			continue;
		}

		node.name = tagName;

		if (tagName === "img") {
			const rawSrc = node.attribs.src;
			const mappedHref =
				rawSrc !== undefined
					? (imageHrefBySourceUrl.get(rawSrc) ??
						imageHrefBySourceUrl.get(rawSrc.trim()))
					: undefined;

			if (mappedHref !== undefined) {
				const alt = node.attribs.alt?.trim() || "插图";
				node.attribs = {
					src: mappedHref,
					alt,
				};
				node.children = [];
				result.push(node);
			} else {
				const placeholder = new Element(
					"p",
					{ class: "image-placeholder" },
					[new Text("[插图未包含]")],
				);
				placeholder.parent = node.parent;
				result.push(placeholder);
			}
			continue;
		}

		sanitizeElementAttributes(node);
		node.children = sanitizeNodeList(node.children, imageHrefBySourceUrl);
		result.push(node);
	}

	return result;
}

function collectTextContent(node: ChildNode): string {
	if (isText(node)) {
		return node.data;
	}
	if (isTag(node)) {
		let text = "";
		for (const child of node.children) {
			text += collectTextContent(child);
		}
		return text;
	}
	return "";
}

function normalizeLeadingHeading(
	nodes: ChildNode[],
	chapterTitle: string,
): ChildNode[] {
	const firstSignificant = nodes.find((node) => {
		if (isComment(node)) {
			return false;
		}
		if (isText(node)) {
			return node.data.trim().length > 0;
		}
		return true;
	});

	if (
		firstSignificant &&
		isTag(firstSignificant) &&
		HEADING_TAG_NAMES.has(firstSignificant.name.toLowerCase())
	) {
		firstSignificant.name = "h1";
		firstSignificant.attribs = {
			...firstSignificant.attribs,
			class: "chapter-title",
		};
		if (collectTextContent(firstSignificant).trim().length === 0) {
			firstSignificant.children = [new Text(chapterTitle)];
		}
		return nodes;
	}

	const heading = new Element("h1", { class: "chapter-title" }, [
		new Text(chapterTitle),
	]);
	return [heading, ...nodes];
}

function wrapXhtmlDocument(options: {
	title: string;
	language?: string | undefined;
	bodyHtml: string;
	bodyAttributes?: string | undefined;
}): string {
	const lang = options.language?.trim() || DEFAULT_LANGUAGE;
	const escapedLang = escapeXml(lang);
	const escapedTitle = escapeXml(options.title);
	const bodyAttrs = options.bodyAttributes ? ` ${options.bodyAttributes}` : "";

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		"<!DOCTYPE html>",
		`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapedLang}" lang="${escapedLang}">`,
		"<head>",
		'\t<meta charset="UTF-8" />',
		`\t<title>${escapedTitle}</title>`,
		'\t<link rel="stylesheet" type="text/css" href="../styles/main.css" />',
		"</head>",
		`<body${bodyAttrs}>`,
		options.bodyHtml,
		"</body>",
		"</html>",
		"",
	].join("\n");
}

export function buildCoverPageXhtml(
	title: string,
	imageHref: string,
	language?: string,
): string {
	const escapedTitle = escapeXml(title);
	const escapedHref = escapeXml(imageHref);
	const bodyHtml = `\t<div class="cover-page"><img src="${escapedHref}" alt="${escapedTitle}" /></div>`;
	return wrapXhtmlDocument({
		title,
		language,
		bodyHtml,
		bodyAttributes: 'epub:type="cover"',
	});
}

export function buildVolumeTitlePageXhtml(options: {
	title: string;
	language?: string | undefined;
	coverHref?: string | undefined;
}): string {
	const escapedTitle = escapeXml(options.title);
	const parts: string[] = ['\t<div class="volume-title-page">'];
	if (options.coverHref) {
		parts.push(
			`\t\t<img src="${escapeXml(options.coverHref)}" alt="${escapedTitle}" />`,
		);
	}
	parts.push(`\t\t<h1 class="volume-title">${escapedTitle}</h1>`);
	parts.push("\t</div>");

	return wrapXhtmlDocument({
		title: options.title,
		language: options.language,
		bodyHtml: parts.join("\n"),
	});
}

function stripInvalidXmlControlChars(text: string): string {
	let hasInvalid = false;
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		if (
			code <= 0x08 ||
			code === 0x0b ||
			code === 0x0c ||
			(code >= 0x0e && code <= 0x1f)
		) {
			hasInvalid = true;
			break;
		}
	}
	if (!hasInvalid) {
		return text;
	}
	let result = "";
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		if (
			code <= 0x08 ||
			code === 0x0b ||
			code === 0x0c ||
			(code >= 0x0e && code <= 0x1f)
		) {
			continue;
		}
		result += text[i] ?? "";
	}
	return result;
}

function escapeXmlFragmentChars(text: string): string {
	return stripInvalidXmlControlChars(text).replace(
		/[&<>]/g,
		(char) => XML_ESCAPE_MAP[char] ?? char,
	);
}

function escapeNodesForXmlSerialization(nodes: ChildNode[]): void {
	for (const node of nodes) {
		if (isText(node)) {
			node.data = escapeXmlFragmentChars(node.data);
			continue;
		}
		if (isTag(node)) {
			const escapedAttribs: Record<string, string> = {};
			for (const [key, value] of Object.entries(node.attribs)) {
				escapedAttribs[key] = escapeXmlFragmentChars(value);
			}
			node.attribs = escapedAttribs;
			escapeNodesForXmlSerialization(node.children);
		}
	}
}

export function sanitizeChapterHtmlToXhtml(options: {
	chapter: EpubChapterData;
	imageHrefBySourceUrl: ReadonlyMap<string, string>;
	language?: string | undefined;
}): string {
	const document = parseDocument(options.chapter.html, {
		decodeEntities: true,
	});
	const sanitizedChildren = sanitizeNodeList(
		document.children,
		options.imageHrefBySourceUrl,
	);
	const normalizedChildren = normalizeLeadingHeading(
		sanitizedChildren,
		options.chapter.title,
	);
	escapeNodesForXmlSerialization(normalizedChildren);
	const bodyHtml = render(normalizedChildren, {
		xmlMode: true,
		encodeEntities: false,
	});

	return wrapXhtmlDocument({
		title: options.chapter.title,
		language: options.language,
		bodyHtml,
	});
}
