# @acanthis-dec/linovelib

[English README](./README.md) | [工作区 README](../../README.zh-CN.md)

Acanthis 面向某个具名阅读来源的适配器。它把来源侧的导航、会话、解析、队列和内容还原细节收在 `LinovelibClient` 后面，再向系统其他部分返回统一的作品元数据、搜索结果、封面与章节 HTML。

这里刻意把它描述为适配器，而不是来源地图。它的职责是让项目更自由、更好，同时让喧闹的细节保持安静。

## 安装

工作区内使用：

```powershell
pnpm install --frozen-lockfile
pnpm --filter=@acanthis-dec/linovelib run check-types
pnpm --filter=@acanthis-dec/linovelib run build
```

从 workspace 源码或发布后的 ESM 包导入：

```ts
import { LinovelibClient, novelIdToCoverUrl } from "@acanthis-dec/linovelib";
```

## 用法

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
		impersonate: { enabled: true, profile: "chrome149-linux" },
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

- `new LinovelibClient(options?, storage?, logger?)` 创建适配器客户端。
- `getNovelInfo(id)` 返回统一作品元数据。
- `getNovelUpdateInfo(id)` 返回轻量更新信息，用于缓存新鲜度判断。
- `searchNovels(keyword)` 返回统一搜索结果。
- `getNovelCover(novelId)` 根据作品 id 解析并获取封面。
- `getCover(url)` 根据封面 URL 获取二进制封面数据。
- `getChapter(novelId, chapterId)` 返回还原后的章节 HTML；存在 storage 时缓存还原参数。

### 选项

- `session`：默认关闭；启用时提供用户名与密码，用于需要已知会话的流程。
- `flareSolverr`：默认启用，默认地址为 `http://localhost:8191`。
- `impersonate`：默认启用，默认画像为 `chrome149-linux`。
- `cookies`：支持 `memory`、`file`、`database`；database Cookie 需要 `StorageService`。
- `proxy`：可选 HTTP(S) 代理地址。

### 辅助方法

- `novelIdToCoverUrl(novelId)` 根据作品 id 构造来源封面 URL。
