import { strToU8, type Zippable, zipSync } from "fflate";
import { buildNavXhtml, type NavEntry } from "./nav";
import { buildTocNcx } from "./ncx";
import {
	buildContainerXml,
	buildContentOpf,
	type OpfManifestItem,
	type OpfSpineItem,
} from "./opf";
import { DEFAULT_EPUB_CSS } from "./styles";
import type {
	EpubChapterData,
	EpubImageAsset,
	NovelEpubInput,
	VolumeEpubInput,
} from "./types";
import {
	buildCoverPageXhtml,
	buildVolumeTitlePageXhtml,
	resolveImageExtension,
	sanitizeChapterHtmlToXhtml,
} from "./xhtml";

const DEFAULT_LANGUAGE = "zh-CN";
const EPUB_MIMETYPE = "application/epub+zip";

interface RegisteredIllustration {
	manifestId: string;
	zipPath: string;
	manifestHref: string;
	relativeHref: string;
	mediaType: string;
	data: Uint8Array;
}

interface ArchiveTextEntry {
	zipPath: string;
	content: string;
}

interface ArchiveBinaryEntry {
	zipPath: string;
	data: Uint8Array;
}

const CANONICAL_IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
	"image/jpeg": "image/jpeg",
	"image/jpg": "image/jpeg",
	"image/png": "image/png",
	"image/webp": "image/webp",
	"image/gif": "image/gif",
	"image/svg+xml": "image/svg+xml",
	"image/avif": "image/avif",
};

const EXTENSION_TO_MEDIA_TYPE: Readonly<Record<string, string>> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
	svg: "image/svg+xml",
	avif: "image/avif",
};

function resolveImageMediaType(mimeType: string, ext: string): string {
	const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
	const canonical = CANONICAL_IMAGE_MEDIA_TYPES[base];
	if (canonical) {
		return canonical;
	}
	return EXTENSION_TO_MEDIA_TYPE[ext.toLowerCase()] ?? "image/jpeg";
}

function resolveVolumeBookTitle(novelTitle: string, volumeTitle: string): string {
	const novel = novelTitle.trim();
	const volume = volumeTitle.trim();
	if (!novel) {
		return volume || "Untitled";
	}
	if (!volume || novel === volume) {
		return novel;
	}
	return `${novel} - ${volume}`;
}

function registerIllustrations(illustrations: readonly EpubImageAsset[]): {
	imageHrefBySourceUrl: Map<string, string>;
	registeredImages: RegisteredIllustration[];
} {
	const registry = new Map<string, RegisteredIllustration>();
	const imageHrefBySourceUrl = new Map<string, string>();
	const registeredImages: RegisteredIllustration[] = [];
	let index = 0;

	for (const asset of illustrations) {
		if (registry.has(asset.sourceUrl)) {
			continue;
		}
		index += 1;
		const paddedIndex = String(index).padStart(4, "0");
		const ext = resolveImageExtension(asset.mimeType, asset.sourceUrl);
		const fileName = `img-${paddedIndex}.${ext}`;
		const entry: RegisteredIllustration = {
			manifestId: `img-${paddedIndex}`,
			zipPath: `OEBPS/images/${fileName}`,
			manifestHref: `images/${fileName}`,
			relativeHref: `../images/${fileName}`,
			mediaType: resolveImageMediaType(asset.mimeType, ext),
			data: asset.data,
		};
		registry.set(asset.sourceUrl, entry);
		imageHrefBySourceUrl.set(asset.sourceUrl, entry.relativeHref);
		registeredImages.push(entry);
	}

	return { imageHrefBySourceUrl, registeredImages };
}

function packEpubArchive(options: {
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
	navEntries: NavEntry[];
	textEntries: readonly ArchiveTextEntry[];
	binaryEntries: readonly ArchiveBinaryEntry[];
}): Uint8Array {
	const contentOpf = buildContentOpf({
		identifier: options.identifier,
		title: options.title,
		author: options.author,
		language: options.language,
		summary: options.summary,
		genres: options.genres,
		modifiedAt: options.modifiedAt,
		coverImageId: options.coverImageId,
		manifest: options.manifest,
		spine: options.spine,
	});

	const navXhtml = buildNavXhtml({
		title: options.title,
		language: options.language,
		entries: options.navEntries,
	});

	const tocNcx = buildTocNcx({
		identifier: options.identifier,
		title: options.title,
		author: options.author,
		entries: options.navEntries,
	});

	const zippable: Zippable = {
		mimetype: [strToU8(EPUB_MIMETYPE), { level: 0 }],
		"META-INF/container.xml": strToU8(buildContainerXml()),
		"OEBPS/styles/main.css": strToU8(DEFAULT_EPUB_CSS),
		"OEBPS/content.opf": strToU8(contentOpf),
		"OEBPS/nav.xhtml": strToU8(navXhtml),
		"OEBPS/toc.ncx": strToU8(tocNcx),
	};

	for (const textEntry of options.textEntries) {
		zippable[textEntry.zipPath] = strToU8(textEntry.content);
	}

	for (const binaryEntry of options.binaryEntries) {
		zippable[binaryEntry.zipPath] = [binaryEntry.data, { level: 0 }];
	}

	return zipSync(zippable);
}

function createBaseManifest(): OpfManifestItem[] {
	return [
		{
			id: "ncx",
			href: "toc.ncx",
			mediaType: "application/x-dtbncx+xml",
		},
		{
			id: "nav",
			href: "nav.xhtml",
			mediaType: "application/xhtml+xml",
			properties: "nav",
		},
		{
			id: "main-css",
			href: "styles/main.css",
			mediaType: "text/css",
		},
	];
}

function appendCoverAssets(options: {
	cover: EpubImageAsset;
	bookTitle: string;
	language: string;
	manifest: OpfManifestItem[];
	spine: OpfSpineItem[];
	textEntries: ArchiveTextEntry[];
	binaryEntries: ArchiveBinaryEntry[];
}): { coverImageId: string; coverRelativeHref: string } {
	const coverExt = resolveImageExtension(
		options.cover.mimeType,
		options.cover.sourceUrl,
	);
	const coverFileName = `cover.${coverExt}`;
	const coverRelativeHref = `../images/${coverFileName}`;
	const coverImageId = "cover-image";

	options.manifest.push(
		{
			id: coverImageId,
			href: `images/${coverFileName}`,
			mediaType: resolveImageMediaType(options.cover.mimeType, coverExt),
			properties: "cover-image",
		},
		{
			id: "cover",
			href: "text/cover.xhtml",
			mediaType: "application/xhtml+xml",
		},
	);

	options.spine.push({ idref: "cover" });

	options.binaryEntries.push({
		zipPath: `OEBPS/images/${coverFileName}`,
		data: options.cover.data,
	});

	options.textEntries.push({
		zipPath: "OEBPS/text/cover.xhtml",
		content: buildCoverPageXhtml(
			options.bookTitle,
			coverRelativeHref,
			options.language,
		),
	});

	return { coverImageId, coverRelativeHref };
}

function appendChapterEntry(options: {
	chapter: EpubChapterData;
	chapterIndex: number;
	language: string;
	imageHrefBySourceUrl: ReadonlyMap<string, string>;
	manifest: OpfManifestItem[];
	spine: OpfSpineItem[];
	textEntries: ArchiveTextEntry[];
}): NavEntry {
	const paddedIndex = String(options.chapterIndex).padStart(4, "0");
	const manifestId = `ch-${paddedIndex}`;
	const manifestHref = `text/ch-${paddedIndex}.xhtml`;
	const zipPath = `OEBPS/${manifestHref}`;

	const xhtml = sanitizeChapterHtmlToXhtml({
		chapter: options.chapter,
		imageHrefBySourceUrl: options.imageHrefBySourceUrl,
		language: options.language,
	});

	options.manifest.push({
		id: manifestId,
		href: manifestHref,
		mediaType: "application/xhtml+xml",
	});
	options.spine.push({ idref: manifestId });
	options.textEntries.push({
		zipPath,
		content: xhtml,
	});

	return {
		title: options.chapter.title,
		href: manifestHref,
	};
}

export function buildVolumeEpub(input: VolumeEpubInput): Uint8Array {
	const language = input.language?.trim() || DEFAULT_LANGUAGE;
	const modifiedAt = input.modifiedAt ?? new Date();
	const bookTitle = resolveVolumeBookTitle(input.novelTitle, input.volumeTitle);

	const manifest = createBaseManifest();
	const spine: OpfSpineItem[] = [];
	const textEntries: ArchiveTextEntry[] = [];
	const binaryEntries: ArchiveBinaryEntry[] = [];
	const navEntries: NavEntry[] = [];

	let coverImageId: string | undefined;
	if (input.cover) {
		const coverResult = appendCoverAssets({
			cover: input.cover,
			bookTitle,
			language,
			manifest,
			spine,
			textEntries,
			binaryEntries,
		});
		coverImageId = coverResult.coverImageId;
	}

	const { imageHrefBySourceUrl, registeredImages } = registerIllustrations(
		input.illustrations,
	);

	let chapterCounter = 0;
	for (const chapter of input.chapters) {
		chapterCounter += 1;
		const navEntry = appendChapterEntry({
			chapter,
			chapterIndex: chapterCounter,
			language,
			imageHrefBySourceUrl,
			manifest,
			spine,
			textEntries,
		});
		navEntries.push(navEntry);
	}

	for (const image of registeredImages) {
		manifest.push({
			id: image.manifestId,
			href: image.manifestHref,
			mediaType: image.mediaType,
		});
		binaryEntries.push({
			zipPath: image.zipPath,
			data: image.data,
		});
	}

	return packEpubArchive({
		identifier: input.identifier,
		title: bookTitle,
		author: input.author,
		language,
		summary: input.summary,
		genres: input.genres,
		modifiedAt,
		coverImageId,
		manifest,
		spine,
		navEntries,
		textEntries,
		binaryEntries,
	});
}

export function buildNovelEpub(input: NovelEpubInput): Uint8Array {
	const language = input.language?.trim() || DEFAULT_LANGUAGE;
	const modifiedAt = input.modifiedAt ?? new Date();
	const bookTitle = input.title.trim() || "Untitled";

	const manifest = createBaseManifest();
	const spine: OpfSpineItem[] = [];
	const textEntries: ArchiveTextEntry[] = [];
	const binaryEntries: ArchiveBinaryEntry[] = [];
	const navEntries: NavEntry[] = [];
	const coverHrefBySourceUrl = new Map<string, string>();

	let coverImageId: string | undefined;
	if (input.cover) {
		const coverResult = appendCoverAssets({
			cover: input.cover,
			bookTitle,
			language,
			manifest,
			spine,
			textEntries,
			binaryEntries,
		});
		coverImageId = coverResult.coverImageId;
		if (input.cover.sourceUrl) {
			coverHrefBySourceUrl.set(
				input.cover.sourceUrl,
				coverResult.coverRelativeHref,
			);
		}
	}

	const { imageHrefBySourceUrl, registeredImages } = registerIllustrations(
		input.illustrations,
	);

	let volumeCounter = 0;
	let chapterCounter = 0;

	for (const volume of input.volumes) {
		volumeCounter += 1;
		const volPadded = String(volumeCounter).padStart(3, "0");

		let volumeCoverHref: string | undefined;
		if (volume.cover) {
			const existingCoverHref = volume.cover.sourceUrl
				? coverHrefBySourceUrl.get(volume.cover.sourceUrl)
				: undefined;
			if (existingCoverHref !== undefined) {
				volumeCoverHref = existingCoverHref;
			} else {
				const ext = resolveImageExtension(
					volume.cover.mimeType,
					volume.cover.sourceUrl,
				);
				const fileName = `vol-cover-${volPadded}.${ext}`;
				const relHref = `../images/${fileName}`;
				manifest.push({
					id: `vol-cover-${volPadded}`,
					href: `images/${fileName}`,
					mediaType: resolveImageMediaType(volume.cover.mimeType, ext),
				});
				binaryEntries.push({
					zipPath: `OEBPS/images/${fileName}`,
					data: volume.cover.data,
				});
				if (volume.cover.sourceUrl) {
					coverHrefBySourceUrl.set(volume.cover.sourceUrl, relHref);
				}
				volumeCoverHref = relHref;
			}
		}

		const volManifestId = `vol-${volPadded}`;
		const volManifestHref = `text/vol-${volPadded}.xhtml`;
		manifest.push({
			id: volManifestId,
			href: volManifestHref,
			mediaType: "application/xhtml+xml",
		});
		spine.push({ idref: volManifestId });
		textEntries.push({
			zipPath: `OEBPS/${volManifestHref}`,
			content: buildVolumeTitlePageXhtml({
				title: volume.title,
				language,
				coverHref: volumeCoverHref,
			}),
		});

		const volumeNavChildren: NavEntry[] = [];
		for (const chapter of volume.chapters) {
			chapterCounter += 1;
			const chapterNavEntry = appendChapterEntry({
				chapter,
				chapterIndex: chapterCounter,
				language,
				imageHrefBySourceUrl,
				manifest,
				spine,
				textEntries,
			});
			volumeNavChildren.push(chapterNavEntry);
		}

		navEntries.push({
			title: volume.title,
			href: volManifestHref,
			children: volumeNavChildren,
		});
	}

	for (const image of registeredImages) {
		manifest.push({
			id: image.manifestId,
			href: image.manifestHref,
			mediaType: image.mediaType,
		});
		binaryEntries.push({
			zipPath: image.zipPath,
			data: image.data,
		});
	}

	return packEpubArchive({
		identifier: input.identifier,
		title: bookTitle,
		author: input.author,
		language,
		summary: input.summary,
		genres: input.genres,
		modifiedAt,
		coverImageId,
		manifest,
		spine,
		navEntries,
		textEntries,
		binaryEntries,
	});
}
