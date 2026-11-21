---
"@acanthis-dec/api-server": patch
---

修复 Scalar 文档页面 Server 栏显示 `..` 且请求拼接出 `/../v1/` 的问题：将静态契约 `servers` 恢复为 `/`，并在运行时 `GET /v1/openapi.json` 中通过 `resolveHost` 动态填充完整对外访问地址（兼容子目录反代）。
