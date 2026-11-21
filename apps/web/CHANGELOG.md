# @acanthis-dec/web

## 0.3.0

### Minor Changes

- 70f4f56: 新增图书馆阅读历史、多对多自定义多书架与元数据标签筛选能力：
  
  - **阅读历史（LNReader 风格）**：扩展同步协议 `ReadingProgress.historyHiddenAt`（独立 max-wins 合并），Web 端新增「历史」一级导航与历史记录页，支持按自然日分组、实时搜索、一键继续阅读、单条删除与二次确认清空并跨端同步。
  - **多对多自定义多书架**：新增 `bookshelf_categories` 表与同步实体，支持自定义书架的新建、重命名、排序与软删除（不删书、自动回落「默认」），支持一本书同时归属多个书架。
  - **元数据标签与状态筛选**：书架条目同步补全 `genres` 与 `status` 快照支持离线组合筛选；新增 `GET /v1/linovelib/genres` 并扩展 `GET /v1/linovelib/novels` 支持 `genres`（AND 交集）、`status`、`q` 筛选；作品详情页标签支持点击跳转书架筛选并可直达服务器缓存查看。

### Patch Changes

- Updated dependencies [70f4f56]
  - @acanthis-dec/core@1.4.0

## 0.2.0

### Minor Changes

- e33a4c1: 新增桌面端源站发现能力（全站首页、16 个出版社文库专题、13 个排行榜含完本榜与 7 维书库筛选），并升级 Web 端发现页为 Schema 驱动的四视图浏览体验。

### Patch Changes

- Updated dependencies [e33a4c1]
  - @acanthis-dec/core@1.3.0

## 0.1.1

### Patch Changes

- a7db5c2: 为 API Server 新增免鉴权健康检查端点 `/v1/health`，并为 Web 入口页补充标准页面描述 meta 标签。

## 0.1.0

### Minor Changes

- 125e219: 首次发布本地优先在线阅读 PWA 客户端 `@acanthis-dec/web`：基于 Vue 3 + Vite + Pinia + Tailwind CSS v4 构建，支持书架/发现/详情/设置三栏响应式导航、IndexedDB 200 章离线缓存与跨设备增量 LWW 同步、基于 `DOMPurify` 安全净化的上下滚动/左右翻页无损切换阅读器、Web Worker 浏览器直出 EPUB，以及阿里云 ESA / Cloudflare / Vercel / Nginx Docker 多形态部署

### Patch Changes

- Updated dependencies [125e219]
- Updated dependencies [125e219]
- Updated dependencies [125e219]
  - @acanthis-dec/core@1.2.0
  - @acanthis-dec/epub@0.1.0
