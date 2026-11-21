---
"@acanthis-dec/api-server": patch
---

为 api-server Docker 镜像添加基于 `/v1/health` 的 `HEALTHCHECK`，使用内置 Node `fetch` 探活并自动适配 `PORT` 与 `LISTEN_HOST` 环境变量。
