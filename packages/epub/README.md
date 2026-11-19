# @acanthis-dec/epub

[中文文档](./README.zh-CN.md) | [Workspace README](../../README.md)

Platform-independent, zero-Node in-memory EPUB 3.0 builder for Acanthis. It converts light novel metadata, sanitized chapter HTML, covers, and deduplicated illustrations into standard EPUB 3.0 archives (with EPUB 2 NCX and cover metadata compatibility) as pure `Uint8Array` buffers suitable for Node.js, Bun, browsers, and Web Workers.

## Runtime Compatibility Guarantee

- **Zero Node.js APIs**: No `node:*` imports and no global `Buffer` usage anywhere in the package.
- **Compile-time & Bundle Guards**: Built with `tsdown` (`platform: "neutral"`) and compiled with TypeScript `"types": []` (without `@types/node`), making it safe for browser Web Workers without Node polyfills.
- **EPUB 3.0 Archive Standards**: Always places uncompressed `mimetype` (`application/epub+zip`, `{ level: 0 }`) as the first ZIP entry, decodes HTML named entities to UTF-8, normalizes leading chapter headings, strips dangerous tags/attributes, deduplicates illustrations by `sourceUrl`, and replaces missing images with `<p class="image-placeholder">[插图未包含]</p>`.

## Installation

Workspace usage:

```powershell
pnpm install --frozen-lockfile
pnpm --filter=@acanthis-dec/epub run check-types
pnpm --filter=@acanthis-dec/epub run build
```

Import from workspace source or the published ESM package:

```ts
import {
	buildNovelEpub,
	buildVolumeEpub,
	type EpubChapterData,
	type EpubImageAsset,
	type EpubVolumeData,
	type NovelEpubInput,
	type VolumeEpubInput,
} from "@acanthis-dec/epub";
```

## Usage

### Single-Volume EPUB (`buildVolumeEpub`)

```ts
import { buildVolumeEpub } from "@acanthis-dec/epub";

const epubBytes = buildVolumeEpub({
	identifier: "urn:acanthis:linovelib:3590:vol:101",
	novelTitle: "Example Novel",
	volumeTitle: "Volume 1",
	author: "Example Author",
	language: "zh-CN",
	cover: {
		sourceUrl: "https://example.invalid/cover.jpg",
		data: coverUint8Array,
		mimeType: "image/jpeg",
	},
	chapters: [
		{
			id: "1001",
			title: "Chapter 1",
			html: "<p>Hello&nbsp;World</p>",
		},
	],
	illustrations: [],
});
```

### Multi-Volume Novel EPUB (`buildNovelEpub`)

```ts
import { buildNovelEpub } from "@acanthis-dec/epub";

const epubBytes = buildNovelEpub({
	identifier: "urn:acanthis:linovelib:3590",
	title: "Example Novel",
	author: "Example Author",
	volumes: [
		{
			id: "101",
			title: "Volume 1",
			chapters: [
				{
					id: "1001",
					title: "Chapter 1",
					html: '<p>Scene</p><img src="https://example.invalid/img-1.png" />',
				},
			],
		},
	],
	illustrations: [
		{
			sourceUrl: "https://example.invalid/img-1.png",
			data: imageUint8Array,
			mimeType: "image/png",
		},
	],
});
```

## API

### Functions

- `buildVolumeEpub(input: VolumeEpubInput): Uint8Array` — Builds a single-volume EPUB 3.0 archive with a 1-level navigation tree (`nav.xhtml` + `toc.ncx`).
- `buildNovelEpub(input: NovelEpubInput): Uint8Array` — Builds a multi-volume EPUB 3.0 archive with volume title pages (`OEBPS/text/vol-XXX.xhtml`), deduplicated volume covers, and a 2-level nested navigation tree.

### Types

- `EpubImageAsset` — `{ sourceUrl: string; data: Uint8Array; mimeType: string }` representing a cover or illustration binary keyed by its HTML `src` / source URL.
- `EpubChapterData` — `{ id: string; title: string; html: string }` representing a single chapter's metadata and HTML content.
- `EpubVolumeData` — `{ id: string; title: string; cover?: EpubImageAsset | undefined; chapters: EpubChapterData[] }` representing a volume within a multi-volume EPUB.
- `VolumeEpubInput` — Input payload for `buildVolumeEpub` (`identifier`, `novelTitle`, `volumeTitle`, `author`, optional `language`, `summary`, `genres`, `modifiedAt`, `cover`, plus `chapters` and `illustrations`).
- `NovelEpubInput` — Input payload for `buildNovelEpub` (`identifier`, `title`, `author`, optional `language`, `summary`, `genres`, `modifiedAt`, `cover`, plus `volumes` and `illustrations`).
