---
"@acanthis-dec/cli": minor
---

优化 CLI 导出目录行为：`outputDir`（默认 `.`）作为输出基目录，支持相对路径与 `~` 主目录展开，并在 `split` 与 `merged` 模式下默认在基目录下以清洗后的纯书名自动创建子目录；新增 `--no-subdir` 选项支持平铺输出至基目录，同时在 `ExportSummary` 中返回实际解析后的 `outputDir`
