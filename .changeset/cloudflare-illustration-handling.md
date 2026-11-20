---
"@acanthis-dec/browser-fetch": patch
"@acanthis-dec/linovelib": patch
"@acanthis-dec/api-server": patch
---

完善插图与封面抓取链路的 Cloudflare 拦截处理：`browser-fetch` 在未启用 FlareSolverr 或重复挑战时统一抛出 `CloudflareBlockError`；`linovelib` 新增 `NovelMediaQueue` 提供串行限速、共享冷却、同 URL 去重、标准图片请求头及 Cloudflare 阶梯退避重试并合并并发会话校验；`api-server` 为 `/illustration/:hash` 增加单飞缓存合并并将 `CloudflareBlockError`/`FlareSolverrError`/`404`/`5xx` 映射为带 `Cache-Control: no-store` 与 `Retry-After` 的规范 HTTP 状态码
