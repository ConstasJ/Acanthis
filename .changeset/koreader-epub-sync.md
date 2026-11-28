---
"@acanthis-dec/core": minor
"@acanthis-dec/epub": minor
"@acanthis-dec/storage": minor
"@acanthis-dec/api-server": minor
"@acanthis-dec/web": minor
---

支持 KOReader（KO1）按卷 EPUB 异步打包、墨水屏图片瘦身与三端段落级阅读进度同步：

- 跨端 `DeviceKind` 枚举新增 `"ereader"`，同步更新核心类型、SQLite 读写归一化、OpenAPI 契约与 Web 端电纸书图标/标签展示。
- `@acanthis-dec/epub` 新增可选 `syncMetadata`，支持在合成章节标题前写入与 `chapterParser.ts` 对齐的 `id="b<N>"` 段落锚点及 `OEBPS/acanthis-manifest.json` 同步清单。
- `@acanthis-dec/api-server` 新增 `/v1/linovelib/epub` 按卷异步构建、进度查询、批量/单卷状态检测与 `ETag`/`304` 流式下载接口，支持磁盘指纹 LRU 缓存、`GET /v1/linovelib/novel/:novelId?cachedOnly=true` 及基于 `sharp` 的 `profile=eink` 单通道灰度图片瘦身，并同步更新 `Dockerfile.runtime`。
