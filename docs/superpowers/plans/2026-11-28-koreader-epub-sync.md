# Acanthis × KOReader（KO1）三步走联动实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为越狱 Kindle Oasis 1（KO1 + KOReader）分三阶段落地完整联动方案：服务端按卷 EPUB 异步构建与缓存底座、`acanthis-koplugin` 独立 LuaJIT 薄客户端、以及三端段落级阅读进度双向同步与 `sharp` 墨水屏图片瘦身。

**Architecture:** `Acanthis` 主仓负责跨端 `DeviceKind` 扩展、`packages/epub` 段落锚点与 `acanthis-manifest.json` 写入、`apps/api-server` 按卷异步构建/缓存接口（抽象 `EpubJobStore` 预留预打包能力）及 `sharp` 灰度压缩管线；独立仓库 `C:\Users\ConstasJ\Coding\acanthis-koplugin` 以纯 LuaJIT 实现离线优先薄客户端与 XPointer ↔ `ReadingProgress` 双向同步；`acanthis-mobile` 同步适配 `ereader` 设备展示。

**Tech Stack:** TypeScript ESM / Hono / Zod v4 / hono-openapi / Drizzle / `fflate` / `htmlparser2` / `sharp` / Docker (`Dockerfile.runtime`) / Vue 3 / Kotlin Multiplatform / LuaJIT (KOReader API).

**Spec:** [2026-11-28-koreader-epub-sync-design.md](file:///c:/Users/ConstasJ/Coding/Acanthis/docs/superpowers/specs/2026-11-28-koreader-epub-sync-design.md)

## Global Constraints

- **Node 与包管理**：`Acanthis` 主仓使用 `pnpm@12.21.0` + Node 24（Windows 非交互 Shell 中使用 `mise exec --` 前缀）；严格遵守 Biome（tabs、双引号、LF 换行），每次改动后对变更文件执行 `pnpm exec biome check <files...>`。
- **不随意引入测试框架**：`Acanthis` 仓库当前无内置测试框架，主仓逻辑校验采用 `check-types`、`build`、`openapi:check` 及 Node 24 内置 `node --test` 验证脚本（不污染 `package.json` 依赖）；`acanthis-mobile` 使用 `.\gradlew.bat :composeApp:testAndroidHostTest`。
- **向后兼容契约**：`packages/epub` 仅在传入可选 `syncMetadata` 时写入锚点与清单，不破坏 `apps/cli` 与 `apps/web`；`GET /v1/linovelib/novel/:novelId` 的 `cachedOnly` 默认 `false`；`apps/api-server` 路由/schema 变更必须同步运行 `pnpm --filter=@acanthis-dec/api-server run openapi:generate` 并通过 `openapi:check`。
- **Docker 与构建纪律**：`sharp` 加入 `apps/api-server/build.ts` 的 `external` 及 `Dockerfile.runtime`（按 `TARGETARCH` 裁剪非目标架构原生包），保持与 `onnxruntime-node` / `isolated-vm` 一致。
- **KO1 硬件与离线纪律**：`acanthis-koplugin` 零外置依赖、纯列表无封面墙 UI；`onCloseDocument` / `onSuspend` 严禁调用 `NetworkMgr:runWhenOnline` 弹窗，离线时仅写入持久化待同步队列。
- **Git 与 Changesets**：每个 Task 验收后原子提交（Conventional Commits 中文概述，禁止擅自 `git push`）；`Acanthis` 中涉及 `apps/*` / `packages/*` 行为改动在 Phase 1 与 Phase 3 收官时补充 `.changeset/*.md` 并通过 `pnpm exec changeset status`。

## Review Focus

以下 5 类最易在实际使用中触发故障的边界输入/失败模式，已分别绑定到对应 Task 的验证步骤：

1. **合成章节标题导致 `blockIndex` 整体 +1 偏移**：章节原始 HTML 无开头 `<h1>` 时，`normalizeLeadingHeading` 会插入 `<h1 class="chapter-title">`，该节点**绝不能**分配 `id="b0"`，否则 KOReader 同步回 Web/Mobile 会永远错位一段（由 Task 2 验证）。
2. **服务端 512MB LRU 淘汰磁盘 `.epub` 后，KO1 误报 `[可更新]`**：服务端已删旧磁盘文件（`cached: false`, `contentFingerprint: null`）但 SQLite 章节数未变时，KO1 已下载卷必须保持 `[已下载]` 而非误标 `[可更新]`（由 Task 4 & Task 6 验证）。
3. **损坏/非位图插图（如 SVG 或截断字节流）导致 `sharp` 抛错中断整卷打包**：`profile=eink` 图片管线遇到单张解码失败时必须记 `warn` 并回退原图，整卷打包仍返回 `ready`（由 Task 7 验证）。
4. **KO1 飞行模式下合盖休眠（`onSuspend`）或退书（`onCloseDocument`）触发开 Wi-Fi 弹窗**：开启自动同步但离线时必须严格静默落盘队列、零弹窗，直到下次显式联网操作再 flush（由 Task 8 验证）。
5. **同一卷并发发起多次构建或下载中途断网**：服务端必须通过 `dedupeKey` Singleflight 复用同一个 `jobId`；客户端流式下载必须先写 `.epub.part` 再原子 `os.rename`，防止坏文件覆盖已可读本地卷（由 Task 3 & Task 6 验证）。

---

## 文件结构总览

### Phase 1（`Acanthis` 主仓 + `acanthis-mobile` 枚举适配）

- Modify: `packages/core/src/types.ts` — `DeviceKind` 增加 `"ereader"`
- Modify: `packages/storage/src/table.ts` — `readingProgress.deviceKind` 枚举增加 `"ereader"`
- Modify: `apps/api-server/src/schemas/sync.ts` — `deviceKindSchema` 增加 `"ereader"`
- Modify: `apps/web/src/config/runtime.ts`, `apps/web/src/views/HistoryView.vue`, `apps/web/src/views/BookshelfView.vue`, `apps/web/src/views/ReaderView.vue` — 识别与展示 `"ereader"`
- Modify: `../acanthis-mobile/composeApp/src/commonMain/kotlin/io/acanthis/app/core/platform/DeviceKind.kt`, `.../feature/history/HistoryScreen.kt`, `.../commonTest/.../HistoryViewModelTest.kt` — 新增 `DeviceKind.EREADER` 与展示图标
- Modify: `packages/epub/src/types.ts`, `packages/epub/src/xhtml.ts`, `packages/epub/src/archive.ts` — 可选 `syncMetadata`、`id="b<N>"` 锚点计数与 `OEBPS/acanthis-manifest.json`
- Modify: `apps/api-server/package.json`, `apps/api-server/src/config.ts`, `apps/api-server/src/services.ts`, `apps/api-server/src/app.ts` — 接入 `@acanthis-dec/epub` 与 `epub` 配置项
- Create: `apps/api-server/src/epub/types.ts` — `EpubJobStore` 接口、`EpubJobRecord`、`EpubProfile` 等类型
- Create: `apps/api-server/src/epub/jobStore.ts` — `InMemoryEpubJobStore`（含 Singleflight 与 TTL 清理）
- Create: `apps/api-server/src/epub/cache.ts` — 磁盘指纹缓存、原子写盘、`.meta.json` 读写与 LRU 淘汰
- Create: `apps/api-server/src/epub/imageProcessor.ts` — 图像处理器接口（Phase 1 提供 passthrough，Phase 3 接入 `sharp`）
- Create: `apps/api-server/src/epub/service.ts` — `VolumeEpubService`（目录刷新、缺章/插图补齐、指纹计算、打包入缓存）
- Create: `apps/api-server/src/schemas/epub.ts` — EPUB 路由 Zod v4 schemas
- Create: `apps/api-server/src/epub.ts` — `/v1/linovelib/epub` 路由工厂
- Modify: `apps/api-server/src/linovelib.ts`, `apps/api-server/src/schemas/linovelib.ts` — `GET /novel/:novelId` 增加 `?cachedOnly=true`
- Modify: `apps/api-server/openapi.json` — 重新生成 OpenAPI 契约

### Phase 2（`C:\Users\ConstasJ\Coding\acanthis-koplugin` 独立仓）

- Create: `acanthis.koplugin/_meta.lua` — 插件元信息
- Create: `acanthis.koplugin/settings.lua` — `LuaSettings` 封装（配置、书架/目录离线快照、待同步队列存储）
- Create: `acanthis.koplugin/api_client.lua` — HTTP(S) 客户端（Bearer、JSON、流式下载、`NetworkMgr` 封装）
- Create: `acanthis.koplugin/storage_mgr.lua` — 本地路径规范化、`.epub.part` 原子落盘、`.acanthis.json` 侧车文件读写、删卷清理
- Create: `acanthis.koplugin/ui_bookshelf.lua` — 分类/书架/卷列表纯列表 `Menu` 与 `Trapper` 异步构建进度轮询
- Create: `acanthis.koplugin/main.lua` — `WidgetContainer` 注册、主菜单入口与设置面板
- Create: `README.md`, `scripts/package.ps1`（或 `scripts/package.sh`）— 安装说明与 `.zip` 打包脚本

### Phase 3（三端进度双向同步 + `sharp` 墨水屏瘦身）

- Modify: `apps/api-server/package.json`, `apps/api-server/build.ts`, `apps/api-server/Dockerfile.runtime`, `apps/api-server/src/epub/imageProcessor.ts` — 集成 `sharp` 实现 `profile=eink` 灰度压缩与回退容错
- Create: `acanthis.koplugin/epub_manifest.lua` — 读取并缓存本地 EPUB 内 `OEBPS/acanthis-manifest.json`
- Create: `acanthis.koplugin/sync_bridge.lua` — XPointer ↔ `(volumeId, chapterId, paragraphIndex)` 双向映射、离线静默队列与跨卷提示
- Modify: `acanthis.koplugin/main.lua`, `acanthis.koplugin/ui_bookshelf.lua` — 挂载阅读器钩子（`onReaderReady` / `onCloseDocument` / `onSuspend`）与手动同步菜单

---

## Phase 1：服务端按卷 EPUB 底座与跨端 `DeviceKind` 扩展

### Task 1: 跨端 `DeviceKind` 枚举扩展（新增 `"ereader"`）

**Files:**

- Modify: `packages/core/src/types.ts:78`
- Modify: `packages/storage/src/table.ts:223-227`
- Modify: `apps/api-server/src/schemas/sync.ts:62-65`
- Modify: `apps/web/src/config/runtime.ts:110-145`
- Modify: `apps/web/src/views/HistoryView.vue:355-375`
- Modify: `apps/web/src/views/BookshelfView.vue:470-490`
- Modify: `apps/web/src/views/ReaderView.vue:1395-1415`
- Modify: `../acanthis-mobile/composeApp/src/commonMain/kotlin/io/acanthis/app/core/platform/DeviceKind.kt:1-41`
- Modify: `../acanthis-mobile/composeApp/src/commonMain/kotlin/io/acanthis/app/feature/history/HistoryScreen.kt:300-320`
- Test: `../acanthis-mobile/composeApp/src/commonTest/kotlin/io/acanthis/app/feature/history/HistoryViewModelTest.kt`

**Interfaces:**

- Produces:
  - `DeviceKind = "desktop" | "mobile" | "ereader" | "unknown"` (`@acanthis-dec/core`)
  - `deviceKindSchema` (`apps/api-server/src/schemas/sync.ts`)
  - `DeviceKind.EREADER = "ereader"` (`io.acanthis.app.core.platform.DeviceKind`)

- [ ] **Step 1: 更新 `Acanthis` 主仓 `DeviceKind` 类型、DB schema 与 OpenAPI schema**
  - 在 `packages/core/src/types.ts`、`packages/storage/src/table.ts`、`apps/api-server/src/schemas/sync.ts` 中加入 `"ereader"`。
  - 更新 `apps/web/src/config/runtime.ts` 中的 `normalizeDeviceKind` 与 `resolveDisplayDeviceKind`（新增 `ereader` 正则匹配 `kindle|kobo|koreader|boox|ereader|oasis|paperwhite`），并在 `HistoryView.vue`、`BookshelfView.vue`、`ReaderView.vue` 为 `"ereader"` 增加电纸书图标与中文标签（“电纸书”）。
- [ ] **Step 2: 校验 `Acanthis` 主仓类型、OpenAPI 与 Biome**
  - Run: `mise exec -- pnpm --filter=@acanthis-dec/api-server run openapi:generate`
  - Run: `mise exec -- pnpm check-types`
  - Run: `mise exec -- pnpm exec biome check packages/core/src/types.ts packages/storage/src/table.ts apps/api-server/src/schemas/sync.ts apps/web/src/config/runtime.ts apps/web/src/views/HistoryView.vue apps/web/src/views/BookshelfView.vue apps/web/src/views/ReaderView.vue`
  - Expected: 全部 0 错误。
- [ ] **Step 3: 同步更新 `acanthis-mobile` 的 `DeviceKind.kt` 与单测**
  - 在 `DeviceKind.kt` 新增 `const val EREADER = "ereader"`、`ereaderLabelRegex` 并在 `normalize` / `resolveDisplayKind` 中返回 `EREADER`；在 `HistoryScreen.kt` 为 `EREADER` 渲染对应图标。
  - 在 `HistoryViewModelTest.kt` 新增用例断言 `deviceKind = "ereader"` 及 `deviceKind = "unknown", deviceLabel = "Kindle Oasis 1"` 均解析为 `DeviceKind.EREADER`。
  - Run (in `../acanthis-mobile`): `.\gradlew.bat :composeApp:testAndroidHostTest`
  - Expected: 全部单测 PASS。
- [ ] **Step 4: 分别在 `Acanthis` 与 `acanthis-mobile` 原子提交**
  - `Acanthis`: `feat(sync): 跨端 DeviceKind 枚举新增 ereader 设备类型`
  - `acanthis-mobile`: `feat(sync): 适配服务端新增的 ereader 设备类型展示`

---

### Task 2: `packages/epub` 段落锚点标注与 `OEBPS/acanthis-manifest.json` 写入

**Files:**

- Modify: `packages/epub/src/types.ts`
- Modify: `packages/epub/src/xhtml.ts`
- Modify: `packages/epub/src/archive.ts`
- Modify: `packages/epub/src/index.ts`

**Interfaces:**

- Consumes: 现有 `sanitizeChapterHtmlToXhtml`、`buildVolumeEpub`
- Produces:
  - `VolumeEpubSyncMetadata`: `{ platform: string; novelId: string; volumeId: string; profile: "original" | "eink"; contentFingerprint: string }`
  - `AcanthisEpubManifest`: `{ schemaVersion: 1; platform: string; novelId: string; volumeId: string; volumeTitle: string; profile: "original" | "eink"; contentFingerprint: string; generatedAt: string; chapters: Array<{ index: number; href: string; chapterId: string; title: string; totalParagraphs: number }> }`
  - `VolumeEpubInput.syncMetadata?: VolumeEpubSyncMetadata | undefined`

- [ ] **Step 1: 扩展 `packages/epub/src/types.ts` 并导出新类型**
  - 新增 `VolumeEpubSyncMetadata`、`AcanthisEpubManifestChapter`、`AcanthisEpubManifest`，在 `VolumeEpubInput` 中添加可选字段 `syncMetadata`。
- [ ] **Step 2: 在 `packages/epub/src/xhtml.ts` 实现与 `chapterParser.ts` 对齐的段落锚点标注**
  - 新增 `annotateChapterBlocks(nodes: ChildNode[]): { nodes: ChildNode[]; totalParagraphs: number }`：
    - 在 `sanitizeChapterHtmlToXhtml` 中、**调用 `normalizeLeadingHeading` 之前**（仅当 `enableBlockAnchors: true` 时）执行；
    - 计数规则严格对齐 `apps/web/src/utils/chapterParser.ts`：非空纯文本包成 `<p id="b<N>">`，顶层 `<img>` 或仅含单图 `<p>` 赋 `id="b<N>"`，非空 `<p>` 与 `h1`~`h6` 赋 `id="b<N>"`，空白文本/空 `<p>`/注释跳过；
    - 确保 `normalizeLeadingHeading` 新插的合成 `<h1 class="chapter-title">` **不获得 `id="b..."`**（Review Focus #1）。
  - `sanitizeChapterHtmlToXhtml` 新增可选返回值辅助函数 `sanitizeChapterHtmlToXhtmlWithStats(...)` 返回 `{ xhtml: string; totalParagraphs: number }`，原函数保持签名兼容。
- [ ] **Step 3: 在 `packages/epub/src/archive.ts` 写入 `OEBPS/acanthis-manifest.json`**
  - `buildVolumeEpub` 检测到 `input.syncMetadata` 时，开启章节锚点标注并收集每章 `{ index, href, chapterId: chapter.id, title: chapter.title, totalParagraphs }`，序列化 JSON 写入 `OEBPS/acanthis-manifest.json`（不加入 `spine`）。
- [ ] **Step 4: 验证构建、类型与锚点对齐（含 Review Focus #1）**
  - Run: `mise exec -- pnpm --filter=@acanthis-dec/epub run check-types && mise exec -- pnpm --filter=@acanthis-dec/epub run build`（PowerShell 分两句执行）
  - 使用 `node --input-type=module` 执行临时验证脚本（不入库）：构造包含“无开头标题 + 纯文本 + 空 `<p>` + 单图 `<p>` + 正常 `<p>`”的章节 HTML 调用 `buildVolumeEpub`，用 `fflate.unzipSync` 解包断言：
    1. `OEBPS/acanthis-manifest.json` 存在且 `schemaVersion === 1`、`totalParagraphs` 与预期块数一致；
    2. 合成 `<h1 class="chapter-title">` 无 `id="b0"`，首个正文块准确标记为 `id="b0"`；
    3. 未传 `syncMetadata` 时不生成 `OEBPS/acanthis-manifest.json` 且不写 `id="b..."`。
  - Run: `mise exec -- pnpm exec biome check packages/epub/src/types.ts packages/epub/src/xhtml.ts packages/epub/src/archive.ts packages/epub/src/index.ts`
- [ ] **Step 5: 提交**
  - `feat(epub): 支持写入段落同步锚点与 acanthis-manifest.json 清单`

---

### Task 3: `apps/api-server` EPUB 任务抽象（`EpubJobStore`）与磁盘指纹 LRU 缓存

**Files:**

- Modify: `apps/api-server/package.json`（添加 `"@acanthis-dec/epub": "workspace:*"`）
- Modify: `apps/api-server/src/config.ts`（添加 `epub` 配置段与环境变量映射）
- Create: `apps/api-server/src/epub/types.ts`
- Create: `apps/api-server/src/epub/jobStore.ts`
- Create: `apps/api-server/src/epub/cache.ts`
- Create: `apps/api-server/src/epub/imageProcessor.ts`

**Interfaces:**

- Produces:
  - `EpubJobStore`: `get(jobId)`, `findActiveByDedupeKey(dedupeKey)`, `create(record)`, `update(jobId, patch)`, `pruneExpired(nowMs)`
  - `InMemoryEpubJobStore implements EpubJobStore`
  - `EpubDiskCache`: `getMetadata(key)`, `getEpubPath(key)`, `writeArtifact(key, bytes, meta)`, `evictIfNeeded()`
  - `EpubImageProcessor`: `process(asset: EpubImageAsset, profile: EpubProfile): Promise<EpubImageAsset>`（Phase 1 提供 `PassthroughEpubImageProcessor`）
  - `computeVolumeContentFingerprint(input): string`

- [ ] **Step 1: 更新 `apps/api-server/package.json` 与 `src/config.ts`**
  - 引入 `@acanthis-dec/epub`（workspace 依赖），在 `ConfigSchema` 新增 `epub: { cacheDir, maxCacheBytes, jobTtlMs, maxConcurrentJobs }` 及 `EPUB_CACHE_DIR` / `EPUB_MAX_CACHE_BYTES` / `EPUB_JOB_TTL_MS` / `EPUB_MAX_CONCURRENT_JOBS` 环境变量解析。
- [ ] **Step 2: 实现 `src/epub/types.ts` 与 `src/epub/jobStore.ts`**
  - 定义 `EpubProfile`, `EpubTriggerSource`, `EpubJobStatus`, `EpubJobRecord`, `EpubJobStore`。
  - 实现 `InMemoryEpubJobStore`：保证同一 `dedupeKey` 在活跃状态（非 `ready`/`failed`）下通过 `findActiveByDedupeKey` 命中 Singleflight 复用（Review Focus #5），并按 `jobTtlMs` 清理过期终态记录。
- [ ] **Step 3: 实现 `src/epub/cache.ts` 与 `src/epub/imageProcessor.ts`**
  - `EpubDiskCache` 磁盘路径：`${cacheDir}/${platform}/${novelId}/${volumeId}/${profile}.epub` 与 `.meta.json`。
  - 写入采用 `.epub.tmp.<random>` + `rename` 与 `.meta.json.tmp.<random>` + `rename` 原子落盘；读取时更新 `lastAccessedAt`；写入后异步检查总字节数超过 `maxCacheBytes` 时按最旧 `lastAccessedAt` 淘汰 `.epub` + `.meta.json`。
  - 实现 `computeVolumeContentFingerprint`（SHA-256 截断 16 位十六进制）。
- [ ] **Step 4: 验证类型、Singleflight 与 LRU 行为**
  - Run: `mise exec -- pnpm --filter=@acanthis-dec/api-server run check-types`
  - 使用临时 Node 脚本验证：`InMemoryEpubJobStore` 同 `dedupeKey` 并发复用、TTL 过期清理、`EpubDiskCache` 原子写入与超限 LRU 淘汰。
  - Run: `mise exec -- pnpm exec biome check apps/api-server/src/config.ts apps/api-server/src/epub/types.ts apps/api-server/src/epub/jobStore.ts apps/api-server/src/epub/cache.ts apps/api-server/src/epub/imageProcessor.ts`
- [ ] **Step 5: 提交**
  - `feat(api-server): 新增 EPUB 异步任务抽象与磁盘指纹 LRU 缓存`

---

### Task 4: `apps/api-server` 按卷 EPUB 构建服务、路由、批量状态接口与 `novel/:novelId?cachedOnly=true`

**Files:**

- Create: `apps/api-server/src/epub/service.ts`
- Create: `apps/api-server/src/schemas/epub.ts`
- Create: `apps/api-server/src/epub.ts`
- Modify: `apps/api-server/src/schemas/linovelib.ts`（`novelStyleQuerySchema` 增加 `cachedOnly`）
- Modify: `apps/api-server/src/linovelib.ts:819-933`（支持 `?cachedOnly=true` 与挂载 `/epub` 子路由）
- Modify: `apps/api-server/src/app.ts`, `apps/api-server/src/services.ts`
- Modify: `apps/api-server/openapi.json`

**Interfaces:**

- Consumes: `EpubJobStore`, `EpubDiskCache`, `EpubImageProcessor`, `buildVolumeEpub`, `StorageService`, `LinovelibClient`
- Produces:
  - `POST /v1/linovelib/epub/volumes/:novelId/:volumeId/jobs`
  - `GET /v1/linovelib/epub/jobs/:jobId`
  - `GET /v1/linovelib/epub/novels/:novelId/status?profile=eink|original`
  - `GET /v1/linovelib/epub/volumes/:novelId/:volumeId/status?profile=eink|original`
  - `GET /v1/linovelib/epub/volumes/:novelId/:volumeId/download?profile=eink|original`
  - `GET /v1/linovelib/novel/:novelId?cachedOnly=true|false`

- [ ] **Step 1: 实现 `VolumeEpubService`（`src/epub/service.ts`）**
  - 实现受控并发队列（`maxConcurrentJobs`）、Singleflight 任务创建/复用。
  - 实现分卷构建流水线：
    1. 目录获取（`refresh: true` 或本地缺失时调用 `linovelibClient.getNovelInfo` 并 `addNovelCache`）；
    2. 跳过无法解析的章节 ID（复用 `isUnresolvedChapterId` 逻辑并记录 warning），缺失章节经 `linovelibClient.getChapter` 拉取并落入 `storageService`；
    3. 提取章节图片 URL 与卷封面，缺失媒体受控并发（3）拉取落入 `storageService`，单图失败记 warning 不中断；
    4. 调用 `imageProcessor.process` 处理图片；
    5. 计算 `contentFingerprint`，若磁盘缓存已匹配直接复用，否则调用 `buildVolumeEpub`（传入 `syncMetadata`）并原子写入 `EpubDiskCache`。
  - 实现 `getNovelVolumesStatus(novelId, profile)` 与 `getVolumeStatus(novelId, volumeId, profile)`：结合 SQLite 现有章节列表与磁盘 `.meta.json` 计算 `cached`、`contentFingerprint`、`stale`、`chapterCount`、`sizeBytes`、`generatedAt`、`activeJobId`（Review Focus #2：当 `cached === false` 时 `stale = false`，避免误报）。
- [ ] **Step 2: 编写 `src/schemas/epub.ts`、`src/epub.ts` 并修改 `src/linovelib.ts` / `src/schemas/linovelib.ts`**
  - 为全部 5 个 EPUB 端点添加完整的 `describeRoute` 与 Zod v4 schema；`/download` 支持 `ETag` / `If-None-Match` (`304`)、流式 `Readable` 响应及 `Content-Disposition`。
  - `GET /v1/linovelib/novel/:novelId` 支持 `cachedOnly`（布尔预处理，默认 `false`）：为 `true` 且 `validCachedNovel` 存在时跳过 `isUpdateNeeded()` 直接返回缓存。
  - 在 `services.ts` 与 `app.ts` / `linovelib.ts` 完成依赖注入挂载。
- [ ] **Step 3: 重新生成 OpenAPI 并全量验证 Phase 1**
  - Run: `mise exec -- pnpm --filter=@acanthis-dec/api-server run openapi:generate`
  - Run: `mise exec -- pnpm --filter=@acanthis-dec/api-server run openapi:check`
  - Run: `mise exec -- pnpm --filter=@acanthis-dec/api-server run check-types`
  - Run: `mise exec -- pnpm --filter=@acanthis-dec/api-server run build`
  - Run: `mise exec -- pnpm exec biome check apps/api-server/src/epub.ts apps/api-server/src/epub/service.ts apps/api-server/src/schemas/epub.ts apps/api-server/src/schemas/linovelib.ts apps/api-server/src/linovelib.ts apps/api-server/src/app.ts apps/api-server/src/services.ts`
  - Expected: 全部 0 错误，且 `dist/index.js` 正常产出。
- [ ] **Step 4: 提交代码并补充 Phase 1 Changeset**
  - Commit: `feat(api-server): 新增按卷 EPUB 异步构建、批量状态查询与磁盘缓存下载接口`
  - 新增 `.changeset/koreader-epub-phase1.md`（涉及 `@acanthis-dec/core`、`@acanthis-dec/epub`、`@acanthis-dec/storage`、`@acanthis-dec/api-server`、`@acanthis-dec/web`，级别 `minor`），执行 `mise exec -- pnpm exec changeset status` 与 `biome check` 后单独提交：`chore(changeset): 添加按卷 EPUB 导出底座与 ereader 设备类型的变更记录`。

---

## Phase 2：`acanthis-koplugin` 独立仓库 MVP（KO1 薄客户端）

### Task 5: 初始化 `C:\Users\ConstasJ\Coding\acanthis-koplugin` 仓库与基础配置/网络模块

**Files:**

- Create: `C:\Users\ConstasJ\Coding\acanthis-koplugin\acanthis.koplugin\_meta.lua`
- Create: `C:\Users\ConstasJ\Coding\acanthis-koplugin\acanthis.koplugin\settings.lua`
- Create: `C:\Users\ConstasJ\Coding\acanthis-koplugin\acanthis.koplugin\api_client.lua`
- Create: `C:\Users\ConstasJ\Coding\acanthis-koplugin\README.md`
- Create: `C:\Users\ConstasJ\Coding\acanthis-koplugin\.gitignore`

**Interfaces:**

- Produces:
  - `Settings`: `getConfig()`, `setConfig(k, v)`, `getBookshelfSnapshot()`, `saveBookshelfSnapshot(data)`, `getNovelVolumesSnapshot(novelId)`, `saveNovelVolumesSnapshot(novelId, volumes)`, `getPendingProgress()`, `upsertPendingProgress(item)`, `clearPendingProgress(keys)`
  - `ApiClient`: `getSyncState(since)`, `pushSyncState(payload)`, `getNovel(novelId, cachedOnly)`, `getNovelEpubStatus(novelId, profile)`, `createVolumeEpubJob(novelId, volumeId, opts)`, `getEpubJob(jobId)`, `downloadVolumeEpub(novelId, volumeId, profile, targetPartPath, onProgress)`

- [ ] **Step 1: 创建插件目录结构与 `_meta.lua`**
  - 在 `C:\Users\ConstasJ\Coding\acanthis-koplugin` 初始化 Git 仓库（需在执行前按规则确认）并创建 `acanthis.koplugin/_meta.lua`（`name = "acanthis"`, `fullname = "Acanthis"`, `version = "0.1.0"`）。
- [ ] **Step 2: 实现 `settings.lua`**
  - 基于 KOReader `LuaSettings` 持久化到 `DataStorage:getSettingsDir() .. "/acanthis.lua"`；默认值：`download_dir = "/mnt/us/documents/Acanthis"`（桌面端回退 `DataStorage:getDataDir() .. "/acanthis_books"`）、`profile = "eink"`、`device_label = "Kindle Oasis 1"`、`auto_sync_online = true`。
  - 内置书架快照、单书卷目录快照、待同步进度队列（按 `platform:novelId` 键 LWW 合并）读写方法。
- [ ] **Step 3: 实现 `api_client.lua`**
  - 基于 KOReader 内置 `socket.http` / `ssl.https` / `ltn12` / `rapidjson` 实现 Bearer Token 鉴权、JSON 编解码、友好错误消息归一化。
  - `downloadVolumeEpub` 使用 `ltn12.sink.file` 流式写入 `.epub.part`，避免整卷加载进 KO1 512MB 内存。
  - 仅在显式调用时提供 `runWhenOnline` 包装，绝不在底层隐式弹 Wi-Fi 框。
- [ ] **Step 4: Lua 语法静态校验与提交**
  - Run: 用 `luac -p`（或 LuaJIT `-bl` / Node 语法检查器）校验所有 `.lua` 文件零语法错误。
  - Commit (in `acanthis-koplugin`): `feat: 初始化插件元数据、配置持久化与 API 客户端`

---

### Task 6: 本地存储管理（`storage_mgr.lua`）与极简列表 UI（`ui_bookshelf.lua` / `main.lua`）

**Files:**

- Create: `C:\Users\ConstasJ\Coding\acanthis-koplugin\acanthis.koplugin\storage_mgr.lua`
- Create: `C:\Users\ConstasJ\Coding\acanthis-koplugin\acanthis.koplugin\ui_bookshelf.lua`
- Create: `C:\Users\ConstasJ\Coding\acanthis-koplugin\acanthis.koplugin\main.lua`
- Create: `C:\Users\ConstasJ\Coding\acanthis-koplugin\scripts\package.ps1`

**Interfaces:**

- Consumes: `Settings`, `ApiClient`
- Produces:
  - `StorageMgr`: `resolveVolumePaths(novelTitle, volumeTitle)`, `readLocalSidecar(sidecarPath)`, `writeLocalSidecar(sidecarPath, meta)`, `commitPartFile(partPath, finalPath)`, `deleteVolume(novelTitle, volumeTitle)`
  - `BookshelfUI`: `showBookshelfMenu()`, `showVolumeMenu(bookItem)`
  - `AcanthisPlugin` (`main.lua`): KOReader 主菜单挂载与设置项

- [ ] **Step 1: 实现 `storage_mgr.lua`**
  - 文件名安全清理（兼容 FAT32/Kindle 挂载分区非法字符 `<>:"/\|?*` 及长度截断）。
  - 实现 `.epub.part` 下载完成后原子 `os.rename` 覆盖 `.epub` 并同步写入 `.acanthis.json` 侧车文件（保存 `platform`, `novelId`, `volumeId`, `profile`, `contentFingerprint`, `chapterCount`, `downloadedAt`）（Review Focus #5）。
  - 实现 `deleteVolume` 删除 `.epub` 与 `.acanthis.json`（不删 KOReader 全局配置）。
- [ ] **Step 2: 实现 `ui_bookshelf.lua`**
  - 纯文字列表 `Menu`（无封面墙，适配实体翻页键）：
    - 顶层支持按 `bookshelfCategories` 切换分类或“全部书架”；
    - 点击作品进入卷列表：优先秒读本地目录快照；若当前 `NetworkMgr:isOnline()`，后台静默发一次 `getNovel(novelId, true)` 与 `getNovelEpubStatus(novelId, profile)` 更新标注；
    - 顶部置顶 `[刷新目录]` 项，显式调用 `getNovel(novelId, false)`；
    - 卷状态严格按设计判定：`[已下载]` / `[可更新]` / `[未下载]`（Review Focus #2：服务端 `cached=false, stale=false` 且章节数未增时保持 `[已下载]`）；
    - 点击未下载或可更新卷：通过 `NetworkMgr:runWhenOnline` + `Trapper:wrap` 发起 `createVolumeEpubJob`，每 1.5s 轮询 `getEpubJob` 并刷新进度文案，状态为 `ready` 时流式下载 `.epub.part` → 原子提交 → 自动 `ReaderUI:showReader(finalPath)` 打开；
    - 长按已下载卷弹出 `ButtonDialog`：打开 / 检查更新并重新下载 / 删除本地文件。
- [ ] **Step 3: 实现 `main.lua` 与打包脚本 `scripts/package.ps1`**
  - 挂载至 KOReader 主菜单 `Acanthis`（包含：我的书架、立即同步书架、插件设置）。
  - `scripts/package.ps1` 将 `acanthis.koplugin/` 打成可直接解压到 Kindle `koreader/plugins/` 的 `.zip`。
- [ ] **Step 4: 语法校验与 KOReader 模拟器/真机端到端验证**
  - 验证配置连接 → 立即同步书架 → 离线打开书架与已下载卷 → 在线选未下载卷看到构建进度条并下载打开 → 删除本地卷。
  - Commit (in `acanthis-koplugin`): `feat: 实现本地存储管理、书架卷列表 UI 与异步构建下载流程`

---

## Phase 3：三端阅读进度双向同步 + `sharp` 墨水屏瘦身

### Task 7: `apps/api-server` 集成 `sharp` 实现 `profile=eink` 墨水屏图片瘦身与 Docker Runtime 更新

**Files:**

- Modify: `apps/api-server/package.json`（添加 `sharp`）
- Modify: `apps/api-server/build.ts`（`external` 新增 `"sharp"`）
- Modify: `apps/api-server/Dockerfile.runtime`（安装锁版本 `sharp` 并按 `TARGETARCH` 裁剪 `@img/sharp-*` / `@img/sharp-libvips-*`）
- Modify: `apps/api-server/src/epub/imageProcessor.ts`（实现 `SharpEpubImageProcessor`）
- Modify: `apps/api-server/src/services.ts`（注入 `SharpEpubImageProcessor`）

**Interfaces:**

- Consumes: `EpubImageProcessor`, `EpubImageAsset`
- Produces: `SharpEpubImageProcessor`（`profile === "eink"` 时执行 `rotate().resize({ width: 1072, withoutEnlargement: true, fit: "inside" }).grayscale().jpeg({ quality: 78, mozjpeg: true })`，输出 `mimeType: "image/jpeg"`；失败记录 warn 并回退原图）

- [ ] **Step 1: 安装 `sharp` 并更新 `build.ts` 与 `Dockerfile.runtime`**
  - `pnpm --filter=@acanthis-dec/api-server add sharp`（保持锁文件同步）。
  - 在 `apps/api-server/build.ts` 的 `external` 数组加入 `"sharp"`。
  - 在 `apps/api-server/Dockerfile.runtime` 的 `npm install` 中固定同一 `sharp` 版本，并按 `ORT_ARCH`（`x64`/`arm64`）删除非目标平台及 `musl` 变体的 `@img/sharp-*` 与 `@img/sharp-libvips-*` 目录。
- [ ] **Step 2: 实现 `SharpEpubImageProcessor`**
  - `profile === "original"` 直接原样返回；
  - `profile === "eink"` 调用 `sharp(asset.data)` 执行旋转、限宽 1072px、灰度、mozjpeg 质量 78 压缩并返回 `image/jpeg`；
  - `try/catch` 捕获损坏图片、SVG 或不支持格式，记录 `logger.warn` 并原样返回 `asset`（Review Focus #3）。
- [ ] **Step 3: 验证压缩效果、回退容错与构建**
  - 用 Node 脚本对真实大图（>1500px 彩图）与故意损坏的伪造字节流分别调用 `SharpEpubImageProcessor`：断言大图输出宽度 ≤ 1072、为灰度 JPEG 且体积显著减小；损坏字节流不抛错并原样返回。
  - Run: `mise exec -- pnpm --filter=@acanthis-dec/api-server run check-types`
  - Run: `mise exec -- pnpm --filter=@acanthis-dec/api-server run build`
  - Run: `mise exec -- pnpm exec biome check apps/api-server/build.ts apps/api-server/src/epub/imageProcessor.ts apps/api-server/src/services.ts`
- [ ] **Step 4: 提交代码并补充 Phase 3 Changeset**
  - Commit: `feat(api-server): 集成 sharp 实现 eink 墨水屏灰度图片瘦身并更新运行时镜像`
  - 新增 `.changeset/koreader-epub-eink-sharp.md`（`@acanthis-dec/api-server: minor`），校验 `changeset status` 后单独提交。

---

### Task 8: `acanthis-koplugin` 进度双向同步（`epub_manifest.lua` + `sync_bridge.lua`）

**Files:**

- Create: `C:\Users\ConstasJ\Coding\acanthis-koplugin\acanthis.koplugin\epub_manifest.lua`
- Create: `C:\Users\ConstasJ\Coding\acanthis-koplugin\acanthis.koplugin\sync_bridge.lua`
- Modify: `C:\Users\ConstasJ\Coding\acanthis-koplugin\acanthis.koplugin\main.lua`
- Modify: `C:\Users\ConstasJ\Coding\acanthis-koplugin\acanthis.koplugin\ui_bookshelf.lua`

**Interfaces:**

- Consumes: `Settings`, `ApiClient`, `OEBPS/acanthis-manifest.json`
- Produces:
  - `EpubManifest`: `loadFromEpub(epubPath)`（无清单返回 `nil` 并缓存判定结果）
  - `SyncBridge`: `extractLocalProgress(ui, manifest)`, `recordAndMaybePush(ui, manifest, opts)`, `flushPendingQueue(opts)`, `pullAndPromptJump(ui, manifest, opts)`

- [ ] **Step 1: 实现 `epub_manifest.lua`**
  - 通过 KOReader 内置 `archiver` / `zip` 读取 `.epub` 中的 `OEBPS/acanthis-manifest.json` 并用 `rapidjson.decode` 解析；对非 Acanthis 书籍快速返回 `nil`，零副作用。
- [ ] **Step 2: 实现 `sync_bridge.lua`**
  - **位置提取（KOReader → Acanthis）**：
    - 读取 `ui.document:getXPointer()`，匹配对应 spine 章节得到 `manifest.chapters[i]`（`chapterId`, `title`, `totalParagraphs`）；
    - 从当前 XPointer / 文档 DOM 定位当前可见块 `id="b<N>"` 得到精确 `paragraphIndex`，若无法直接命中（如纯图页/跨页节点）按章内页码比例兜底估算并夹紧到 `[0, totalParagraphs - 1]`；
    - 构造 `ReadingProgress`（`deviceKind = "ereader"`，`deviceLabel = settings.device_label`，`updatedAt = os.time() * 1000`）。
  - **离线静默队列与上报（Review Focus #4）**：
    - `recordAndMaybePush` 始终先将进度写入 `settings:upsertPendingProgress(progress)`；
    - 当 `opts.interactive == true`（用户手动点击“同步当前书进度”）时经 `NetworkMgr:runWhenOnline` 联网并推送队列；
    - 当 `opts.interactive == false`（`onCloseDocument` / `onSuspend`）时**严禁调用 `runWhenOnline`**，仅在 `NetworkMgr:isOnline()` 为真时静默推送，否则留待下次联网（立即同步书架 / 下卷 / 在线开书）自动调用 `flushPendingQueue` 补传。
  - **拉取与跳转（Acanthis → KOReader）**：
    - `pullAndPromptJump` 比对 `remote.updatedAt > localUpdatedAt`：
      - 同卷：弹出 `ConfirmBox` 询问是否跳转到远端位置（`ui.link:onGotoLink({ xpointer = ... })` 定位至目标章节 `#b<paragraphIndex>`）；
      - 跨卷：弹出 `ConfirmBox` 提示“其他设备已读至《远端卷名》，是否前往卷列表？”，确认后打开该书卷列表。
- [ ] **Step 3: 挂载生命周期钩子到 `main.lua` 与 `ui_bookshelf.lua`**
  - 在 `main.lua` 监听 `onReaderReady`（加载 manifest，若在线且开启自动同步则执行 `flushPendingQueue` + `pullAndPromptJump`）、`onCloseDocument` 与 `onSuspend`（执行静默 `recordAndMaybePush(..., { interactive = false })`）；在阅读器内菜单显示“同步当前书进度”。
  - 在 `ui_bookshelf.lua` 的“立即同步书架”与下载操作前自动执行 `flushPendingQueue`。
- [ ] **Step 4: 全链路三端验证与提交**
  - 端到端核验：
    1. KO1 飞行模式阅读翻页 → 合书/休眠（确认无任何 Wi-Fi 弹窗，队列已落盘）→ 连网点同步 → Web 与 `acanthis-mobile` 历史页显示“电纸书”图标与准确段落位置；
    2. Web/Mobile 推进到同卷后续段落 → KO1 在线打开该卷提示并精准跳段；
    3. Web/Mobile 推进到下一卷 → KO1 提示跨卷并可一键跳转卷列表下载。
  - Commit (in `acanthis-koplugin`): `feat: 实现 Acanthis 清单解析、离线待同步队列与三端阅读进度双向同步`
