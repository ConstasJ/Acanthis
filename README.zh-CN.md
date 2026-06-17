# Acanthis

[English README](./README.md)

A project that make world more free and better.

Acanthis 是一个 TypeScript ESM monorepo，用来构建一层安静的内容访问能力：像浏览器一样发起请求、把不同来源收束成适配器、在本地持久化缓存，并通过 HTTP API 暴露为可部署服务。它把来源细节藏在包边界之后，对应用侧提供稳定的数据模型和服务接口。

## 包列表

| 包 | 作用 |
| --- | --- |
| [`@acanthis-dec/api-server`](./apps/api-server/README.zh-CN.md) | 基于 Hono 的 HTTP API，连接适配器与本地缓存。 |
| [`@acanthis-dec/browser-fetch`](./packages/browser-fetch/README.zh-CN.md) | 带浏览器画像、Cookie、重试与挑战处理能力的请求客户端。 |
| [`@acanthis-dec/core`](./packages/core/README.zh-CN.md) | 共享内容模型与还原工具。 |
| [`@acanthis-dec/deobfuscator`](./packages/deobfuscator/README.zh-CN.md) | JavaScript 混淆检测与恢复封装。 |
| [`@acanthis-dec/linovelib`](./packages/linovelib/README.zh-CN.md) | 阅读站点适配器，将页面整理为统一小说数据。 |
| [`@acanthis-dec/storage`](./packages/storage/README.zh-CN.md) | SQLite/libSQL 与文件系统持久化，保存缓存、封面、Cookie 与正文。 |

## 安装

```powershell
pnpm install --frozen-lockfile
```

可使用包过滤器进行局部开发：

```powershell
pnpm --filter=@acanthis-dec/api-server run dev
pnpm --filter=@acanthis-dec/browser-fetch run build
pnpm --filter=@acanthis-dec/linovelib run check-types
```

## 用法

从仓库根目录启动 API 服务：

```powershell
pnpm --filter=@acanthis-dec/api-server run dev
```

默认监听 `http://localhost:5301`，API 路由挂载在 `/v1` 下。

也可以在 workspace 消费方中直接使用库包：

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

## API 概览

### HTTP API

API server 在 `/v1/linovelib` 下提供以下路由：

- `GET /chapter/:chapterId` 返回缓存或新获取的章节正文。
- `GET /novel/:novelId?style=raw|simple` 返回统一后的作品元数据。
- `GET /cover/novel/:novelId` 返回缓存或新获取的作品封面二进制内容。
- `GET /cover/volume/:volumeId` 返回缓存或新获取的分卷封面二进制内容。
- `GET /search?keyword=<text>&style=raw|simple` 搜索配置来源并缓存结果。

数据路由返回 JSON envelope：

```json
{
	"code": 0,
	"message": "Success",
	"data": {}
}
```

### 库 API

- `@acanthis-dec/core`：`joinChapterHtml`、`buildDescrambleMapping`、`restoreByMapping` 与共享小说/章节类型。
- `@acanthis-dec/browser-fetch`：`BrowserFetchClient`、Cookie stores、浏览器画像、transport 类型、重试选项与错误类型。
- `@acanthis-dec/linovelib`：`LinovelibClient` 与 `novelIdToCoverUrl`。
- `@acanthis-dec/storage`：`StorageService`、`DatabaseService`、`FSStorageService` 与 `DatabaseCookieStore`。
- `@acanthis-dec/deobfuscator`：`detectObfuscation` 与 `deobfuscate`。

每个包的 README 都包含该包的安装方式、用法示例与导出 API 说明。

## 开发

```powershell
pnpm build
pnpm check-types
pnpm format-and-lint
```

本仓库由 `pnpm@11.6.0` 与 Turbo 管理。库包使用 `tsdown` 构建；API server 使用自定义 esbuild bundle 脚本。
