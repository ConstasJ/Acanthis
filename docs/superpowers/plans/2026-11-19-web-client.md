# Acanthis 在线浏览 Web 客户端与多源跨端同步实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1（底座多源与鉴权）与 Plan 2（`@acanthis-dec/epub`）基础上，完成跨端同步数据模型与 `/v1/sync/state` 后端接口，并交付本地优先、可切换阅读模式、支持 Web Worker 浏览器直出 EPUB 及多形态部署的 Vue 3 PWA 客户端 `@acanthis-dec/web`（`apps/web`）。

**Architecture:** 后端在 `@acanthis-dec/core` 新增 `BookshelfItem` 与 `ReadingProgress` 共享类型，在 `@acanthis-dec/storage` 新增 `bookshelf_items` 与 `reading_progress` 表（采用客户端事件时间 `updatedAt` 时钟漂移钳制 LWW + 服务端单调递增 `server_updated_at` 游标分离设计），并在 `@acanthis-dec/api-server` 暴露受鉴权保护的 `GET/POST /v1/sync/state`。前端以 Vue 3 + Vite + Pinia + Vue Router + Tailwind CSS v4 构建本地优先 PWA，所有状态先写 IndexedDB（`acanthis-web`）再经防抖/`keepalive` 增量同步，正文经 `DOMPurify` 白名单净化后拆解为 `0-based` 块并在 Web Worker 中复用 `@acanthis-dec/epub` 打包下载。

**Tech Stack:** TypeScript 5.8.3（`apps/web` 局部）/ 7.0.2（其余包）、Drizzle ORM（libSQL/SQLite）、Hono 4、Zod 4、Vue 3、Vite、Vue Router 4、Pinia、Tailwind CSS v4、`DOMPurify`、`lucide-vue-next`、`vite-plugin-pwa`、`@acanthis-dec/epub`、Nginx（Docker）、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-11-19-web-client-design.md`

## Global Constraints

- 跨端阅读进度同步严禁使用像素高度 `scrollTop`，必须统一使用 `0-based` 章节内容块序号 `paragraphIndex` 与 `(platform, novelId)` 复合键。
- 所有章节富文本必须先经过 `DOMPurify` 严格白名单过滤（仅保留 `h1-h6, p, img, br, hr, ruby, rt, rp, span, em, strong, b, i`）后再拆块渲染，严禁未经净化使用 `v-html`。
- 严禁把 `AUTH_TOKEN` 拼入图片 URL 查询参数或依赖跨站 Cookie；JSON 接口统一携带 `Authorization: Bearer <token>`，封面与插图二进制路由保持免 Header 直连。
- `@acanthis-dec/web` 仅在 `apps/web/package.json` 局部声明 `"typescript": "^5.8.3"` 配合 `vue-tsc --noEmit`（工作区其余包保持 `catalog:` 的 `7.0.2`）；`apps/web/tsconfig.json` 继承 `@acanthis-dec/config-typescript/apps.json` 并显式覆盖 `"types": ["vite/client"]` 与 `"jsx": "preserve"`，保持 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`。
- 代码格式与 Lint 严格遵守 Biome（Tab 缩进、双引号、`recommended`、`organizeImports`）；根 `.gitignore` 添加 `!apps/web/index.html` 且 **`apps/web/` 内严禁将任何目录或文件命名为 `data`**（规避 `.gitignore:145` 的裸 `data` 规则，IndexedDB 模块统一置于 `src/db/`）。
- 遵循 `AGENTS.md`：仓库当前无单元测试框架且严禁新增单元测试框架；所有验证以包级 `check-types`（`apps/web` 为 `vue-tsc --noEmit`）、`build`、`pnpm run format-and-lint`、`drizzle-kit generate` 及端到端实测命令为准。
- 实施依赖前置：本计划为三步串联的第三步，假设 Plan 1（`SourceCapability`、`NovelSourceDescriptor`、CORS、`AUTH_TOKEN` 鉴权中间件、`GET /v1/sources`、`GET /v1/:platform/novels`、插图代理与重写、`resolveHost(c)`）与 Plan 2（`@acanthis-dec/epub` 零 Node API 包）均已按三份设计规格文档与前两步实施计划契约就绪。

## Review Focus

1. **时钟超前设备污染 LWW（`updatedAt` 未来时间戳）**：客户端系统时间超前数小时会导致其他正常设备再也无法覆盖进度；`StorageService.mergeSyncState` 必须在事务内先执行 `effectiveUpdatedAt = Math.min(input.updatedAt, Date.now() + 60_000)` 并以此写入 `updated_at`，再用单调 `server_updated_at` 游标驱动 `GET /v1/sync/state?since=`。（落地验证：Task 2、Task 3）
2. **离线重放与多端并发漏同步（`cursor` vs `serverTime` 游标隔离 + 软删除墓碑）**：若客户端误用 `POST /v1/sync/state` 返回的 `serverTime` 推进本地 `lastSyncServerTime`，会跳过同期其他设备写入；客户端 `lastSyncServerTime` **仅能由 `GET /v1/sync/state` 的 `cursor` 推进**，且 `since > 0` 必须包含 `deletedAt !== null` 软删除墓碑项。（落地验证：Task 3、Task 5）
3. **服务端未配对外 `HOST` 导致网页插图/EPUB 裂图与 `sourceUrl` 失配**：分离部署时章节 HTML `<img src>` 可能带有内网/默认 `http://localhost:5301/v1/...` 或相对路径 `/v1/...`；前端 API 层、`parseChapterBlocks` 与 EPUB Web Worker 必须统一执行 `apiBaseUrl` 媒体重定基，并确保传入 `buildVolumeEpub`/`buildNovelEpub` 的 `EpubImageAsset.sourceUrl` 与 `EpubChapterData.html` 内 `<img src>` 字面完全相等，且遇到无封面分卷 `404`（`code: 10001`）时优雅跳过。（落地验证：Task 4、Task 8）
4. **`keepalive` 64KB 载荷保护 + PWA 排除 `/config.js` 与 `/v1/*`**：页面隐藏或切章时 `fetch(..., { keepalive: true })` 超过 64KB 会被浏览器静默丢弃，必须仅推送脏队列并设置 `60KB` 上限降级策略（超限时仅刷写最新一条 `ReadingProgress`）；同时 `vite-plugin-pwa` 必须排除 `/config.js` 预缓存（`NetworkOnly`）与 `/v1/*` 导航回退，防止容器修改 `DEFAULT_API_BASE_URL` 后被旧 SW 锁死。（落地验证：Task 5、Task 9）
5. **未决章节（`TOBEDETERMINED*`）、XSS 注入与双模式切换 `paragraphIndex` 锚定**：详情页、阅读器下一章预取及 EPUB 导出必须统一跳过 `id.startsWith("TOBEDETERMINED")`；`parseChapterBlocks` 必须先做 `DOMPurify` 白名单清洗并忽略空白文本节点以保证 `0-based` `blockIndex` 确定性，`scroll` 与 `paginated` 模式切换时通过 `[data-block-index]` 无损恢复阅读位置。（落地验证：Task 6、Task 7、Task 8）

## Spec 与当前代码库对齐说明

| 对齐项 | Spec / 约定描述 | 仓库当前实况与本计划处理方式 |
| --- | --- | --- |
| 前置依赖分工 | Spec 3 §3 跨步实施基线 | `GET /v1/sources`、`AUTH_TOKEN` 中间件（含 `CORS_ORIGIN` 与 `OPTIONS` 放行）、`resolveHost(c)` 归属 Plan 1；`@acanthis-dec/epub` 归属 Plan 2；本计划聚焦同步类型/表/路由、`apps/web` 及发布工作流，不重复修改 Plan 1/2 已完成符号。 |
| `.gitignore` 规则冲突 | Spec 3 §3 仅提及 `!apps/web/index.html` | 仓库 `.gitignore:143` 有 `*.html` 且 **`.gitignore:145` 有裸 `data` 规则**（会忽略任意层级的 `data` 文件或目录）。Task 4 添加 `!apps/web/index.html`，同时规定 `apps/web/` 内严禁使用 `data` 作为文件或目录名（IndexedDB 模块使用 `src/db/`）。 |
| `turbo.json` 任务缓存输入 | Spec 3 §3 要求补充 `.vue` / `index.html` / `vite.config.ts` | `turbo.json:6-24` 的 `build.inputs` 增补 `**/*.vue`、`index.html`、`vite.config.ts`、`public/**`；`check-types.inputs` 增补 `**/*.vue`、`vite.config.ts`。 |
| TypeScript 与 `tsconfig` | 根 `catalog:` 为 `typescript: "7.0.2"` | `tools/config-typescript/base.json:7,11` 默认含 `"types": ["node"]` 与 `"jsx": "react-jsx"`。Task 4 仅在 `apps/web/package.json` 局部声明 `"typescript": "^5.8.3"`，并在 `apps/web/tsconfig.json` 显式覆盖 `"types": ["vite/client"]` 与 `"jsx": "preserve"`。 |
| `packageManager` 字段 | `AGENTS.md:5` 写 `pnpm@11.6.0` | `package.json:9` 及各子包实际均为 `"pnpm@12.21.0"`。新建 `apps/web/package.json` 统一使用 `"pnpm@12.21.0"`。 |
| Drizzle 唯一索引命名 | Spec 3 §5.1.2 仅写 `UNIQUE(platform, novel_id)` | `packages/storage/src/table.ts:60,78` 存在同名索引先例；Task 2 为新表显式采用全局唯一索引名 `bookshelf_platform_novel_idx` 与 `reading_progress_platform_novel_idx`。 |
| 同步接口 `coverUrl` 规范化 | Spec 3 §5.1.3 要求返回规范化封面 URL | Task 3 直接复用 Plan 1 在 `apps/api-server` 中修正并导出的 `resolveHost(c)`（读取 `config.host ?? c.req.header("host")`），统一规范化为 `${host}/v1/${platform}/cover/novel/${novelId}`。 |
| 游标与默认地址优先级 | Spec 3 §5.1.3 / §5.2.1 / §5.2.4 | `GET /v1/sync/state` 返回 `cursor`（空库返回 `0`），`POST /v1/sync/state` 返回 `serverTime`，客户端仅由 `GET.cursor` 推进游标；`apiBaseUrl` 统一采用 4 级优先级：`localStorage` > `window.__ACANTHIS_CONFIG__?.defaultApiBaseUrl` > `import.meta.env.VITE_DEFAULT_API_BASE_URL` > `"http://localhost:5301"`。 |

---

### Task 1: `@acanthis-dec/core` 新增跨端同步共享类型

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: Plan 1 已在 `packages/core/src/types.ts` 定义的 `SourceCapability` 与 `NovelSourceDescriptor`
- Produces（导出自 `@acanthis-dec/core` 即 `packages/core/src/index.ts`）:
  ```ts
  export interface BookshelfItem {
  	platform: string;
  	novelId: string;
  	title: string;
  	author: string;
  	coverUrl: string;
  	addedAt: number;
  	updatedAt: number;
  	deletedAt: number | null;
  }

  export interface ReadingProgress {
  	platform: string;
  	novelId: string;
  	novelTitle: string;
  	coverUrl: string;
  	volumeId: string;
  	volumeTitle: string;
  	chapterId: string;
  	chapterTitle: string;
  	paragraphIndex: number;
  	totalParagraphs: number;
  	deviceLabel: string;
  	updatedAt: number;
  }
  ```

- [ ] **Step 1: 在 `packages/core/src/types.ts` 定义 `BookshelfItem` 与 `ReadingProgress`**

  在 `packages/core/src/types.ts` 末尾追加上述两个 `interface`（严格保留 `deletedAt: number | null`、`paragraphIndex: number` `0-based` 语义及所有字段名）。

- [ ] **Step 2: 在 `packages/core/src/index.ts` 导出新增类型**

  在 `packages/core/src/index.ts` 的 `export type { ... } from "./types"` 中补充导出 `BookshelfItem` 与 `ReadingProgress`。

- [ ] **Step 3: 运行类型检查、构建与 Biome 检查**

  Run:
  `pnpm --filter=@acanthis-dec/core run check-types && pnpm --filter=@acanthis-dec/core run build && pnpm run format-and-lint`
  Expected: 全部退出码 `0`，`packages/core/dist/index.d.mts` 中包含 `BookshelfItem` 与 `ReadingProgress` 类型声明。

- [ ] **Step 4: 提交 `@acanthis-dec/core` 改动**

  ```bash
  git add packages/core/src/types.ts packages/core/src/index.ts
  git commit -m "feat(core): 新增书架项与阅读进度跨端同步类型定义" -m "在 @acanthis-dec/core 中定义并导出 BookshelfItem 与 ReadingProgress 接口，供存储层、API 同步路由与 Web 客户端共享使用。"
  ```

---

### Task 2: `@acanthis-dec/storage` 新增同步数据表、Drizzle 迁移与 LWW 同步方法

**Files:**
- Modify: `packages/storage/src/table.ts`
- Modify: `packages/storage/src/db.ts`
- Modify: `packages/storage/src/service.ts`
- Modify: `packages/storage/src/index.ts`
- Generate: `packages/storage/migrations/<timestamp>_*/migration.sql`（通过 `drizzle-kit generate` 生成，严禁手写迁移文件）

**Interfaces:**
- Consumes: `BookshelfItem`, `ReadingProgress` from `@acanthis-dec/core`
- Produces（导出自 `packages/storage/src/service.ts` 经 `packages/storage/src/index.ts` 再导出）:
  ```ts
  // StorageService 新增实例方法
  getSyncState(since?: number): Promise<{
  	bookshelf: BookshelfItem[];
  	progress: ReadingProgress[];
  	cursor: number;
  }>;
  mergeSyncState(input: {
  	bookshelf?: BookshelfItem[];
  	progress?: ReadingProgress[];
  }): Promise<{
  	bookshelf: BookshelfItem[];
  	progress: ReadingProgress[];
  	serverTime: number;
  }>;
  ```

- [ ] **Step 1: 在 `packages/storage/src/table.ts` 新增 `bookshelfItems` 与 `readingProgress` 表并纳入 `relations`**

  - `bookshelfItems`（SQL 表名 `"bookshelf_items"`）：列 `id`（自增主键）、`platform`、`novelId` (`"novel_id"`)、`title`、`author`、`coverUrl` (`"cover_url"`)、`addedAt` (`"added_at"`)、`updatedAt` (`"updated_at"`)、`serverUpdatedAt` (`"server_updated_at"`)、`deletedAt` (`"deleted_at"`, 可空 integer)；复合唯一约束 `unique("bookshelf_platform_novel_idx").on(table.platform, table.novelId)`。
  - `readingProgress`（SQL 表名 `"reading_progress"`）：列 `id`（自增主键）、`platform`、`novelId` (`"novel_id"`)、`novelTitle` (`"novel_title"`)、`coverUrl` (`"cover_url"`)、`volumeId` (`"volume_id"`)、`volumeTitle` (`"volume_title"`)、`chapterId` (`"chapter_id"`)、`chapterTitle` (`"chapter_title"`)、`paragraphIndex` (`"paragraph_index"`)、`totalParagraphs` (`"total_paragraphs"`)、`deviceLabel` (`"device_label"`)、`updatedAt` (`"updated_at"`)、`serverUpdatedAt` (`"server_updated_at"`)；复合唯一约束 `unique("reading_progress_platform_novel_idx").on(table.platform, table.novelId)`。
  - 将 `bookshelfItems` 与 `readingProgress` 加入 `defineRelations({ ... })` 首参对象中，确保 `DatabaseService` 关系型查询与 Drizzle schema 完整对齐。

- [ ] **Step 2: 生成 Drizzle SQLite 迁移并核对生成 SQL**

  Run: `pnpm --filter=@acanthis-dec/storage exec drizzle-kit generate`
  Expected: 在 `packages/storage/migrations/` 生成新迁移目录；检查其中的 `migration.sql` 确认包含 `CREATE TABLE \`bookshelf_items\``、`CREATE TABLE \`reading_progress\`` 及唯一索引 `bookshelf_platform_novel_idx`、`reading_progress_platform_novel_idx`。

- [ ] **Step 3: 在 `packages/storage/src/db.ts` 与 `service.ts` 实现 `getSyncState` 与 `mergeSyncState`**

  核心算法要点（务必严格实现，对应 Review Focus #1 & #2）：
  - **公共游标查询**：分别求 `MAX(server_updated_at)`（空表记为 `0`），取两者最大值 `maxCursor`。
  - **`getSyncState(since?: number)`**：
    - 当 `since === undefined || since <= 0`：查询 `bookshelf_items` 中 `isNull(bookshelfItems.deletedAt)` 的有效书架项与 `reading_progress` 全量记录；返回 `{ bookshelf, progress, cursor: maxCursor }`（空库返回 `cursor: 0`）。
    - 当 `since > 0`：查询 `bookshelf_items` 中 `gt(bookshelfItems.serverUpdatedAt, since)`（**必须包含 `deletedAt !== null` 的软删除墓碑**）与 `reading_progress` 中 `gt(readingProgress.serverUpdatedAt, since)`；返回 `{ bookshelf, progress, cursor: Math.max(since, maxCursor) }`。
    - 映射为 `BookshelfItem` / `ReadingProgress` 时剥离内部 `id` 与 `serverUpdatedAt` 字段。
  - **`mergeSyncState(input)`**：
    - 在单个 `await this.db.transaction(async (tx) => { ... })` 内执行；先查询当前两表最大 `server_updated_at` 作为 `lastCursor`。
    - 定义单调游标生成器 `nextCursor = () => { lastCursor = Math.max(Date.now(), lastCursor + 1); return lastCursor; }`。
    - 对每条输入记录执行**时钟漂移钳制**：`const effectiveUpdatedAt = Math.min(item.updatedAt, Date.now() + 60_000)`；按 `(platform, novelId)` 查找现有行：
      - 若不存在或 `effectiveUpdatedAt >= existing.updatedAt`，则执行 upsert，并将 `updated_at` 存为 `effectiveUpdatedAt`、`server_updated_at` 存为 `nextCursor()`；
      - 否则保留 `existing` 不覆盖。
    - 按 `(platform, novelId)` 去重收集**仅针对本次请求提交键的合并后权威记录**（若同一键在单次请求出现多次，以最终生效状态返回一条），`serverTime` 取 `Math.max(Date.now(), lastCursor)`。
  - 在 `StorageService`（`packages/storage/src/service.ts`）透传 `getSyncState` 与 `mergeSyncState`，并确认 `packages/storage/src/index.ts` 导出完整类型。

- [ ] **Step 4: 运行存储层类型检查、构建、Lint 与无框架实测脚本**

  1. Run: `pnpm --filter=@acanthis-dec/storage run check-types && pnpm --filter=@acanthis-dec/storage run build && pnpm run format-and-lint`
     Expected: 全部退出码 `0`。
  2. Run（使用临时 SQLite 文件实测 Review Focus #1 & #2）:
     使用 `pnpm --filter=@acanthis-dec/storage exec tsx -e "..."` 创建临时 `StorageService`，依次验证：
     - 空库调用 `getSyncState()` 返回 `cursor === 0`；
     - 调用 `mergeSyncState` 提交 `updatedAt: Date.now() + 86_400_000` 的记录，断言返回值中 `updatedAt <= Date.now() + 60_000`（时钟超前钳制生效）；
     - 提交 `deletedAt: Date.now()` 软删除，断言 `getSyncState()` 不含该墓碑而 `getSyncState(prevCursor)` 包含该墓碑且 `cursor` 单调递增；清理临时数据库文件。
     Expected: 所有断言打印通过并退出码 `0`。

- [ ] **Step 5: 提交 `@acanthis-dec/storage` 改动与迁移文件**

  ```bash
  git add packages/storage/src/table.ts packages/storage/src/db.ts packages/storage/src/service.ts packages/storage/src/index.ts packages/storage/migrations
  git commit -m "feat(storage): 新增书架与阅读进度同步表、Drizzle 迁移及 LWW 合并方法" -m "新增 bookshelf_items 与 reading_progress 表及复合唯一索引，生成 Drizzle 迁移并在 StorageService 实现带时钟漂移钳制的 LWW 合并与单调游标增量查询。"
  ```

---

### Task 3: `@acanthis-dec/api-server` 新增 `/v1/sync/state` 同步路由

**Files:**
- Create: `apps/api-server/src/sync.ts`
- Modify: `apps/api-server/src/index.ts`

**Interfaces:**
- Consumes:
  - `BookshelfItem`, `ReadingProgress` from `@acanthis-dec/core`
  - `storageService`, `logger` from `./services`
  - `resolveHost(c: Context): string` from `./utils`（由 Plan 1 提取并修正 `c.req.header("host")`）
  - Plan 1 已挂载在 `apps/api-server/src/index.ts` 上的 CORS 中间件与可选 `AUTH_TOKEN` Bearer 鉴权中间件
- Produces（挂载于 `app.route("/sync", SyncRoutes)`，完整路径如下）:
  - `GET /v1/sync/state?since=<optional int>=0>` -> `{ code: 0, message: "Success", data: { bookshelf: BookshelfItem[], progress: ReadingProgress[], cursor: number } }`
  - `POST /v1/sync/state`（Body: `{ bookshelf?: BookshelfItem[], progress?: ReadingProgress[] }`） -> `{ code: 0, message: "Success", data: { bookshelf: BookshelfItem[], progress: ReadingProgress[], serverTime: number } }`

- [ ] **Step 1: 创建 `apps/api-server/src/sync.ts` 实现 `GET /state` 与 `POST /state`**

  - 使用 `zValidator` 定义输入校验：
    - `syncQuerySchema`：`since` 为可选非负整数（`z.coerce.number().int().min(0).optional()`，当未传或空串时视为 `undefined`）。
    - `syncPushSchema`：`bookshelf: z.array(bookshelfItemSchema).optional()`、`progress: z.array(readingProgressSchema).optional()`，其中 `paragraphIndex`、`totalParagraphs` 为 `int().min(0)`，`deletedAt` 为 `z.number().nullable()`。
  - 注意配合 `exactOptionalPropertyTypes: true` 构造传给 `storageService.mergeSyncState` 的对象（仅在字段非 `undefined` 时包含属性）。
  - 返回前调用 `resolveHost(c)` 统一规范化每条 `BookshelfItem` 与 `ReadingProgress` 的 `coverUrl` 为 `${host}/v1/${encodeURIComponent(item.platform)}/cover/novel/${encodeURIComponent(item.novelId)}`。
  - 统一使用 `try/catch` 捕获异常并通过 `logger.error` 记录堆栈，返回 `500` `{ code: 20000, message: "Internal Server Error" }`；正常响应严格遵循 `{ code: 0, message: "Success", data }` Envelope。

- [ ] **Step 2: 在 `apps/api-server/src/index.ts` 挂载 `/sync` 路由**

  在 `apps/api-server/src/index.ts` 的 CORS 与 Auth 中间件之后挂载 `app.route("/sync", SyncRoutes)`，确保 `/v1/sync/state` 自动受 `AUTH_TOKEN` 保护且支持浏览器 CORS 预检与 `Authorization` Header。

- [ ] **Step 3: 运行类型检查、构建、Lint 与 HTTP 端到端实测**

  1. Run: `pnpm --filter=@acanthis-dec/api-server run check-types && pnpm --filter=@acanthis-dec/api-server run build && pnpm run format-and-lint`
     Expected: 全部退出码 `0`。
  2. 启动本地测试实例（设置临时 `DATA_DB_PATH`、`DATA_FILE_PATH`、`AUTH_TOKEN=test-secret`）并用 `curl` / PowerShell `Invoke-RestMethod` 实测（覆盖 Review Focus #1 & #2）：
     - 无 Token 请求 `GET http://localhost:5301/v1/sync/state` -> HTTP `401`，`{ code: 40100, message: "Unauthorized" }`；
     - 带 `Authorization: Bearer test-secret` 请求 `GET /v1/sync/state` -> `200`，`data.cursor === 0`；
     - `POST /v1/sync/state` 提交带未来时间 `updatedAt = Date.now() + 86400000` 的进度与一条书架项 -> `200`，返回 `data.progress[0].updatedAt <= Date.now() + 60000` 且 `coverUrl` 为 `${host}/v1/linovelib/cover/novel/...`；
     - 记录上一步 `GET /v1/sync/state` 的 `cursor`（记为 `C1`），再 `POST /v1/sync/state` 提交书架项 `deletedAt: Date.now()` -> 验证 `GET /v1/sync/state`（不带 `since`）不再返回该书架项，而 `GET /v1/sync/state?since=C1` **返回该墓碑项**且 `cursor > C1`。

- [ ] **Step 4: 提交 `apps/api-server` 同步路由改动**

  ```bash
  git add apps/api-server/src/sync.ts apps/api-server/src/index.ts
  git commit -m "feat(api-server): 新增受鉴权保护的 /v1/sync/state 跨端同步接口" -m "实现 GET 与 POST /v1/sync/state 路由，使用 Zod 校验载荷并复用 resolveHost(c) 规范化封面地址，支持增量游标与软删除墓碑下发。"
  ```

---

### Task 4: `apps/web` 工程脚手架、工具链适配、运行时配置与 API 客户端

**Files:**
- Modify: `.gitignore:143`
- Modify: `turbo.json:4-24`
- Modify: `biome.json`（可选：仅当 Step 2 中 Biome 2.6.8 对 `.vue`/`.html`/`.css` 规则冲突需调整时修改）
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/index.html`
- Create: `apps/web/public/config.js`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/env.d.ts`
- Create: `apps/web/src/styles/main.css`
- Create: `apps/web/src/config/runtime.ts`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/main.ts`
- Create: `apps/web/src/App.vue`

**Interfaces:**
- Consumes: `NovelSourceDescriptor`, `NovelSearchResult`, `NovelInfo`, `Novel`, `BookshelfItem`, `ReadingProgress` from `@acanthis-dec/core`
- Produces:
  - `apps/web/src/config/runtime.ts`:
    - `STORAGE_KEYS`: `{ apiBaseUrl, authToken, deviceLabel, readerSettings, selectedPlatform, lastSyncServerTime }`
    - `normalizeBaseUrl(url: string): string`
    - `resolveApiBaseUrl(): string`（4 级优先级：`localStorage` > `window.__ACANTHIS_CONFIG__?.defaultApiBaseUrl` > `import.meta.env.VITE_DEFAULT_API_BASE_URL` > `"http://localhost:5301"`）
    - `detectDefaultDeviceLabel(): string`
  - `apps/web/src/api/client.ts`:
    - `ApiError`（含 `status: number`、`code: number`、`message: string`）
    - `rebaseMediaUrl(rawUrl: string | null | undefined, apiBaseUrl?: string): string`
    - `fetchSources(): Promise<NovelSourceDescriptor[]>`
    - `fetchNovels(platform: string, page: number, pageSize?: number): Promise<{ items: NovelInfo[]; total: number; page: number; pageSize: number }>`
    - `searchNovels(platform: string, keyword: string, signal?: AbortSignal): Promise<NovelSearchResult[]>`
    - `fetchNovelDetail(platform: string, novelId: string): Promise<Novel>`
    - `fetchChapterContent(platform: string, chapterId: string, novelId: string): Promise<{ content: string }>`（始终附带 `?novelId=`）
    - `fetchSyncState(since?: number): Promise<{ bookshelf: BookshelfItem[]; progress: ReadingProgress[]; cursor: number }>`
    - `postSyncState(payload: { bookshelf?: BookshelfItem[]; progress?: ReadingProgress[] }, options?: { keepalive?: boolean }): Promise<{ bookshelf: BookshelfItem[]; progress: ReadingProgress[]; serverTime: number }>`

- [ ] **Step 1: 适配 `.gitignore` 与 `turbo.json`**

  - 在 `.gitignore:143` 的 `*.html` 下一行追加 `!apps/web/index.html`；**严禁修改或删除第 145 行 `data`（因此 `apps/web` 内不得出现任何名为 `data` 的目录或文件）**。
  - 在 `turbo.json` 的 `tasks.build.inputs` 补充 `"**/*.vue"`, `"index.html"`, `"vite.config.ts"`, `"public/**"`；在 `tasks.check-types.inputs` 补充 `"**/*.vue"`, `"vite.config.ts"`。

- [ ] **Step 2: 创建 `apps/web` 基础包配置与 Vite/TS 脚手架**

  - `apps/web/package.json`：`"name": "@acanthis-dec/web"`、`"private": true`、`"type": "module"`、`"packageManager": "pnpm@12.21.0"`；scripts：`dev` (`vite`)、`build` (`vite build`)、`preview` (`vite preview`)、`check-types` (`vue-tsc --noEmit`)；dependencies：`@acanthis-dec/core: workspace:*`、`@acanthis-dec/epub: workspace:*`、`vue`、`vue-router`、`pinia`、`dompurify`、`lucide-vue-next`；devDependencies：`@acanthis-dec/config-typescript: workspace:*`、`@vitejs/plugin-vue`、`@tailwindcss/vite`、`tailwindcss`、`vite`、`vite-plugin-pwa`、`vue-tsc`、`@types/dompurify`、`"typescript": "^5.8.3"`。
  - `apps/web/tsconfig.json`：`"extends": "@acanthis-dec/config-typescript/apps.json"`，覆盖 `"types": ["vite/client"]`、`"jsx": "preserve"`、`"paths": { "@/*": ["./src/*"] }`，包含 `src/**/*.ts`、`src/**/*.d.ts`、`src/**/*.vue`、`vite.config.ts`。
  - `apps/web/public/config.js`：`window.__ACANTHIS_CONFIG__ = window.__ACANTHIS_CONFIG__ || {};`。
  - `apps/web/index.html`：移动端 viewport（`viewport-fit=cover`），并在 `<script type="module" src="/src/main.ts"></script>` 之前引入 `<script src="/config.js"></script>`。
  - `apps/web/vite.config.ts`：配置 `vue()`、`tailwindcss()`、`resolve.alias`（`@` -> `./src`）、`worker: { format: "es" }`。
  - `apps/web/src/env.d.ts`、`apps/web/src/styles/main.css`（定义亮色/羊皮纸护眼色/OLED 纯黑三套主题 CSS 变量与安全区辅助样式）、最小可编译 `src/main.ts` 与 `src/App.vue`。
  - 如运行 `pnpm run format-and-lint` 时 Biome 2.6.8 对 `.vue` / `.css` / 后续 `.html` 存在格式规则冲突，按项目惯例保持 `.ts`/`.json`/`.css` 遵守 Biome 规则（若在 `biome.json` 中补充 `.vue`/`.html`/`.css` 兼容处理，避免放宽既有 TS Lint 规则，且须一并纳入 Step 5 的 `git add`）。

- [ ] **Step 3: 实现 `src/config/runtime.ts` 与 `src/api/client.ts`**

  - `resolveApiBaseUrl()` 严格按 4 级优先级求值并调用 `normalizeBaseUrl`（去除空白与尾部 `/`）：
    1. `localStorage.getItem(STORAGE_KEYS.apiBaseUrl)`
    2. `window.__ACANTHIS_CONFIG__?.defaultApiBaseUrl`
    3. `import.meta.env.VITE_DEFAULT_API_BASE_URL`
    4. `"http://localhost:5301"`
  - `rebaseMediaUrl(rawUrl, apiBaseUrl)`（对应 Review Focus #3）：
    - 若 `rawUrl` 为空返回 `""`；
    - 若以 `/v1/` 开头，拼接 `${resolvedBase}${rawUrl}`；
    - 若能解析为 `http(s)://...` 且 `pathname.startsWith("/v1/")`，将其 `origin` 替换为 `resolvedBase`（保留 `pathname + search`），解决远端部署下服务端仍返回 `http://localhost:5301/v1/...` 导致的裂图问题；其他外链原样返回。
  - HTTP 请求统一解包 `{ code, message, data }` Envelope；若 `authToken` 非空自动附带 `Authorization: Bearer ${authToken}`；非 `2xx` 或 `code !== 0` 抛出 `ApiError(status, code, message)`。

- [ ] **Step 4: 安装依赖并验证类型检查、构建、Lint 与媒体重定基**

  1. Run: `pnpm install`
     Expected: `pnpm-lock.yaml` 仅增量更新 `@acanthis-dec/web` 依赖，工作区其他包保持原状。
  2. Run: `git check-ignore -v apps/web/index.html`
     Expected: 退出码 `1`（未被忽略，`!apps/web/index.html` 生效）。
  3. Run: `pnpm --filter=@acanthis-dec/web run check-types && pnpm --filter=@acanthis-dec/web run build && pnpm run format-and-lint`
     Expected: `vue-tsc --noEmit`、`vite build` 与 `biome check .` 全部通过，产出 `apps/web/dist/index.html` 与 `apps/web/dist/config.js`。
  4. 在 `vite dev` 页面控制台或轻量验证脚本实测 `rebaseMediaUrl("http://localhost:5301/v1/linovelib/illustration/abc123...", "https://api.example.com")` 返回 `"https://api.example.com/v1/linovelib/illustration/abc123..."`，且 `resolveApiBaseUrl()` 按 4 级优先级正确回退。

- [ ] **Step 5: 提交 `apps/web` 脚手架与工具链适配改动**

  （若 Step 2 中因 `.vue`/`.html`/`.css` 兼容调整了根目录 `biome.json`，须将 `biome.json` 一并加入下方 `git add`。）
  ```bash
  git add .gitignore turbo.json pnpm-lock.yaml apps/web/package.json apps/web/tsconfig.json apps/web/index.html apps/web/public/config.js apps/web/vite.config.ts apps/web/src/env.d.ts apps/web/src/styles/main.css apps/web/src/config/runtime.ts apps/web/src/api/client.ts apps/web/src/main.ts apps/web/src/App.vue
  git commit -m "feat(web): 初始化 @acanthis-dec/web 脚手架、工具链适配与 API 客户端" -m "配置 .gitignore 与 turbo.json 适配 Vue/Vite，局部声明 typescript@^5.8.3 与 tsconfig 覆盖，实现 4 级 apiBaseUrl 解析、Bearer 鉴权封装与媒体 URL 重定基。"
  ```

---

### Task 5: `apps/web` 本地优先存储（IndexedDB）与 Pinia 同步状态机

**Files:**
- Create: `apps/web/src/db/indexedDb.ts`
- Create: `apps/web/src/stores/settings.ts`
- Create: `apps/web/src/stores/sources.ts`
- Create: `apps/web/src/stores/library.ts`

**Interfaces:**
- Consumes:
  - `BookshelfItem`, `ReadingProgress`, `Novel`, `NovelSourceDescriptor` from `@acanthis-dec/core`
  - `STORAGE_KEYS`, `resolveApiBaseUrl`, `detectDefaultDeviceLabel` from `@/config/runtime`
  - `fetchSources`, `fetchSyncState`, `postSyncState`, `ApiError` from `@/api/client`
- Produces:
  - `apps/web/src/db/indexedDb.ts`:
    - `CachedChapterRecord`: `{ key: string; platform: string; novelId: string; chapterId: string; title: string; content: string; accessedAt: number }`
    - `DirtySyncEntry`: `{ key: string; kind: "bookshelf" | "progress"; platform: string; novelId: string; updatedAt: number }`
    - `webDb`：封装 `getAllBookshelf()`, `putBookshelf(item)`, `bulkPutBookshelf(items)`, `getAllProgress()`, `putProgress(item)`, `bulkPutProgress(items)`, `getDirtyEntries()`, `putDirtyEntry(entry)`, `deleteDirtyEntries(keys)`, `getNovelCache(platform, novelId)`, `putNovelCache(novel)`, `getChapterCache(platform, chapterId)`, `putChapterCache(record, maxEntries = 200)`, `getChapterCacheStats()`, `clearChapterCache()`
  - `apps/web/src/stores/settings.ts` (`useSettingsStore`): `apiBaseUrl`, `authToken`, `deviceLabel`, `selectedExplorePlatform`, `lastSyncServerTime`, `readerSettings`（`mode: "scroll" | "paginated"`, `theme: "light" | "sepia" | "oled"`, `fontSize`, `lineHeight`, `pagePadding`）及持久化 setters
  - `apps/web/src/stores/sources.ts` (`useSourcesStore`): `sources`, `loading`, `error`, `needsSetup`, `refreshSources()`
  - `apps/web/src/stores/library.ts` (`useLibraryStore`): `bookshelfMap`, `progressMap`, `activeBookshelf`, `continueReadingItem`, `syncStatus`, `syncNow()`, `toggleBookshelf(entry: { platform: string; novelId: string; title: string; author: string; coverUrl: string }): Promise<boolean>`, `updateReadingProgress(progress: ReadingProgress): Promise<void>`, `flushOnLeave(): void`

- [ ] **Step 1: 实现 `apps/web/src/db/indexedDb.ts`**

  - 建立 IndexedDB 数据库 `acanthis-web`（`version = 1`），创建 5 个 Object Store：`bookshelf`（`keyPath: "compositeKey"`，值为 `${platform}:${novelId}`）、`progress`（`keyPath: "compositeKey"`）、`dirtyQueue`（`keyPath: "key"`，格式 `${kind}:${platform}:${novelId}`）、`novels`（`keyPath: "compositeKey"`）、`chapters`（`keyPath: "key"`，格式 `${platform}:${chapterId}`，索引 `by_accessedAt`）。
  - `putChapterCache` 写入后检查总数，若超出 `200` 条则按 `by_accessedAt` 游标升序淘汰最旧记录，防止移动端 IndexedDB 配额膨胀。

- [ ] **Step 2: 实现 `settings.ts` 与 `sources.ts` Pinia Store**

  - `useSettingsStore`：从 `localStorage` 初始化；保存 `apiBaseUrl` 时同步写入 `STORAGE_KEYS.apiBaseUrl` 并在修改后重置 `lastSyncServerTime = 0`（可选或保留以重新全量拉取）；`readerSettings` 默认 `mode = "scroll"`、`theme = "light"`、`fontSize = 18`、`lineHeight = 1.8`、`pagePadding = 20`。
  - `useSourcesStore`：`refreshSources()` 调用 `fetchSources()`；若网络失败或捕获 `ApiError`（`status === 401` 或 `code === 40100`），置 `needsSetup = true` 并记录友好错误信息供 `SetupBanner` 展示。

- [ ] **Step 3: 实现 `useLibraryStore`（本地优先读写 + 同步状态机）**

  核心算法要点（对应 Review Focus #2 & #4）：
  1. **游标严格隔离**：`hydrate()` 从 IndexedDB 加载全部 `bookshelf` 与 `progress`；`syncNow()` 仅在先将 `dirtyQueue` 通过 `postSyncState` 推送并清除已成功推送键之后，再调用 `fetchSyncState(settings.lastSyncServerTime)`，并**仅使用 `GET` 返回的 `cursor` 更新 `settings.lastSyncServerTime`**（`POST` 返回的 `serverTime` 绝对不写入 `lastSyncServerTime`）。
  2. **本地 LWW 合并**：收到远端 `bookshelf`（含 `deletedAt !== null` 墓碑）或 `progress` 时，仅当本地无记录或 `remote.updatedAt >= local.updatedAt` 时覆盖内存与 IndexedDB；UI 列表 `activeBookshelf` 过滤 `deletedAt === null`。
  3. **软删除墓碑**：`toggleBookshelf` 移除收藏时**不从 IndexedDB 物理删除**，而是写入 `deletedAt = now, updatedAt = now` 并入队 `dirtyQueue`，确保跨端同步可删除其他设备书架项。
  4. **2s 防抖 + `keepalive` 64KB 保护**：`updateReadingProgress` 立即更新内存与 IndexedDB 并入队 `dirtyQueue`，开启 `2000ms` 防抖推送；`flushOnLeave()`（由 `visibilitychange -> hidden`、`pagehide` 及路由切出调用）先取消防抖，构造脏载荷并用 `new TextEncoder().encode(JSON.stringify(payload)).byteLength` 检测体积：若 `> 60 * 1024` 字节，自动降级为仅发送最新一条 `ReadingProgress`，随后调用 `postSyncState(payload, { keepalive: true })`。

- [ ] **Step 4: 验证类型检查、构建、Lint 与离线/同步/载荷保护实测**

  1. Run: `pnpm --filter=@acanthis-dec/web run check-types && pnpm --filter=@acanthis-dec/web run build && pnpm run format-and-lint`
     Expected: 全部退出码 `0`。
  2. 浏览器 DevTools 实测（连接 Task 3 运行中的 `api-server`）：
     - 断网（Offline）状态下在内存/控制台触发 `toggleBookshelf` 与 `updateReadingProgress` -> 检查 Application -> IndexedDB `acanthis-web` 中 `dirtyQueue`、`bookshelf`、`progress` 落盘成功；
     - 恢复网络调用 `syncNow()` -> Network 面板确认依次发出 `POST /v1/sync/state` 与 `GET /v1/sync/state?since=...`，且 `localStorage` 中 `lastSyncServerTime` 等于 `GET` 的 `cursor`；
     - 写入超长脏队列并触发 `pagehide` -> Network 面板确认 `keepalive` 请求体 `< 64KB` 且包含最新阅读进度（Review Focus #4）。

- [ ] **Step 5: 提交 IndexedDB 与 Pinia 同步状态机改动**

  ```bash
  git add apps/web/src/db/indexedDb.ts apps/web/src/stores/settings.ts apps/web/src/stores/sources.ts apps/web/src/stores/library.ts
  git commit -m "feat(web): 实现 IndexedDB 本地优先存储与 Pinia 增量同步状态机" -m "建立 5 个 IndexedDB Store 与 200 章 LRU 缓存，实现 GET cursor 与 POST serverTime 游标隔离、软删除墓碑合并、2s 防抖推送及 keepalive 64KB 降级保护。"
  ```

---

### Task 6: `apps/web` 响应式壳层、路由与四大视图（书架 / 发现 / 详情 / 设置）

**Files:**
- Create: `apps/web/src/router/index.ts`
- Create: `apps/web/src/components/AppShell.vue`
- Create: `apps/web/src/components/SetupBanner.vue`
- Create: `apps/web/src/views/BookshelfView.vue`
- Create: `apps/web/src/views/ExploreView.vue`
- Create: `apps/web/src/views/NovelDetailView.vue`
- Create: `apps/web/src/views/SettingsView.vue`
- Modify: `apps/web/src/App.vue`
- Modify: `apps/web/src/main.ts`

**Interfaces:**
- Consumes:
  - `useSettingsStore`, `useSourcesStore`, `useLibraryStore`
  - `fetchNovels`, `searchNovels`, `fetchNovelDetail`, `rebaseMediaUrl` from `@/api/client`
  - `webDb` from `@/db/indexedDb`
- Produces:
  - Vue Router 5 条 History 路由：`/`（`bookshelf`）、`/explore`（`explore`）、`/novel/:platform/:novelId`（`novel-detail`）、`/read/:platform/:novelId/:chapterId`（`reader`，Task 6 先使用内联占位组件以确保独立通过 `vue-tsc` 与 `vite build`，Task 7 替换为 `ReaderView.vue`，标注 `meta: { immersive: true }`）、`/settings`（`settings`）
  - `NovelDetailView.vue` 预留 EPUB 导出触发槽位与分卷勾选状态（Task 8 接入 Web Worker 导出）

- [ ] **Step 1: 实现 `router/index.ts`、`AppShell.vue` 与 `SetupBanner.vue`**

  - `AppShell.vue`：当路由 `meta.immersive === true`（阅读页）隐藏导航；在移动端（`< md`）固定底部三栏导航（书架 `/`、书源·发现 `/explore`、设置 `/settings`），适配 `env(safe-area-inset-bottom)`；在桌面端（`>= md`）切换为左侧 Navigation Rail。
  - `SetupBanner.vue`：当 `sourcesStore.needsSetup` 为真（未配置后端、网络不可达或 `401`）时，在书架与发现页顶部展示温和引导卡片，点击跳转 `/settings`。

- [ ] **Step 2: 实现 `BookshelfView.vue` 与 `ExploreView.vue`**

  - `BookshelfView.vue`：
    - 顶部“继续阅读”主卡片：读取 `libraryStore.continueReadingItem`（`progressMap` 中 `updatedAt` 最大者），展示经 `rebaseMediaUrl` 重定基的封面、书名、书源角标、卷章名、百分比进度（`paragraphIndex + 1` / `totalParagraphs`）与 `deviceLabel` + 相对时间，点击直达 `/read/:platform/:novelId/:chapterId`；
    - 收藏网格：展示 `activeBookshelf`（`deletedAt === null`），左上角显示书源徽标，支持“最近阅读 / 最近添加”排序切换与菜单移除（触发软删除）。
  - `ExploreView.vue`：
    - 顶部渲染 `/v1/sources` 返回的书源切换胶囊，记住并持久化 `selectedExplorePlatform`；
    - 搜索框为空时分页请求 `fetchNovels(platform, page)`；
    - 搜索时使用 `AbortController` 自动取消上一条未完成请求，请求超过 `1.5s` 展示友好提示（说明源站可能需要数秒过验证码）。

- [ ] **Step 3: 实现 `NovelDetailView.vue` 与 `SettingsView.vue` 并装配 `App.vue` / `main.ts`**

  - `NovelDetailView.vue`：先读 `webDb.getNovelCache` 秒开并后台刷新 `fetchNovelDetail` 回写缓存；展示作品信息、加入/移出书架按钮、“开始阅读 / 续读至第 X 章”主按钮；分卷折叠列表展示分卷封面（`rebaseMediaUrl`）与章节，对 `chapter.id.startsWith("TOBEDETERMINED")` 的未决章节置灰禁用点击并标注“源站暂未公开链接”（对应 Review Focus #5）；预留单卷“导出本卷 EPUB”与“批量选卷/整书导出”按钮交互。
  - `SettingsView.vue`：提供 `API Base URL` 与 `Access Token` 表单、“测试连接”按钮（请求 `fetchSources()` 并显示可用书源数量与延迟）、`deviceLabel` 自定义、阅读外观全局默认值、“立即同步”按钮、离线章节缓存计数与一键清空按钮。
  - `main.ts` / `App.vue`：注册 Pinia 与 Router，启动时执行 `libraryStore.hydrate()` -> `sourcesStore.refreshSources()` -> `libraryStore.syncNow()`，挂载 `document` 的 `visibilitychange`（切回前台同步、切入后台 `flushOnLeave`）与 `pagehide` 监听。

- [ ] **Step 4: 验证类型检查、构建、Lint 与四视图端到端联调**

  1. Run: `pnpm --filter=@acanthis-dec/web run check-types && pnpm --filter=@acanthis-dec/web run build && pnpm run format-and-lint`
     Expected: 全部退出码 `0`。
  2. 启动 `api-server` 与 `pnpm --filter=@acanthis-dec/web run dev`，在浏览器（含 Chrome DevTools 移动端 `390x844` 与桌面端 `1280x800`）逐项实测：
     - 设错误 Token 后打开 `/` 或 `/explore` -> 展示 `SetupBanner` 引导跳转 `/settings`；
     - 在 `/settings` 填入正确地址与 Token 点击“测试连接” -> 显示成功并返回已启用书源 `linovelib`；
     - 在 `/explore` 分页浏览与关键词搜索 -> 切换搜索词时前一次未完成请求在 Network 显示 `canceled`；
     - 进入含未决章节的 `/novel/linovelib/<novelId>` -> `TOBEDETERMINED*` 章节呈现禁用态无法点击（Review Focus #5）；加入书架后返回 `/`，验证收藏网格与桌面/移动端响应式导航切换正常。

- [ ] **Step 5: 提交响应式壳层与四大页面改动**

  ```bash
  git add apps/web/src/router/index.ts apps/web/src/components/AppShell.vue apps/web/src/components/SetupBanner.vue apps/web/src/views/BookshelfView.vue apps/web/src/views/ExploreView.vue apps/web/src/views/NovelDetailView.vue apps/web/src/views/SettingsView.vue apps/web/src/App.vue apps/web/src/main.ts
  git commit -m "feat(web): 实现响应式导航壳层与书架、发现、详情、设置四大视图" -m "搭建 Vue Router History 路由与移动端底导/桌面端 Rail 自适应布局，完成多书源发现、详情目录未决章节禁用、本地书架与设置连接测试页面。"
  ```

---

### Task 7: `apps/web` 沉浸式阅读器引擎（`DOMPurify` + 双模式无损切换 + 预取 + 跨端提示）

**Files:**
- Create: `apps/web/src/utils/chapterParser.ts`
- Create: `apps/web/src/composables/useNextChapterPrefetch.ts`
- Create: `apps/web/src/views/ReaderView.vue`
- Modify: `apps/web/src/router/index.ts`（将 `/read/:platform/:novelId/:chapterId` 指向真实 `ReaderView.vue`）

**Interfaces:**
- Consumes:
  - `fetchChapterContent`, `fetchNovelDetail`, `rebaseMediaUrl` from `@/api/client`
  - `webDb` from `@/db/indexedDb`
  - `useLibraryStore`, `useSettingsStore`
- Produces:
  - `apps/web/src/utils/chapterParser.ts`:
    ```ts
    export type ReaderBlock =
    	| { blockIndex: number; kind: "heading"; tag: string; html: string }
    	| { blockIndex: number; kind: "paragraph"; html: string }
    	| { blockIndex: number; kind: "image"; src: string; alt: string };

    export function parseChapterBlocks(rawHtml: string, apiBaseUrl: string): ReaderBlock[];
    ```
  - `apps/web/src/composables/useNextChapterPrefetch.ts`:
    - `useNextChapterPrefetch(options: { platform: Ref<string>; novelId: Ref<string>; chapterId: Ref<string>; novel: Ref<Novel | null>; stableMs?: number }): void`

- [ ] **Step 1: 实现 `apps/web/src/utils/chapterParser.ts`**

  核心安全与分块规则（对应 Review Focus #3 & #5）：
  - 先调用 `DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS: ["h1","h2","h3","h4","h5","h6","p","img","br","hr","ruby","rt","rp","span","em","strong","b","i"], ALLOWED_ATTR: ["src","alt","title","class"], ALLOW_DATA_ATTR: false })`；
  - 使用 `DOMParser` 解析净化结果 `body.childNodes`：跳过空白文本节点（`!node.textContent?.trim()`），保证 `0-based` `blockIndex` 稳定递增；
  - 对所有 `<img>`（包括仅包裹单个 `<img>` 的 `<p>`）执行 `rebaseMediaUrl(img.getAttribute("src"), apiBaseUrl)` 并拆为 `{ blockIndex, kind: "image", src, alt }`；其余 `h1-h6` 拆为 `heading`，`p` 或文本节点拆为 `paragraph`（内部嵌套 `<img>` 亦同步重定基）。

- [ ] **Step 2: 实现 `apps/web/src/composables/useNextChapterPrefetch.ts`**

  - 监听当前 `(platform, novelId, chapterId)` 变化，清理上一定时器；
  - 进入章节稳定 `1500ms` 后，从已缓存 `novel.volumes` 扁平目录定位当前章之后的**首个非 `id.startsWith("TOBEDETERMINED")` 章节**（Review Focus #5）；
  - 若 `webDb.getChapterCache(platform, nextChapter.id)` 未命中，静默调用 `fetchChapterContent(platform, nextChapter.id, novelId)` 并写入 `webDb.putChapterCache(..., 200)`（出错静默吞掉，不打扰阅读）。

- [ ] **Step 3: 实现 `apps/web/src/views/ReaderView.vue` 并接入路由**

  核心交互与双模式锚定算法（对应 Review Focus #5）：
  1. **读取章节与路由参数**：先查 `webDb.getChapterCache`，未命中则调用 `fetchChapterContent(platform, chapterId, novelId)` 并写入 LRU 缓存；若目录缺失则拉取 `fetchNovelDetail` 缓存目录；支持 `?paragraph=<n>` 查询参数初始定位。
  2. **上下滚动模式（`mode === "scroll"`，默认）**：单栏流式渲染 `ReaderBlock[]`，每个块绑定 `data-block-index="block.blockIndex"`，底部放置“上一章 / 目录 / 下一章”；通过滚动节流 / `IntersectionObserver` 计算视口上 `1/4` 基准线命中的 `[data-block-index]` 更新 `paragraphIndex` 并调用 `libraryStore.updateReadingProgress`。
  3. **左右翻页模式（`mode === "paginated"`）**：固定视口高度容器使用 CSS 多栏布局（`column-width`、`column-gap`、图片 `break-inside: avoid`），通过水平偏移切换页码；支持左 `1/3` 上一页 / 右 `1/3` 下一页 / 中 `1/3` 显隐阅读 HUD、移动端左右滑动手势（Swipe `>= 40px`）与键盘 `ArrowLeft`/`ArrowRight`；翻页后取当前视口内首个可见 `[data-block-index]` 更新 `paragraphIndex`。
  4. **无损切换模式**：切换 `scroll` <-> `paginated` 时先记录 `anchor = currentParagraphIndex`，在 `await nextTick()` + 字体/布局计算后查找 `[data-block-index="${anchor}"]`，`scroll` 模式执行 `scrollIntoView({ block: "start" })`，`paginated` 模式根据元素水平偏移 `Math.floor(el.offsetLeft / pageStride)` 立即跳转到对应页。
  5. **跨设备进度提示**：进入阅读器完成首轮 `syncNow()` 后，若远端进度 `updatedAt` 晚于本地：
     - 同章且 `Math.abs(remote.paragraphIndex - currentParagraphIndex) >= 3`：直接平滑定位到 `remote.paragraphIndex` 并显示轻量 Toast `已同步至上次阅读位置`；
     - 不同章：底部非侵入式浮现提示条 `其他设备（${remote.deviceLabel}）已读到「${remote.chapterTitle}」，是否跳转？`。
  6. **离开刷写与外观控制**：HUD 菜单支持切换三套主题（亮色 / 羊皮纸护眼色 / OLED 纯黑）、字号、行高、目录抽屉（禁用 `TOBEDETERMINED*`）与本卷 EPUB 导出；在 `onBeforeRouteLeave` 调用 `libraryStore.flushOnLeave()`。

- [ ] **Step 4: 运行类型检查、构建、Lint 与阅读器专项端到端实测**

  1. Run: `pnpm --filter=@acanthis-dec/web run check-types && pnpm --filter=@acanthis-dec/web run build && pnpm run format-and-lint`
     Expected: 全部退出码 `0`。
  2. 浏览器端到端实测（覆盖 Review Focus #3 & #5）：
     - **XSS 过滤验证**：拦截 `/v1/:platform/chapter/:id` 注入 `<script>window.__xss=1</script><p>正文</p><img src="/v1/linovelib/illustration/deadbeef" onerror="window.__xss=2">` -> 验证 DOM 中无 `<script>`、`onerror` 属性、`window.__xss === undefined`，且 `<img>` `src` 已重定基为当前 `apiBaseUrl`；
     - **双模式无损锚定验证**：在滚动模式滑至第 10 段（`[data-block-index="10"]`），切为左右翻页模式 -> 验证当前页首可见块仍为第 10 段附近且不丢位置；翻 2 页后再切回滚动模式 -> 验证视口对齐到新 `paragraphIndex`；
     - **下一章预取与未决章节跳过**：停留 2 秒后检查 IndexedDB `chapters`，验证下一正常章已缓存，且当下一章为 `TOBEDETERMINED*` 时不发起错误请求；
     - **跨设备提示验证**：通过 `POST /v1/sync/state` 写入更高 `updatedAt` 的同章（`+5` 段）与异章记录，重新进入阅读器分别验证 Toast 自动跳转与底部跳转提示条。

- [ ] **Step 5: 提交阅读器引擎改动**

  ```bash
  git add apps/web/src/utils/chapterParser.ts apps/web/src/composables/useNextChapterPrefetch.ts apps/web/src/views/ReaderView.vue apps/web/src/router/index.ts
  git commit -m "feat(web): 实现安全分块阅读器、滚动/翻页双模式无损切换与预取" -m "基于 DOMPurify 白名单过滤实现 0-based parseChapterBlocks 与媒体重定基，支持滚动与 CSS 多栏翻页以 paragraphIndex 无损互切、1.5s 下一章预取及跨端进度同步提示。"
  ```

---

### Task 8: `apps/web` Web Worker 浏览器直出 EPUB 导出

**Files:**
- Create: `apps/web/src/workers/epub.worker.ts`
- Create: `apps/web/src/services/epubExport.ts`
- Modify: `apps/web/src/views/NovelDetailView.vue`
- Modify: `apps/web/src/views/ReaderView.vue`

**Interfaces:**
- Consumes:
  - `buildVolumeEpub`, `buildNovelEpub`, `EpubImageAsset`, `EpubChapterData`, `EpubVolumeData`, `VolumeEpubInput`, `NovelEpubInput` from `@acanthis-dec/epub`（Plan 2 导出）
  - `Novel`, `Volume` from `@acanthis-dec/core`
  - `rebaseMediaUrl` from `@/api/client`
  - `webDb` from `@/db/indexedDb`
- Produces:
  - `apps/web/src/workers/epub.worker.ts` 消息协议：
    - 入站 `EpubWorkerRequest`: `{ kind: "volume" | "novel"; apiBaseUrl: string; authToken: string; novel: Novel; volumeIds: string[]; cachedChapters: Record<string, string> }`（`cachedChapters` 以 `chapterId` 为键）
    - 出站 `EpubWorkerResponse`: `{ type: "progress"; stage: "chapters" | "images" | "packaging"; completed: number; total: number; message: string } | { type: "done"; fileName: string; buffer: ArrayBuffer } | { type: "error"; message: string }`
  - `apps/web/src/services/epubExport.ts`:
    - `exportVolumeEpub(options: { apiBaseUrl: string; authToken: string; novel: Novel; volumeId: string; onProgress?: (p: EpubExportProgress) => void; signal?: AbortSignal }): Promise<void>`
    - `exportNovelEpub(options: { apiBaseUrl: string; authToken: string; novel: Novel; volumeIds: string[]; onProgress?: (p: EpubExportProgress) => void; signal?: AbortSignal }): Promise<void>`

- [ ] **Step 1: 实现 `apps/web/src/workers/epub.worker.ts`**

  核心契约与容错细节（对应 Review Focus #3 & #5 及 `2026-11-19-epub-and-cli.md` Task 4 媒体重定基与无封面分卷容错约定）：
  - **Worker 全局作用域类型安全**：在文件顶部注明 `/// <reference lib="webworker" />` 并使用 `const workerSelf = self as unknown as DedicatedWorkerGlobalScope`（或单独拆出 `apps/web/tsconfig.worker.json` 覆盖 `"lib": ["ESNext", "WebWorker"]` 并纳入 `check-types`），避免单一 `tsconfig.json` 带默认 DOM lib 时将 `self` 推导为 `Window` 导致 `postMessage` 重载报错；
  - 过滤所选分卷中的未决章节（`chapter.id.startsWith("TOBEDETERMINED")`）；
  - 章节正文优先使用主线程传入的 `cachedChapters[chapterId]`，缺失时请求 `${apiBaseUrl}/v1/${platform}/chapter/${chapterId}?novelId=${novel.id}`（携带 `Authorization: Bearer <token>`）；
  - **媒体重定基与 `sourceUrl` 严格一致**：将章节 HTML 内所有 `<img src="...">`（含 `/v1/...` 或旧 host `/v1/...`）统一先通过 `rebaseMediaUrl(src, apiBaseUrl)` 规范化并写回 `EpubChapterData.html`，再收集去重后的 `<img src>` 列表作为拉图 URL 与 `EpubImageAsset.sourceUrl`，确保 **`EpubImageAsset.sourceUrl` 与 `EpubChapterData.html` 中的 `<img src>` 字面 100% 相等**；
  - 使用 `concurrency = 4` 并发队列下载插图、作品封面及分卷封面（图片请求不带 `Authorization` Header）；遇到分卷封面返回 `404`（`code: 10001`）时优雅省略该分卷封面，不得中断导出；单个插图下载失败时记录告警并降级跳过；
  - 调用 `buildVolumeEpub` 或 `buildNovelEpub` 生成 `bytes: Uint8Array`，通过 `const transferBuffer = new Uint8Array(bytes).buffer` 将缓冲区收窄为纯 `ArrayBuffer`（规避 TS 5.8 中 `Uint8Array.buffer` 为 `ArrayBufferLike` 不可直接传给 `Transferable[]` 的类型错误），再调用 `workerSelf.postMessage({ type: "done", fileName, buffer: transferBuffer }, [transferBuffer])` 零拷贝传回主线程。

- [ ] **Step 2: 实现 `apps/web/src/services/epubExport.ts` 并接入 `NovelDetailView.vue` / `ReaderView.vue`**

  - `epubExport.ts` 在拉起 Worker 前从 `webDb` 读取所选章节的已缓存正文预填充 `cachedChapters`，避免重复网络请求；收到 `done` 后构造 `new Blob([buffer], { type: "application/epub+zip" })` 触发 `<a download>` 下载并延迟 `URL.revokeObjectURL`，支持 `AbortSignal` 终止 Worker 并清理资源。
  - 在 `NovelDetailView.vue` 接入单卷“导出本卷 EPUB”及顶部“整书/批量选卷导出”弹窗与进度条；在 `ReaderView.vue` 菜单接入“导出当前卷 EPUB”。

- [ ] **Step 3: 运行类型检查、构建、Lint 与浏览器内 EPUB 打包实测**

  1. Run: `pnpm --filter=@acanthis-dec/web run check-types && pnpm --filter=@acanthis-dec/web run build && pnpm run format-and-lint`
     Expected: 全部退出码 `0`。
  2. 在 `NovelDetailView` 对一部包含插图且存在无封面分卷（`/cover/volume/:id` 返回 `404`）的作品执行“导出本卷 EPUB”与“批量导出 EPUB”：
     - 确认主线程滚动与交互在导出期间不卡顿，进度条实时递增；
     - 确认跳过 `TOBEDETERMINED*` 章节且无封面分卷 `404` 未导致导出失败（Review Focus #3 & #5）；
     - 解压下载的 `.epub` 文件（如 PowerShell `Expand-Archive` 或 `unzip -l`），核对 `META-INF/container.xml`、`content.opf`、章节 XHTML `<img src>` 与 `images/*` 资源均完整存在且可被阅读器正常打开。

- [ ] **Step 4: 提交 Web Worker EPUB 导出改动**

  ```bash
  git add apps/web/src/workers/epub.worker.ts apps/web/src/services/epubExport.ts apps/web/src/views/NovelDetailView.vue apps/web/src/views/ReaderView.vue
  git commit -m "feat(web): 在 Web Worker 中集成 @acanthis-dec/epub 实现浏览器直出导出" -m "实现独立 ES Web Worker 按并发 4 拉取缺失章节与插图，保证 EpubImageAsset.sourceUrl 与正文 <img> 精确一致并容错无封面分卷 404，在详情页与阅读器提供进度条导出下载。"
  ```

---

### Task 9: PWA 离线配置与多形态构建分发（ESA / Pages / Docker / GitHub Release / CI）

**Files:**
- Modify: `apps/web/vite.config.ts`
- Create: `apps/web/public/favicon.svg`
- Create: `apps/web/public/pwa-192x192.png`
- Create: `apps/web/public/pwa-512x512.png`
- Create: `esa.jsonc`（仓库根目录）
- Create: `apps/web/public/_redirects`
- Create: `apps/web/vercel.json`
- Create: `apps/web/docker/nginx.conf`
- Create: `apps/web/docker/40-acanthis-config.sh`
- Create: `apps/web/Dockerfile`
- Create: `.github/workflows/web-release.yml`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `apps/web/dist/` 构建产物、`public/config.js` 运行时配置协议（`window.__ACANTHIS_CONFIG__.defaultApiBaseUrl`）
- Produces:
  - PWA Service Worker 规则（严格排除 `/config.js` 预缓存与 `/v1/*` 导航回退）
  - 静态平台部署配置（`esa.jsonc`、`apps/web/public/_redirects`、`apps/web/vercel.json`）
  - 容器镜像构建文件（`apps/web/Dockerfile` + `DEFAULT_API_BASE_URL` 注入脚本）
  - GitHub Workflows（`.github/workflows/web-release.yml` 与更新 `.github/workflows/ci.yml`）

- [ ] **Step 1: 配置 `vite-plugin-pwa` 与应用图标**

  - 在 `apps/web/public/` 生成基础 `favicon.svg`、`pwa-192x192.png`、`pwa-512x512.png`。
  - 在 `apps/web/vite.config.ts` 挂载 `VitePWA`（`registerType: "autoUpdate"`），配置 `manifest`（`name: "Acanthis"`、`display: "standalone"`、192/512 图标）；在 `workbox` 配置中（对应 Review Focus #4）：
    - `globIgnores: ["**/config.js"]`（禁止将 `/config.js` 打入预缓存清单）；
    - `navigateFallback: "/index.html"` 与 `navigateFallbackDenylist: [/^\/v1\//, /^\/config\.js$/]`；
    - `runtimeCaching` 为 `/\/config\.js$/` 指定 `handler: "NetworkOnly"`，保证容器修改 `DEFAULT_API_BASE_URL` 后立即生效。

- [ ] **Step 2: 创建静态托管平台配置（`esa.jsonc`、`_redirects`、`vercel.json`）**

  - 仓库根目录 `esa.jsonc`：按 Spec 3 §5.2.4 配置 `"installCommand": "pnpm install --filter=@acanthis-dec/web... --frozen-lockfile"`、`"buildCommand": "pnpm --filter=@acanthis-dec/web... run build"`、`"assets": { "directory": "./apps/web/dist", "notFoundStrategy": "singlePageApplication" }`。
  - `apps/web/public/_redirects`：`/* /index.html 200`（Cloudflare Pages / Netlify）。
  - `apps/web/vercel.json`：SPA rewrite 将非静态文件请求重写至 `/index.html`。

- [ ] **Step 3: 创建 `apps/web/Dockerfile` 与 Nginx 运行时配置**

  - `apps/web/docker/nginx.conf`：配置 `try_files $uri $uri/ /index.html;` SPA 路由回退；`/assets/` 长期不可变缓存（`immutable`）；`/config.js` 与 `/sw.js` 设置 `Cache-Control: no-store, max-age=0`。
  - `apps/web/docker/40-acanthis-config.sh`：置于 `/docker-entrypoint.d/`（`chmod +x`），当环境变量 `DEFAULT_API_BASE_URL` 非空时生成合法 JS（通过转义双引号/反斜杠或 `jq -n` 安全写入 `window.__ACANTHIS_CONFIG__ = { defaultApiBaseUrl: ... };`）覆盖 `/usr/share/nginx/html/config.js`。
  - `apps/web/Dockerfile`：多阶段构建，构建阶段基于 `node:24-slim` + `corepack`，执行 `pnpm install --filter=@acanthis-dec/web... --frozen-lockfile` 与 `pnpm --filter=@acanthis-dec/web... run build`（完全跳过后端原生 C++ 依赖）；运行阶段基于 `nginx:alpine`，拷贝 `apps/web/dist`、`nginx.conf` 与 `40-acanthis-config.sh`。

- [ ] **Step 4: 创建 `.github/workflows/web-release.yml` 并更新 `.github/workflows/ci.yml`**

  - `.github/workflows/web-release.yml`：监听 `@acanthis-dec/web@*` tag 与 `workflow_dispatch`：
    1. 使用 `pnpm install --filter=@acanthis-dec/web... --frozen-lockfile` 与 `pnpm --filter=@acanthis-dec/web... run build` 构建静态产物，打包为 `acanthis-web-v${VERSION}-dist.zip` 并生成 `SHA256SUMS.txt`，使用 `softprops/action-gh-release` 上传至 GitHub Release；
    2. 使用 `docker/build-push-action@v7`（`platforms: linux/amd64,linux/arm64`，`file: apps/web/Dockerfile`）推送 semver 与 `latest` 标签至 `ghcr.io/constasj/acanthis-web` 与 `constasj0721/acanthis-web`。
  - `.github/workflows/ci.yml`：在 `changes` job 的 `filters` 补充 `web-src`（`apps/web/**`、`esa.jsonc`），且 `outputs` 与条件判断均统一使用 `web-src`（即 `web-src: ${{ steps.changes.outputs.web-src }}`，与现有 `api-server-src` / `packages-src` 命名一致）；保留既有 `quality` job（`lint`、`check-types:affected`、`build:affected` 将自动校验 `@acanthis-dec/web`）；新增 `web-canary` job（`master` 分支推送且 `needs.changes.outputs.web-src == 'true'`、`packages-src` 或 `ci` 变更时构建多架构或当前架构镜像推送 `ghcr.io/constasj/acanthis-web:canary` 与 `canary-<shortsha>`）。

- [ ] **Step 5: 验证 PWA Service Worker 规则、全工作区检查与容器运行期注入**

  1. Run: `pnpm run format-and-lint && pnpm run check-types && pnpm run build`
     Expected: 全工作区 Biome、`tsc`/`vue-tsc`、打包构建全部通过（退出码 `0`）。
  2. 检查 `apps/web/dist/sw.js`（Review Focus #4）：
     - 检索 `dist/sw.js` 内容，确认预缓存列表不包含 `config.js`，且存在 `/v1/` 与 `/config.js` 的 `navigateFallbackDenylist` 及 `NetworkOnly` 规则。
  3. 验证过滤安装与容器运行时注入（若本机已启动 Docker Daemon 执行完整容器实测；否则至少完成静态产物 + `nginx`/preview 验证并记录）：
     - `docker build -f apps/web/Dockerfile -t acanthis-web:test .`
     - `docker run -d --rm -p 18080:80 -e DEFAULT_API_BASE_URL=https://api.example.com --name acanthis-web-test acanthis-web:test`
     - `curl -s http://localhost:18080/config.js` -> 包含 `"https://api.example.com"` 且响应头含 `Cache-Control: no-store`；
     - `curl -s -o /dev/null -w "%{http_code}" http://localhost:18080/explore` -> 返回 `200`（SPA 回退成功）；清理测试容器 `docker stop acanthis-web-test`。

- [ ] **Step 6: 提交 PWA、多形态部署配置与 CI/Release 工作流**

  ```bash
  git add esa.jsonc apps/web/vite.config.ts apps/web/public apps/web/vercel.json apps/web/docker apps/web/Dockerfile .github/workflows/web-release.yml .github/workflows/ci.yml
  git commit -m "feat(web): 配置 PWA 离线排除规则与多形态部署发布流水线" -m "集成 vite-plugin-pwa 排除 /config.js 与 /v1/* 缓存，新增 esa.jsonc、Pages/Vercel 路由回退、nginx 运行期注入 Dockerfile 及 web-release/CI 工作流。"
  ```
