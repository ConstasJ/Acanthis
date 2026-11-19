---
"@acanthis-dec/core": minor
"@acanthis-dec/storage": minor
"@acanthis-dec/api-server": minor
---

新增跨设备书架与阅读进度同步底座：补充 `BookshelfItem` 与 `ReadingProgress` 共享类型、SQLite 同步数据表与 Drizzle 增量迁移、基于客户端 `updatedAt` 时钟钳制 LWW 与服务端单调游标 `serverUpdatedAt` 的软删除合并逻辑，以及受鉴权保护的 `GET/POST /v1/sync/state` 接口
