---
"@acanthis-dec/api-server": minor
"@acanthis-dec/browser-fetch": patch
---

新增 OpenAPI 3.1 契约端点（`/v1/openapi.json`）、Scalar 交互式文档页面（`/v1/docs`）、`docs.enabled` / `DOCS_ENABLED` 文档开关，以及离线契约生成与防漂移校验脚本；同时将 `@acanthis-dec/browser-fetch` 的 `impers` 改为首次请求时延迟加载，消除顶层导入原生库与网络下载副作用。
