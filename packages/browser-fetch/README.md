# @acanthis-dec/browser-fetch

[中文文档](./README.zh-CN.md) | [Workspace README](../../README.md)

Browser-shaped fetch client for Acanthis. It combines browser profiles, cookie stores, retries, transport configuration, optional FlareSolverr integration, and typed response helpers.

## Installation

Workspace usage:

```powershell
pnpm install --frozen-lockfile
```

Package checks:

```powershell
pnpm --filter=@acanthis-dec/browser-fetch run check-types
pnpm --filter=@acanthis-dec/browser-fetch run build
```

Published consumers import the built ESM package after release:

```ts
import { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
```

## Usage

```ts
import { BrowserFetchClient, FileCookiesStore } from "@acanthis-dec/browser-fetch";

const client = new BrowserFetchClient({
	profile: "chrome-latest-linux",
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

- `request(init)` executes a typed browser-like request.
- `text(url, options?)` returns `{ data, mimeType }` for text content.
- `json<T>(url, options?, schema?)` parses JSON and optionally validates it with Zod.
- `binary(url, options?)` returns `{ data, mimeType }` for binary content.
- `ensureClearance(url, method, body?)` obtains a clearance cookie when missing.
- `refreshClearance(url, method, body?)` refreshes clearance explicitly.
- `getCookies(url)`, `setCookies(cookies)`, and `clearCookies(url)` manage cookies.
- `close()` closes the underlying transport.

### Cookie stores

Exports include `InMemoryCookiesStore`, `FileCookiesStore`, cookie conversion helpers, matching helpers, and cookie-store types. Custom stores can be supplied through `cookieStore: { type: "custom", store }`.

### Browser profiles and transport types

Exports include `browserProfileNames`, `browserProfiles`, `BrowserProfileName`, transport request/session/TLS types, retry options, response types, and error classes such as `CloudflareBlockError`, `FlareSolverrError`, `HttpStatusError`, and `NetworkError`.
