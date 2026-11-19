import { escapeXml } from "./xhtml";

export interface NavEntry {
	title: string;
	href: string;
	children?: NavEntry[] | undefined;
}

function renderNavList(
	entries: readonly NavEntry[],
	indentLevel: number,
): string {
	const indent = "\t".repeat(indentLevel);
	const itemIndent = "\t".repeat(indentLevel + 1);
	if (entries.length === 0) {
		return `${indent}<ol></ol>`;
	}

	const lines: string[] = [`${indent}<ol>`];
	for (const entry of entries) {
		const href = escapeXml(entry.href);
		const title = escapeXml(entry.title);
		const children = entry.children;
		if (children && children.length > 0) {
			lines.push(`${itemIndent}<li>`);
			lines.push(`${itemIndent}\t<a href="${href}">${title}</a>`);
			lines.push(renderNavList(children, indentLevel + 2));
			lines.push(`${itemIndent}</li>`);
		} else {
			lines.push(`${itemIndent}<li><a href="${href}">${title}</a></li>`);
		}
	}
	lines.push(`${indent}</ol>`);
	return lines.join("\n");
}

export function buildNavXhtml(options: {
	title: string;
	language: string;
	entries: NavEntry[];
}): string {
	const lang = options.language.trim() || "zh-CN";
	const escapedLang = escapeXml(lang);
	const escapedTitle = escapeXml(options.title);

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		"<!DOCTYPE html>",
		`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapedLang}" lang="${escapedLang}">`,
		"<head>",
		'\t<meta charset="UTF-8" />',
		`\t<title>${escapedTitle}</title>`,
		'\t<link rel="stylesheet" type="text/css" href="styles/main.css" />',
		"</head>",
		"<body>",
		'\t<nav epub:type="toc" id="toc">',
		`\t\t<h1>${escapedTitle}</h1>`,
		renderNavList(options.entries, 2),
		"\t</nav>",
		"</body>",
		"</html>",
		"",
	].join("\n");
}
