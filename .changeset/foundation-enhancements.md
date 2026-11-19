---
"@acanthis-dec/core": minor
"@acanthis-dec/storage": minor
"@acanthis-dec/linovelib": minor
"@acanthis-dec/api-server": minor
---

补齐多端底座能力：新增书源能力描述与 `/v1/sources` 发现接口、CORS 与可选 `AUTH_TOKEN` Bearer 鉴权、章节插图提取重写与封闭式磁盘缓存代理 `/v1/linovelib/illustration/:hash`、书库分页 `/v1/linovelib/novels`、章节直链 `?novelId=` 兜底、目录隐藏章节 ID 双向推导与事务残留清理，并修复已缓存作品离线降级与冷库迁移初始化竞态问题
