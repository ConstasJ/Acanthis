# @acanthis-dec/storage

## 1.2.0

### Minor Changes

- 70f4f56: 新增图书馆阅读历史、多对多自定义多书架与元数据标签筛选能力：
  
  - **阅读历史（LNReader 风格）**：扩展同步协议 `ReadingProgress.historyHiddenAt`（独立 max-wins 合并），Web 端新增「历史」一级导航与历史记录页，支持按自然日分组、实时搜索、一键继续阅读、单条删除与二次确认清空并跨端同步。
  - **多对多自定义多书架**：新增 `bookshelf_categories` 表与同步实体，支持自定义书架的新建、重命名、排序与软删除（不删书、自动回落「默认」），支持一本书同时归属多个书架。
  - **元数据标签与状态筛选**：书架条目同步补全 `genres` 与 `status` 快照支持离线组合筛选；新增 `GET /v1/linovelib/genres` 并扩展 `GET /v1/linovelib/novels` 支持 `genres`（AND 交集）、`status`、`q` 筛选；作品详情页标签支持点击跳转书架筛选并可直达服务器缓存查看。

### Patch Changes

- Updated dependencies [70f4f56]
  - @acanthis-dec/core@1.4.0

## 1.1.5

### Patch Changes

- Updated dependencies [3af0894]
  - @acanthis-dec/browser-fetch@1.1.6

## 1.1.4

### Patch Changes

- Updated dependencies [728d7cd]
  - @acanthis-dec/browser-fetch@1.1.5

## 1.1.3

### Patch Changes

- Updated dependencies [e33a4c1]
  - @acanthis-dec/core@1.3.0

## 1.1.2

### Patch Changes

- Updated dependencies [986b128]
  - @acanthis-dec/browser-fetch@1.1.4

## 1.1.1

### Patch Changes

- Updated dependencies [6716664]
  - @acanthis-dec/browser-fetch@1.1.3

## 1.1.0

### Minor Changes

- 125e219: 新增跨设备书架与阅读进度同步底座：补充 `BookshelfItem` 与 `ReadingProgress` 共享类型、SQLite 同步数据表与 Drizzle 增量迁移、基于客户端 `updatedAt` 时钟钳制 LWW 与服务端单调游标 `serverUpdatedAt` 的软删除合并逻辑，以及受鉴权保护的 `GET/POST /v1/sync/state` 接口
- 125e219: 补齐多端底座能力：新增书源能力描述与 `/v1/sources` 发现接口、CORS 与可选 `AUTH_TOKEN` Bearer 鉴权、章节插图提取重写与封闭式磁盘缓存代理 `/v1/linovelib/illustration/:hash`、书库分页 `/v1/linovelib/novels`、章节直链 `?novelId=` 兜底、目录隐藏章节 ID 双向推导与事务残留清理，并修复已缓存作品离线降级与冷库迁移初始化竞态问题

### Patch Changes

- Updated dependencies [125e219]
- Updated dependencies [125e219]
  - @acanthis-dec/core@1.2.0

## 1.0.8

### Patch Changes

- Updated dependencies [2b43002]
  - @acanthis-dec/browser-fetch@1.1.2

## 1.0.7

### Patch Changes

- 8654d2b: 修复了 filter 时 now 可能引用过期数据的问题
- Updated dependencies [e5ea7d6]
  - @acanthis-dec/browser-fetch@1.1.1

## 1.0.6

### Patch Changes

- Updated dependencies [8949718]
- Updated dependencies [2c8596b]
  - @acanthis-dec/browser-fetch@1.1.0
  - @acanthis-dec/core@1.1.0

## 1.0.5

### Patch Changes

- Updated dependencies [7c60833]
  - @acanthis-dec/browser-fetch@1.0.4

## 1.0.4

### Patch Changes

- Updated dependencies [10ea62d]
  - @acanthis-dec/browser-fetch@1.0.3

## 1.0.3

### Patch Changes

- 27ddae6: 解决了几个关于 novelCacheMeta 的问题。
  - 解决了 addNovelCoverMeta 和 addVolumeCoverMeta 中没有对 onConflictDoNothing 的调用，导致重复插入时抛出异常的问题。
  - addNovelCoverMeta 现在会在 novel 找不到时，尝试插入一个新的空 novel 记录，以便后续可以复用本地 cover 缓存。

## 1.0.2

### Patch Changes

- 51130dc: Fix published `types` metadata to point at generated declaration files.
- Updated dependencies [51130dc]
  - @acanthis-dec/browser-fetch@1.0.2
  - @acanthis-dec/core@1.0.2

## 1.0.1

### Patch Changes

- build(npm): 为 package.json 添加 types 字段，确保 npm 可以正确识别出这是一个有类型声明的包
- Updated dependencies
  - @acanthis-dec/browser-fetch@1.0.1
  - @acanthis-dec/core@1.0.1

## 1.0.0

### Major Changes

- 初次发版，基本完成了首次重构，真不容易

### Patch Changes

- Updated dependencies
  - @acanthis-dec/browser-fetch@1.0.0
  - @acanthis-dec/core@1.0.0
