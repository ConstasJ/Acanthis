# @acanthis-dec/api-server

## 1.1.0

### Minor Changes

- 125e219: 新增跨设备书架与阅读进度同步底座：补充 `BookshelfItem` 与 `ReadingProgress` 共享类型、SQLite 同步数据表与 Drizzle 增量迁移、基于客户端 `updatedAt` 时钟钳制 LWW 与服务端单调游标 `serverUpdatedAt` 的软删除合并逻辑，以及受鉴权保护的 `GET/POST /v1/sync/state` 接口
- 125e219: 补齐多端底座能力：新增书源能力描述与 `/v1/sources` 发现接口、CORS 与可选 `AUTH_TOKEN` Bearer 鉴权、章节插图提取重写与封闭式磁盘缓存代理 `/v1/linovelib/illustration/:hash`、书库分页 `/v1/linovelib/novels`、章节直链 `?novelId=` 兜底、目录隐藏章节 ID 双向推导与事务残留清理，并修复已缓存作品离线降级与冷库迁移初始化竞态问题

### Patch Changes

- Updated dependencies [125e219]
- Updated dependencies [125e219]
  - @acanthis-dec/core@1.2.0
  - @acanthis-dec/storage@1.1.0
  - @acanthis-dec/linovelib@1.3.0

## 1.0.9

### Patch Changes

- Updated dependencies [6c2a0e8]
  - @acanthis-dec/linovelib@1.2.0
  - @acanthis-dec/storage@1.0.8

## 1.0.8

### Patch Changes

- Updated dependencies [99cbf29]
  - @acanthis-dec/linovelib@1.1.2

## 1.0.7

### Patch Changes

- Updated dependencies [19203d3]
- Updated dependencies [8654d2b]
  - @acanthis-dec/linovelib@1.1.1
  - @acanthis-dec/storage@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [31e0ddb]
- Updated dependencies [8949718]
  - @acanthis-dec/linovelib@1.1.0
  - @acanthis-dec/core@1.1.0
  - @acanthis-dec/storage@1.0.6

## 1.0.5

### Patch Changes

- 7c60833: 新增了 Chrome 150 的 porfile，同时重构了 profile 体系
- Updated dependencies [7c60833]
  - @acanthis-dec/linovelib@1.0.5
  - @acanthis-dec/storage@1.0.5

## 1.0.4

### Patch Changes

- 3dfabee: 针对 api-server 的设置和输出格式进行调整，确保正常工作
- Updated dependencies [07ff2b5]
- Updated dependencies [1e4b6f1]
  - @acanthis-dec/linovelib@1.0.4
  - @acanthis-dec/storage@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [27ddae6]
  - @acanthis-dec/storage@1.0.3
  - @acanthis-dec/linovelib@1.0.3

## 1.0.2

### Patch Changes

- a63414f: 调整/linovelib/cover/novel 的行为，现在它可以直接从上游获取封面 URL 了
- Updated dependencies [3901772]
- Updated dependencies [51130dc]
  - @acanthis-dec/linovelib@1.0.2
  - @acanthis-dec/core@1.0.2
  - @acanthis-dec/storage@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies
  - @acanthis-dec/core@1.0.1
  - @acanthis-dec/linovelib@1.0.1
  - @acanthis-dec/storage@1.0.1

## 1.0.0

### Major Changes

- 初次发版，基本完成了首次重构，真不容易

### Patch Changes

- Updated dependencies
  - @acanthis-dec/core@1.0.0
  - @acanthis-dec/linovelib@1.0.0
  - @acanthis-dec/storage@1.0.0
