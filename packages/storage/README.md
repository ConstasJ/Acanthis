# @acanthis-dec/storage

[中文文档](./README.zh-CN.md) | [Workspace README](../../README.md)

Persistence package for Acanthis. It combines SQLite/libSQL access, Drizzle migrations, filesystem storage, cache records, cover data, normalized metadata, and database-backed cookies.

## Installation

Workspace usage:

```powershell
pnpm install --frozen-lockfile
pnpm --filter=@acanthis-dec/storage run check-types
pnpm --filter=@acanthis-dec/storage run build
```

Import from workspace source or the published ESM package:

```ts
import { StorageService } from "@acanthis-dec/storage";
```

## Usage

```ts
import { StorageService } from "@acanthis-dec/storage";

const storage = new StorageService({
	dataDir: "data",
	db: {
		path: "data/data.db",
		migrations: { directory: "migrations" },
	},
});

const hash = await storage.setNovelContent("<p>Hello</p>");
const content = await storage.getNovelContent(hash);
const cookieStore = storage.getCookieStore();

await storage.close();
```

## API

### `StorageService`

- `getNovelContent(hash)` and `setNovelContent(content)` read and write content files by hash.
- `getCoverData(type, platform, platformId)` and `setCoverData(...)` manage cover binaries.
- `addSearchResult(keyword, platform, results)` and `searchNovels(keyword, platform)` cache search results.
- `getNovelCache(platform, platformId)` and `addNovelCache(novel)` manage normalized novel metadata.
- `getVolumeMeta(platform, platformId)` reads volume metadata.
- `getChapterFromTitle(title)` and `getChapterFromId(platform, platformId)` read chapter metadata.
- `addNovelContentHash(platform, chapterId, contentHash)` links chapter metadata to stored content.
- `getCookieStore()` returns a database-backed cookie store for browser-fetch integration.
- `getCache(key, schema)` and `setCache(key, value)` store typed small cache entries.
- `close(logger?)` closes the database connection.

### Other exports

- `DatabaseService` and `DatabaseOptions` for lower-level database access.
- `FSStorageService` for filesystem-backed content and cover storage.
- `DatabaseCookieStore` for cookie persistence.

Keep `migrations/` aligned with database schema changes because the API server Docker image copies those migration files at runtime.
