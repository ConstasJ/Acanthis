# 图书馆体验升级（阅读历史、多书架与元数据标签筛选）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `Acanthis`（后端/存储/Web 端）与 `acanthis-mobile`（Android/Desktop KMP App）同步落地 LNReader 风格阅读历史、多对多自定义多书架，以及书架与服务器缓存双端的元数据题材标签/状态筛选，并完成发版前验证与 Changeset。

**Architecture:** 向后兼容扩展 `GET/POST /v1/sync/state`（新增 `categories` 同步实体、`BookshelfItem.categoryIds/genres/status`、`ReadingProgress.historyHiddenAt`），服务端按 `novels` + `novel_genres` 自动补齐书架条目元数据，并扩展 `GET /v1/linovelib/novels` 与新增 `GET /v1/linovelib/genres` 支持服务器缓存筛选；Web 端 IndexedDB 升至 `v2`、App 端 Room 升至 `v3` 并补齐显式 `MIGRATION_2_3`，两端在首次 schema 升级时一次性将同步游标归零以补齐老书元数据。

**Tech Stack:** TypeScript ESM、Drizzle ORM (SQLite/libSQL)、Hono + Zod + `hono-openapi`、Vue 3 + Pinia + Tailwind + IndexedDB、Kotlin Multiplatform + Compose Multiplatform + Room + Ktor + Kotlin Test。

**Spec:** `c:\Users\ConstasJ\Coding\Acanthis\docs\superpowers\specs\2026-11-21-library-history-shelves-tags-design.md`

## Global Constraints

- 所有新同步字段（`categories`、`BookshelfItem.categoryIds/genres/status`、`ReadingProgress.historyHiddenAt`）在请求体中均为可选，老客户端调用 `/v1/sync/state` 不得报错或覆盖服务端已有值。
- `historyHiddenAt` 合并严格遵循 **max-wins**，与阅读位置字段的 LWW（按 `updatedAt`）相互独立；历史可见条件恒为 `historyHiddenAt == null || updatedAt > historyHiddenAt`。
- 单条删除历史立即落库并弹出轻提示，不提供 Undo 按钮；清空全部历史前必须弹出二次确认弹窗。
- 内置「全部」与「默认」为虚拟视图，不写入 `bookshelf_categories`；删除自定义书架仅软删除分类，绝不删除 `bookshelf_items`。
- `Acanthis` 仓库不新增测试框架，以 `pnpm check-types`、`pnpm build`、`openapi:check`、定向 `pnpm exec biome check <changed-files>` 与 `tsx` 验证脚本验证；`acanthis-mobile` 仓库以 `.\gradlew.bat :composeApp:testAndroidHostTest` 与 `.\gradlew.bat :androidApp:assembleDebug` 验证。
- 每个独立任务完成后按 Conventional Commits（中文摘要 + 详细 body）原子提交；**严禁擅自 `git push`**。
- Windows 非交互 PowerShell 执行 Node/pnpm 命令前先初始化 `fnm`：`fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression`。

## Review Focus

1. **旧客户端推送不带新字段**：`POST /v1/sync/state` 收到不含 `categoryIds`/`genres`/`status`/`historyHiddenAt` 的载荷时，服务端更新既有记录必须保留原值，不能覆写为空数组或 `null`（Task 2 验证）。
2. **删除历史后同毫秒内重读**：客户端在 `updateReadingProgress` 时若 `Date.now() <= existing.historyHiddenAt`，必须将新 `updatedAt` 设为 `Math.max(Date.now(), (existing.historyHiddenAt ?? 0) + 1)`，保证重读必然立即重现于历史顶部（Task 4、Task 10 验证）。
3. **删除书架后残留无效 `categoryIds`**：A 设备删掉书架 X 而 B 设备把书放进 X 同步后，两端书架过滤逻辑必须先按活跃 `categories` ID 集合过滤 `categoryIds`，过滤后为空则自动归入「默认」视图，确保书籍不失踪（Task 4、Task 12 验证）。
4. **空白/超长书架名与非法输入**：创建/重命名书架必须 `trim()` 并校验长度 `1..32`，拒绝纯空白或超长字符串（Task 3、Task 4、Task 10 验证）。
5. **服务器缓存筛选边界参数**：`GET /v1/linovelib/novels` 收到 `genres=,,`（空段/重复）或 `q` 含 `%`/`_` 时，需去空去重且转义 SQLite `LIKE` 通配符，避免误匹配全表（Task 2、Task 3 验证）。

---

## Phase 1: Backend & Shared Contracts (`c:\Users\ConstasJ\Coding\Acanthis`)

### Task 1: 扩展 `@acanthis-dec/core` 共享领域类型

**Files:**
- Modify: `packages/core/src/types.ts:55-80`
- Modify: `packages/core/src/index.ts:8-31`

**Interfaces:**
- Produces:
  - `BookshelfCategory` (`id`, `name`, `sortOrder`, `createdAt`, `updatedAt`, `deletedAt`)
  - `BookshelfItem` 扩展可选字段 `categoryIds?: string[]`, `genres?: string[]`, `status?: NovelStatus`
  - `ReadingProgress` 扩展可选字段 `historyHiddenAt?: number | null`
  - `CachedGenreItem` (`name: string`, `count: number`)

- [ ] **Step 1: 更新 `packages/core/src/types.ts` 与 `packages/core/src/index.ts`**
  按设计文档第 3.1 节精确定义 `BookshelfCategory`、`CachedGenreItem`，并在 `BookshelfItem` 与 `ReadingProgress` 中补充上述可选字段，在 `packages/core/src/index.ts` 导出新增类型。

- [ ] **Step 2: 运行类型检查、构建与 Biome 校验**
  Run: `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; pnpm --filter=@acanthis-dec/core run check-types; pnpm --filter=@acanthis-dec/core run build; pnpm exec biome check packages/core/src/types.ts packages/core/src/index.ts`
  Expected: 0 errors, 0 warnings.

- [ ] **Step 3: 提交**
  ```bash
  git add packages/core/src/types.ts packages/core/src/index.ts
  git commit -m "feat(core): 扩展书架分类、元数据快照与历史隐藏同步类型" -m "- 新增 BookshelfCategory 与 CachedGenreItem 类型定义\n- BookshelfItem 增加可选 categoryIds/genres/status 字段\n- ReadingProgress 增加可选 historyHiddenAt 字段"
  ```

---

### Task 2: `@acanthis-dec/storage` Schema、迁移、同步合并与缓存筛选

**Files:**
- Modify: `packages/storage/src/table.ts:169-233`
- Create: `packages/storage/migrations/<generated>.sql` (及 `meta/` 快照，由 `drizzle-kit generate` 生成)
- Modify: `packages/storage/src/type.ts`
- Modify: `packages/storage/src/db.ts`
- Modify: `packages/storage/src/service.ts`

**Interfaces:**
- Consumes: `@acanthis-dec/core` 的 `BookshelfCategory`, `BookshelfItem`, `ReadingProgress`, `CachedGenreItem`, `NovelStatus`
- Produces:
  - `SyncStateResult` 新增 `categories: BookshelfCategory[]`
  - `MergeSyncStateInput` 新增 `categories?: BookshelfCategory[]`
  - `MergeSyncStateResult` 新增 `categories: BookshelfCategory[]`
  - `ListCachedNovelsOptions` 扩展 `{ page: number; pageSize: number; genres?: string[]; status?: NovelStatus; q?: string }`
  - `StorageService.listCachedGenres(platform: string): Promise<CachedGenreItem[]>`

- [ ] **Step 1: 更新 `packages/storage/src/table.ts`**
  1. 新增 `bookshelfCategories` 表（`id`, `name`, `sortOrder`, `createdAt`, `updatedAt`, `serverUpdatedAt`, `deletedAt`）。
  2. `bookshelfItems` 新增 `categoryIds` (`text("category_ids").notNull().default("[]")`), `genresJson` (`text("genres_json").notNull().default("[]")`), `status` (`text("status", { enum: ["ongoing", "completed", "unknown"] }).notNull().default("unknown")`)。
  3. `readingProgress` 新增 `historyHiddenAt` (`integer("history_hidden_at")`)。
  4. 将 `bookshelfCategories` 加入 `defineRelations`。

- [ ] **Step 2: 生成 Drizzle 迁移**
  Run: `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; cd packages/storage; pnpm exec drizzle-kit generate`
  Expected: 在 `packages/storage/migrations/` 生成仅包含 `CREATE TABLE bookshelf_categories` 与 4 条 `ALTER TABLE ... ADD COLUMN` 的增量 SQL 文件。

- [ ] **Step 3: 更新 `packages/storage/src/type.ts`、`src/db.ts`、`src/service.ts`**
  实现要点：
  1. `getMaxSyncCursor` 改为三表取最大 `serverUpdatedAt`（`bookshelfItems`、`readingProgress`、`bookshelfCategories`）。
  2. `enrichBookshelfItemsWithNovelMetadata(tx, items)`：按 `(platform, novelId)` 批量查 `novels` + `novelGenres` + `genres`，若 `novels` 有关联非空 `genres` 则优先使用，否则回退 `bookshelf_items.genres_json`；`status` 非 `"unknown"` 优先用 `novels.status`。`getSyncState` 与 `mergeSyncState` 返回 `bookshelf` 前统一调用。
  3. `getSyncState(since?)`：
     - `since === undefined || since <= 0`：返回未软删除 `bookshelf_categories`（按 `sortOrder ASC, createdAt ASC, id ASC`）、未软删除 `bookshelf_items`、全部 `reading_progress`。
     - `since > 0`：三表均按 `serverUpdatedAt > since` 返回增量（含软删除）。
  4. `mergeSyncState(input)`：
     - 合并 `input.categories`（按 `id` 查找，LWW on `effectiveUpdatedAt >= existing.updatedAt`，带 60s 时钟偏移钳制）。
     - 合并 `input.bookshelf`：新建时缺省 `categoryIds=[]`、`genres=[]`、`status="unknown"`；更新时若入参字段为 `undefined` 则**保留服务端现有值**（满足 Review Focus #1）。`categoryIds` 与 `genres` 写入前去空去重。
     - 合并 `input.progress`：阅读位置字段按 `effectiveUpdatedAt >= existing.updatedAt` 做 LWW；`historyHiddenAt` 独立按 **max-wins** 合并（入参为 `undefined`/`null` 时保留原值，入参为数字时钳制到 `now + 60s` 后与原值取 `Math.max`）；两者任一变化即推进 `serverUpdatedAt = nextCursor()`。
  5. `listCachedNovels(platform, options)`：
     - 支持 `status` 精确过滤；
     - 支持 `q` 关键词过滤：`trim()` 后转义 `\`/`%`/`_`（`ESCAPE '\'`），对 `LOWER(name)` 或 `LOWER(author)` 做 `LIKE`；
     - 支持 `genres`（去空去重后多选 AND 交集）：使用 `EXISTS` 或 `novelId IN (SELECT novel_id FROM novel_genres INNER JOIN genres ... WHERE genres.name IN (...) GROUP BY novel_id HAVING COUNT(DISTINCT genres.name) = N)`，同时正确计算 `total` 与分页；
  6. 新增 `listCachedGenres(platform: string): Promise<CachedGenreItem[]>`：聚合统计该平台已缓存作品的每个题材标签数量，按 `count DESC, name ASC` 排序，并在 `StorageService` 透出。

- [ ] **Step 4: 用 `tsx` 冒烟验证迁移与核心合并/筛选边界**
  使用临时内存/临时文件 SQLite 库运行一次性验证脚本（不写入仓库文件），验证：
  - 迁移应用成功；
  - Review Focus #1（老客户端不传新字段不覆盖 `categoryIds`/`genres`/`status`/`historyHiddenAt`）；
  - `historyHiddenAt` max-wins 与后续重读（`updatedAt > historyHiddenAt`）；
  - `listCachedNovels` 多标签 AND 交集、`q` 含 `%`/`_` 转义、`genres=[]` 退化、`listCachedGenres` 计数排序。

- [ ] **Step 5: 类型检查、构建与 Biome 校验并提交**
  Run: `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; pnpm --filter=@acanthis-dec/storage run check-types; pnpm --filter=@acanthis-dec/storage run build; pnpm exec biome check packages/storage/src/table.ts packages/storage/src/type.ts packages/storage/src/db.ts packages/storage/src/service.ts`
  Expected: 0 errors, 0 warnings.
  ```bash
  git add packages/storage/src packages/storage/migrations
  git commit -m "feat(storage): 支持多书架同步、历史软隐藏合并与缓存标签筛选" -m "- 新增 bookshelf_categories 表及 bookshelf_items/reading_progress 新列迁移\n- mergeSyncState 实现分类 LWW、historyHiddenAt max-wins 与旧客户端字段保护\n- getSyncState/mergeSyncState 自动关联 novels 表补齐 genres 与 status\n- listCachedNovels 支持 genres/status/q 筛选并新增 listCachedGenres"
  ```

---

### Task 3: `@acanthis-dec/api-server` 路由、Zod Schema 与 OpenAPI 契约

**Files:**
- Modify: `apps/api-server/src/schemas/sync.ts`
- Modify: `apps/api-server/src/sync.ts`
- Modify: `apps/api-server/src/schemas/linovelib.ts`
- Modify: `apps/api-server/src/linovelib.ts`
- Modify: `apps/api-server/openapi.json` (自动生成)

**Interfaces:**
- Consumes: Task 2 的 `StorageService` 新接口与 `@acanthis-dec/core` 新类型
- Produces:
  - `GET /v1/sync/state` 返回 `{ bookshelf, progress, categories, cursor }`
  - `POST /v1/sync/state` 接收 `{ bookshelf?, progress?, categories? }`，返回 `{ bookshelf, progress, categories, serverTime }`
  - `GET /v1/linovelib/novels?page=&pageSize=&style=&genres=&status=&q=`
  - `GET /v1/linovelib/genres` 返回 `{ code: 0, message: "Success", data: CachedGenreItem[] }`

- [ ] **Step 1: 扩展 `apps/api-server/src/schemas/sync.ts` 与 `src/sync.ts`**
  - 新增 `bookshelfCategorySchema`（`name: z.string().trim().min(1).max(32)`，`sortOrder: z.number().int()` 等）。
  - `bookshelfItemSchema` 新增可选字段 `categoryIds?: string[]`, `genres?: string[]`, `status?: NovelStatus`。
  - `readingProgressSchema` 新增可选字段 `historyHiddenAt?: number | null`。
  - `syncPushSchema`、`syncGetDataSchema`、`syncPostDataSchema` 加入 `categories`。
  - `createSyncRoutes` 在 `GET/POST /state` 中透传 `categories`。

- [ ] **Step 2: 扩展 `apps/api-server/src/schemas/linovelib.ts` 与 `src/linovelib.ts`**
  - `cachedNovelsQuerySchema` 新增可选 `genres`（字符串按逗号拆分、去空白、去重）、`status`（`novelStatusSchema.optional()`）、`q`（`z.string().trim().max(100).optional()`）。
  - 新增 `cachedGenreItemSchema` 与 `cachedGenresResponseSchema`，在 `createLinovelibRoutes` 中挂载 `GET /genres`（`operationId: "getLinovelibCachedGenres"`）并调用 `storageService.listCachedGenres("linovelib")`。
  - `GET /novels` 将 `genres`、`status`、`q` 透传给 `storageService.listCachedNovels("linovelib", ...)`。

- [ ] **Step 3: 重新生成 OpenAPI 并执行检查**
  Run: `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; pnpm --filter=@acanthis-dec/api-server run openapi:generate; pnpm --filter=@acanthis-dec/api-server run openapi:check; pnpm --filter=@acanthis-dec/api-server run check-types; pnpm --filter=@acanthis-dec/api-server run build; pnpm exec biome check apps/api-server/src/schemas/sync.ts apps/api-server/src/sync.ts apps/api-server/src/schemas/linovelib.ts apps/api-server/src/linovelib.ts`
  Expected: OpenAPI 无漂移，构建与检查 0 errors, 0 warnings。

- [ ] **Step 4: 提交**
  ```bash
  git add apps/api-server/src apps/api-server/openapi.json
  git commit -m "feat(api-server): 扩展同步接口与服务器缓存题材标签筛选端点" -m "- /v1/sync/state 支持 categories、书架归属/元数据快照与 historyHiddenAt\n- /v1/linovelib/novels 支持 genres/status/q 筛选参数\n- 新增 GET /v1/linovelib/genres 并同步更新 openapi.json"
  ```

---

## Phase 2: Web 端（`c:\Users\ConstasJ\Coding\Acanthis\apps\web`）

### Task 4: Web API Client、IndexedDB v2 与 `useLibraryStore`

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/db/indexedDb.ts`
- Modify: `apps/web/src/stores/library.ts`

**Interfaces:**
- Consumes: Task 3 的 HTTP 契约
- Produces:
  - `fetchCachedNovels(platform, { page, pageSize, genres?, status?, q? })` 与 `fetchCachedGenres(platform)`
  - `webDb`: IndexedDB v2（新增 `categories` store，返回 `upgradedFromV1` 标志用于一次性重置游标）
  - `useLibraryStore` 新增：`activeCategories`, `historyList`, `continueReadingItem`（取 `historyList[0]`）, `getEffectiveCategoryIds(item)`, `createCategory(name)`, `renameCategory(id, name)`, `deleteCategory(id)`, `reorderCategories(orderedIds)`, `setBookshelfCategories(platform, novelId, categoryIds)`, `removeHistoryItem(platform, novelId)`, `clearAllHistory()`

- [ ] **Step 1: 扩展 `apps/web/src/api/client.ts`**
  - 更新 `SyncStatePullResponse` / `SyncStatePushPayload` / `SyncStatePushResponse` 加入 `categories?: BookshelfCategory[]` / `categories: BookshelfCategory[]`。
  - 扩展 `fetchCachedNovels` 支持可选 `genres?: string[]`, `status?: NovelStatus`, `q?: string`。
  - 新增 `fetchCachedGenres(platform: string): Promise<CachedGenreItem[]>`。

- [ ] **Step 2: 升级 `apps/web/src/db/indexedDb.ts` 至 `DB_VERSION = 2`**
  - `onupgradeneeded` 中创建 `categories` store（`keyPath: "id"`），当 `event.oldVersion > 0 && event.oldVersion < 2` 时标记 `migratedFromV1 = true`（暴露 `consumeSchemaUpgradeFlag(): boolean`）。
  - `DirtySyncEntry.kind` 扩展为 `"bookshelf" | "progress" | "category"`（分类条目的 `novelId` 存 `categoryId`，`platform` 存 `""`）。
  - `stripBookshelfRecord` / `stripProgressRecord` 保留并兜底 `categoryIds`、`genres`、`status`、`historyHiddenAt`。
  - 新增 `getAllCategories`、`putCategory`、`bulkPutCategories`。

- [ ] **Step 3: 扩展 `apps/web/src/stores/library.ts`**
  - 实现 `categoriesMap`、`activeCategories`、`historyList`、`continueReadingItem`。
  - `hydrate()` 检测到 `webDb.consumeSchemaUpgradeFlag()` 为 `true` 时调用 `settingsStore.setLastSyncServerTime(0)`。
  - `mergeProgressItem` 按设计文档第 3.2.A 节实现 `updatedAt` LWW + `historyHiddenAt` max-wins 合并。
  - `updateReadingProgress` 保证新 `updatedAt = Math.max(progress.updatedAt, (existing?.historyHiddenAt ?? 0) + 1)`（满足 Review Focus #2）。
  - `createCategory`/`renameCategory` 对名称执行 `trim()` 并校验 `1..32` 字符（满足 Review Focus #4）；ID 使用 `crypto.randomUUID()`（带 fallback）。
  - `getEffectiveCategoryIds(item)` 基于当前 `activeCategories` ID 集合过滤 `item.categoryIds ?? []`（满足 Review Focus #3）。
  - `toggleBookshelf` 接受可选 `genres?`、`status?`、`categoryIds?`，并允许在保留收藏时通过 `setBookshelfCategories` 更新归属。
  - `applyKeepalivePayloadLimit` 支持 `categories` 字段。

- [ ] **Step 4: 验证并提交**
  Run: `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; pnpm --filter=@acanthis-dec/web run check-types; pnpm exec biome check apps/web/src/api/client.ts apps/web/src/db/indexedDb.ts apps/web/src/stores/library.ts`
  Expected: 0 errors, 0 warnings。
  ```bash
  git add apps/web/src/api/client.ts apps/web/src/db/indexedDb.ts apps/web/src/stores/library.ts
  git commit -m "feat(web): 升级 IndexedDB v2 与书架同步 Store 支持多书架及历史记录" -m "- IndexedDB 升级至 v2 新增 categories store，升级时自动归零游标补齐元数据\n- library store 实现分类 CRUD/排序、多书架归属、historyHiddenAt max-wins 合并与删除/清空历史\n- API client 新增缓存标签查询与缓存列表筛选参数"
  ```

---

### Task 5: Web 端 4-Tab 导航与 LNReader 风格「历史记录」页

**Files:**
- Modify: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/components/AppShell.vue`
- Create: `apps/web/src/views/HistoryView.vue`

**Interfaces:**
- Consumes: `useLibraryStore().historyList`, `removeHistoryItem`, `clearAllHistory`
- Produces: 路由 `/history`（`name: "history"`）及导航入口「历史」

- [ ] **Step 1: 在 `router/index.ts` 与 `AppShell.vue` 增加 `/history` 路由与导航项**
  将导航项调整为 4 项：`书架 (/)`、`历史 (/history)`、`发现 (/explore)`、`设置 (/settings)`（图标使用 `lucide-vue-next` 的 `History`）。

- [ ] **Step 2: 创建 `apps/web/src/views/HistoryView.vue`**
  按设计文档第 6.2 节实现：
  - 顶部搜索框（按 `novelTitle` / `chapterTitle` 实时过滤）+ 「清空历史」按钮（点击弹出二次确认对话框）。
  - 按本地时区自然日分组（`今天`、`昨天`、`YYYY年MM月DD日`），展示封面（点进详情）、书名、卷/章标题、阅读时间 `HH:mm` 与设备标签、主按钮「继续」（直达 `/read/...`）和单条删除按钮（立即调用 `removeHistoryItem` 并展示 2s 轻提示「已从历史记录移除」，不提供撤销）。
  - 无历史 / 搜索无结果空态。

- [ ] **Step 3: 验证并提交**
  Run: `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; pnpm --filter=@acanthis-dec/web run check-types; pnpm exec biome check apps/web/src/router/index.ts apps/web/src/components/AppShell.vue apps/web/src/views/HistoryView.vue`
  Expected: 0 errors, 0 warnings。
  ```bash
  git add apps/web/src/router/index.ts apps/web/src/components/AppShell.vue apps/web/src/views/HistoryView.vue
  git commit -m "feat(web): 新增 LNReader 风格阅读历史页面与导航入口" -m "- 桌面侧边栏与移动端底栏扩展为 4 个一级入口（书架/历史/发现/设置）\n- 新增 HistoryView 支持按日期分组、搜索、一键继续阅读、单条删除与清空确认"
  ```

---

### Task 6: Web 端「多书架 + 元数据标签筛选」书架页与管理弹窗

**Files:**
- Create: `apps/web/src/components/ShelfManagerModal.vue`
- Create: `apps/web/src/components/ShelfAssignModal.vue`
- Modify: `apps/web/src/views/BookshelfView.vue`

**Interfaces:**
- Consumes: `useLibraryStore` 的分类/筛选/归属方法；URL query `?genre=...`
- Produces: 可复用的 `ShelfAssignModal.vue`（`NovelDetailView.vue` 在 Task 7 复用）

- [ ] **Step 1: 创建 `ShelfManagerModal.vue` 与 `ShelfAssignModal.vue`**
  - `ShelfManagerModal.vue`：新建书架（校验 1..32 字符）、行内重命名、上移/下移排序、删除书架（提示仅移除分组，不删书）。
  - `ShelfAssignModal.vue`：接收 `platform`、`novelId`、`title` 与当前 `categoryIds`，展示所有自定义书架多选框（提示“不勾选任何书架时保留在「默认」中”），支持在弹窗内快速新建书架并确认保存。

- [ ] **Step 2: 重构 `apps/web/src/views/BookshelfView.vue`**
  - 顶部书架 Tab 条：`全部`、`默认`、各自定义书架（带藏书计数）+ `管理` 按钮。
  - 搜索与筛选栏：书名/作者搜索框、题材标签多选下拉/面板（统计当前书架范围内所有 `genres` 及计数，多选 AND 交集）、连载状态筛选（全部/连载中/已完结）、排序（最近阅读/最近添加/书名）。
  - 支持读取路由 query `?genre=...` 自动激活该标签筛选并切换至「全部」书架；当筛选无结果且存在激活标签时，空态提供“去服务器缓存中查看「xxx」”一键跳转 `/explore?tab=cached&genre=...`。
  - 卡片三点菜单新增「管理所属书架」打开 `ShelfAssignModal`。

- [ ] **Step 3: 验证并提交**
  Run: `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; pnpm --filter=@acanthis-dec/web run check-types; pnpm exec biome check apps/web/src/components/ShelfManagerModal.vue apps/web/src/components/ShelfAssignModal.vue apps/web/src/views/BookshelfView.vue`
  Expected: 0 errors, 0 warnings。
  ```bash
  git add apps/web/src/components/ShelfManagerModal.vue apps/web/src/components/ShelfAssignModal.vue apps/web/src/views/BookshelfView.vue
  git commit -m "feat(web): 书架页支持多书架管理、本地搜索与元数据标签筛选" -m "- 新增 ShelfManagerModal 与 ShelfAssignModal 弹窗组件\n- BookshelfView 新增全部/默认/自定义书架切换、题材多选 AND 筛选、状态筛选与 URL 联动"
  ```

---

### Task 7: Web 端详情页标签点击/多书架归属 + 发现页服务器缓存筛选

**Files:**
- Modify: `apps/web/src/views/NovelDetailView.vue`
- Modify: `apps/web/src/views/ExploreView.vue`

**Interfaces:**
- Consumes: Task 4 的 `fetchCachedNovels` / `fetchCachedGenres`、Task 6 的 `ShelfAssignModal.vue` 与 `/?genre=...` 路由

- [ ] **Step 1: 更新 `apps/web/src/views/NovelDetailView.vue`**
  - 收藏/加入书架时透传 `novel.genres` 与 `novel.status`。
  - 已在书架时新增“管理书架分组”入口（或点击书架按钮时在有自定义书架的情况下提供分组编辑），复用 `ShelfAssignModal.vue`。
  - 将 `novel.genres` 胶囊改为 `<RouterLink :to="{ name: 'bookshelf', query: { genre } }">`，支持点击直达书架标签筛选。

- [ ] **Step 2: 更新 `apps/web/src/views/ExploreView.vue`**
  - 读取路由 query `?tab=cached&genre=...` 支持从书架空态跳转直达「服务器缓存」并预选标签。
  - 在「服务器缓存」Tab 加载 `fetchCachedGenres(platform)`，新增关键词搜索框（防抖 300ms）、连载状态 Chip、题材标签多选 Chip 条（AND 交集），筛选变化时重置到第 1 页重新请求 `fetchCachedNovels`。

- [ ] **Step 3: 验证并提交**
  Run: `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; pnpm --filter=@acanthis-dec/web run check-types; pnpm --filter=@acanthis-dec/web run build; pnpm exec biome check apps/web/src/views/NovelDetailView.vue apps/web/src/views/ExploreView.vue`
  Expected: 0 errors, 0 warnings。
  ```bash
  git add apps/web/src/views/NovelDetailView.vue apps/web/src/views/ExploreView.vue
  git commit -m "feat(web): 详情页支持标签跳转与多书架分配，发现页服务器缓存支持标签筛选" -m "- NovelDetailView 收藏透传 genres/status，标签胶囊可点击跳书架筛选，支持多书架分配\n- ExploreView 服务器缓存 Tab 支持按题材多选、连载状态与关键词组合筛选"
  ```

---

### Task 8: Acanthis 全量校验与 Changeset 补充

**Files:**
- Create: `.changeset/library-history-shelves-tags.md`

- [ ] **Step 1: 新增 Changeset 文件**
  创建 `.changeset/library-history-shelves-tags.md`，frontmatter 标注 `@acanthis-dec/core: minor`、`@acanthis-dec/storage: minor`、`@acanthis-dec/api-server: minor`、`@acanthis-dec/web: minor`，正文简明中文概括三项新功能。

- [ ] **Step 2: 执行 Acanthis 全量校验**
  Run: `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; pnpm check-types; pnpm build; pnpm --filter=@acanthis-dec/api-server run openapi:check; pnpm exec changeset status; pnpm exec biome check .changeset/library-history-shelves-tags.md`
  Expected: 所有 9 个包 `check-types` 与 `build` 0 错误，`openapi:check` 通过，`changeset status` 正确识别 4 个 minor 包。

- [ ] **Step 3: 提交 Changeset**
  ```bash
  git add .changeset/library-history-shelves-tags.md
  git commit -m "chore(changeset): 为阅读历史、多书架与标签筛选添加发版变更集" -m "- 声明 core/storage/api-server/web 四个包的 minor 版本变更"
  ```

---

## Phase 3: App 端（`c:\Users\ConstasJ\Coding\acanthis-mobile`）

### Task 9: App Room v3、显式 `MIGRATION_2_3` 与 `ServerConfigStore` 升级游标重置

**Files:**
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/core/database/Entities.kt`
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/core/database/Daos.kt`
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/core/database/AppDatabase.kt`
- Create: `composeApp/schemas/io.acanthis.app.core.database.AppDatabase/3.json` (KSP 编译自动导出)
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/core/preferences/ServerConfigStore.kt`
- Test: `composeApp/src/commonTest/kotlin/io/acanthis/app/core/database/AppDatabaseMigrationTest.kt`

**Interfaces:**
- Produces:
  - `BookshelfCategoryEntity` & `BookshelfCategoryDao`
  - `BookshelfEntity` 新增 `categoryIdsJson: String = "[]"`, `genresJson: String = "[]"`, `status: String = "unknown"`
  - `ReadingProgressEntity` 新增 `historyHiddenAt: Long? = null`
  - `DirtySyncEntity.KIND_CATEGORY = "category"`
  - `MIGRATION_2_3: Migration`
  - `ServerConfigStore.ensureSyncSchemaVersion(targetVersion: Int)`（首次升到 `2` 时把 `lastSyncCursor` 置 `0L`）

- [ ] **Step 1: 编写失败的迁移与 DAO 单元测试 (`AppDatabaseMigrationTest.kt`)**
  测试内容：用内存 `BundledSQLiteDriver` 先按 `2.json` 建 v2 表并插入 1 条书架与 1 条阅读进度，执行 `MIGRATION_2_3.migrate(connection)` 后验证：
  - `bookshelf_categories` 表存在且可读写；
  - 原有 `bookshelf_items` 行完整保留，新列默认值为 `'[]'`、`'[]'`、`'unknown'`；
  - 原有 `reading_progress` 行完整保留，`historyHiddenAt` 为 `NULL`。

- [ ] **Step 2: 运行测试确认失败**
  Run: `cd c:\Users\ConstasJ\Coding\acanthis-mobile; .\gradlew.bat :composeApp:testAndroidHostTest --tests "io.acanthis.app.core.database.AppDatabaseMigrationTest"`
  Expected: FAIL（`MIGRATION_2_3` 不存在）。

- [ ] **Step 3: 更新 `Entities.kt`、`Daos.kt`、`AppDatabase.kt` 与 `ServerConfigStore.kt`**
  - 新增 `BookshelfCategoryEntity`、`BookshelfCategoryDao`（`observeActiveCategories` 按 `sortOrder ASC, createdAt ASC, id ASC`、`getById`、`getAll`、`upsert`、`upsertAll`）。
  - `ReadingProgressDao.observeLatestProgress()` 与新增 `observeVisibleHistory()` 均过滤 `historyHiddenAt IS NULL OR updatedAt > historyHiddenAt`。
  - `AppDatabase` 升至 `version = 3`，注册 `MIGRATION_2_3`（`.addMigrations(MIGRATION_2_3)`）。
  - `ServerConfigStore` 新增 `syncSchemaVersion` 字段与 `ensureSyncSchemaVersion(2)` 一次性重置 `lastSyncCursor = 0L`。

- [ ] **Step 4: 运行测试并提交**
  Run: `cd c:\Users\ConstasJ\Coding\acanthis-mobile; .\gradlew.bat :composeApp:testAndroidHostTest --tests "io.acanthis.app.core.database.AppDatabaseMigrationTest"`
  Expected: PASS，且 `composeApp/schemas/.../3.json` 已生成。
  ```bash
  git add composeApp/src composeApp/schemas
  git commit -m "feat(database): 升级 Room v3 并提供显式 MIGRATION_2_3 支持多书架与历史隐藏" -m "- 新增 BookshelfCategoryEntity/Dao 与 bookshelf_items/reading_progress 扩展列\n- 注册 MIGRATION_2_3 保护本地数据升级不丢失，并在 ServerConfigStore 中支持升级一次性归零同步游标"
  ```

---

### Task 10: App 网络模型、`AcanthisApiClient`、`LibraryRepository` 与 `SyncCoordinator`

**Files:**
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/core/network/ApiModels.kt`
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/core/network/AcanthisApiClient.kt`
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/data/LibraryLocalStore.kt`
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/data/LibraryRepository.kt`
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/data/SyncCoordinator.kt`
- Test: `composeApp/src/commonTest/kotlin/io/acanthis/app/core/network/AcanthisApiClientTest.kt`
- Test: `composeApp/src/commonTest/kotlin/io/acanthis/app/data/SyncCoordinatorTest.kt`

**Interfaces:**
- Consumes: Task 9 的 Entities/DAOs 与后端 Task 3 的 HTTP API
- Produces:
  - `AcanthisApiClient.getCachedNovels(platform, page, pageSize, genres, status, query)`、`getCachedGenres(platform)`
  - `LibraryRepository`: `observeActiveCategories()`, `observeVisibleHistory()`, `createCategory(name)`, `renameCategory(id, name)`, `deleteCategory(id)`, `reorderCategories(orderedIds)`, `setBookshelfCategories(platform, novelId, categoryIds)`, `removeHistoryItem(platform, novelId)`, `clearAllHistory()`

- [ ] **Step 1: 在 `AcanthisApiClientTest.kt` 与 `SyncCoordinatorTest.kt` 新增失败测试**
  覆盖：
  - `getCachedNovels` 正确拼接 `genres` / `status` / `q` 查询参数与 `getCachedGenres` 解析；
  - `SyncCoordinator` 推送与拉取 `categories` LWW 合并；
  - `historyHiddenAt` max-wins 合并（远端旧进度不覆盖本地已隐藏状态，本地重读 `updatedAt = max(now, hiddenAt + 1)` 自动重现，满足 Review Focus #2）；
  - `createCategory`/`renameCategory` 拒绝空白与超 32 字符名称（Review Focus #4）。

- [ ] **Step 2: 运行测试确认失败**
  Run: `cd c:\Users\ConstasJ\Coding\acanthis-mobile; .\gradlew.bat :composeApp:testAndroidHostTest --tests "io.acanthis.app.core.network.AcanthisApiClientTest" --tests "io.acanthis.app.data.SyncCoordinatorTest"`
  Expected: FAIL。

- [ ] **Step 3: 实现 DTO、API Client、LocalStore、Repository 与 SyncCoordinator 变更**
  - `ApiModels.kt` 扩展 `BookshelfItemDto`、`ReadingProgressDto`、`SyncState*Dto`，新增 `BookshelfCategoryDto`、`CachedGenreDto`。
  - `LibraryLocalStore` 封装 `categories` 读写与 `BookshelfEntity` JSON 编解码辅助函数（使用 `kotlinx.serialization.json.Json`）。
  - `SyncCoordinator.syncNow()` 启动前调用 `serverConfigStore.ensureSyncSchemaVersion(2)`，随后推送 `bookshelf`/`progress`/`categories` 脏数据并合并拉取结果。

- [ ] **Step 4: 运行测试并提交**
  Run: `cd c:\Users\ConstasJ\Coding\acanthis-mobile; .\gradlew.bat :composeApp:testAndroidHostTest --tests "io.acanthis.app.core.network.AcanthisApiClientTest" --tests "io.acanthis.app.data.SyncCoordinatorTest"`
  Expected: PASS。
  ```bash
  git add composeApp/src
  git commit -m "feat(sync): App 端接入多书架、历史软隐藏同步与服务器缓存筛选接口" -m "- 扩展同步 DTO、AcanthisApiClient 与 SyncCoordinator 支持 categories 及 historyHiddenAt max-wins\n- LibraryRepository 新增分类管理、多书架归属与历史删除/清空能力，并补齐单元测试"
  ```

---

### Task 11: App 4-Tab 导航与「历史记录」页

**Files:**
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/app/navigation/Routes.kt`
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/app/AcanthisApp.kt`
- Create: `composeApp/src/commonMain/kotlin/io/acanthis/app/feature/history/HistoryViewModel.kt`
- Create: `composeApp/src/commonMain/kotlin/io/acanthis/app/feature/history/HistoryScreen.kt`
- Test: `composeApp/src/commonTest/kotlin/io/acanthis/app/feature/history/HistoryViewModelTest.kt`

**Interfaces:**
- Consumes: Task 10 的 `LibraryRepository.observeVisibleHistory()`, `removeHistoryItem()`, `clearAllHistory()`
- Produces: `HistoryRoute` 与 `HistoryScreen`

- [ ] **Step 1: 编写 `HistoryViewModelTest.kt`**
  验证按自然日分组（今天 / 昨天 / 具体日期）、按书名与章节名过滤、调用单条删除与清空历史。

- [ ] **Step 2: 运行测试确认失败**
  Run: `cd c:\Users\ConstasJ\Coding\acanthis-mobile; .\gradlew.bat :composeApp:testAndroidHostTest --tests "io.acanthis.app.feature.history.HistoryViewModelTest"`
  Expected: FAIL。

- [ ] **Step 3: 实现 `HistoryViewModel`、`HistoryScreen` 并接入 `Routes.kt` / `AcanthisApp.kt`**
  - `TopLevelTab` 扩展为 4 项：`书架`、`历史`、`发现`、`设置`。
  - `HistoryScreen` 参考 LNReader 样式：顶部搜索框 + 清空按钮（带二次确认 Dialog）、`LazyColumn` 粘性/分组日期头、每行展示封面（点击进详情）、书名、卷/章与时间、继续阅读按钮（直达 `ReaderRoute`）与单条删除按钮（立即落库 + Snackbar 轻提示，无 Undo）。

- [ ] **Step 4: 运行测试并提交**
  Run: `cd c:\Users\ConstasJ\Coding\acanthis-mobile; .\gradlew.bat :composeApp:testAndroidHostTest --tests "io.acanthis.app.feature.history.HistoryViewModelTest"`
  Expected: PASS。
  ```bash
  git add composeApp/src
  git commit -m "feat(history): App 端新增 LNReader 风格阅读历史页面与底栏入口" -m "- 底栏扩展为书架/历史/发现/设置 4 个 Tab\n- 新增 HistoryViewModel/HistoryScreen 支持日期分组、搜索、继续阅读、单条删除与清空确认"
  ```

---

### Task 12: App「多书架 + 元数据标签筛选」书架页与管理弹窗

**Files:**
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/feature/bookshelf/BookshelfViewModel.kt`
- Create: `composeApp/src/commonMain/kotlin/io/acanthis/app/feature/bookshelf/BookshelfDialogs.kt`
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/feature/bookshelf/BookshelfScreen.kt`
- Test: `composeApp/src/commonTest/kotlin/io/acanthis/app/feature/bookshelf/BookshelfViewModelTest.kt`

**Interfaces:**
- Consumes: Task 10 的 `LibraryRepository` 分类与书架流
- Produces: `BookshelfViewModel.applyGenreFilterFromOutside(genre: String)`、`ShelfAssignDialog`（Task 13 详情页复用）

- [ ] **Step 1: 编写 `BookshelfViewModelTest.kt`**
  验证：
  - 「全部」/「默认」/自定义书架过滤，含已删除书架残留 ID 自动回落「默认」（Review Focus #3）；
  - 多选题材标签 AND 交集筛选 + 状态筛选 + 关键词搜索 + 三种排序；
  - `applyGenreFilterFromOutside("奇幻")` 自动切到「全部」并激活该标签。

- [ ] **Step 2: 运行测试确认失败**
  Run: `cd c:\Users\ConstasJ\Coding\acanthis-mobile; .\gradlew.bat :composeApp:testAndroidHostTest --tests "io.acanthis.app.feature.bookshelf.BookshelfViewModelTest"`
  Expected: FAIL。

- [ ] **Step 3: 实现 `BookshelfViewModel`、`BookshelfDialogs` 与 `BookshelfScreen`**
  - `BookshelfDialogs.kt` 包含 `ShelfManagerDialog`（新建/重命名/上下排序/删除）与 `ShelfAssignDialog`（多选书架归属 + 快捷新建）。
  - `BookshelfScreen.kt` 顶部增加水平可滚动书架 Tab 条（全部/默认/自定义书架/管理）、搜索栏、标签多选弹窗按钮、状态筛选与排序菜单、已选筛选 Chip 条；长按卡片菜单提供「管理所属书架」与「移出书架」；标签筛选空态提供“去服务器缓存中查看”回调。

- [ ] **Step 4: 运行测试并提交**
  Run: `cd c:\Users\ConstasJ\Coding\acanthis-mobile; .\gradlew.bat :composeApp:testAndroidHostTest --tests "io.acanthis.app.feature.bookshelf.BookshelfViewModelTest"`
  Expected: PASS。
  ```bash
  git add composeApp/src
  git commit -m "feat(bookshelf): App 端书架页支持多书架分类、本地搜索与元数据标签筛选" -m "- 新增 ShelfManagerDialog 与 ShelfAssignDialog\n- BookshelfViewModel/Screen 支持全部/默认/自定义书架切换、多选标签 AND 筛选与状态排序"
  ```

---

### Task 13: App 详情页标签点击/多书架分配 + 发现页服务器缓存筛选 + 终验

**Files:**
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/feature/detail/NovelDetailViewModel.kt`
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/feature/detail/NovelDetailScreen.kt`
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/data/ExploreRepository.kt`
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/feature/explore/ExploreViewModel.kt`
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/feature/explore/ExploreScreen.kt`
- Modify: `composeApp/src/commonMain/kotlin/io/acanthis/app/app/AcanthisApp.kt`
- Test: `composeApp/src/commonTest/kotlin/io/acanthis/app/data/ExploreRepositoryTest.kt`
- Test: `composeApp/src/commonTest/kotlin/io/acanthis/app/feature/explore/ExploreViewModelTest.kt`

**Interfaces:**
- Consumes: Task 10 `getCachedNovels`/`getCachedGenres`、Task 12 `ShelfAssignDialog` 与 `applyGenreFilterFromOutside`

- [ ] **Step 1: 在 `ExploreRepositoryTest.kt` 与 `ExploreViewModelTest.kt` 补充服务器缓存筛选测试**
  验证加载 `cachedGenres`、切换多选标签/状态/搜索词触发重置第 1 页并透传参数。

- [ ] **Step 2: 运行测试确认失败**
  Run: `cd c:\Users\ConstasJ\Coding\acanthis-mobile; .\gradlew.bat :composeApp:testAndroidHostTest --tests "io.acanthis.app.data.ExploreRepositoryTest" --tests "io.acanthis.app.feature.explore.ExploreViewModelTest"`
  Expected: FAIL。

- [ ] **Step 3: 实现详情页与发现页联动**
  - `NovelDetailViewModel` / `NovelDetailScreen`：收藏时透传 `genres` 与 `status`；支持打开 `ShelfAssignDialog` 编辑多书架归属；`FlowRow` 中的标签徽章改为可点击，通过 `onGenreClick(genre)` 导航回 `BookshelfRoute` 并调用 `applyGenreFilterFromOutside(genre)`。
  - `ExploreRepository` / `ExploreViewModel` / `ExploreScreen`：「服务器缓存」Tab 加载 `getCachedGenres(platform)`，提供搜索框、状态筛选与题材标签多选面板；支持从书架空态通过 `openCachedWithGenre(genre)` 直达该 Tab 并预选标签。

- [ ] **Step 4: 运行 App 全量单测与 Debug APK 构建**
  Run: `cd c:\Users\ConstasJ\Coding\acanthis-mobile; .\gradlew.bat :composeApp:testAndroidHostTest :androidApp:assembleDebug`
  Expected: 所有单元测试 PASS，Debug APK 构建成功（0 errors）。

- [ ] **Step 5: 提交**
  ```bash
  git add composeApp/src
  git commit -m "feat(detail,explore): App 详情页支持标签跳转与多书架分配，发现页支持缓存标签筛选" -m "- 详情页标签徽章可点击跳书架筛选，收藏透传元数据并支持编辑所属书架\n- 发现页服务器缓存 Tab 接入题材标签/状态/关键词组合筛选"
  ```
