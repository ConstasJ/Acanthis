# @acanthis-dec/browser-fetch

## 1.1.7

### Patch Changes

- bd1db4a: 增强搜索链路容错与去重并补充全链路可观测 debug 日志：
  
  - `@acanthis-dec/api-server`：将 `SearchRateLimitError` / `SearchVerificationError` 映射为 `503 + Retry-After`；为 `/v1/linovelib/search` 增加 `keyword` `trim()` 归一化、同关键词 single-flight 并发合并与 2 分钟空结果内存负缓存；为 `MemoryTtlCache`（`/home`、`/rankings`、`/catalog`）、`/search`、`/novel`、`/chapter`、`/cover`、带 query 的 HTTP 请求以及服务启动生效配置摘要补充 `debug` 日志。
  - `@acanthis-dec/linovelib`：将 `logger` 注入 `BrowserFetchClient`、`SearchSession`、登录会话与章节解扰链路；加固搜索翻页上限（15 页）、防死循环保护、瞬断重试与验证码提交后的限流页检测；导出 `SearchRateLimitError` 与 `SearchVerificationError`。
  - `@acanthis-dec/browser-fetch`：支持通过 `BrowserFetchClientOptions.logger` 注入可选 logger，记录上游请求耗时/状态、Cloudflare 验证页检测、FlareSolverr 求解耗时与响应复用以及 `pRetry` 重试信息。

## 1.1.6

### Patch Changes

- 3af0894: 新增 OpenAPI 3.1 契约端点（`/v1/openapi.json`）、Scalar 交互式文档页面（`/v1/docs`）、`docs.enabled` / `DOCS_ENABLED` 文档开关，以及离线契约生成与防漂移校验脚本；同时将 `@acanthis-dec/browser-fetch` 的 `impers` 改为首次请求时延迟加载，消除顶层导入原生库与网络下载副作用。

## 1.1.5

### Patch Changes

- 728d7cd: FlareSolverr 自动解盾成功后，对非二进制的 2xx 文本与 JSON 响应直接复用返回的 `solution.response`（同时照常持久化 `cf_clearance`），避免在宿主与容器出口 IP 不一致或漂移时因重放再次触发 Cloudflare 403 拦截。

## 1.1.4

### Patch Changes

- 986b128: 修复插图与封面回源请求在传输停滞时长时间卡死队列的问题：修正 `ImpersTransport` 向 `impers` 传递 `timeout`/`connectTimeout` 的毫秒与秒单位错配（原会导致超时被放大 1000 倍至 8.33 小时），补充 `TCP_KEEPALIVE`、低速停滞检测、JS 兜底超时、损坏会话回收与瞬态 `CurlError` 映射，加固 `FlareSolverrClient` 请求超时；为 `NovelMediaQueue` 补充显式超时、网络重试上限与全生命周期调试日志；在 API Server 中将上游 `NetworkError` 映射为 `502`/`504`（带 `Cache-Control: no-store`）并补充插图回源调试日志

## 1.1.3

### Patch Changes

- 6716664: 完善插图与封面抓取链路的 Cloudflare 拦截处理：`browser-fetch` 在未启用 FlareSolverr 或重复挑战时统一抛出 `CloudflareBlockError`；`linovelib` 新增 `NovelMediaQueue` 提供串行限速、共享冷却、同 URL 去重、标准图片请求头及 Cloudflare 阶梯退避重试并合并并发会话校验；`api-server` 为 `/illustration/:hash` 增加单飞缓存合并并将 `CloudflareBlockError`/`FlareSolverrError`/`404`/`5xx` 映射为带 `Cache-Control: no-store` 与 `Retry-After` 的规范 HTTP 状态码

## 1.1.2

### Patch Changes

- 2b43002: 修复 FileCookiesStore 从不持久化的问题：改为懒加载磁盘文件，并在写入/删除/清空后自动落盘，读取时恢复时间字段的 Date 类型

## 1.1.1

### Patch Changes

- e5ea7d6: - 修复了 expires 和 maxAge 无法正确透传到上层 cookieStore 的问题
  - 添加了处理 maxAge 为 0 或负数的逻辑，确保在这种情况下不会将 cookie 存储到 cookieStore 中

## 1.1.0

### Minor Changes

- 8949718: 实现了若干个实用工具

### Patch Changes

- 2c8596b: 修正了 Chrome 150 不正确的 Sec-Ch-Ua 标头

## 1.0.4

### Patch Changes

- 7c60833: 新增了 Chrome 150 的 porfile，同时重构了 profile 体系

## 1.0.3

### Patch Changes

- 10ea62d: 修复了 detectCFBlock 和 pRetry 的重试回调中的几个问题
  - detectCFBlock 中加入了对 429 的检测，确保在 Cloudflare 的速率限制下也能正确识别被封锁的情况
  - pRetry 的三个回调（onFailedAttempt、onFailedAttemptAsync、onRetry）全部改为 async 包装，确保在回调中进行异步操作时能够正确等待，避免出现“非预期并发”行为

## 1.0.2

### Patch Changes

- 51130dc: Fix published `types` metadata to point at generated declaration files.

## 1.0.1

### Patch Changes

- build(npm): 为 package.json 添加 types 字段，确保 npm 可以正确识别出这是一个有类型声明的包

## 1.0.0

### Major Changes

- 初次发版，基本完成了首次重构，真不容易
