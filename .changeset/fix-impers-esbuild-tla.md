---
"@acanthis-dec/api-server": patch
---

修复 `api-server` 使用 esbuild 单文件打包动态导入 `impers` 时丢失顶层 `await` 导致运行时报错 `this.impers.Session is not a constructor` 的问题。
