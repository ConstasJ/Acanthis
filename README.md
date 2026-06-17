# Acanthis

[中文文档](./README.zh-CN.md)

A project that make world more free and better.

Acanthis is a TypeScript ESM monorepo for building a quiet content access layer: browser-shaped fetching, source adapters, local persistence, and an HTTP API that turns those pieces into a deployable service. It keeps source-specific details behind package boundaries while exposing stable data models and service APIs for applications.

## Packages

| Package | Purpose |
| --- | --- |
| [`@acanthis-dec/api-server`](./apps/api-server/README.md) | Hono HTTP API for the supported adapters and local cache. |
| [`@acanthis-dec/browser-fetch`](./packages/browser-fetch/README.md) | Browser-like HTTP client with profiles, cookies, retries, and challenge helpers. |
| [`@acanthis-dec/core`](./packages/core/README.md) | Shared content models and descrambling utilities. |
| [`@acanthis-dec/deobfuscator`](./packages/deobfuscator/README.md) | JavaScript obfuscation detection and recovery wrapper. |
| [`@acanthis-dec/linovelib`](./packages/linovelib/README.md) | Reading-site adapter that turns source pages into normalized novel data. |
| [`@acanthis-dec/storage`](./packages/storage/README.md) | SQLite/libSQL and filesystem persistence for cache, covers, cookies, and content. |

## Installation

```powershell
pnpm install --frozen-lockfile
```

Use package filters for focused work:

```powershell
pnpm --filter=@acanthis-dec/api-server run dev
pnpm --filter=@acanthis-dec/browser-fetch run build
pnpm --filter=@acanthis-dec/linovelib run check-types
```

## Usage

Start the API server from the workspace root:

```powershell
pnpm --filter=@acanthis-dec/api-server run dev
```

The server listens on `http://localhost:5301` by default and mounts API routes under `/v1`.

Use library packages directly in workspace consumers:

```ts
import { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
import { LinovelibClient } from "@acanthis-dec/linovelib";
import { StorageService } from "@acanthis-dec/storage";

const storage = new StorageService({
	db: { path: "data/data.db", migrations: { directory: "migrations" } },
	dataDir: "data",
});

const sourceClient = new LinovelibClient(undefined, storage);
const novel = await sourceClient.getNovelInfo("example-id");

const browser = new BrowserFetchClient();
const page = await browser.text("https://example.com");
```

## API overview

### HTTP API

The API server exposes these routes under `/v1/linovelib`:

- `GET /chapter/:chapterId` returns cached or freshly retrieved chapter content.
- `GET /novel/:novelId?style=raw|simple` returns normalized novel metadata.
- `GET /cover/novel/:novelId` returns a cached or fetched novel cover binary.
- `GET /cover/volume/:volumeId` returns a cached or fetched volume cover binary.
- `GET /search?keyword=<text>&style=raw|simple` searches the configured source and caches results.

Responses use a JSON envelope for data routes:

```json
{
	"code": 0,
	"message": "Success",
	"data": {}
}
```

### Library API

- `@acanthis-dec/core`: `joinChapterHtml`, `buildDescrambleMapping`, `restoreByMapping`, and shared novel/chapter types.
- `@acanthis-dec/browser-fetch`: `BrowserFetchClient`, cookie stores, browser profile definitions, transport types, retry options, and typed errors.
- `@acanthis-dec/linovelib`: `LinovelibClient` and `novelIdToCoverUrl`.
- `@acanthis-dec/storage`: `StorageService`, `DatabaseService`, `FSStorageService`, and `DatabaseCookieStore`.
- `@acanthis-dec/deobfuscator`: `detectObfuscation` and `deobfuscate`.

See each package README for package-level installation notes, usage examples, and exported API details.

## Development

```powershell
pnpm build
pnpm check-types
pnpm format-and-lint
```

The monorepo is managed by `pnpm@11.6.0` and Turbo. Library packages build with `tsdown`; the API server uses a custom esbuild bundle script.
