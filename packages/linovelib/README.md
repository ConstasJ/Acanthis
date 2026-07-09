# @acanthis-dec/linovelib

[中文文档](./README.zh-CN.md) | [Workspace README](../../README.md)

Acanthis adapter for a named reading source. It keeps the source-specific navigation, session, parsing, queueing, and content restoration details behind a `LinovelibClient`, then returns normalized novel metadata, search results, covers, and chapter HTML to the rest of the system.

The package is intentionally described as an adapter rather than a public map of the source. Its role is to make the wider project more free and better while keeping the noisy details quiet.

## Installation

Workspace usage:

```powershell
pnpm install --frozen-lockfile
pnpm --filter=@acanthis-dec/linovelib run check-types
pnpm --filter=@acanthis-dec/linovelib run build
```

Import from workspace source or the published ESM package:

```ts
import { LinovelibClient, novelIdToCoverUrl } from "@acanthis-dec/linovelib";
```

## Usage

```ts
import { LinovelibClient } from "@acanthis-dec/linovelib";
import { StorageService } from "@acanthis-dec/storage";

const storage = new StorageService({
	db: { path: "data/data.db", migrations: { directory: "migrations" } },
	dataDir: "data",
});

const client = new LinovelibClient(
	{
		session: { enabled: false },
		flareSolverr: {
			enabled: true,
			host: "http://localhost:8191",
			timeoutMs: 60_000,
			sessionId: "acanthis-linovelib-client",
		},
		impersonate: { enabled: true, profile: "chrome-latest-linux" },
		cookies: { type: "database" },
	},
	storage,
);

const results = await client.searchNovels("keyword");
const novel = await client.getNovelInfo("example-id");
const chapterHtml = await client.getChapter("example-novel-id", "example-chapter-id");
```

## API

### `LinovelibClient`

- `new LinovelibClient(options?, storage?, logger?)` creates the adapter client.
- `getNovelInfo(id)` returns normalized novel metadata.
- `getNovelUpdateInfo(id)` returns lightweight update metadata used for cache freshness checks.
- `searchNovels(keyword)` returns normalized search results.
- `getNovelCover(novelId)` resolves and fetches a cover by novel id.
- `getCover(url)` fetches binary cover data from a direct cover URL.
- `getChapter(novelId, chapterId)` returns restored chapter HTML and caches restoration parameters when storage is available.

### Options

- `session`: disabled by default; when enabled, provide username and password for flows that need a known session.
- `flareSolverr`: enabled by default with `http://localhost:8191`.
- `impersonate`: enabled by default with `chrome-latest-linux`.
- `cookies`: `memory`, `file`, or `database`; database cookies require `StorageService`.
- `proxy`: optional HTTP(S) proxy URL.

### Helpers

- `novelIdToCoverUrl(novelId)` builds a source cover URL from a novel id.
