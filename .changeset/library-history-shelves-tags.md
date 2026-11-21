---
"@acanthis-dec/core": minor
"@acanthis-dec/storage": minor
"@acanthis-dec/api-server": minor
"@acanthis-dec/web": minor
---

新增图书馆阅读历史、多对多自定义多书架与元数据标签筛选能力：

- **阅读历史（LNReader 风格）**：扩展同步协议 `ReadingProgress.historyHiddenAt`（独立 max-wins 合并），Web 端新增「历史」一级导航与历史记录页，支持按自然日分组、实时搜索、一键继续阅读、单条删除与二次确认清空并跨端同步。
- **多对多自定义多书架**：新增 `bookshelf_categories` 表与同步实体，支持自定义书架的新建、重命名、排序与软删除（不删书、自动回落「默认」），支持一本书同时归属多个书架。
- **元数据标签与状态筛选**：书架条目同步补全 `genres` 与 `status` 快照支持离线组合筛选；新增 `GET /v1/linovelib/genres` 并扩展 `GET /v1/linovelib/novels` 支持 `genres`（AND 交集）、`status`、`q` 筛选；作品详情页标签支持点击跳转书架筛选并可直达服务器缓存查看。
