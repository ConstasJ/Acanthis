---
"@acanthis-dec/api-server": patch
---

请求日志中间件跳过 `/v1/health` 路径，避免容器健康检查探针周期性刷屏日志。
