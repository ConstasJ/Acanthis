import type { NavEntry } from "./nav";
import { escapeXml } from "./xhtml";

function computeDepth(entries: readonly NavEntry[]): number {
	if (entries.length === 0) {
		return 1;
	}
	let maxDepth = 1;
	for (const entry of entries) {
		if (entry.children && entry.children.length > 0) {
			const childDepth = 1 + computeDepth(entry.children);
			if (childDepth > maxDepth) {
				maxDepth = childDepth;
			}
		}
	}
	return maxDepth;
}

function renderNavPoints(
	entries: readonly NavEntry[],
	indentLevel: number,
	counter: { value: number },
): string[] {
	const indent = "\t".repeat(indentLevel);
	const lines: string[] = [];

	for (const entry of entries) {
		counter.value += 1;
		const order = counter.value;
		lines.push(
			`${indent}<navPoint id="navPoint-${order}" playOrder="${order}">`,
		);
		lines.push(`${indent}\t<navLabel>`);
		lines.push(`${indent}\t\t<text>${escapeXml(entry.title)}</text>`);
		lines.push(`${indent}\t</navLabel>`);
		lines.push(`${indent}\t<content src="${escapeXml(entry.href)}" />`);
		if (entry.children && entry.children.length > 0) {
			lines.push(...renderNavPoints(entry.children, indentLevel + 1, counter));
		}
		lines.push(`${indent}</navPoint>`);
	}

	return lines;
}

export function buildTocNcx(options: {
	identifier: string;
	title: string;
	author: string;
	entries: NavEntry[];
}): string {
	const depth = computeDepth(options.entries);
	const counter = { value: 0 };
	const navPointLines = renderNavPoints(options.entries, 2, counter);

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">',
		"\t<head>",
		`\t\t<meta name="dtb:uid" content="${escapeXml(options.identifier)}" />`,
		`\t\t<meta name="dtb:depth" content="${depth}" />`,
		'\t\t<meta name="dtb:totalPageCount" content="0" />',
		'\t\t<meta name="dtb:maxPageNumber" content="0" />',
		"\t</head>",
		"\t<docTitle>",
		`\t\t<text>${escapeXml(options.title)}</text>`,
		"\t</docTitle>",
		"\t<docAuthor>",
		`\t\t<text>${escapeXml(options.author)}</text>`,
		"\t</docAuthor>",
		"\t<navMap>",
		...navPointLines,
		"\t</navMap>",
		"</ncx>",
		"",
	].join("\n");
}
