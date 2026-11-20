---
"@acanthis-dec/browser-fetch": patch
"@acanthis-dec/linovelib": patch
"@acanthis-dec/api-server": patch
---

修复插图与封面回源请求在传输停滞时长时间卡死队列的问题：修正 `ImpersTransport` 向 `impers` 传递 `timeout`/`connectTimeout` 的毫秒与秒单位错配（原会导致超时被放大 1000 倍至 8.33 小时），补充 `TCP_KEEPALIVE`、低速停滞检测、JS 兜底超时、损坏会话回收与瞬态 `CurlError` 映射，加固 `FlareSolverrClient` 请求超时；为 `NovelMediaQueue` 补充显式超时、网络重试上限与全生命周期调试日志；在 API Server 中将上游 `NetworkError` 映射为 `502`/`504`（带 `Cache-Control: no-store`）并补充插图回源调试日志
