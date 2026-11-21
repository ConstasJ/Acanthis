---
"@acanthis-dec/api-server": patch
---

修复 API Server 反向代理部署在子目录时 Scalar 文档页无法拉取 OpenAPI Spec 及在线调试丢失子目录前缀的问题（将 `scalarConfig.url` 改为 `./openapi.json`，`servers[0].url` 改为 `..`）。
