# @acanthis-dec/browser-fetch

[English README](./README.md) | [工作区 README](../../README.zh-CN.md)

Acanthis 的浏览器形态请求客户端。它组合了浏览器画像、Cookie 存储、重试、transport 配置、可选 FlareSolverr 集成和类型化响应辅助方法。

## 安装

工作区内使用：

```powershell
pnpm install --frozen-lockfile
```

包级检查：

```powershell
pnpm --filter=@acanthis-dec/browser-fetch run check-types
pnpm --filter=@acanthis-dec/browser-fetch run build
```

发布后消费者可导入构建产物：

```ts
import { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
```

## 用法

```ts
import { BrowserFetchClient, FileCookiesStore } from "@acanthis-dec/browser-fetch";

const client = new BrowserFetchClient({
	profile: "chrome149-linux",
	cookieStore: { type: "file", path: "cookies.json" },
	flareSolverr: {
		enabled: true,
		host: "http://localhost:8191",
		timeoutMs: 60_000,
		sessionId: "acanthis-browser-fetch",
	},
});

const html = await client.text("https://example.com");
const data = await client.json<{ ok: boolean }>("https://example.com/api");
const image = await client.binary("https://example.com/image.png");

await client.close();
```

## API

### `BrowserFetchClient`

- `request(init)` 执行类型化的浏览器形态请求。
- `text(url, options?)` 返回文本内容的 `{ data, mimeType }`。
- `json<T>(url, options?, schema?)` 解析 JSON，并可用 Zod schema 校验。
- `binary(url, options?)` 返回二进制内容的 `{ data, mimeType }`。
- `ensureClearance(url, method, body?)` 在缺少 clearance cookie 时获取它。
- `refreshClearance(url, method, body?)` 主动刷新 clearance。
- `getCookies(url)`、`setCookies(cookies)`、`clearCookies(url)` 管理 Cookie。
- `close()` 关闭底层 transport。

### Cookie stores

导出包括 `InMemoryCookiesStore`、`FileCookiesStore`、Cookie 转换工具、匹配工具和 Cookie store 类型。也可通过 `cookieStore: { type: "custom", store }` 传入自定义 store。

### 浏览器画像与 transport 类型

导出包括 `browserProfileNames`、`browserProfiles`、`BrowserProfileName`、transport 请求/会话/TLS 类型、重试选项、响应类型，以及 `CloudflareBlockError`、`FlareSolverrError`、`HttpStatusError`、`NetworkError` 等错误类型。
