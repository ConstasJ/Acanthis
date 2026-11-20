# @acanthis-dec/web

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
