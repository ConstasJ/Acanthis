# Acanthis 底座能力补齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `@acanthis-dec/core`、`@acanthis-dec/storage`、`@acanthis-dec/linovelib` 与 `@acanthis-dec/api-server` 补齐多源发现、CORS 与可选 Bearer 鉴权、封闭式正文插图代理缓存、已缓存书库分页、章节直链兜底以及隐藏章节双向推导能力。

**Architecture:** 自底向上按包依赖顺序推进：`@acanthis-dec/core` 定义 `SourceCapability` 与 `NovelSourceDescriptor` 契约；`@acanthis-dec/storage` 落地 `illustration_metadata` 表与文件夹式 Drizzle 迁移、插图读写、书库分页查询及事务内残留章节/分卷清理；`@acanthis-dec/linovelib` 封装章节插图提取/重写/拉取与两阶段隐藏章节推导状态机；`@acanthis-dec/api-server` 编排 `CORS`、`AUTH_TOKEN` 鉴权中间件及新版路由，出口统一用 `resolveHost(c)` 动态重写插图与封面 URL，磁盘 `.zst` 保持源站原始 HTML 不变。

**Tech Stack:** TypeScript 7.0.2（ESM + 严格模式）、pnpm 12.21.0 + Turbo、Zod v4、Drizzle ORM (`rc`) + libSQL/SQLite、Cheerio 1.2.0、Hono 4、Biome、tsdown / esbuild。

**Spec:** `docs/superpowers/specs/2026-11-19-foundation-enhancements-design.md`

## Spec 与当前代码库对齐说明

实施时以下细节以当前仓库真实代码为准（不改动 Spec 原文）：

1. **`getNovelVolumes` 首参补齐**：Spec §5.2.2 签名为 `getNovelVolumes(novelId, title, url, fetchClient, retry, chapterQueue)`，当前 `packages/linovelib/src/novel.ts:63-69` 缺少 `novelId` 形参；实施时补齐首参 `novelId: string`（保留 `chapterQueue?` 可选），并更新 `packages/linovelib/src/novel.ts:230` 调用处传入 `id`。
2. **`resolveHost(c)` 修正 `c.header("host")` 笔误**：Spec §5.3.2 要求复用 `config.host ?? c.req.header("host") ?? "http://localhost:5301"`，而 `apps/api-server/src/linovelib.ts:116,304` 现行误写为 `c.header("host")`（Hono 响应头 API）；实施时统一抽取 `resolveHost(c)` 读取 `c.req.header("host")`、补齐协议前缀并去除末尾 `/`。
3. **Drizzle v1 `rc` 与 `defineRelations`**：`packages/storage/package.json:34,41` 使用 `drizzle-orm: "rc"` 与 `drizzle-kit: "rc"`，迁移采用 `migrations/<ts>_<name>/migration.sql` + `snapshot.json` 文件夹格式；新增表 `illustrationMetadata` 必须同步加入 `packages/storage/src/table.ts:149-162` 的 `defineRelations`。
4. **具名类型 `SourceCapability`**：`packages/core/src/types.ts` 同步导出具名类型 `SourceCapability` 与 `NovelSourceDescriptor`，一次性对齐 Spec 1 与后续 Plan 3 契约。
5. **`transformOutputStyleForSearchResult` 泛型化**：`apps/api-server/src/utils.ts:54-70` 现行返回类型为 `NovelSearchResult | LNReaderNovelItem`；将其改为泛型 `<T extends NovelSearchResult>(result: T, style: OutputStyle | undefined): T | LNReaderNovelItem`，确保 `GET /v1/linovelib/novels` 返回完整 `NovelInfo` 字段类型。
6. **`CORS_ORIGIN` / `AUTH_TOKEN` 空串处理**：`apps/api-server/src/config.ts:114-164` 使用 `deepmerge(fileConfig, envConfig)`；仅当环境变量值为非空字符串时才注入 `envConfig.cors` / `envConfig.auth`，避免空串覆盖 `config.yaml` 或触发 `z.string().min(1)` 启动失败。
7. **工具链与校验命令**：根 `package.json:9` 为 `"packageManager": "pnpm@12.21.0"`，根目录无 `tsconfig.json`；所有类型检查与构建命令统一使用 `pnpm --filter=<pkg> run check-types` / `build` 及根目录 `pnpm run format-and-lint`。

## Global Constraints

- **包边界职责**：`@acanthis-dec/storage` 仅负责 SQLite（Drizzle + libSQL）与文件系统持久化，禁止引入 HTML 解析或爬虫逻辑；`@acanthis-dec/linovelib` 负责站点 HTML 提取/重写、隐藏章节推导与带 `Referer` 图片抓取；`@acanthis-dec/api-server` 负责 Zod 配置校验、CORS/鉴权中间件、参数校验与缓存协调。
- **TypeScript 严格模式与代码风格**：遵循 `tools/config-typescript/base.json`（`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`、`isolatedModules`、`noUncheckedSideEffectImports`），禁止使用类型断言压制编译错误；遵循 `biome.json`（Tab 缩进、双引号、recommended 规则、`organizeImports`）。
- **限流与安全红线**：所有新增章节/分页抓取必须经过 `NovelChapterQueue`（`concurrency: 1`，随机间隔 `500~1000ms`）；严禁开放式图片代理或写死图床域名白名单（仅代理 `illustration_metadata` 已登记 URL）；不修改 `.zst` 原始 HTML 存储格式；保持既有 `{ code, message, data }` JSON Envelope 向后兼容。
- **跨包与跨计划契约**：导出符号、HTTP 路由、错误码（`0`/`10000`/`10001`/`10002`/`10003`/`20000`/`40100`）与环境变量（`HOST`/`CORS_ORIGIN`/`AUTH_TOKEN`）必须与后续计划契约完全一致。
- **无单元测试框架约束**：不新增测试框架，所有 Task 使用包级 `check-types`、`build`、`pnpm run format-and-lint`、`drizzle-kit generate` 及可执行的端到端实测脚本/HTTP 请求验证；每次完成原子单元后提交符合 Conventional Commits 规范的 commit（暂不执行 `git push`）。

## Review Focus

1. **连续隐藏章节、末章未决与空卷事务清理**：目录出现连续 2 章以上 `javascript:cid(0)`、跨卷边界隐藏、全书末章隐藏、超过单章多分页章节或彻底无解章节时，`getNovelVolumes` 不得拼接非法 URL 导致 `NovelChapterQueue` 抛错，也不得因重复 `"TOBEDETERMINED"` 违反 `chapters` 表 `UNIQUE(novel_id, platform_id)` 约束；`addNovelCache` 面对空 `volumes` 不得因 Drizzle `notInArray(..., [])` 报错。（落地于 **Task 3** 与 **Task 5** 验证步骤）
2. **协议相对 `//` URL、非 HTTP(S) `img` 与 Cheerio 片段外层包裹**：章节 HTML 含 `<img src="//...">`、空 `src`、`data:image/...` 或无 `src` 标签时，`extractChapterIllustrationUrls` 须正确补全 `https:` 并过滤非 HTTP(S) 链接；`rewriteChapterIllustrations` 不得破坏既有 `<p>`/`<h2>` 结构或包裹多余的 `<html><body>` 外壳。（落地于 **Task 4** 验证步骤）
3. **CORS 预检、鉴权旁路与 `timingSafeEqual` 长度安全**：启用 `AUTH_TOKEN` 时，跨域 `OPTIONS` 预检、不同长度无效 Bearer Token、非 Bearer `Authorization` 头、`AUTH_TOKEN=""` 空环境变量，以及 `GET /v1/:platform/cover/*` 与 `GET /v1/:platform/illustration/*` 免鉴权（同时 `POST` 等非 GET 方法不可绕过）均不得触发 `RangeError` 或越权放行。（落地于 **Task 6** 验证步骤）
4. **插图数据库记录与磁盘文件半状态一致性**：同一章节重复插图 URL 须幂等入库；`.zst` 已缓存但 `illustration_metadata` 未登记的老章节需在读取时补登记；数据库中 `file_hash` 已存在但磁盘文件意外缺失时须按 `undefined` 回源修复落盘；未登记的 32 位 hex hash 必须严格返回 `404` `{ code: 10003 }`。（落地于 **Task 3** 与 **Task 7** 验证步骤）
5. **`HOST` 末尾斜杠、占位行过滤与无效直链 `novelId` 兜底**：`HOST` 带末尾 `/` 时拼接封面与插图 URL 不得产生双斜杠；`addSearchResult`/`addNovelCoverMetadata` 写入的 `status="unknown"` / `author=""` / `name=""` 占位行不得出现在 `GET /v1/linovelib/novels` 中，空库返回 `{ items: [], total: 0, page, pageSize }`；`GET /v1/linovelib/chapter/:chapterId?novelId=` 传入无效或不存在的 `novelId` 时须干净回落 `404` `code: 10000` 而非写入脏数据或崩溃。（落地于 **Task 3** 与 **Task 7** 验证步骤）

---

### Task 1: `@acanthis-dec/core` 新增书源发现类型契约

**Files:**

- Modify: `packages/core/src/types.ts:41`
- Modify: `packages/core/src/index.ts:8-16`

**Interfaces:**

- Consumes: 无（基础类型定义）
- Produces（由 `packages/core/src/index.ts` 包根导出）:
  - `export type SourceCapability = "search" | "novels" | "illustrations";`
  - `export interface NovelSourceDescriptor { id: string; name: string; capabilities: SourceCapability[]; }`

- [ ] **Step 1: 在 `packages/core/src/types.ts` 末尾追加书源能力与描述类型**

定义并导出 `SourceCapability` 与 `NovelSourceDescriptor`，字段类型严格匹配 Produces 契约。

- [ ] **Step 2: 在 `packages/core/src/index.ts` 包根再导出新类型**

将 `NovelSourceDescriptor` 与 `SourceCapability` 加入 `./types` 的 `export type { ... }` 导出列表。

- [ ] **Step 3: 运行类型检查、构建与 Lint 验证**

Run:

```bash
pnpm --filter=@acanthis-dec/core run check-types
pnpm --filter=@acanthis-dec/core run build
pnpm run format-and-lint
```
Expected: 全部退出码 `0`，`packages/core/dist/index.d.mts` 中可见 `NovelSourceDescriptor` 与 `SourceCapability` 类型声明。

- [ ] **Step 4: 原子提交**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts
git commit -m "feat(core): 新增书源能力与描述类型定义" -m "在 packages/core/src/types.ts 与 src/index.ts 中新增并导出 SourceCapability 与 NovelSourceDescriptor 契约类型。"
```

---

### Task 2: `@acanthis-dec/storage` 新增 `illustrationMetadata` 表、Hash 工具、分页类型与 Drizzle 增量迁移

**Files:**

- Modify: `packages/storage/src/table.ts:144-218`
- Modify: `packages/storage/src/utils.ts:28-43`
- Modify: `packages/storage/src/type.ts:1-20`
- Modify: `packages/storage/src/index.ts:1-11`
- Create: `packages/storage/migrations/<timestamp>_<name>/migration.sql`（及同目录 `snapshot.json`，由 `drizzle-kit generate` 生成）

**Interfaces:**

- Consumes: `@acanthis-dec/core` (`NovelInfo`)
- Produces:
  - 内部表定义（仅从 `packages/storage/src/table.ts` 导出供内部 `db.ts` 消费，不从包根 `index.ts` 暴露）：
    - `illustrationMetadata`（表名 `illustration_metadata`，唯一索引名 `illustration_platform_url_hash_idx` 覆盖 `(platform, url_hash)`）
  - 包根导出（由 `packages/storage/src/index.ts` 导出）：
    - `export function getUrlHash(url: string): string;`（MD5 32 位小写 hex）
    - `export interface ListNovelsOptions { page: number; pageSize: number; }`
    - `export interface PaginatedNovels { items: NovelInfo[]; total: number; page: number; pageSize: number; }`

- [ ] **Step 1: 在 `packages/storage/src/table.ts` 新增 `illustrationMetadata` 表并更新 `defineRelations`**

在 `generalCache` 后新增 `illustrationMetadata = sqliteTable("illustration_metadata", { ... })`：

- 列定义：`id`（自增主键）、`platform`（`text("platform").notNull()`）、`urlHash`（`text("url_hash").notNull()`）、`originalUrl`（`text("original_url").notNull()`）、`fileHash`（`text("file_hash")` 可空）、`contentType`（`text("content_type")` 可空）、`createdAt`（`integer("created_at").notNull()`）。
- 索引：`unique("illustration_platform_url_hash_idx").on(table.platform, table.urlHash)`。
- 将 `illustrationMetadata` 加入第 149-162 行 `defineRelations({ ... })` 首参表映射中。

- [ ] **Step 2: 新增 `getUrlHash` 与书库分页类型并在包根导出**

1. 在 `packages/storage/src/utils.ts` 复用 `node:crypto` 的 `createHash("md5")` 新增导出 `getUrlHash(url: string): string`。
2. 在 `packages/storage/src/type.ts` 导入 `type { NovelInfo } from "@acanthis-dec/core"`，新增并导出 `ListNovelsOptions` 与 `PaginatedNovels`。
3. 在 `packages/storage/src/index.ts` 包根仅再导出 `getUrlHash`（来自 `./utils`）以及 `type ListNovelsOptions`、`type PaginatedNovels`（来自 `./type`）；`illustrationMetadata` 保持仅从 `packages/storage/src/table.ts` 导出供内部 `db.ts` 消费。

- [ ] **Step 3: 生成 Drizzle 增量迁移并追加存量未决章节清理 SQL**

Run:

```bash
pnpm --filter=@acanthis-dec/storage exec drizzle-kit generate
```
Expected: 在 `packages/storage/migrations/` 下生成新的 `<timestamp>_<name>/` 文件夹，包含 `snapshot.json` 与 `migration.sql`（内含 `CREATE TABLE illustration_metadata` 与 `CREATE UNIQUE INDEX illustration_platform_url_hash_idx`）。

随后编辑新生成的 `migration.sql`，在末尾追加（遵循 Drizzle 语句分隔符约定）：

```sql
--> statement-breakpoint
DELETE FROM `chapters` WHERE `platform_id` LIKE 'TOBEDETERMINED%';
```

- [ ] **Step 4: 类型检查与临时库迁移冒烟验证**

Run:

```bash
pnpm --filter=@acanthis-dec/storage run check-types
pnpm --filter=@acanthis-dec/storage run build
pnpm run format-and-lint
```
并用 `pnpm --filter=@acanthis-dec/storage exec tsx -e "..."` 在临时目录创建预置旧表与 `"TOBEDETERMINED"` 章节行的 SQLite 库，指向 `packages/storage/migrations`（即包内 `./migrations`）实例化 `DatabaseService`（或依次执行初始与新增迁移），验证：

1. `SELECT count(*) FROM chapters WHERE platform_id LIKE 'TOBEDETERMINED%'` 结果为 `0`；
2. `sqlite_master` 中存在 `illustration_metadata` 表与 `illustration_platform_url_hash_idx` 唯一索引。

- [ ] **Step 5: 原子提交**

```bash
git add packages/storage/src/table.ts packages/storage/src/utils.ts packages/storage/src/type.ts packages/storage/src/index.ts packages/storage/migrations
git commit -m "feat(storage): 新增插图元数据表、分页类型与增量迁移" -m "在 table.ts 新增 illustration_metadata 表及关系定义，在 utils.ts/type.ts/index.ts 导出 getUrlHash 与分页类型，并生成含清理存量 TOBEDETERMINED 章节 SQL 的 Drizzle 迁移。"
```

---

### Task 3: `@acanthis-dec/storage` 实现插图缓存、书库分页查询与事务残留清理

**Files:**

- Modify: `packages/storage/src/db.ts:14-31,183-274,611-622`
- Modify: `packages/storage/src/files.ts:1-107`
- Modify: `packages/storage/src/service.ts:1-123`

**Interfaces:**

- Consumes: Task 2（`illustrationMetadata`、`getUrlHash`、`getExtFromContentType`、`ListNovelsOptions`、`PaginatedNovels`）
- Produces（`StorageService` 新增实例方法，并同步由 `DatabaseService` / `FSStorageService` 提供底层实现）:
  - `registerIllustrations(platform: string, urls: string[]): Promise<void>`
  - `getIllustrationSourceUrl(platform: string, urlHash: string): Promise<string | undefined>`
  - `getIllustrationData(platform: string, urlHash: string): Promise<BinaryResponse | undefined>`
  - `setIllustrationData(platform: string, urlHash: string, data: Buffer, contentType: string): Promise<void>`
  - `listCachedNovels(platform: string, options: ListNovelsOptions): Promise<PaginatedNovels>`

- [ ] **Step 1: 增强 `DatabaseService.addNovelCache` 事务残留清理并新增 DB 查询/写入方法**

在 `packages/storage/src/db.ts` 完成以下变更：

1. **事务内残留清理（`addNovelCache` 183-274 行）**：
   - 更新已有章节冲突策略为同时刷新 `volumeId` 与 `name`（**绝不覆写 `contentHash`**）。
   - upsert 全部分卷与章节后，收集本次有效 `volumePlatformIds` 与 `chapterPlatformIds`：
     - 清理过期章节：若 `chapterPlatformIds.length > 0` 则删除 `novelId` 下 `notInArray(chapters.platformId, chapterPlatformIds)` 的行；否则删除该 `novelId` 下全部章节（避免 `notInArray(..., [])` 报错）。
     - 清理过期分卷：若 `volumePlatformIds.length > 0` 则删除 `novelId` 下 `notInArray(volumes.platformId, volumePlatformIds)` 的行；否则删除该 `novelId` 下全部分卷。
2. **插图元数据方法**：
   - `registerIllustrations(platform: string, urls: string[]): Promise<void>`：对 `urls` 去重并过滤空串后，若非空则在事务中批量计算 `getUrlHash(url)`，以 `onConflictDoNothing({ target: [illustrationMetadata.platform, illustrationMetadata.urlHash] })` 插入。
   - `getIllustrationSourceUrl(platform: string, urlHash: string): Promise<string | undefined>`：按 `(platform, urlHash)` 查询返回 `originalUrl`。
   - `getIllustrationMetadata(platform: string, urlHash: string)`：返回 `{ originalUrl, fileHash, contentType } | undefined`。
   - `updateIllustrationFileInfo(platform: string, urlHash: string, fileHash: string, contentType: string): Promise<void>`：按 `(platform, urlHash)` 回填 `fileHash` 与 `contentType`。
3. **已缓存书库分页查询**：
   - `listCachedNovels(platform: string, options: ListNovelsOptions): Promise<PaginatedNovels>`：
     - 过滤条件：`and(eq(novels.platform, platform), ne(novels.status, "unknown"), ne(novels.author, ""), ne(novels.name, ""))`；
     - 分别查询 `total`（`count()`）与当前页列表（`orderBy(desc(novels.updateAt), desc(novels.id))`、`limit(pageSize)`、`offset((page - 1) * pageSize)`）；
     - 批量查询命中 `novelId` 关联的 `novelGenres` + `genres` 名称组装完整 `NovelInfo`（含 `genres: string[]`），返回 `{ items, total, page, pageSize }`。

- [ ] **Step 2: 在 `FSStorageService` 与 `StorageService` 暴露插图文件读写与书库查询接口**

1. 在 `packages/storage/src/files.ts` 新增：
   - `getIllustrationData(platform: string, urlHash: string): Promise<BinaryResponse | undefined>`：查 `this.dbService.getIllustrationMetadata`；若无记录、`fileHash`/`contentType` 为空或磁盘路径 `${this.basePath}/illustrations/${fileHash.slice(0, 2)}/${fileHash}.${getExtFromContentType(contentType)}` 不存在，均返回 `undefined`；命中则返回 `{ data, mimeType: contentType }`。
   - `setIllustrationData(platform: string, urlHash: string, data: Buffer, contentType: string): Promise<void>`：计算 `fileHash = getCoverHash(data)` 与 `ext = getExtFromContentType(contentType)`，确保目录存在后落盘，再调用 `this.dbService.updateIllustrationFileInfo(platform, urlHash, fileHash, contentType)`。
2. 在 `packages/storage/src/service.ts` 挂载并透传 Produces 所列的 5 个方法。

- [ ] **Step 3: 类型检查、构建与端到端实测验证（覆盖 Review Focus #1、#4、#5）**

Run:

```bash
pnpm --filter=@acanthis-dec/storage run check-types
pnpm --filter=@acanthis-dec/storage run build
pnpm run format-and-lint
```
并运行 `pnpm --filter=@acanthis-dec/storage exec tsx -e "..."` 临时验证脚本（使用临时目录 + 临时 SQLite，执行后清理临时目录），确认全部断言通过：

1. **Review Focus #1（空卷与残留清理）**：先写入含 `TOBEDETERMINED_0_0` 与普通章节（附带 `contentHash="abc"`）的 `Novel`，再次调用 `addNovelCache` 用真实 ID 替换占位章并保留普通章，断言占位行已删除且保留章 `contentHash` 仍为 `"abc"`；随后以 `volumes: []` 调用 `addNovelCache`，断言不抛 `notInArray` 异常且分卷/章节被清空。
2. **Review Focus #4（插图幂等与半状态恢复）**：传入含重复 URL 的数组调用 `registerIllustrations`，断言无冲突报错且 `getIllustrationSourceUrl` 返回正确原 URL；调用 `setIllustrationData` 落盘后手动 `rmSync` 删除磁盘文件，断言 `getIllustrationData` 返回 `undefined` 而非抛错。
3. **Review Focus #5（书库占位过滤与空库）**：空库调用 `listCachedNovels("linovelib", { page: 1, pageSize: 20 })` 返回 `{ items: [], total: 0, page: 1, pageSize: 20 }`；写入 `addSearchResult` 与 `addNovelCoverMetadata` 占位行后查询仍为 `total: 0`；写入完整 `addNovelCache` 后返回对应 `NovelInfo`（含 `genres`）且按 `updateAt DESC, id DESC` 排序。

- [ ] **Step 4: 原子提交**

```bash
git add packages/storage/src/db.ts packages/storage/src/files.ts packages/storage/src/service.ts
git commit -m "feat(storage): 实现插图缓存管理、书库分页查询与事务残留清理" -m "升级 DatabaseService.addNovelCache 事务内清理过期分卷与章节（保留既有 contentHash），并新增插图读写、去重登记及过滤占位行的书库分页查询接口。"
```

---

### Task 4: `@acanthis-dec/linovelib` 实现章节插图提取/重写与二进制图片拉取

**Files:**

- Create: `packages/linovelib/src/illustration.ts`（或直接修改 `packages/linovelib/src/chapter.ts` 并在 `index.ts` 导出）
- Modify: `packages/linovelib/src/client.ts:230-237`
- Modify: `packages/linovelib/src/index.ts:1-6`

**Interfaces:**

- Consumes: `@acanthis-dec/browser-fetch` (`BinaryResponse`)、`cheerio`
- Produces（由 `packages/linovelib/src/index.ts` 包根导出）:
  - `export function extractChapterIllustrationUrls(html: string): string[];`
  - `export function rewriteChapterIllustrations(html: string, mapUrl: (originalUrl: string) => string): string;`
  - `LinovelibClient.prototype.getIllustration(url: string, referer?: string): Promise<BinaryResponse>`

- [ ] **Step 1: 实现 `extractChapterIllustrationUrls` 与 `rewriteChapterIllustrations`**

在 `packages/linovelib/src/illustration.ts`（用 Cheerio 片段模式 `cheerio.load(html, null, false)`，避免注入 `<html><head><body>` 外壳）：

- 规范化辅助逻辑：提取 `img` 的 `src` 并 `trim()`；若以 `"//"` 开头则补全为 `"https:" + src`；仅保留以 `"http://"` 或 `"https://"` 开头的 URL（过滤空串、`data:`、相对路径等）。
- `extractChapterIllustrationUrls(html: string): string[]`：遍历所有 `img`，按出现顺序使用 `Set<string>` 去重返回规范化 URL 数组。
- `rewriteChapterIllustrations(html: string, mapUrl: (originalUrl: string) => string): string`：使用片段模式加载 `html`，对每个满足 HTTP(S) 规范的 `img` 将其 `src` 替换为 `mapUrl(normalizedUrl)`，直接返回 `$.html()`，不改动既有 `<p>`、`<h2>` 等段落与标签结构。

- [ ] **Step 2: 为 `LinovelibClient` 新增 `getIllustration` 并在包根导出新工具函数**

1. 在 `packages/linovelib/src/client.ts:230-237` 后新增：

   ```ts
   async getIllustration(url: string, referer?: string): Promise<BinaryResponse>
   ```

   若 `this.options?.session.enabled && !this.isSessionValid` 则先执行 `ensureValidSession`，随后复用 `this.getCover(url, referer || "https://www.linovelib.com/")`。
2. 在 `packages/linovelib/src/index.ts` 导出 `extractChapterIllustrationUrls` 与 `rewriteChapterIllustrations`。

- [ ] **Step 3: 类型检查、构建与端到端片段解析验证（覆盖 Review Focus #2）**

Run:

```bash
pnpm --filter=@acanthis-dec/linovelib run check-types
pnpm --filter=@acanthis-dec/linovelib run build
pnpm run format-and-lint
```
并运行 `pnpm --filter=@acanthis-dec/linovelib exec tsx -e "..."` 临时脚本验证 **Review Focus #2**：
输入包含 `<h2>章节名</h2>\n<p>正文</p><p><img src="//img.example.com/a.jpg" class="imagecontent"></p><p><img src="https://cdn.example.com/b.png"></p><img src="data:image/png;base64,AAA"><img src="   "><img><img src="//img.example.com/a.jpg">`：

- `extractChapterIllustrationUrls` 返回 `["https://img.example.com/a.jpg", "https://cdn.example.com/b.png"]`（仅 2 项且顺序正确）；
- `rewriteChapterIllustrations` 返回字符串包含重写后的两个 `src`，保留 `<h2>` 与 `<p>`，保留 `data:image/...` 等非 HTTP(S) 原样不变，且**不包含** `<html>`、`<head>` 或 `<body>` 标签。

- [ ] **Step 4: 原子提交**

```bash
git add packages/linovelib/src/illustration.ts packages/linovelib/src/client.ts packages/linovelib/src/index.ts
git commit -m "feat(linovelib): 新增章节插图提取、片段重写与二进制拉取方法" -m "实现基于 Cheerio 片段模式的 extractChapterIllustrationUrls 与 rewriteChapterIllustrations（补全协议相对 URL 并过滤非 HTTP(S) 链接），并为 LinovelibClient 新增带 Referer 的 getIllustration 方法。"
```

---

### Task 5: `@acanthis-dec/linovelib` 重构目录隐藏章节（`TOBEDETERMINED`）双向推导

**Files:**

- Modify: `packages/linovelib/src/novel.ts:32-242`
- Modify: `packages/linovelib/src/index.ts:1-6`

**Interfaces:**

- Consumes: `NovelChapterQueue`（`fetchChapterPart(url: string): Promise<string>`，位于 `packages/linovelib/src/queue.ts:62-116`）
- Produces:
  - 包根导出（`packages/linovelib/src/index.ts`）：`export function isUnresolvedChapterId(id: string): boolean`（返回 `id.startsWith("TOBEDETERMINED")`）
  - `packages/linovelib/src/novel.ts` 导出/内部契约：
    - `isUnresolvedChapterId(id: string): boolean`
    - `parseNextChapterIdFromPrevChapter(novelId: string, prevChapterId: string, chapterQueue: NovelChapterQueue): Promise<string>`
    - `getNovelVolumes(novelId: string, title: string, url: string, fetchClient: BrowserFetchClient, retry: RetryOptions, chapterQueue?: NovelChapterQueue): Promise<Volume[]>`
    - 最终未决章节固定格式：`TOBEDETERMINED_${vIndex}_${cIndex}`

- [ ] **Step 1: 实现 `isUnresolvedChapterId` 与 `parseNextChapterIdFromPrevChapter`**

在 `packages/linovelib/src/novel.ts`：

1. 新增导出 `isUnresolvedChapterId(id: string): boolean`，实现为 `id.startsWith("TOBEDETERMINED")`。
2. 实现 `parseNextChapterIdFromPrevChapter(novelId: string, prevChapterId: string, chapterQueue: NovelChapterQueue): Promise<string>`：
   - 若 `!/^\d+$/.test(prevChapterId)` 直接返回 `""`；
   - 设置 `MAX_PAGES = 50`，从 `currentPageId = prevChapterId` 起循环拉取 `https://www.linovelib.com/novel/${novelId}/${currentPageId}.html`（走 `chapterQueue.fetchChapterPart`）；
   - 从响应 HTML 依次提取 `$("div.mlfy_page a:last").attr("href")?.match(/\/novel\/(\d+)\/([\d_]+)\.html/)?.[2]` 或 `html.match(/url_next:'\/novel\/(\d+)\/([\d_]+)\.html'/)?.[2]`（同时确保匹配到的卷/章非目录页或 `vol_`）；
   - 若 `nextPageId` 为空返回 `""`；
   - 若 `nextPageId.startsWith(`${prevChapterId}_`)`，更新 `currentPageId = nextPageId` 继续翻页；
   - 若 `/^\d+$/.test(nextPageId) && nextPageId !== prevChapterId`，立即返回 `nextPageId`；
   - 否则（指向目录/分卷或超过 50 页上限）返回 `""`；请求异常时捕获并返回 `""`（避免中断其余章节推导）。

- [ ] **Step 2: 重构 `getNovelVolumes` 两阶段双向推导状态机并更新 `getNovelInfo` 与包根导出**

在 `packages/linovelib/src/novel.ts` 与 `src/index.ts`：

1. 重构 `getNovelVolumes(novelId, title, url, fetchClient, retry, chapterQueue?)`：
   - 同步解析各卷 DOM 后，按阅读顺序将全书所有章节展平为 `flatChapters: Array<{ chapter: Chapter; vIndex: number; cIndex: number; nextHref: string }>`（保留对 `volumes[vIndex].chapters[cIndex]` 的直接引用）。
   - **第一阶段（反向单跳推导）**：仅当 `chapterQueue` 存在，遍历 `flatChapters`，当 `current.chapter.id === "TOBEDETERMINED"` **且** `next` 存在且 `!/^$/.test(next.chapter.id)`、`!isUnresolvedChapterId(next.chapter.id)` 且 `/^\d+$/.test(next.chapter.id)` 时，才调用 `parseChapterIdFromNextChapter` 请求 `https://www.linovelib.com/novel/${novelId}/${next.chapter.id}.html` 提取 `url_previous`；若解析出合法纯数字 ID 则原地回填 `current.chapter.id`。
   - **第二阶段（正向链式推导兜底）**：仅当 `chapterQueue` 存在，按索引**从前往后**再次扫描 `flatChapters`：若 `current.chapter.id === "TOBEDETERMINED"` 且前一项 `prev` 存在且 `/^\d+$/.test(prev.chapter.id)`，调用 `parseNextChapterIdFromPrevChapter(novelId, prev.chapter.id, chapterQueue)` 并将非空结果原地写回 `current.chapter.id`（顺序扫描天然解锁任意长度的连续隐藏块与全书末章）。
   - **未决占位符兜底**：扫描全部 `flatChapters`，对仍满足 `current.chapter.id === "TOBEDETERMINED" || current.chapter.id === ""` 的章节统一赋值为 `TOBEDETERMINED_${current.vIndex}_${current.cIndex}`，保证单书内 `UNIQUE(novel_id, platform_id)` 唯一性。
2. 更新 `packages/linovelib/src/novel.ts:230` `getNovelInfo` 调用 `getNovelVolumes(id, title, ...)`。
3. 在 `packages/linovelib/src/index.ts` 导出 `isUnresolvedChapterId`。

- [ ] **Step 3: 类型检查、构建与隐藏章节状态机验证（覆盖 Review Focus #1）**

Run:

```bash
pnpm --filter=@acanthis-dec/linovelib run check-types
pnpm --filter=@acanthis-dec/linovelib run build
pnpm run format-and-lint
```
并运行 `pnpm --filter=@acanthis-dec/linovelib exec tsx -e "..."` 验证脚本（构造含 mock `fetchClient.text` 与真实 `NovelChapterQueue` 的测试场景），断言 **Review Focus #1** 全部情景通过且队列未抛出 `Invalid chapter URL`：

1. 第一卷包含「正常章 `100` -> 连续两章隐藏 `javascript:cid(0)` -> 正常章 `103`」：验证 `102` 由反向单跳或正向推导正确解出，`101` 与 `102` 均获得正确数字 ID；
2. 跨卷边界隐藏：卷 1 末章 `javascript:cid(0)` 依赖卷 2 首章 `201` 反向或前章正向正确解出；
3. 全书末章隐藏 + 前一章多分页（`301.html` -> `301_2.html` -> `302.html`）：验证正向链式翻页命中 `302` 并回填末章；
4. 前后均无合法 ID 或目标页返回 `catalog` 导致彻底无解的多章场景：各自落为唯一的 `TOBEDETERMINED_${vIndex}_${cIndex}` 且满足 `isUnresolvedChapterId(id) === true`。

- [ ] **Step 4: 原子提交**

```bash
git add packages/linovelib/src/novel.ts packages/linovelib/src/index.ts
git commit -m "feat(linovelib): 重构目录隐藏章节双向推导与唯一占位符" -m "实现 isUnresolvedChapterId、parseNextChapterIdFromPrevChapter 与两阶段双向隐藏章节推导状态机，并对无解章节生成唯一的 TOBEDETERMINED_<vIndex>_<cIndex> 占位符。"
```

---

### Task 6: `@acanthis-dec/api-server` 配置、CORS 与可选 Bearer 鉴权中间件

**Files:**

- Modify: `apps/api-server/src/config.ts:9-176`
- Modify: `apps/api-server/src/middleware.ts:1-32`
- Modify: `apps/api-server/src/index.ts:1-12`

**Interfaces:**

- Consumes: `node:crypto` (`createHash`, `timingSafeEqual`)、`hono/cors`
- Produces:
  - `ConfigSchema` & `Config` 新增 `cors: { origin: string | string[] }`（默认 `{ origin: "*" }`）与 `auth?: { token?: string } | undefined`
  - 环境变量映射：`CORS_ORIGIN`、`AUTH_TOKEN`
  - `apps/api-server/src/middleware.ts` 导出 `authMiddleware`（或按配置生成的中间件）

- [ ] **Step 1: 扩展 `ConfigSchema` 与 `getConfig()` 环境变量映射**

在 `apps/api-server/src/config.ts`：

1. `ConfigSchema` 新增：
   - `cors: z.object({ origin: z.union([z.string(), z.array(z.string())]).default("*") }).default({ origin: "*" })`
   - `auth: z.object({ token: z.string().min(1).optional() }).optional()`
2. `getConfig()` 解析环境变量（空串视同未设置）：
   - 辅助解析 `CORS_ORIGIN`：仅当 `process.env.CORS_ORIGIN?.trim()` 非空时，若等于 `"*"` 则为 `"*"`；若含 `,` 则按 `,` 拆分、`trim()` 并过滤空项为 `string[]`；否则为单字符串；仅在非空时写入 `envConfig.cors = { origin: parsedOrigin }`。
   - 仅当 `process.env.AUTH_TOKEN?.trim()` 非空时写入 `envConfig.auth = { token: process.env.AUTH_TOKEN.trim() }`（确保 `AUTH_TOKEN=""` 不触发 `min(1)` 校验失败）。

- [ ] **Step 2: 实现安全 Bearer 鉴权中间件并在 `src/index.ts` 按正确顺序挂载 CORS 与 Auth**

1. 在 `apps/api-server/src/middleware.ts` 实现 `createAuthMiddleware(expectedToken: string)`（或读取 `config.auth?.token` 的 `authMiddleware`）：
   - 放行规则：若 `c.req.method === "OPTIONS"`，直接 `return next()`；若 `c.req.method === "GET"` 且 `c.req.path` 匹配 `/^\/v1\/[^/]+\/(cover|illustration)\//`，直接 `return next()`。
   - 其余 `/v1/*` 请求读取 `c.req.header("authorization")`，须匹配 `Bearer <token>`（`token` 非空）；
   - 恒定时间比对：先对 `provided` 与 `expectedToken` 分别计算 `createHash("sha256").update(...).digest()`（固定 32 字节），再调用 `timingSafeEqual`（完全消除长度不等导致的 `RangeError`）。
   - 未通过返回 `c.json({ code: 40100, message: "Unauthorized" }, 401)`。
2. 在 `apps/api-server/src/index.ts` 按严格顺序挂载中间件：
   - `app.use(loggerMiddleware)`
   - `app.use("*", cors({ origin: config.cors.origin, allowHeaders: ["Content-Type", "Authorization"], allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }))`
   - 若 `config.auth?.token` 存在：`app.use("*", createAuthMiddleware(config.auth.token))`（确保 `CORS` 在 `Auth` 之前，预检请求永不被 `401` 拦截）。

- [ ] **Step 3: 类型检查、构建与 CORS/鉴权实测验证（覆盖 Review Focus #3）**

Run:

```bash
pnpm --filter=@acanthis-dec/api-server run check-types
pnpm --filter=@acanthis-dec/api-server run build
pnpm run format-and-lint
```
使用临时端口与临时数据目录分别启动 `@acanthis-dec/api-server` 进程验证 **Review Focus #3**（测试后停止进程并清理临时目录）：

1. 设置 `AUTH_TOKEN=""` 与未设置 `CORS_ORIGIN` 启动成功，验证 `GET /v1/linovelib/search?keyword=test` 不返回 `401`，响应头含 `Access-Control-Allow-Origin: *`；
2. 设置 `AUTH_TOKEN="secret-token-123"`、`CORS_ORIGIN="https://app.example.com,http://localhost:5173"` 启动后请求：
   - `OPTIONS /v1/linovelib/search`（带 `Origin: http://localhost:5173`、`Access-Control-Request-Method: GET`）-> `204`/`200` 且返回匹配 `Access-Control-Allow-Origin: http://localhost:5173`（未被 Auth 拦截）；
   - 无 `Authorization` 头访问受保护路由 -> `401` `{ "code": 40100, "message": "Unauthorized" }`；
   - 不同长度无效 Token（如 `Bearer x` 与 `Bearer a-very-long-invalid-token-string`）及非 Bearer 头（`Basic abc`）-> 稳定返回 `401` `{ "code": 40100 }`（服务端无 `RangeError`）；
   - `GET /v1/linovelib/cover/volume/nonexistent` 与 `GET /v1/linovelib/illustration/00000000000000000000000000000000`（无 Token）-> 不返回 `401`（成功旁路进入路由）；
   - `POST /v1/linovelib/cover/novel/1`（无 Token）-> 返回 `401`（非 `GET` 不可旁路）。

- [ ] **Step 4: 原子提交**

```bash
git add apps/api-server/src/config.ts apps/api-server/src/middleware.ts apps/api-server/src/index.ts
git commit -m "feat(api-server): 新增 CORS 与可选 Bearer 鉴权配置及中间件" -m "在 ConfigSchema 映射 CORS_ORIGIN 与 AUTH_TOKEN（忽略空字符串），实现基于 SHA-256 + timingSafeEqual 的可选 Bearer 鉴权中间件并按 CORS 优先于 Auth 顺序挂载（放行 OPTIONS 与 GET 封面/插图路由）。"
```

---

### Task 7: `@acanthis-dec/api-server` 新增书源发现、书库分页、插图代理与章节直链兜底路由

**Files:**

- Modify: `apps/api-server/src/utils.ts:1-88`
- Create: `apps/api-server/src/sources.ts`（或直接注册于 `index.ts`）
- Modify: `apps/api-server/src/index.ts:8-12`
- Modify: `apps/api-server/src/linovelib.ts:1-345`

**Interfaces:**

- Consumes:
  - `@acanthis-dec/core` (`NovelSourceDescriptor`)
  - `@acanthis-dec/storage` (`getUrlHash`, `StorageService.registerIllustrations`, `getIllustrationSourceUrl`, `getIllustrationData`, `setIllustrationData`, `listCachedNovels`)
  - `@acanthis-dec/linovelib` (`extractChapterIllustrationUrls`, `rewriteChapterIllustrations`, `LinovelibClient.getIllustration`)
- Produces（HTTP 路由与工具导出）:
  - `apps/api-server/src/utils.ts`:
    - `export function resolveHost(c: Context): string`
    - 泛型 `export function transformOutputStyleForSearchResult<T extends NovelSearchResult>(result: T, style: OutputStyle | undefined): T | LNReaderNovelItem`
  - `GET /v1/sources` -> `200` `{ code: 0, message: "Success", data: NovelSourceDescriptor[] }`
  - `GET /v1/linovelib/novels?page=&pageSize=&style=` -> `200` `{ code: 0, message: "Success", data: { items, total, page, pageSize } }`
  - `GET /v1/linovelib/illustration/:hash` -> `200` 二进制流（`Content-Type` + `Cache-Control: public, max-age=86400`）或 `404` `{ code: 10003, message: "Illustration not found" }`
  - `GET /v1/linovelib/chapter/:chapterId?novelId=` -> `200` `{ code: 0, message: "Success", data: { content } }`（`<img src>` 动态重写为 `${host}/v1/linovelib/illustration/${hash}`）或 `404` `{ code: 10000, message: "Chapter meta not found" }`

- [ ] **Step 1: 抽取 `resolveHost(c)` 并泛型化 `transformOutputStyleForSearchResult`**

在 `apps/api-server/src/utils.ts`：

1. 新增导出 `resolveHost(c: Context): string`：取 `config.host ?? c.req.header("host") ?? "http://localhost:5301"`；若不以 `http://` 或 `https://` 开头，根据 `c.req.header("x-forwarded-proto") ?? "http"` 补齐协议前缀；最后 `.replace(/\/+$/, "")` 去除末尾所有斜杠。
2. 将 `transformOutputStyleForSearchResult` 签名升级为 `<T extends NovelSearchResult>(result: T, style: OutputStyle | undefined): T | LNReaderNovelItem`，保持运行时分支不变。
3. 将 `apps/api-server/src/linovelib.ts:116` 与 `:304` 的 `config.host ?? c.header("host") ?? ...` 统一替换为 `resolveHost(c)`。

- [ ] **Step 2: 新增 `GET /v1/sources` 书源发现路由**

在 `apps/api-server/src/sources.ts`（并在 `src/index.ts` 挂载 `app.route("/sources", SourcesRoutes)`，或直接在 `index.ts` 定义 `app.get("/sources", ...)`）：
返回 `{ code: 0, message: "Success", data }`，其中 `data: NovelSourceDescriptor[]` 包含 `{ id: "linovelib", name: "哔哩轻小说", capabilities: ["search", "novels", "illustrations"] }`。

- [ ] **Step 3: 升级 `GET /v1/linovelib/chapter/:chapterId` 并新增 `/illustration/:hash` 与 `/novels` 路由**

在 `apps/api-server/src/linovelib.ts`：

1. **升级 `GET /chapter/:chapterId`**：
   - 增加 `zValidator("query", z.object({ novelId: z.string().min(1).optional() }))`。
   - 当 `chapterMeta` 为空且传入 `novelId` 时：尝试 `linovelibClient.getNovelInfo(novelId)`（捕获源站异常仅记日志不抛 500），仅当返回有效作品（`novel && novel.title !== "" && novel.volumes.length > 0`）时执行 `storageService.addNovelCache(novel)`，再重查 `getChapterFromId("linovelib", chapterId)`；仍为空则返回 `404` `{ code: 10000, message: "Chapter meta not found" }`。
   - 获取原始未改写 `rawHtml`（来自 `getNovelContent(hash)`；或新抓取 `linovelibClient.getChapter` 后先调用 `setNovelContent(rawHtml)` + `addNovelContentHash` 持久化原始 HTML）。
   - 提取插图 URL：`const urls = extractChapterIllustrationUrls(rawHtml)`，若 `urls.length > 0` 调用 `await storageService.registerIllustrations("linovelib", urls)`。
   - 用 `const host = resolveHost(c)` 调用 `rewriteChapterIllustrations(rawHtml, (url) => \`\${host}/v1/linovelib/illustration/\${getUrlHash(url)}\`)`返回重写后的`content`。
2. **新增 `GET /illustration/:hash`**：
   - 校验 param：`z.object({ hash: z.string().regex(/^[a-f0-9]{32}$/, "Invalid illustration hash") })`。
   - 先查 `storageService.getIllustrationData("linovelib", hash)`，命中则带 `Content-Type` 与 `Cache-Control: public, max-age=86400` 返回 `c.body(new Uint8Array(cached.data))`。
   - 未命中文件缓存时查 `storageService.getIllustrationSourceUrl("linovelib", hash)`：
     - 无记录返回 `404` `{ code: 10003, message: "Illustration not found" }`；
     - 有 `sourceUrl` 则调用 `linovelibClient.getIllustration(sourceUrl)`，调用 `storageService.setIllustrationData("linovelib", hash, res.data, res.mimeType)` 落盘后返回二进制流与上述响应头。
3. **新增 `GET /novels`**：
   - 校验 query：`page`（`z.coerce.number().int().min(1).default(1)`）、`pageSize`（`z.coerce.number().int().min(1).max(100).default(20)`）、`style`（`outputStyleSchema.optional()`）。
   - 调用 `storageService.listCachedNovels("linovelib", { page, pageSize })`，使用 `const host = resolveHost(c)` 将每项 `coverUrl` 重写为 `${host}/v1/linovelib/cover/novel/${novel.id}`，通过 `transformOutputStyleForSearchResult(novel, style)` 转换单条记录并返回 `{ code: 0, message: "Success", data: { items, total, page, pageSize } }`。

- [ ] **Step 4: 全量类型检查、构建、Lint 与 API 端到端实测（覆盖 Review Focus #4、#5）**

Run:

```bash
pnpm run check-types
pnpm run build
pnpm run format-and-lint
```
在临时数据目录（预置一个临时 `data.db` 与 `.zst` 章节文件模拟存量老缓存，且配置 `HOST="https://api.example.com/"`）启动 `@acanthis-dec/api-server`，使用 `curl`/PowerShell `Invoke-RestMethod` 验证：

1. `GET /v1/sources` -> `200` `code: 0`，`data` 含 `linovelib` 及 `["search", "novels", "illustrations"]`；
2. **Review Focus #5**：
   - `GET /v1/linovelib/novels?page=1&pageSize=20` -> 排除所有 `unknown`/空字段占位行，有效书目 `coverUrl` 为 `https://api.example.com/v1/linovelib/cover/novel/<id>`（无双斜杠）；`style=lnreader` 返回 `{ name, path, cover }`；
   - `GET /v1/linovelib/chapter/not-exist?novelId=invalid-non-numeric` -> 返回 `404` `{ "code": 10000, "message": "Chapter meta not found" }` 且数据库未新增脏小说行；
3. **Review Focus #4**：
   - 请求预置的存量老 `.zst` 章节 `GET /v1/linovelib/chapter/<id>` -> 响应 `content` 中 `<img src>` 已被重写为 `https://api.example.com/v1/linovelib/illustration/<32位hex>`，磁盘 `.zst` 解压后仍为未改写源站 URL，且数据库 `illustration_metadata` 已幂等登记；
   - `GET /v1/linovelib/illustration/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`（未登记的 32 位 hex）-> 返回 `404` `{ "code": 10003, "message": "Illustration not found" }`；
   - `GET /v1/linovelib/illustration/bad-hash` -> 返回 `400` Zod 参数校验错误。

- [ ] **Step 5: 原子提交**

```bash
git add apps/api-server/src/utils.ts apps/api-server/src/sources.ts apps/api-server/src/index.ts apps/api-server/src/linovelib.ts
git commit -m "feat(api-server): 新增书源发现、书库分页、插图代理与章节直链兜底路由" -m "抽取 resolveHost(c) 修正 c.req.header('host') 读取并泛型化 transformOutputStyleForSearchResult，新增 /v1/sources、/v1/linovelib/novels、/v1/linovelib/illustration/:hash 代理缓存及 chapter 直链 novelId 兜底重写。"
```
