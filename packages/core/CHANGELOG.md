# @acanthis-dec/core

## 1.4.1

### Patch Changes

- b2c6329: 阅读进度同步新增 `deviceKind`（`desktop` / `mobile` / `unknown`）设备种类字段与数据库迁移，Web 端历史记录、继续阅读与跨设备进度提示按设备操作系统种类显示 PC 或移动设备图标。

## 1.4.0

### Minor Changes

- 70f4f56: 新增图书馆阅读历史、多对多自定义多书架与元数据标签筛选能力：
  - **阅读历史（LNReader 风格）**：扩展同步协议 `ReadingProgress.historyHiddenAt`（独立 max-wins 合并），Web 端新增「历史」一级导航与历史记录页，支持按自然日分组、实时搜索、一键继续阅读、单条删除与二次确认清空并跨端同步。
  - **多对多自定义多书架**：新增 `bookshelf_categories` 表与同步实体，支持自定义书架的新建、重命名、排序与软删除（不删书、自动回落「默认」），支持一本书同时归属多个书架。
  - **元数据标签与状态筛选**：书架条目同步补全 `genres` 与 `status` 快照支持离线组合筛选；新增 `GET /v1/linovelib/genres` 并扩展 `GET /v1/linovelib/novels` 支持 `genres`（AND 交集）、`status`、`q` 筛选；作品详情页标签支持点击跳转书架筛选并可直达服务器缓存查看。

## 1.3.0

### Minor Changes

- e33a4c1: 新增桌面端源站发现能力（全站首页、16 个出版社文库专题、13 个排行榜含完本榜与 7 维书库筛选），并升级 Web 端发现页为 Schema 驱动的四视图浏览体验。

## 1.2.0

### Minor Changes

- 125e219: 新增跨设备书架与阅读进度同步底座：补充 `BookshelfItem` 与 `ReadingProgress` 共享类型、SQLite 同步数据表与 Drizzle 增量迁移、基于客户端 `updatedAt` 时钟钳制 LWW 与服务端单调游标 `serverUpdatedAt` 的软删除合并逻辑，以及受鉴权保护的 `GET/POST /v1/sync/state` 接口
- 125e219: 补齐多端底座能力：新增书源能力描述与 `/v1/sources` 发现接口、CORS 与可选 `AUTH_TOKEN` Bearer 鉴权、章节插图提取重写与封闭式磁盘缓存代理 `/v1/linovelib/illustration/:hash`、书库分页 `/v1/linovelib/novels`、章节直链 `?novelId=` 兜底、目录隐藏章节 ID 双向推导与事务残留清理，并修复已缓存作品离线降级与冷库迁移初始化竞态问题

## 1.1.0

### Minor Changes

- 8949718: 实现了若干个实用工具

## 1.0.2

### Patch Changes

- 51130dc: Fix published `types` metadata to point at generated declaration files.

## 1.0.1

### Patch Changes

- build(npm): 为 package.json 添加 types 字段，确保 npm 可以正确识别出这是一个有类型声明的包

## 1.0.0

### Major Changes

- 初次发版，基本完成了首次重构，真不容易
