import DOMPurify from "dompurify";
import { rebaseMediaUrl } from "@/api/client";

export type ReaderBlock =
	| { blockIndex: number; kind: "heading"; tag: string; html: string }
	| { blockIndex: number; kind: "paragraph"; html: string }
	| { blockIndex: number; kind: "image"; src: string; alt: string };

const ALLOWED_TAGS = [
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p",
	"img",
	"br",
	"hr",
	"ruby",
	"rt",
	"rp",
	"span",
	"em",
	"strong",
	"b",
	"i",
];

const ALLOWED_ATTR = ["src", "alt", "title", "class"];

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function rebaseElementImages(element: Element, apiBaseUrl: string): void {
	const images = element.querySelectorAll("img");
	for (const img of images) {
		const rebased = rebaseMediaUrl(img.getAttribute("src"), apiBaseUrl);
		if (rebased) {
			img.setAttribute("src", rebased);
		} else {
			img.removeAttribute("src");
		}
	}
}

function extractSingleImageFromElement(element: Element): Element | null {
	let foundImg: Element | null = null;
	for (const child of element.childNodes) {
		if (child.nodeType === Node.TEXT_NODE) {
			if (child.textContent && child.textContent.trim().length > 0) {
				return null;
			}
			continue;
		}
		if (child.nodeType === Node.ELEMENT_NODE) {
			const childEl = child as Element;
			if (childEl.tagName.toLowerCase() === "img" && foundImg === null) {
				foundImg = childEl;
				continue;
			}
			return null;
		}
		if (child.nodeType !== Node.COMMENT_NODE) {
			return null;
		}
	}
	return foundImg;
}

export function parseChapterBlocks(
	rawHtml: string,
	apiBaseUrl: string,
): ReaderBlock[] {
	if (!rawHtml.trim()) {
		return [];
	}

	const cleanHtml = DOMPurify.sanitize(rawHtml, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		ALLOW_DATA_ATTR: false,
	});

	const doc = new DOMParser().parseFromString(cleanHtml, "text/html");
	const blocks: ReaderBlock[] = [];

	for (const node of doc.body.childNodes) {
		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent;
			if (!text || !text.trim()) {
				continue;
			}
			blocks.push({
				blockIndex: blocks.length,
				kind: "paragraph",
				html: escapeHtml(text.trim()),
			});
			continue;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			continue;
		}

		const element = node as Element;
		const tag = element.tagName.toLowerCase();

		if (tag === "img") {
			blocks.push({
				blockIndex: blocks.length,
				kind: "image",
				src: rebaseMediaUrl(element.getAttribute("src"), apiBaseUrl),
				alt: element.getAttribute("alt") ?? "",
			});
			continue;
		}

		if (tag === "p") {
			const singleImg = extractSingleImageFromElement(element);
			if (singleImg !== null) {
				blocks.push({
					blockIndex: blocks.length,
					kind: "image",
					src: rebaseMediaUrl(singleImg.getAttribute("src"), apiBaseUrl),
					alt: singleImg.getAttribute("alt") ?? "",
				});
				continue;
			}

			if (!element.textContent?.trim() && element.children.length === 0) {
				continue;
			}

			rebaseElementImages(element, apiBaseUrl);
			blocks.push({
				blockIndex: blocks.length,
				kind: "paragraph",
				html: element.innerHTML,
			});
			continue;
		}

		if (HEADING_TAGS.has(tag)) {
			rebaseElementImages(element, apiBaseUrl);
			blocks.push({
				blockIndex: blocks.length,
				kind: "heading",
				tag,
				html: element.innerHTML,
			});
			continue;
		}

		rebaseElementImages(element, apiBaseUrl);
		blocks.push({
			blockIndex: blocks.length,
			kind: "paragraph",
			html: element.outerHTML,
		});
	}

	return blocks;
}
