# @acanthis-dec/core

[中文文档](./README.zh-CN.md) | [Workspace README](../../README.md)

Core shared package for Acanthis. It contains platform-independent content helpers, descrambling utilities, and normalized novel/chapter type definitions used by adapters, storage, and the API server.

## Installation

Workspace usage:

```powershell
pnpm install --frozen-lockfile
pnpm --filter=@acanthis-dec/core run check-types
pnpm --filter=@acanthis-dec/core run build
```

Import from workspace source or the published ESM package:

```ts
import { buildDescrambleMapping, joinChapterHtml, restoreByMapping } from "@acanthis-dec/core";
```

## Usage

```ts
import { buildDescrambleMapping, joinChapterHtml, restoreByMapping } from "@acanthis-dec/core";

const html = joinChapterHtml("Chapter 1", "<p>Hello</p>");

const mapping = buildDescrambleMapping(4, 1234, {
	multiplier: 9301,
	increment: 49297,
	modulus: 233280,
});

const restored = restoreByMapping(["b", "a", "d", "c"], mapping);
```

## API

- `joinChapterHtml(title, bodyHtml)` prepends an optional heading to chapter body HTML.
- `buildDescrambleMapping(length, seed, lcg, offset?)` builds an index mapping from linear-congruential parameters.
- `restoreByMapping(items, mapping)` restores an item array by target index mapping.
- `ContentNode` describes paragraph, image, and raw HTML content nodes.
- `DescrambleCoefficients` and `LcgConfig` describe descrambling parameters.
- `Novel`, `NovelInfo`, `NovelSearchResult`, `NovelStatus`, `Volume`, `Chapter`, and `ChapterContent` describe normalized reading metadata and content.
