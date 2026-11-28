# Acanthis × KOReader（KO1）三步走联动方案设计

- **日期**：2026-11-28
- **状态**：已批准（Approved）
- **涉及仓库**：
  - `Acanthis`（主仓：`packages/core`、`packages/epub`、`packages/storage`、`apps/api-server`、`apps/web`）
  - `acanthis-koplugin`（独立插件仓：`C:\Users\ConstasJ\Coding\acanthis-koplugin`）
  - `acanthis-mobile`（同步适配新增的 `DeviceKind.EREADER` 展示）

---

## 1. 背景与目标（Intent & Why）

为越狱 **Kindle Oasis 1（KO1）+ KOReader** 打造一套与 Acanthis 深度联动的阅读闭环。相比传统的纯 OPDS 方案，通过服务端异步按卷打包 + 专用 KOReader 薄客户端插件，能够同时解决三个核心痛点：

1. **按需爬书不超时**：服务端自动补齐整卷缺失章节与插图并异步打包，KOReader 展示实时进度，避免单次 HTTP GET 超时与上游风控雪崩。
2. **适配 KO1 硬件极限**：KO1 为单核 i.MX6、512MB RAM、4GB 存储（可用约 3GB）、6 寸 1072×1448 黑白墨水屏，且日常以飞行模式离线阅读为主；方案采用按卷下载、服务端 `sharp` 墨水屏图片瘦身、纯列表无封面墙 UI 与显式联网策略。
3. **三端阅读进度闭环**：复用现有 `/v1/sync/state`，结合 `packages/epub` 写入的章节与段落锚点，实现 **Web ↔ Mobile ↔ KOReader** 之间的书架同步与段落级阅读进度双向同步。

---

## 2. 目标、非目标与反目标

### Goals

- **Phase 1（服务端底座）**：
  - 在 `apps/api-server` 接入 `@acanthis-dec/epub`，提供按卷异步构建、进度查询、缓存状态查询与流式下载接口。
  - 抽象 `EpubJobStore` 与磁盘缓存索引，**为后续 Web/Mobile 触发后台预打包预留扩展点**。
  - 在 `packages/epub` 中为按卷 EPUB 写入可选的 Acanthis 同步清单与与 `chapterParser.ts` 对齐的段落锚点。
  - 全链路扩充 `DeviceKind` 枚举，新增 `"ereader"`。
- **Phase 2（`acanthis-koplugin` MVP）**：
  - 在独立仓库 `acanthis-koplugin` 实现纯 LuaJIT 薄客户端：服务配置、拉取 `/v1/sync/state` 书架与分类、查看各卷缓存/本地状态、触发异步打包并带 `Trapper` 进度下载到本地打开、支持删除本地卷释放空间。
- **Phase 3（进度双向同步 + 墨水屏瘦身）**：
  - 实现 KOReader XPointer ↔ Acanthis `(volumeId, chapterId, paragraphIndex)` 双向精准同步。
  - 在 `apps/api-server` 引入 `sharp`（同步更新 `Dockerfile.runtime` 与 `build.ts` externals），提供 `profile=eink` 灰度压缩预设。

### Non-Goals

- 本次不实现 OPDS 1.2 / 2.0 路由（但 Phase 1 的按卷 EPUB 磁盘缓存底座天然可被未来 OPDS 复用）。
- 不在 KOReader 插件中实现排行榜、全站搜索、封面墙或复杂书源筛选（找书/加书架仍由 Web 与移动端承担）。
- Phase 1 不在 `packages/storage` 中新增 SQLite 任务表与数据库迁移（先以内存 `InMemoryEpubJobStore` 实现，保留平滑切换至 SQLite 的接口）。

### Anti-Goals

- **禁止在单个 HTTP GET 下载请求中同步爬取整卷章节**，避免 KO1 超时重连引发并发雪崩。
- **禁止将高分辨率彩图原样灌入 KO1 的默认下载流**，避免 512MB 内存翻图卡顿或 4GB 存储迅速耗尽。
- **禁止插件在后台静默高频轮询网络**，破坏墨水屏飞行模式续航习惯。
- **禁止破坏现有 `packages/epub` 的 CLI/Web 调用方**以及既有 `/v1/sync/state` 向后兼容性。

---

## 3. 关键约束

- **硬件与运行时约束（KO1）**：LuaJIT 环境、无外置依赖（仅使用 KOReader 内置 `socket.http` / `ssl.https` / `rapidjson` / `NetworkMgr` / `Trapper` / `Menu` / `crengine` API），单卷 EPUB 目标体积控制在 1~3MB（`eink` 预设下）。
- **服务端打包与镜像约束**：
  - `apps/api-server/build.ts` 使用 esbuild 单文件打包，`sharp` 必须列入 `external`。
  - `apps/api-server/Dockerfile.runtime` 需安装 `sharp` 并按 `TARGETARCH`（`amd64`/`arm64`）裁剪非目标平台原生二进制，保持与现有 `onnxruntime-node` / `isolated-vm` 一致的裁剪纪律。
  - 新增/修改路由与 schema 必须同步执行 `pnpm --filter=@acanthis-dec/api-server run openapi:generate` 并通过 `openapi:check`。
- **同步契约对齐约束**：
  - `packages/epub` 段落锚点编号必须与 `apps/web/src/utils/chapterParser.ts`（`parseChapterBlocks`）及 `acanthis-mobile` `ChapterParser.kt` 的 `blockIndex` 定义严格一致。
  - `DeviceKind` 扩展需保持旧客户端兼容（未知枚举值在旧版客户端回退为 `unknown`）。

---

## 4. 架构方案对比与选型

| 方案               | 核心思路                                                                                       | 权衡                                                                                                                                    | 结论                                                |
| :----------------- | :--------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------- |
| **方案一（选定）** | **内存任务队列（抽象 `EpubJobStore`）+ 磁盘指纹缓存 + EPUB 内嵌锚点客户端映射 + `sharp` 瘦身** | 零 DB 迁移成本，完全贴合单人自部署；重启仅丢失内存中临时进度，已抓章节全在 `storage` 可秒级续抓；通过 `EpubJobStore` 预留未来预打包扩展 | **采用**（附加预打包扩展点与 `DeviceKind.ereader`） |
| 方案二             | SQLite 持久化任务表 + 跨端预打包 Worker + 专用 KOReader 同步端点                               | 支持重启恢复队列与手机端提前预构建，但改动面过大（DB 迁移、Web/Mobile 联动、额外同步端点）                                              | 暂不采用（预留演进路径）                            |
| 方案三             | 同步长超时 GET 直出 EPUB + 仅章节级粗同步                                                      | 代码量最小，但未缓存整卷时极易超时断连，无进度反馈，且牺牲三端段落级续读体验                                                            | 淘汰                                                |

---

## 5. 详细设计

### 5.1 跨端 `DeviceKind` 枚举扩展

将 `DeviceKind` 从 `"desktop" | "mobile" | "unknown"` 扩展为：

```ts
export type DeviceKind = "desktop" | "mobile" | "ereader" | "unknown";
```

影响面与兼容策略：

1. **`packages/core/src/types.ts`**：更新 `DeviceKind` 类型定义。
2. **`packages/storage/src/table.ts`**：更新 `readingProgress.deviceKind` 列枚举定义（SQLite 列类型为 `TEXT`，无需新增 DDL 迁移脚本，兼容存量数据）。
3. **`apps/api-server/src/schemas/sync.ts`**：更新 `deviceKindSchema` 并重新生成 `openapi.json`。
4. **`apps/web`**：在历史记录/书架进度展示组件（如 `HistoryView.vue`、`BookshelfView.vue` 等引用点）为 `"ereader"` 增加电纸书图标与中文标签（如“电纸书”）。
5. **`acanthis-mobile`**：在 `DeviceKind.kt` 新增 `const val EREADER = "ereader"`、补充识别正则（匹配 `kindle|kobo|koreader|boox|ereader|oasis|paperwhite`），并在 `HistoryScreen.kt` 展示对应图标。

---

### 5.2 `packages/epub` 段落锚点与 Acanthis 同步清单

为保持向后兼容，在 `VolumeEpubInput` 中新增可选字段 `syncMetadata`（未传时行为与现有一致）：

```ts
export interface VolumeEpubSyncMetadata {
	platform: string;
	novelId: string;
	volumeId: string;
	profile: "original" | "eink";
	contentFingerprint: string;
}
```

当传入 `syncMetadata` 时：

1. **章节段落锚点标注（与 `chapterParser.ts` 1:1 对齐）**：
   - 在 `sanitizeChapterHtmlToXhtml` 中、**调用 `normalizeLeadingHeading` 之前**，对清洗后的顶层子节点按与 `parseChapterBlocks` 相同的语义遍历并计数 `blockIndex`（从 `0` 开始）：
     - 非空纯文本节点 → 包裹为 `<p id="b<N>">...</p>`；
     - 顶层 `<img>` 或仅包含单张 `<img>` 的 `<p>` → 赋予 `id="b<N>"`（保留图块占位）；
     - 非空 `<p>` 与标题标签 `h1`~`h6` → 赋予 `id="b<N>"`；
     - 空白文本节点、空 `<p>` 与注释节点跳过不计数。
   - 若 `normalizeLeadingHeading` 额外插入了合成章节标题 `<h1 class="chapter-title">`，该合成标题**不分配 `id="b..."`**，避免与 Web/Mobile 的 `blockIndex` 发生 `+1` 偏移。
   - 同步记录每章统计出的 `totalParagraphs`（即最终块数量）。

2. **包内写入 `OEBPS/acanthis-manifest.json`**：
   - 作为附加文本条目打入 EPUB ZIP（不加入 `spine`，不影响任何标准阅读器翻页），结构如下：

```json
{
	"schemaVersion": 1,
	"platform": "linovelib",
	"novelId": "2930",
	"volumeId": "114514",
	"volumeTitle": "第一卷",
	"profile": "eink",
	"contentFingerprint": "sha256:...",
	"generatedAt": "2026-11-28T14:30:00.000Z",
	"chapters": [
		{
			"index": 1,
			"href": "text/ch-0001.xhtml",
			"chapterId": "123456",
			"title": "序章",
			"totalParagraphs": 42
		}
	]
}
```

---

### 5.3 服务端按卷 EPUB 异步构建与缓存（`apps/api-server`）

#### 5.3.1 配置扩展（`apps/api-server/src/config.ts`）

在 `ConfigSchema` 中新增 `epub` 配置段（同步支持 `config.yaml` 与环境变量）：

| 配置键                   | 环境变量                   | 默认值                        | 说明                                     |
| :----------------------- | :------------------------- | :---------------------------- | :--------------------------------------- |
| `epub.cacheDir`          | `EPUB_CACHE_DIR`           | `${data.filePath}/epub-cache` | EPUB 产物磁盘缓存目录                    |
| `epub.maxCacheBytes`     | `EPUB_MAX_CACHE_BYTES`     | `536870912`（512MB）          | 磁盘缓存上限，超出按 LRU 淘汰            |
| `epub.jobTtlMs`          | `EPUB_JOB_TTL_MS`          | `1800000`（30 分钟）          | 已完成/失败任务记录在内存中的保留时长    |
| `epub.maxConcurrentJobs` | `EPUB_MAX_CONCURRENT_JOBS` | `1`                           | 最大并发构建任务数（保护上游限速与风控） |

#### 5.3.2 缓存键与内容指纹（Content Fingerprint）

- **卷目录刷新**：发起构建时若 `refresh: true` 或本地无卷目录，先拉取小说目录；否则优先读取本地已缓存的卷与章节列表。
- **内容指纹计算**：基于 `(platform, novelId, volumeId, profile, epubSchemaVersion, coverHash, orderedChapterIdsAndContentHashes)` 计算 SHA-256 截断 16 位十六进制。
  - 若卷新增了章节或章节内容哈希变化，指纹自动变化并触发重新打包；
  - 若指纹未变且磁盘缓存文件存在，直接命中返回 `ready`（零重抓、零重打包）。
- **磁盘布局**：
  - `${cacheDir}/${platform}/${novelId}/${volumeId}/${profile}.epub`
  - `${cacheDir}/${platform}/${novelId}/${volumeId}/${profile}.meta.json`（记录 `contentFingerprint`、`sizeBytes`、`chapterCount`、`generatedAt`、`lastAccessedAt`、`warnings`）
  - 写入采用“临时文件 + `rename`”保证原子性，避免下载读到半成品。

#### 5.3.3 任务抽象与预打包扩展点

抽象出存储无关的 `EpubJobStore` 接口：

```ts
export type EpubProfile = "original" | "eink";
export type EpubTriggerSource = "reader" | "prefetch";
export type EpubJobStatus =
	| "queued"
	| "fetching_chapters"
	| "fetching_images"
	| "processing_images"
	| "packing"
	| "ready"
	| "failed";

export interface EpubJobRecord {
	jobId: string;
	dedupeKey: string; // `${platform}:${novelId}:${volumeId}:${profile}`
	platform: string;
	novelId: string;
	volumeId: string;
	profile: EpubProfile;
	triggerSource: EpubTriggerSource;
	status: EpubJobStatus;
	phaseMessage: string;
	current: number;
	total: number;
	warnings: string[];
	error?: string | undefined;
	artifact?:
		| {
				contentFingerprint: string;
				sizeBytes: number;
				chapterCount: number;
				generatedAt: string;
				downloadPath: string;
		  }
		| undefined;
	createdAt: number;
	updatedAt: number;
}
```

- Phase 1 提供 `InMemoryEpubJobStore` + Singleflight 去重（同一 `dedupeKey` 已有活跃任务时直接返回现有 `jobId`，不重复抓取）。
- 后续若需支持 Web/Mobile 触发后台预打包（`triggerSource: "prefetch"`），只需将 `InMemoryEpubJobStore` 替换为 SQLite 实现并在 `api-server` 暴露批量入队接口，**现有单卷构建/轮询/下载接口与磁盘缓存格式无需任何破坏性变更**。

#### 5.3.4 REST API 契约（挂在 `/v1/linovelib/epub` 下，走标准 Bearer 鉴权）

1. **`POST /v1/linovelib/epub/volumes/:novelId/:volumeId/jobs`**
   - Request Body：`{ profile?: "original" | "eink", refresh?: boolean, triggerSource?: "reader" | "prefetch" }`（默认 `profile = "original"`，`refresh = false`，`triggerSource = "reader"`）。
   - Response：
     - 命中有效磁盘缓存（且 `refresh` 未触发新指纹）时，返回 `200` + `{ code: 0, data: { ...jobRecord, status: "ready" } }`；
     - 否则创建或复用活跃任务，返回 `202` + `{ code: 0, data: jobRecord }`。
2. **`GET /v1/linovelib/epub/jobs/:jobId`**
   - Response：`200` 返回最新 `EpubJobRecord`；不存在或已过期返回 `404`。
3. **`GET /v1/linovelib/epub/novels/:novelId/status`**（工程决策：整本批量状态接口，避免 KO1 单核无 Keep-Alive 环境下逐卷发起 15–30 次 HTTPS）
   - Query：`?profile=eink`
   - Response：`200` 返回该小说所有分卷的状态数组，每项包含：
     - `volumeId`、`cached: boolean`（磁盘是否存在可用 `.epub`）
     - `contentFingerprint`（磁盘缓存的指纹，未缓存时为 `null`）
     - `stale: boolean`（比对 SQLite 现有该卷章节集合及 `contentHash` 与磁盘 `.meta.json` 是否已失配；若 SQLite 有新增章节或哈希变更则为 `true`）
     - `chapterCount`（SQLite 当前已知章节数）、`sizeBytes`、`generatedAt`、`activeJobId`
4. **`GET /v1/linovelib/epub/volumes/:novelId/:volumeId/status`**
   - Query：`?profile=eink`
   - Response：`200` 返回单卷缓存与任务状态（字段结构同上述单项，便于单卷构建前/后的精准校验）。
5. **`GET /v1/linovelib/epub/volumes/:novelId/:volumeId/download`**
   - Query：`?profile=eink`
   - 行为：校验磁盘缓存存在后，流式返回 `application/epub+zip`，附带 `ETag: "<contentFingerprint>"`（支持 `If-None-Match` 返回 `304`）、`Content-Length` 与安全转义的 `Content-Disposition: attachment; filename*=UTF-8''...`；缓存不存在返回 `404`（提示先调用 `POST .../jobs`）。
6. **`GET /v1/linovelib/novel/:novelId` 兼容增强**（工程决策：避免 KO1 每次打开卷列表触发上游回源阻塞）
   - 新增可选查询参数 `?cachedOnly=true`（默认 `false`，完全保持现有 Web/Mobile 回源行为不变）；
   - 当 `cachedOnly=true` 且本地 SQLite 已有该小说及分卷目录时，跳过 `isUpdateNeeded()` 上游检查直接返回缓存目录；仅当本地无记录时才回源拉取。

#### 5.3.5 缺章与插图补齐规则

- 章节拉取：遍历目标卷章节列表，跳过无法解析的章节 ID（参考 `apps/cli/src/exporter.ts` 的 `isUnresolvedChapterId` 逻辑并记录 warning）；本地 `storageService` 已有 `contentHash` 且磁盘可读的直接复用，缺失章节经 `linovelibClient` 串行/受控拉取并落盘缓存。
- 插图与封面拉取：解析章节 HTML 中的图片 URL，优先复用本地 `storageService` 缓存，缺失则受控并发（并发度 2~4）拉取落盘；单张图片失败记录 warning 并由 `packages/epub` 渲染为占位文本，不中断整卷构建。
- 仅当整卷最终有效章节数为 `0` 或发生鉴权/致命上游错误时，任务置为 `failed`。

---

### 5.4 墨水屏图片瘦身（Phase 3，`sharp` + Docker Runtime）

- **处理管线（仅 `profile === "eink"` 启用）**：
  - 针对卷封面与所有章节插图，经 `sharp(asset.data)` 处理：
    - `.rotate()`（按 EXIF 自动校正方向）
    - `.resize({ width: 1072, withoutEnlargement: true, fit: "inside" })`
    - `.grayscale()`
    - `.jpeg({ quality: 78, mozjpeg: true })`
  - 统一输出 `mimeType: "image/jpeg"`，天然剥离冗余 EXIF/ICC 元数据。
  - 容错：若单张图片（如异常损坏图或 SVG）经 `sharp` 解码失败，记录 `warn` 日志并回退使用原始图片字节流，保证打包不失败。
- **构建与 Docker 集成**：
  - `apps/api-server/package.json` 新增 `sharp` 依赖。
  - `apps/api-server/build.ts` 将 `"sharp"` 加入 `external`。
  - `apps/api-server/Dockerfile.runtime` 在 `npm install` 阶段安装锁版本的 `sharp`，并参照 `onnxruntime-node`/`isolated-vm` 规则裁剪非目标架构的 `@img/sharp-*` / `@img/sharp-libvips-*` 目录，保持 runtime 镜像精简且可复用 CI `runtime-<hash12>` 缓存机制。

---

### 5.5 `acanthis-koplugin` 插件设计（Phase 2 & 3）

仓库位置：`C:\Users\ConstasJ\Coding\acanthis-koplugin`（发布物为 `acanthis.koplugin/` 目录及对应 `.zip` 包）。

#### 5.5.1 模块结构

```text
acanthis.koplugin/
├── _meta.lua           # 插件元信息（id, fullname, description, version）
├── main.lua            # WidgetContainer 入口、菜单挂载、文档生命周期钩子
├── settings.lua        # 配置读写（LuaSettings，含离线书架快照缓存）
├── api_client.lua      # HTTP(S) 封装（Bearer Token、JSON 解析、流式下载、NetworkMgr 包装）
├── epub_manifest.lua   # 从本地 .epub 读取并缓存 OEBPS/acanthis-manifest.json
├── sync_bridge.lua     # XPointer ↔ (volumeId, chapterId, paragraphIndex) 双向映射与合并
├── storage_mgr.lua     # 本地目录管理（路径规范化、原子写入、删除本地卷）
└── ui_bookshelf.lua    # 极简列表 UI（分类筛选、书架、卷列表、Trapper 构建进度弹窗）
```

#### 5.5.2 交互流程与界面草图（适配 KO1 实体翻页键）

```text
KOReader 主菜单 → Acanthis
├── 1. 我的书架（按分类筛选 / 全部）
│   └── 选中作品 → 卷列表（优先秒读本地目录快照 + 在线静默拉取 ?cachedOnly=true 与批量 /novels/:novelId/status）
│       ├── [刷新目录]              → 显式回源拉取最新分卷目录（不带 cachedOnly）
│       ├── [已下载] 第一卷         → 点击直接打开；长按：检查更新 / 删除本地文件
│       ├── [可更新] 第二卷         → 点击重新构建覆盖；长按：打开旧版 / 删除本地文件
│       └── [未下载] 第三卷         → 点击触发 POST .../jobs → Trapper 轮询进度 → 流式下载 → 自动打开
├── 2. 立即同步书架（显式触发 flush 待同步进度队列 + GET /v1/sync/state 并更新本地快照）
├── 3. 同步当前书进度（阅读器内菜单可见）
└── 4. 插件设置（Server URL / Token / 下载目录 / 图片模式 eink|original / 设备名 / 在线自动同步开关）
```

- **卷状态判定规则**（避免服务端 512MB LRU 淘汰导致误报）：
  - 本地无 `.epub` → `[未下载]`；
  - 本地有 `.epub` 且（服务端 `stale === true`，或服务端 `cached === true` 且 `contentFingerprint !== localFingerprint`，或服务端已知 `chapterCount > localChapterCount`）→ `[可更新]`；
  - 其余情况（包含离线状态或服务端 LRU 淘汰了磁盘缓存但章节数未变）→ 保持 `[已下载]`。
- **离线优先与静默队列**：
  - 离线时可正常浏览本地书架快照与已缓存的卷目录快照，并秒开 `[已下载]` 卷；
  - 仅在用户主动点击联网操作（立即同步书架、刷新目录、下载/更新卷、手动同步进度）时才经 `NetworkMgr:runWhenOnline(...)` 唤起 Wi-Fi；
  - `onCloseDocument` 与 `onSuspend` **绝不弹窗请求开 Wi-Fi**（防止打断飞行模式与休眠）：仅在 `NetworkMgr:isOnline()` 为真且开启自动同步时静默上报，离线时将进度写入 `settings.lua` 的持久化待同步队列（按 `(platform, novelId)` LWW 合并），待下次显式联网操作时自动 flush 补传。
- **本地存储路径**：默认 `<download_dir>/<sanitized_novel_title>/<sanitized_volume_title>.epub`（同目录保存极轻量的 `.acanthis.json` 侧车文件记录已下载卷的 `contentFingerprint` 与 `chapterCount`，用于快速比对更新，无需反复解压 EPUB）。
- **下载原子性**：下载先写入 `.epub.part`，校验 HTTP 200 与完整写入后再 `os.rename` 覆盖目标文件，避免 KO1 断电/断网留下坏文件。

#### 5.5.3 阅读进度双向同步协议（Phase 3）

- **适用判断**：打开文档时，通过 `epub_manifest.lua` 检查文件内是否存在 `OEBPS/acanthis-manifest.json`；普通非 Acanthis 电子书直接忽略，零额外开销。
- **上报（KOReader → `/v1/sync/state`）**：
  - 触发时机：
    - 手动点击“同步当前书进度”（走 `NetworkMgr:runWhenOnline` 联网并同时 flush 待同步队列）；
    - 自动触发（开启“在线自动同步”时）：`onCloseDocument` / `onSuspend` 先将最新进度写入本地持久化待同步队列；若 `NetworkMgr:isOnline()` 为真则静默推送，否则不弹窗、等待下次联网操作（同步书架/下载卷/在线开书）自动补传。
  - 位置提取：读取 Crengine 当前 `xpointer = self.ui.document:getXPointer()`：
    1. 从 XPointer 对应的文档片段（DocFragment / `getCurrentPage()` 所在 spine 项）查清单得到 `chapterId`、`chapterTitle` 与 `totalParagraphs`；
    2. 解析当前页首可见元素对应的 `id="b<N>"` 得到精确 `paragraphIndex`；若遇到跨节点/纯图片页无法直接命中 `b<N>`，则按当前章节内相对页码比例估算 `clamp(floor(ratio * (totalParagraphs - 1)), 0, totalParagraphs - 1)` 作为兜底；
    3. 组装 `ReadingProgress`（`deviceKind = "ereader"`，`deviceLabel = settings.device_label`，默认 `"Kindle Oasis 1"`）推送到 `POST /v1/sync/state`。
- **拉取（`/v1/sync/state` → KOReader）**：
  - 触发时机：打开 Acanthis EPUB 时（若已联网且开启自动拉取）或手动触发同步。
  - 比对 `remote.updatedAt > local.updatedAt`：
    - 若远端进度在**当前卷**：弹窗提示（或自动跳转）定位到目标章节的 `#b<paragraphIndex>`；
    - 若远端进度在**同书其他卷**：弹窗提示“其他设备已读至《卷名》，是否前往该卷？”，确认后跳至卷列表对应项。

---

## 6. 分阶段交付与验证标准

- **Phase 1（`Acanthis` 主仓）**：
  - `DeviceKind` 增加 `"ereader"` 并完成 `core`/`storage`/`api-server`/`web`/`acanthis-mobile` 兼容更新；
  - `packages/epub` 输出 `id="b<N>"` 锚点与 `OEBPS/acanthis-manifest.json`，不破坏现有 `apps/cli` 和 `apps/web`；
  - `apps/api-server` 提供按卷 EPUB 构建/轮询/状态/下载接口与磁盘 LRU 缓存，通过 `check-types`、`build`、`openapi:check` 及真实卷构建端到端验证。
- **Phase 2（`acanthis-koplugin` 独立仓）**：
  - 完成插件核心模块与打包脚本；
  - 在 KOReader 桌面模拟器（及 KO1 真机）跑通：配置连接 → 同步书架 → 选卷触发异步构建看到进度 → 流式下载并打开 → 离线查看与删除本地卷。
- **Phase 3（双向同步 + `sharp` 瘦身）**：
  - `apps/api-server` 与 `Dockerfile.runtime` 集成 `sharp`，验证 `profile=eink` 体积压缩效果与回退容错；
  - 验证 Web/Mobile ↔ KOReader 双向段落级进度同步（含同卷跳转与跨卷提示）。

---

## 7. 留给实现阶段自主决定的细节（Left to the Builder）

以下实现细节无需在设计阶段锁死，由后续计划与实现阶段按工程最佳实践敲定：

- `apps/api-server` 磁盘缓存 LRU 扫描与清理的具体触发时机（写入后异步清理 vs 定时清理）；
- `InMemoryEpubJobStore` 内部过期任务的清理间隔与并发队列调度实现；
- `acanthis-koplugin` 流式写文件的分块大小、HTTP 超时参数（连接超时 vs 读取超时）以及轮询退避间隔（建议 1~2 秒）；
- `acanthis-koplugin` 的本地打包发布脚本（如 zip 打包）与单元测试/模拟测试组织方式；
- `apps/web` 与 `acanthis-mobile` 为 `"ereader"` 选用的具体矢量图标样式。
