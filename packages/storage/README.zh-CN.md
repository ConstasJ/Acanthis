# @acanthis-dec/storage

[English README](./README.md) | [工作区 README](../../README.zh-CN.md)

Acanthis 的持久化包。它组合 SQLite/libSQL 访问、Drizzle migration、文件系统存储、缓存记录、封面数据、统一元数据和数据库 Cookie 存储。

## 安装

工作区内使用：

```powershell
pnpm install --frozen-lockfile
pnpm --filter=@acanthis-dec/storage run check-types
pnpm --filter=@acanthis-dec/storage run build
```

从 workspace 源码或发布后的 ESM 包导入：

```ts
import { StorageService } from "@acanthis-dec/storage";
```

## 用法

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

- `getNovelContent(hash)` 与 `setNovelContent(content)` 按 hash 读写正文文件。
- `getCoverData(type, platform, platformId)` 与 `setCoverData(...)` 管理封面二进制数据。
- `addSearchResult(keyword, platform, results)` 与 `searchNovels(keyword, platform)` 缓存搜索结果。
- `getNovelCache(platform, platformId)` 与 `addNovelCache(novel)` 管理统一作品元数据。
- `getVolumeMeta(platform, platformId)` 读取分卷元数据。
- `getChapterFromTitle(title)` 与 `getChapterFromId(platform, platformId)` 读取章节元数据。
- `addNovelContentHash(platform, chapterId, contentHash)` 将章节元数据关联到已保存正文。
- `getCookieStore()` 返回供 browser-fetch 集成的数据库 Cookie store。
- `getCache(key, schema)` 与 `setCache(key, value)` 存取带类型校验的小型缓存项。
- `close(logger?)` 关闭数据库连接。

### 其他导出

- `DatabaseService` 与 `DatabaseOptions` 用于较底层的数据库访问。
- `FSStorageService` 用于文件系统正文与封面存储。
- `DatabaseCookieStore` 用于 Cookie 持久化。

数据库 schema 变更时需保持 `migrations/` 同步，因为 API server Docker 镜像会在运行时复制这些 migration 文件。
