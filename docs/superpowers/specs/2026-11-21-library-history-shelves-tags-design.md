# 图书馆体验升级设计文档：阅读历史、多书架与元数据标签筛选

- **日期**：2026-11-21
- **适用仓库**：
  - `Acanthis`（`packages/core`、`packages/storage`、`apps/api-server`、`apps/web`）
  - `acanthis-mobile`（`:composeApp` Android / Desktop KMP）
- **目标**：在 Web 端与 App 端同步引入 LNReader 风格的完整阅读历史、多对多自定义多书架，以及书架与服务器缓存双端的元数据分类标签筛选，并在完成后发版。

---

## 1. 背景与目标

### 1.1 为什么做
1. **历史记录缺失**：当前系统在 `reading_progress` 中已按 `(platform, novelId)` 记录每本书的最近阅读位置（包括未加入书架的书），但两端 UI 只展示顶部单条“继续阅读”卡片，无法浏览过往阅读记录，也无法删除或清空历史。
2. **单一书架难以管理**：书架当前是单一扁平列表，藏书变多后难以按个人阅读状态或主题归类。
3. **元数据未用于检索**：后端与详情页已解析并存储了题材标签（`genres`）和连载状态（`status`），但书架页和服务端本地缓存列表均不支持按标签/状态筛选，详情页标签胶囊也不可点击。

### 1.2 核心目标
- **历史记录（LNReader 风格）**：每本书保留最近读过的一条，按日期分组（今天 / 昨天 / 具体日期），支持搜索、一键继续阅读、点击进详情、单条删除与一键清空，并跨端同步。
- **多书架（多对多 Category）**：支持自定义书架的新建、重命名、排序、删除，一本书可同时归属多个书架，内置「全部」与「默认」视图兼容旧数据，并跨端同步。
- **元数据标签筛选**：
  - **书架内**支持按题材标签（多选交集 AND）、连载状态（连载中 / 已完结）、书名/作者关键词组合筛选，且离线可用。
  - **发现页 → 服务器缓存**支持按服务端已缓存作品的题材标签、连载状态与关键词组合筛选。
  - **作品详情页**上的题材标签胶囊改为可点击，点击后跳转到筛选视图。

### 1.3 非目标（Non-Goals）
- 不记录同一本书不同时间点读过的多章节历史流水（每本书仅保留一条最近记录，与 LNReader 一致）。
- 不新增单独的“已读章节集合”同步或书签系统。
- 不改变上游 `linovelib` 发现页「书库」已有的远端多维筛选机制。
- 不要求破坏旧版客户端兼容性（老版客户端继续调用 `/v1/sync/state` 不应崩溃）。

---

## 2. 方案对比与选型

| 方案 | 核心思路 | 权衡与取舍 |
|------|----------|------------|
| **方案 1（已选定）** | 向后兼容扩展现有 `GET/POST /v1/sync/state`（新增 `categories`、`BookshelfItem.categoryIds/genres/status`、`ReadingProgress.historyHiddenAt`），并扩展 `GET /v1/linovelib/novels` + 新增 `GET /v1/linovelib/genres` | 复用现有离线优先 + 脏队列 + 增量 cursor + LWW 同步架构，单次往返完成全量/增量同步，两端对称且离线可用。并发在两台离线设备修改同一本书的书架归属时按整组 `categoryIds` LWW 覆盖，个人多设备场景可接受。 |
| 方案 2（未选） | 新增在线优先 REST CRUD（`/v1/categories/*`、`/v1/history/*`） | 破坏离线优先体验（断网无法建书架、归类或删历史），且两端需同时维护增量同步与在线缓存两套一致性逻辑，复杂度过高。 |

---

## 3. 数据模型与同步协议设计

### 3.1 共享领域类型（`@acanthis-dec/core`）

在 `packages/core/src/types.ts` 中扩展与新增以下类型：

```ts
export interface BookshelfCategory {
	id: string; // 客户端生成的稳定 ID（UUID v4 / nanoid），跨端唯一
	name: string; // 书架名称（非空，trim 后 1~32 字符）
	sortOrder: number; // 排序权重（整数，升序）
	createdAt: number; // 创建时间戳（毫秒）
	updatedAt: number; // 最后修改时间戳（毫秒，LWW 依据）
	deletedAt: number | null; // 软删除时间戳（毫秒），未删除为 null
}

export interface BookshelfItem {
	platform: string;
	novelId: string;
	title: string;
	author: string;
	coverUrl: string;
	addedAt: number;
	updatedAt: number;
	deletedAt: number | null;
	// v2 新增（可选以兼容旧客户端，服务端响应始终返回明确值）
	categoryIds?: string[]; // 所属自定义书架 ID 列表（去重）；空数组代表仅在「默认」
	genres?: string[]; // 作品题材标签快照，用于客户端离线筛选
	status?: NovelStatus; // 作品连载状态快照（ongoing | completed | unknown）
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
	updatedAt: number; // 最近阅读时间戳（毫秒），历史分组与继续阅读均以此为准
	// v2 新增（可选以兼容旧客户端，服务端响应始终返回 number | null）
	historyHiddenAt?: number | null; // 历史隐藏时间戳（毫秒）；不为 null 且 >= updatedAt 时不在历史页显示
}

export interface CachedGenreItem {
	name: string;
	count: number;
}
```

### 3.2 关键一致性语义（核心约束）

#### A. 历史记录删除/清空与阅读进度分离（CRDT Max-Wins）
- **可见性判定**：一条 `ReadingProgress` 出现在历史页的条件是：
  `historyHiddenAt == null || updatedAt > historyHiddenAt`
- **“继续阅读”卡片**：保持与历史页一致——取所有**未隐藏**进度中 `updatedAt` 最新的一条（若用户清空了历史或删掉了最近那条，书架顶部的“继续阅读”卡片同步切换为下一条未隐藏记录，或无记录时隐藏）。
- **单条删除历史**：不修改 `updatedAt`（保留真实的阅读时间与阅读位置），仅将 `historyHiddenAt = Math.max(Date.now(), item.updatedAt)`，写入本地库与脏队列并同步。
- **清空全部历史**：对本地所有当前可见的 `ReadingProgress` 条目批量设置 `historyHiddenAt = Math.max(now, item.updatedAt)`，写入脏队列并同步。
- **重新阅读自动重现**：用户再次打开该书阅读时，`updateReadingProgress` 会写入新的 `updatedAt = Date.now()`（严格大于 `historyHiddenAt`），该书自动重新出现在历史页“今天”分组顶部。
- **服务端合并规则（`mergeSyncState`）**：
  - 阅读位置字段（`volumeId`、`chapterId`、`paragraphIndex`、`updatedAt` 等）仍按 `effectiveUpdatedAt >= existing.updatedAt` 做 LWW。
  - `historyHiddenAt` 独立按 **max-wins** 合并：`mergedHiddenAt = maxNullable(existing.historyHiddenAt, clampedIncomingHiddenAt)`（带 60s 时钟偏移钳制）。
  - 只要阅读位置更新 **或** `mergedHiddenAt !== existing.historyHiddenAt`，就推进 `serverUpdatedAt = nextCursor()`，确保增量拉取把删除操作同步到其他设备。
  - 旧客户端推送时不带 `historyHiddenAt`（`undefined`），服务端保留现有 `existing.historyHiddenAt`，绝不会把已删除的历史误恢复。

#### B. 多书架（多对多）与内置视图规则
- **两个内置虚拟视图**（不存库，不占用户书架名额）：
  - **「全部」**：展示所有 `deletedAt === null` 的 `BookshelfItem`。
  - **「默认」**：展示所有 `deletedAt === null` 且有效归属自定义书架为空（`effectiveCategoryIds.length === 0`）的 `BookshelfItem`。
    - *有效归属*定义：`item.categoryIds` 中过滤掉在本地 `categories` 表里不存在或已软删除（`deletedAt !== null`）的 ID 后的集合。
- **删除自定义书架**：仅对该 `BookshelfCategory` 设置 `deletedAt = now, updatedAt = now`，**不删除**其中的书，也不必批量改写所有 `BookshelfItem`；原本仅属于该书架的书会自动落回「默认」视图，绝不丢书。
- **取消全部自定义书架勾选**：在“分配书架”弹窗中取消所有自定义书架勾选，仅把 `categoryIds` 置空（书留在「默认」中）；只有显式触发“移出书架”才设置 `BookshelfItem.deletedAt = now`。
- **新书加入书架**：
  - 若当前没有任何自定义书架：一键直接加入（`categoryIds = []`，归入「默认」）。
  - 若已存在自定义书架：详情页点击“加入书架”时直接加入默认并弹出轻量分组选择器（或弹出分组多选框，默认已勾选/可跳过直接确认），减少操作阻力；已加入书架后点击按钮可编辑所属书架或移出书架。
- **排序**：自定义书架按 `(sortOrder ASC, createdAt ASC, id ASC)` 排序；重命名和调整顺序均更新 `updatedAt` 并入脏队列。

#### C. 元数据标签（`genres`）与连载状态（`status`）补全
- **写路径**：客户端在收藏或更新书架条目时，若本地有 `Novel` 详情缓存，顺带写入 `genres` 与 `status`。
- **服务端存储与补全**：
  - `bookshelf_items` 新增 `category_ids`（TEXT JSON 数组，默认 `'[]'`）、`genres_json`（TEXT JSON 数组，默认 `'[]'`）、`status`（TEXT，默认 `'unknown'`）。
  - `getSyncState` 与 `mergeSyncState` 返回 `BookshelfItem` 前，按 `(platform, novelId)` 批量查询服务端 `novels` + `novel_genres` + `genres` 表：
    - 若服务端 `novels` 表中存在该书记录，以 `novels.status` 和关联 `genres` 优先补全（当 `novels` 有非空 `genres` 时优先用 `novels` 的，否则回退 `bookshelf_items.genres_json`；`status` 非 `"unknown"` 时优先用 `novels.status`）。
  - 这样老数据（历史收藏但未写 `genres_json` 的书）与跨设备同步（A 设备收藏、B 设备未打开过详情页）都能直接拿到准确的标签和状态。

---

## 4. 后端数据库与 API 设计（`packages/storage` & `apps/api-server`）

### 4.1 Drizzle Schema 变更（`packages/storage/src/table.ts` + 迁移）

1. **新增表 `bookshelf_categories`**：
   - `id`: `text("id").primaryKey()`
   - `name`: `text("name").notNull()`
   - `sortOrder`: `integer("sort_order").notNull().default(0)`
   - `createdAt`: `integer("created_at").notNull()`
   - `updatedAt`: `integer("updated_at").notNull()`
   - `serverUpdatedAt`: `integer("server_updated_at").notNull()`
   - `deletedAt`: `integer("deleted_at")`
2. **修改表 `bookshelf_items`**：
   - 新增 `categoryIds`: `text("category_ids").notNull().default("[]")`（存储 JSON `string[]`）
   - 新增 `genresJson`: `text("genres_json").notNull().default("[]")`（存储 JSON `string[]`）
   - 新增 `status`: `text("status", { enum: ["ongoing", "completed", "unknown"] }).notNull().default("unknown")`
3. **修改表 `reading_progress`**：
   - 新增 `historyHiddenAt`: `integer("history_hidden_at")`（可空）
4. **同步游标 `getMaxSyncCursor`**：
   - 改为取 `max(bookshelf_items.server_updated_at, reading_progress.server_updated_at, bookshelf_categories.server_updated_at)`。
5. **迁移**：使用 `drizzle-kit generate` 在 `packages/storage/migrations/` 生成正式 SQL 迁移文件。

### 4.2 `/v1/sync/state` 契约扩展（`apps/api-server/src/sync.ts` & `schemas/sync.ts`）

- **`GET /v1/sync/state?since=<ms>`**：
  - 响应 `data` 新增 `categories: BookshelfCategory[]`（`since <= 0` 或省略时返回所有未软删除的分类；`since > 0` 时返回 `server_updated_at > since` 的分类，含软删除）。
  - `bookshelf` 每项包含 `categoryIds: string[]`、`genres: string[]`、`status: NovelStatus`。
  - `progress` 每项包含 `historyHiddenAt: number | null`。
- **`POST /v1/sync/state`**：
  - 请求体新增可选字段 `categories?: BookshelfCategory[]`。
  - 请求体中 `bookshelf[].categoryIds`、`bookshelf[].genres`、`bookshelf[].status`、`progress[].historyHiddenAt` 均为可选（未传时兼容老客户端：新建取默认值，更新保留服务端既有值）。
  - 响应 `data` 新增 `categories: BookshelfCategory[]`（合并后的分类列表）。

### 4.3 服务器缓存筛选 API（`apps/api-server/src/linovelib.ts` & `packages/storage/src/db.ts`）

1. **扩展 `GET /v1/linovelib/novels`**：
   - 保留现有 `page`、`pageSize`、`style` 参数，新增可选查询参数：
     - `genres`：逗号分隔的题材标签名（如 `奇幻,校园`），采用**交集（AND）**语义——返回同时拥有所选全部标签的已缓存小说（SQLite 通过 `novel_genres` + `genres` 分组 `HAVING COUNT(DISTINCT genres.id) = N` 实现，或子查询 `EXISTS`）。
     - `status`：`"ongoing" | "completed" | "unknown"`，可选。
     - `q`：可选关键词，对 `novels.name` 或 `novels.author` 做不区分大小写的模糊匹配（`LIKE`）。
   - 返回结构不变：`{ items: NovelInfo[], total, page, pageSize }`（`style=lnreader` 兼容逻辑保持不变）。
2. **新增 `GET /v1/linovelib/genres`**：
   - 返回当前平台在服务端 `novels` 表中已缓存作品的所有题材标签及其作品数量：
     `{ code: 0, message: "Success", data: CachedGenreItem[] }`（按 `count DESC, name ASC` 排序）。
   - 供 Web 与 App 在「发现页 → 服务器缓存」动态渲染标签筛选器。
3. **OpenAPI 契约同步**：修改完成后运行 `pnpm --filter=@acanthis-dec/api-server run openapi:generate` 更新 `apps/api-server/openapi.json` 并通过 `openapi:check`。

---

## 5. 客户端存储、迁移与同步设计（Web & App）

### 5.1 Web 端（`apps/web`）

- **IndexedDB 升级（`apps/web/src/db/indexedDb.ts`）**：
  - `DB_VERSION` 从 `1` 升至 `2`。
  - 新增 Object Store `categories`（`keyPath: "id"`）。
  - `DirtySyncEntry.kind` 扩展为 `"bookshelf" | "progress" | "category"`（分类脏键格式 `category:${id}`）。
  - 读取旧 `bookshelf` / `progress` 记录时做字段兜底（`categoryIds ?? []`、`genres ?? []`、`status ?? "unknown"`、`historyHiddenAt ?? null`）。
  - 首次从 `v1` 升级到 `v2` 时，自动将 `settingsStore.lastSyncServerTime` 重置为 `0`，触发一次全量拉取以补齐所有老书的 `genres`/`status` 与远端 `categories`。
- **Store 扩展（`apps/web/src/stores/library.ts`）**：
  - 新增 `categoriesMap` 与 `activeCategories`（按 `sortOrder ASC, createdAt ASC` 排序）。
  - 新增 `historyList`（过滤掉 `historyHiddenAt != null && updatedAt <= historyHiddenAt`，按 `updatedAt DESC` 排序）。
  - `continueReadingItem` 改为取 `historyList[0] ?? null`。
  - 新增方法：`createCategory`、`renameCategory`、`deleteCategory`、`reorderCategories`、`setBookshelfCategories(platform, novelId, categoryIds)`、`removeHistoryItem(platform, novelId)`、`clearAllHistory()`。
  - `applyKeepalivePayloadLimit` 同步支持 `categories` 载荷。

### 5.2 App 端（`acanthis-mobile/:composeApp`）

- **Room 数据库升级（`AppDatabase.kt`、`Entities.kt`、`Daos.kt`）**：
  - `version` 从 `2` 升至 `3`，**新增显式 `MIGRATION_2_3`** 并通过 `.addMigrations(MIGRATION_2_3)` 注册（保留 `fallbackToDestructiveMigration` 仅作极端兜底），确保已安装用户升级不丢书架/进度/章节缓存：
    - `CREATE TABLE IF NOT EXISTS bookshelf_categories (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, sortOrder INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER)`
    - `ALTER TABLE bookshelf_items ADD COLUMN categoryIdsJson TEXT NOT NULL DEFAULT '[]'`
    - `ALTER TABLE bookshelf_items ADD COLUMN genresJson TEXT NOT NULL DEFAULT '[]'`
    - `ALTER TABLE bookshelf_items ADD COLUMN status TEXT NOT NULL DEFAULT 'unknown'`
    - `ALTER TABLE reading_progress ADD COLUMN historyHiddenAt INTEGER`
  - 导出 Room `schemas/io.acanthis.app.core.database.AppDatabase/3.json`。
  - 在 `ServerConfigStore` 记录 `syncSchemaVersion`（或检测升级迁移完成）时将 `lastSyncCursor` 一次性重置为 `0L`，触发全量拉取补齐老书元数据。
- **网络与同步层（`ApiModels.kt`、`AcanthisApiClient.kt`、`SyncCoordinator.kt`、`LibraryRepository.kt`）**：
  - `BookshelfItemDto` 增加 `categoryIds: List<String> = emptyList()`、`genres: List<String> = emptyList()`、`status: String = "unknown"`。
  - `ReadingProgressDto` 增加 `historyHiddenAt: Long? = null`。
  - 新增 `BookshelfCategoryDto`、`CachedGenreDto`，扩展 `SyncStatePullResponseDto` / `SyncStatePushPayloadDto` / `SyncStatePushResponseDto`。
  - `AcanthisApiClient` 扩展 `getCachedNovels(platform, page, pageSize, genres, status, q)` 并新增 `getCachedGenres(platform)`。
  - `SyncCoordinator` 增加 `category` 脏队列推送、合并与 `historyHiddenAt` max-wins 合并。

---

## 6. UI 与交互设计（Web 与 App 保持一致）

### 6.1 导航结构
- 两端一级导航统一为 **4 个 Tab**：**书架 / 历史 / 发现 / 设置**。
  - Web 端：顶部/底部导航新增 `/history`（`HistoryView.vue`）。
  - App 端：`TopLevelTab` 新增 `HistoryRoute`（`HistoryScreen.kt`）。

### 6.2 历史记录页（参考 LNReader）
- **顶部操作栏**：标题「历史」、关键词搜索框（按书名/章节名本地过滤）、右上角「清空历史」按钮（带二次确认弹窗）。
- **列表内容**：按本地时区自然日分组（`今天`、`昨天`、`YYYY年MM月DD日`），每行展示：
  - 左侧：封面缩略图（点击进作品详情）。
  - 中间：书名、上次阅读的卷/章标题、阅读时间（如 `14:32`）与设备标签。
  - 右侧：主按钮「继续」（▶，直接打开阅读器恢复到该章节与段落）+ 删除按钮（🗑，点击后立即按第 3.2.A 节落库并入脏队列，弹出简洁轻提示「已从历史记录移除」，不提供撤销按钮——避免与 `historyHiddenAt` 严格 max-wins 语义冲突；清空全部历史前弹出二次确认框）。
- **空态**：无历史或搜索无结果时给出清晰提示与“去发现好书”引导。

### 6.3 书架页（多书架 + 标签/状态筛选 + 搜索）
- **书架切换栏**（水平可滚动 Tab / Chip 条）：
  - `[ 全部 ] [ 默认 ] [ 自定义书架 1 ] [ 自定义书架 2 ] ... [ 管理 ]`
  - 每个 Tab 可显示当前书架内藏书数量；“管理”打开书架管理弹窗/底部抽屉（新建书架、重命名、上移/下移排序、删除书架）。
- **筛选与搜索工具栏**：
  - 本地搜索框（按书名/作者实时过滤）。
  - 标签筛选按钮（打开标签多选弹窗/下拉，列出当前藏书中出现过的所有 `genres` 及对应计数，支持多选 AND 交集）+ 连载状态筛选（全部 / 连载中 / 已完结）。
  - 排序切换（最近阅读 / 最近添加 / 书名）。
  - 已激活的筛选条件以可一键关闭的 Chip 条展示，并提供“重置筛选”。
- **书籍卡片操作**：
  - Web 端三点菜单 & App 端长按/菜单新增**「管理所属书架」**（打开多选书架弹窗）与「移出书架」。
  - 作品详情页「加入书架 / 已在书架」按钮同步支持选择/修改所属书架。

### 6.4 发现页 → 服务器缓存筛选 & 详情页标签点击
- **发现页 → 服务器缓存**：
  - 顶部新增搜索输入框（支持防抖按 `q` 查询）、连载状态 Chip、以及从 `GET /v1/{platform}/genres` 加载的题材标签多选筛选器；条件变化时重新请求 `GET /v1/{platform}/novels` 第 1 页。
- **作品详情页标签点击**：
  - `NovelDetailView.vue` 与 `NovelDetailScreen.kt` 中的 `novel.genres` 胶囊改为可点击。
  - 点击某个标签后，跳转到**书架页并自动选中该标签筛选**（Web 端可通过 query 参数如 `/?genre=奇幻`；App 端通过导航参数或共享状态切换至书架 Tab 并设置筛选条件；若该书不在书架或书架内无匹配，书架空态提供“去服务器缓存中查看「奇幻」”一键跳转）。

---

## 7. 验收与发版要求

1. **Acanthis 仓库**：
   - Drizzle 迁移可对空库和已有旧库平滑升级。
   - `pnpm --filter=@acanthis-dec/api-server run openapi:check`、`pnpm check-types`、`pnpm build` 全部通过；所有改动文件通过 `pnpm exec biome check`。
   - 按 `AGENTS.md` 规范补充 Changeset（涉及 `@acanthis-dec/core`、`@acanthis-dec/storage`、`@acanthis-dec/api-server`、`@acanthis-dec/web`）。
2. **acanthis-mobile 仓库**：
   - Room `MIGRATION_2_3` 有对应单元测试（含 Sync 合并测试：`historyHiddenAt` max-wins、多书架 LWW、软删除兜底回默认书架、标签筛选逻辑）。
   - `.\gradlew.bat :composeApp:testAndroidHostTest` 与 `.\gradlew.bat :androidApp:assembleDebug` 全部通过。

---

## 8. 留给实现阶段决定的细节
- 具体 UI 图标选择、动画过渡、移动端底部抽屉 vs 对话框的视觉微调。
- Web 端与 App 端书架管理弹窗的拖拽排序 vs 上下箭头按钮实现方式（均可，优先简洁可靠）。
- 服务端 `GET /v1/linovelib/genres` 是否加短时内存缓存（如 30s）或直接 SQL 聚合（SQLite 本地查询极快，实现者可自行权衡）。
