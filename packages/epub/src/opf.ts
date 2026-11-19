import { escapeXml } from "./xhtml";

export interface OpfManifestItem {
	id: string;
	href: string;
	mediaType: string;
	properties?: string | undefined;
}

export interface OpfSpineItem {
	idref: string;
	linear?: boolean | undefined;
}

export function buildContainerXml(): string {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
		"\t<rootfiles>",
		'\t\t<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />',
		"\t</rootfiles>",
		"</container>",
		"",
	].join("\n");
}

export function buildContentOpf(options: {
	identifier: string;
	title: string;
	author: string;
	language: string;
	summary?: string | undefined;
	genres?: string[] | undefined;
	modifiedAt: Date;
	coverImageId?: string | undefined;
	manifest: OpfManifestItem[];
	spine: OpfSpineItem[];
}): string {
	const modifiedTimestamp = `${options.modifiedAt.toISOString().slice(0, 19)}Z`;
	const lines: string[] = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">',
		'\t<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
		`\t\t<dc:identifier id="bookid">${escapeXml(options.identifier)}</dc:identifier>`,
		`\t\t<dc:title>${escapeXml(options.title)}</dc:title>`,
		`\t\t<dc:creator>${escapeXml(options.author)}</dc:creator>`,
		`\t\t<dc:language>${escapeXml(options.language)}</dc:language>`,
	];

	const summary = options.summary?.trim();
	if (summary) {
		lines.push(`\t\t<dc:description>${escapeXml(summary)}</dc:description>`);
	}

	for (const genre of options.genres ?? []) {
		const trimmed = genre.trim();
		if (trimmed) {
			lines.push(`\t\t<dc:subject>${escapeXml(trimmed)}</dc:subject>`);
		}
	}

	lines.push(
		`\t\t<meta property="dcterms:modified">${modifiedTimestamp}</meta>`,
	);

	const coverImageId = options.coverImageId?.trim();
	if (coverImageId) {
		lines.push(
			`\t\t<meta name="cover" content="${escapeXml(coverImageId)}" />`,
		);
	}

	lines.push("\t</metadata>");
	lines.push("\t<manifest>");

	for (const item of options.manifest) {
		const propertiesAttr = item.properties
			? ` properties="${escapeXml(item.properties)}"`
			: "";
		lines.push(
			`\t\t<item id="${escapeXml(item.id)}" href="${escapeXml(item.href)}" media-type="${escapeXml(item.mediaType)}"${propertiesAttr} />`,
		);
	}

	lines.push("\t</manifest>");
	lines.push('\t<spine toc="ncx">');

	for (const spineItem of options.spine) {
		const linearAttr = spineItem.linear === false ? ' linear="no"' : "";
		lines.push(
			`\t\t<itemref idref="${escapeXml(spineItem.idref)}"${linearAttr} />`,
		);
	}

	lines.push("\t</spine>");
	lines.push("</package>");
	lines.push("");

	return lines.join("\n");
}
