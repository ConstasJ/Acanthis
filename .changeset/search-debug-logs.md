---
"@acanthis-dec/api-server": patch
"@acanthis-dec/linovelib": patch
"@acanthis-dec/browser-fetch": patch
---

增强搜索链路容错与去重并补充全链路可观测 debug 日志：

- `@acanthis-dec/api-server`：将 `SearchRateLimitError` / `SearchVerificationError` 映射为 `503 + Retry-After`；为 `/v1/linovelib/search` 增加 `keyword` `trim()` 归一化、同关键词 single-flight 并发合并与 2 分钟空结果内存负缓存；为 `MemoryTtlCache`（`/home`、`/rankings`、`/catalog`）、`/search`、`/novel`、`/chapter`、`/cover`、带 query 的 HTTP 请求以及服务启动生效配置摘要补充 `debug` 日志。
- `@acanthis-dec/linovelib`：将 `logger` 注入 `BrowserFetchClient`、`SearchSession`、登录会话与章节解扰链路；加固搜索翻页上限（15 页）、防死循环保护、瞬断重试与验证码提交后的限流页检测；导出 `SearchRateLimitError` 与 `SearchVerificationError`。
- `@acanthis-dec/browser-fetch`：支持通过 `BrowserFetchClientOptions.logger` 注入可选 logger，记录上游请求耗时/状态、Cloudflare 验证页检测、FlareSolverr 求解耗时与响应复用以及 `pRetry` 重试信息。
