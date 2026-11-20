# 源站发现与 LNReader 插件薄壳化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于桌面端 `https://www.linovelib.com` 为 Acanthis 建立跨书源通用、Schema 驱动的发现体系（全站首页、16 个出版社文库专题、13 个排行榜含完本榜、7 维书库筛选），升级 `@acanthis-dec/web` 发现页，并将 `lnreader-plugins` 中的 `linovelib.ts` 彻底降级为无 `cheerio` 的纯薄壳且支持多维筛选。

**Architecture:** 自底向上按包依赖顺序推进：`@acanthis-dec/core` 扩展 `SourceCapability` 与通用发现契约；`@acanthis-dec/linovelib` 在 `src/explore/` 下实现桌面端首页/出版社专题、排行榜/完本榜与 7 维书库解析器及专用 `NovelExploreQueue`；`@acanthis-dec/api-server` 增加带 Single-flight 并发合并的内存 TTL 缓存、更新 `/v1/sources` 并暴露 `/v1/linovelib/explore/schema`、`/home`、`/rankings`、`/catalog`（含封面代理重写与 `style=lnreader` 兼容）；`@acanthis-dec/web` 将 `ExploreView` 升级为 4 标签动态 Schema 驱动发现体验；最后将 `c:\Users\ConstasJ\Coding\lnreader-plugins\plugins\chinese\linovelib.ts` 切换为纯 HTTP 转发薄壳。

**Tech Stack:** TypeScript 7（ESM + 严格模式）、pnpm + Turbo、Zod v4、Cheerio、Hono 4、Vue 3 + Pinia + Vue Router + Tailwind CSS、Biome、tsdown / esbuild；插件侧为 `lnreader-plugins`（ES5/Hermes、ESLint、Prettier）。

**Spec:** `docs/superpowers/specs/2026-11-20-explore-and-plugin-thin-client-design.md`

## Global Constraints

- **包边界职责**：`@acanthis-dec/core` 仅放跨书源通用类型；`@acanthis-dec/linovelib` 负责桌面端 HTML 解析、白名单参数校验与队列限流；`@acanthis-dec/api-server` 负责 Zod 参数校验、内存 TTL 缓存、封面代理重写与 `style=acanthis|lnreader` 适配；`@acanthis-dec/web` 不硬编码书源筛选项，全部由 `GET /v1/:platform/explore/schema` 动态驱动；`linovelib.ts` 插件不再包含 `cheerio` 或源站 HTML 抓取逻辑。
- **CF 隔离红线**：无 CF 的全站首页（`/`）与排行榜（`/top/`、`/topfull/`）不得依赖需 CF 的 `/wenku/*` 路径；`/wenku/*` 遇到 `CloudflareBlockError` 时统一映射为 `503`（`code: 20001`）且优雅提示。
- **不落库约束**：首页、排行榜与书库筛选结果仅做服务端内存 TTL 缓存，不新增 SQLite 表或写入已缓存书库。
- **TypeScript 严格模式与代码风格**：遵循 `tools/config-typescript/base.json`（含 `exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`），禁止用类型断言压制错误；定向使用 `pnpm exec biome check --write <files>` 避免误改无关文件。
- **无单元测试框架与提交纪律**：不新增测试框架，使用包级 `check-types`、`build`、`pnpm format-and-lint` 与可执行实测脚本/HTTP 验证；每完成一个原子任务立即提交 Conventional Commits（不执行 `git push`）；所有 Acanthis 代码变更完成后统一补充 Changeset。

## Review Focus

1. **占位封面与脏链接过滤**：桌面端页面 `img[data-original]` 缺失、指向 `book-cover-no.svg` 占位图或协议相对 `//` URL 时，须干净回退至 `novelIdToCoverUrl(id)`；非 `/novel/<数字>.html` 链接及同板块内重复小说 ID 不得产生脏数据。（验证于 **Task 3** 与 **Task 4**）
2. **参数白名单注入防护与 `allvisit` 冲突**：`channel`/`rank`/`sort`/`region`/`tag`/`progress`/`anime`/`words`/`updated` 收到非法值时须由 Zod/白名单拒绝返回 `400`；API 侧对 `rank=allvisit&full=false` 严格返回 `400`，LNReader 插件侧在 `rank === "allvisit"` 时自动按 `full=true` 请求。（验证于 **Task 5** 与 **Task 7**）
3. **Cloudflare 503 隔离与 Single-flight 错误不缓存**：`/wenku/*` 触发 `CloudflareBlockError` 时须映射为 `503`（`code: 20001`）、不写入 TTL 缓存并释放 `inFlight` 句柄，且全站首页与排行榜完全不受影响。（验证于 **Task 5** 与 **Task 6**）
4. **书库 0 结果与排行榜尾页边界**：多维筛选命中 0 条结果（无 `#pagestats`）时返回 `{ items: [], page, totalPages: 1, hasNextPage: false }`；排行榜不足 30 条或空页时 `hasNextPage` 须为 `false`。（验证于 **Task 3** 与 **Task 5**）
5. **Web 端 URL Query 状态恢复与无 `"explore"` 书源降级**：从作品详情页返回 `ExploreView` 时保持当前 Tab、频道、榜单/完本开关、书库筛选条件与页码；遇到不具备 `"explore"` 能力的书源时不发 `explore/schema` 请求，自动回退为「本地已缓存 + 搜索」。（验证于 **Task 6**）

---

### Task 1: `@acanthis-dec/core` 新增通用发现契约类型

**Files:**

- Modify: `packages/core/src/types.ts:43-49`
- Modify: `packages/core/src/index.ts:8-20`

**Interfaces:**

- Consumes: 现有 `NovelStatus`（`packages/core/src/types.ts:41`）
- Produces（由 `packages/core/src/index.ts` 包根导出）:
  - `SourceCapability = "search" | "novels" | "illustrations" | "explore"`
  - `ExploreFilterOption`, `ExploreFilterGroup`, `ExploreChannelOption`, `ExploreRankingOption`, `ExploreSchema`
  - `ExploreNovelItem`, `ExploreSectionLayout`, `ExploreSectionMoreTarget`, `ExploreSection`, `ExploreHomeData`, `ExplorePage`

- [ ] **Step 1: 在 `packages/core/src/types.ts` 扩展 `SourceCapability` 并追加发现契约类型**

严格按 Spec §5.1 定义所有接口；所有可选属性均与 `exactOptionalPropertyTypes` 兼容（按接口原样声明 `?`，实现侧仅在值非 `undefined` 时赋值）。

- [ ] **Step 2: 在 `packages/core/src/index.ts` 包根再导出新增类型**

将上述 11 个新类型加入 `export type { ... } from "./types"` 列表并按字母序整理。

- [ ] **Step 3: 运行类型检查、构建与定向格式化校验**

Run:

```powershell
pnpm --filter=@acanthis-dec/core run check-types
pnpm --filter=@acanthis-dec/core run build
pnpm exec biome check packages/core/src/types.ts packages/core/src/index.ts
```
Expected: 全部退出码 `0`，`packages/core/dist/index.d.mts` 导出 `ExploreSchema`、`ExploreHomeData`、`ExplorePage` 等全部类型。

- [ ] **Step 4: 原子提交**

```powershell
git add packages/core/src/types.ts packages/core/src/index.ts
git commit -m "feat(core): 新增通用书源发现与筛选契约类型" -m "扩展 SourceCapability 增加 explore，新增 ExploreSchema、ExploreHomeData、ExploreSection、ExploreNovelItem、ExplorePage 等跨书源通用类型并在包根导出。"
```

---

### Task 2: `@acanthis-dec/linovelib` 定义发现 Schema 白名单与 `NovelExploreQueue`

**Files:**

- Create: `packages/linovelib/src/explore/schema.ts`
- Modify: `packages/linovelib/src/queue.ts`

**Interfaces:**

- Consumes: Task 1 导出的 `ExploreSchema`
- Produces:
  - `packages/linovelib/src/explore/schema.ts`:
    - `LINOVELIB_EXPLORE_SCHEMA: ExploreSchema`（含 `home` + 16 个出版社频道、13 个榜单、7 组书库筛选器及 Spec 附录 A 全部 60 个 `tag` 映射）
    - 白名单集合与类型：`LINOVELIB_CHANNEL_IDS`, `LINOVELIB_RANKING_IDS`, `LINOVELIB_CATALOG_SORT_IDS`, `LINOVELIB_CATALOG_REGION_IDS`, `LINOVELIB_CATALOG_TAG_IDS`, `LINOVELIB_CATALOG_PROGRESS_IDS`, `LINOVELIB_CATALOG_ANIME_IDS`, `LINOVELIB_CATALOG_WORDS_IDS`, `LINOVELIB_CATALOG_UPDATED_IDS`
    - 选项类型：`LinovelibRankingOptions { rank: string; full?: boolean; page?: number }`、`LinovelibCatalogOptions { sort?: string; region?: string; tag?: string; progress?: string; anime?: string; words?: string; updated?: string; page?: number }`
    - 校验辅助：`isValidLinovelibChannel(channel: string): boolean`、`isValidLinovelibRanking(rank: string, full: boolean): boolean`、`normalizeCatalogOptions(options?: LinovelibCatalogOptions): Required<LinovelibCatalogOptions>`（非法值抛 `Error`）
  - `packages/linovelib/src/queue.ts`:
    - `export class NovelExploreQueue`（`concurrency: 2`，请求间隔 `300~600ms`，提供 `fetchPage(url: string): Promise<string>`；遇到 `CloudflareBlockError` 直接透传不死循环重试，网络/5xx 按 `defaultRetryPolicy` 最多重试 2 次）

- [ ] **Step 1: 创建 `packages/linovelib/src/explore/schema.ts`**

完整录入 Spec §5.2.1 与附录 A 的全部 16 个出版社频道、13 个榜单（`allvisit` 为 `supportsAll: false, supportsFull: true`）与 7 维筛选选项（含 60 个主题 ID 与名称），实现白名单集合及参数校验/规范化函数。

- [ ] **Step 2: 在 `packages/linovelib/src/queue.ts` 中新增 `NovelExploreQueue`**

仿照 `NovelInfoQueue` 实现 `NovelExploreQueue`（`concurrency: 2`，`300~600ms` 节流）；注意对 `CloudflareBlockError` 不做额外重试（由 `BrowserFetchClient` 自身决定是否调 FlareSolverr，失败即刻上抛以便 API 快速返回 503）。

- [ ] **Step 3: 运行类型检查与定向格式化校验**

Run:

```powershell
pnpm --filter=@acanthis-dec/linovelib run check-types
pnpm exec biome check packages/linovelib/src/explore/schema.ts packages/linovelib/src/queue.ts
```
Expected: 全部退出码 `0`。

- [ ] **Step 4: 原子提交**

```powershell
git add packages/linovelib/src/explore/schema.ts packages/linovelib/src/queue.ts
git commit -m "feat(linovelib): 新增桌面端发现 Schema 白名单与探索请求队列" -m "定义全站首页、16 个出版社频道、13 个排行榜及 7 维 60 主题书库筛选 Schema 与白名单校验，并在 queue.ts 中新增 NovelExploreQueue。"
```

---

### Task 3: `@acanthis-dec/linovelib` 实现排行榜/完本榜与 7 维书库解析器

**Files:**

- Create: `packages/linovelib/src/explore/common.ts`
- Create: `packages/linovelib/src/explore/rankings.ts`
- Create: `packages/linovelib/src/explore/catalog.ts`

**Interfaces:**

- Consumes: Task 1 的 `ExploreNovelItem`, `ExplorePage`, `NovelStatus`；Task 2 的 `schema.ts` 与 `NovelExploreQueue`；现有 `novelIdToCoverUrl`（`packages/linovelib/src/cover.ts`）
- Produces:
  - `packages/linovelib/src/explore/common.ts`:
    - `LINOVELIB_DESKTOP_BASE = "https://www.linovelib.com"`
    - `extractNovelIdFromHref(href: string | undefined): string | null`
    - `resolveDesktopCoverUrl(novelId: string, rawSrc?: string): string`（过滤空串、`book-cover-no.svg`、`data:`，补全 `//` 为 `https://`，无效时回退 `novelIdToCoverUrl(novelId)`）
    - `parseNovelStatusText(raw: string | undefined): NovelStatus`（含 `完结`/`完本` -> `"completed"`，`连载` -> `"ongoing"`，其余 `"unknown"`）
  - `packages/linovelib/src/explore/rankings.ts`:
    - `export function parseRankingsHtml(html: string, page: number): ExplorePage`
    - `export async function getRankings(options: LinovelibRankingOptions, queue: NovelExploreQueue): Promise<ExplorePage>`
  - `packages/linovelib/src/explore/catalog.ts`:
    - `export function buildCatalogUrl(options: Required<LinovelibCatalogOptions>): string`
    - `export function parseCatalogHtml(html: string, page: number): ExplorePage`
    - `export async function getCatalog(options: LinovelibCatalogOptions | undefined, queue: NovelExploreQueue): Promise<ExplorePage>`

- [ ] **Step 1: 创建 `packages/linovelib/src/explore/common.ts`**

实现 URL 提取、占位图过滤与封面回退、状态文本归一化工具函数。

- [ ] **Step 2: 创建 `packages/linovelib/src/explore/rankings.ts`**

按 Spec §5.2.2 拼接 `/top/${rank}/${page}.html` 或 `/topfull/${rank}/${page}.html` 并解析 `.rank_d_list`（每页 30 条，`hasNextPage: items.length >= 30`，`rank: (page - 1) * 30 + index + 1`）；空页或不足 30 条时 `hasNextPage` 为 `false`。

- [ ] **Step 3: 创建 `packages/linovelib/src/explore/catalog.ts`**

按 Spec §5.2.3 校验并拼接 `/wenku/${sort}_${tag}_${progress}_${anime}_${region}_0_0_${words}_${page}_${updated}.html`，解析 `.store_collist .bookbox` 与 `#pagestats`（`1/183`）；无结果且无 `#pagestats` 时返回 `{ platform: "linovelib", items: [], page, totalPages: 1, hasNextPage: false }`。

- [ ] **Step 4: 类型检查与离线 + 实站解析验证**

Run:

```powershell
pnpm --filter=@acanthis-dec/linovelib run check-types
pnpm exec biome check packages/linovelib/src/explore/common.ts packages/linovelib/src/explore/rankings.ts packages/linovelib/src/explore/catalog.ts
```
并使用 `tsx` 运行快速验证脚本：

- 对实站 `getRankings({ rank: "monthvisit", page: 1 })` 与 `getRankings({ rank: "allvisit", full: true, page: 1 })` 验证返回 30 条结构化数据且封面非 `book-cover-no.svg`；
- 对 `parseCatalogHtml` 传入模拟 `.bookbox` HTML、占位封面、以及空结果 HTML，确认 `totalPages`、`hasNextPage`、封面回退与空结果兜底均符合 Review Focus #1 与 #4。

- [ ] **Step 5: 原子提交**

```powershell
git add packages/linovelib/src/explore/common.ts packages/linovelib/src/explore/rankings.ts packages/linovelib/src/explore/catalog.ts
git commit -m "feat(linovelib): 实现桌面端排行榜、完本榜与 7 维书库筛选解析" -m "新增 common.ts、rankings.ts 与 catalog.ts，支持 /top、/topfull 与 /wenku 多维组合筛选解析、占位封面回退及精确分页提取。"
```

---

### Task 4: `@acanthis-dec/linovelib` 实现首页与 16 出版社专题解析并接入 `LinovelibClient`

**Files:**

- Create: `packages/linovelib/src/explore/home.ts`
- Create: `packages/linovelib/src/explore/index.ts`
- Modify: `packages/linovelib/src/client.ts`
- Modify: `packages/linovelib/src/index.ts`

**Interfaces:**

- Consumes: Task 1 的 `ExploreHomeData`, `ExploreSection`, `ExploreNovelItem`；Task 2 的 `schema.ts`, `NovelExploreQueue`；Task 3 的 `common.ts`, `rankings.ts`, `catalog.ts`
- Produces:
  - `packages/linovelib/src/explore/home.ts`:
    - `export function parseHomeHtml(html: string, channel: string): ExploreHomeData`
    - `export async function getExploreHome(channel: string | undefined, queue: NovelExploreQueue): Promise<ExploreHomeData>`
  - `LinovelibClient` 新增公开方法：
    - `getExploreSchema(): ExploreSchema`
    - `getExploreHome(channel?: string): Promise<ExploreHomeData>`
    - `getRankings(options: LinovelibRankingOptions): Promise<ExplorePage>`
    - `getCatalog(options?: LinovelibCatalogOptions): Promise<ExplorePage>`
  - `packages/linovelib/src/index.ts` 导出 `LINOVELIB_EXPLORE_SCHEMA`、`LinovelibRankingOptions`、`LinovelibCatalogOptions` 及相关校验函数。

- [ ] **Step 1: 创建 `packages/linovelib/src/explore/home.ts` 与 `index.ts`**

- `channel === "home"` 请求 `https://www.linovelib.com/`，按实测区块提取：焦点推荐（`featured`）、强推榜（`rank`）、新书精选（`grid`）、新书榜（`rank`）、热门小说与各文库精选（`grid`，带 `more: { type: "channel", params: { channel } }`）、经典完本与完本推荐（`grid`）、热点榜（`rank`）、最近更新（`updates`，提取 `latestChapter`、`latestChapterId`、`wordCount`、`updatedAt`，`more: { type: "ranking", params: { rank: "lastupdate", full: "false" } }`）。
- `channel !== "home"` 校验白名单后请求 `https://www.linovelib.com/wenku/${channel}/1.html`，提取各模块标题下的 `.mind-book` 卡片、榜单条目与更新列表为同类 `ExploreSection[]`。
- 同一板块内按 `novelId` 去重，过滤非 `/novel/<数字>.html` 链接，任一子板块 DOM 缺失时跳过该板块而不中断整页解析。

- [ ] **Step 2: 在 `packages/linovelib/src/client.ts` 与 `src/index.ts` 接入并导出**

在 `LinovelibClient` 构造函数中初始化 `private novelExploreQueue: NovelExploreQueue;`，挂载 `getExploreSchema`、`getExploreHome`、`getRankings`、`getCatalog` 四个公开方法，并在 `packages/linovelib/src/index.ts` 导出 Schema 与选项类型。

- [ ] **Step 3: 运行类型检查、构建与实站首页联调**

Run:

```powershell
pnpm --filter=@acanthis-dec/linovelib run check-types
pnpm --filter=@acanthis-dec/linovelib run build
pnpm exec biome check packages/linovelib/src
```
并使用 `tsx` 对实站运行 `client.getExploreHome("home")`，确认返回多个非空 `ExploreSection`（含 `featured`、`grid`、`rank`、`updates`），且所有 `items` 均有合法数字 `id` 与非占位封面 URL。

- [ ] **Step 4: 原子提交**

```powershell
git add packages/linovelib/src/explore/home.ts packages/linovelib/src/explore/index.ts packages/linovelib/src/client.ts packages/linovelib/src/index.ts
git commit -m "feat(linovelib): 实现首页与出版社文库专题解析并接入 LinovelibClient" -m "新增 home.ts 解析桌面端全站首页与 16 个出版社文库专题页，并将探索 Schema、首页、榜单与书库筛选方法统一挂载至 LinovelibClient。"
```

---

### Task 5: `@acanthis-dec/api-server` 实现内存 TTL 缓存与发现 API 路由

**Files:**

- Create: `apps/api-server/src/cache.ts`
- Modify: `apps/api-server/src/sources.ts:4-10`
- Modify: `apps/api-server/src/linovelib.ts`

**Interfaces:**

- Consumes: Task 1 类型；Task 4 的 `LinovelibClient` 新方法；现有 `resolveHost`、`transformOutputStyleForSearchResult`、`handleLinovelibError`
- Produces:
  - `apps/api-server/src/cache.ts`: `export class MemoryTtlCache<T>`（默认 TTL 5 分钟、最大条目数 200 的 FIFO/LRU 淘汰，提供 `getOrLoad(key: string, loader: () => Promise<T>): Promise<T>`，内置 Single-flight 并发合并；`loader` 抛错时不写入缓存并立即清理 `inFlight`）
  - `GET /v1/sources`：`linovelib` 的 `capabilities` 变为 `["search", "novels", "illustrations", "explore"]`
  - `GET /v1/linovelib/explore/schema` -> `{ code: 0, message: "Success", data: ExploreSchema }`（`Cache-Control: public, max-age=3600`）
  - `GET /v1/linovelib/home?channel=home` -> `{ code: 0, message: "Success", data: ExploreHomeData }`
  - `GET /v1/linovelib/rankings?rank=monthvisit&full=false&page=1&style=acanthis|lnreader` -> `acanthis` 返回 `ExplorePage`，`lnreader` 返回 `LNReaderNovelItem[]`
  - `GET /v1/linovelib/catalog?sort=lastupdate&region=0&tag=0&progress=0&anime=0&words=0&updated=0&page=1&style=acanthis|lnreader` -> `acanthis` 返回 `ExplorePage`，`lnreader` 返回 `LNReaderNovelItem[]`

- [ ] **Step 1: 创建 `apps/api-server/src/cache.ts`**

实现 `MemoryTtlCache<T>`，支持 TTL 过期、最大容量淘汰以及 Single-flight 并发去重；确保异常 rejection 时在 `finally` 中移除 `inFlight` 条目且不缓存失败结果。

- [ ] **Step 2: 更新 `apps/api-server/src/sources.ts`**

将 `linovelib` 的 `capabilities` 扩展为 `["search", "novels", "illustrations", "explore"]`。

- [ ] **Step 3: 在 `apps/api-server/src/linovelib.ts` 新增四条发现路由**

- 定义严格的 Zod Query Schema（基于 `LINOVELIB_*_IDS` 白名单校验）：
  - `homeQuerySchema`：`channel` 默认 `"home"`，非白名单返回 400。
  - `rankingsQuerySchema`：`rank` 默认 `"monthvisit"`、`full` 布尔转换（支持 `"true"`/`"false"`/`"1"`/`"0"`）默认 `false`、`page` 正整数默认 `1`、`style` 可选；在 `.refine` 中校验 `!(rank === "allvisit" && !full)`，违规返回 `400`。
  - `catalogQuerySchema`：`sort`/`region`/`tag`/`progress`/`anime`/`words`/`updated` 均做白名单校验并设默认值、`page` 正整数默认 `1`、`style` 可选。
- 封面代理重写：构造辅助函数 `rewriteExploreItemCover(item, host)`，将 `coverUrl` 统一改写为 `${host}/v1/linovelib/cover/novel/${item.id}`（注意缓存原始未改写 `host` 的结构或按请求出口动态改写，避免反代切换 `host` 时缓存污染）。
- 错误处理全部交由 `handleLinovelibError(c, error)`，确保 `CloudflareBlockError` 稳定映射为 `503`（`code: 20001`）。

- [ ] **Step 4: 类型检查、构建与端到端 HTTP 验证**

Run:

```powershell
pnpm --filter=@acanthis-dec/api-server run check-types
pnpm --filter=@acanthis-dec/api-server run build
pnpm exec biome check apps/api-server/src
```
启动本地 `api-server` 或通过 Hono `app.request(...)` 脚本验证：

1. `GET /v1/sources` 包含 `"explore"`；
2. `GET /v1/linovelib/explore/schema` 返回完整 16 频道 + 13 榜单 + 7 维 60 主题；
3. `GET /v1/linovelib/home` 返回全站首页板块，封面均为 `/v1/linovelib/cover/novel/<id>`；
4. `GET /v1/linovelib/rankings?rank=monthvisit&page=1` 与 `?style=lnreader` 均返回正确契约；
5. `GET /v1/linovelib/rankings?rank=allvisit&full=false` 返回 `400`；`GET /v1/linovelib/home?channel=../etc` 返回 `400`；
6. 未开 FlareSolverr 时 `GET /v1/linovelib/catalog` 返回 `503`（`code: 20001`）且不会阻塞/污染后续 `/home` 与 `/rankings` 请求。

- [ ] **Step 5: 原子提交**

```powershell
git add apps/api-server/src/cache.ts apps/api-server/src/sources.ts apps/api-server/src/linovelib.ts
git commit -m "feat(api-server): 新增源站发现路由、内存 TTL 缓存与 LNReader 榜单/书库兼容" -m "在 /v1/sources 宣告 explore 能力，新增 /explore/schema、/home、/rankings 与 /catalog 路由，支持 Single-flight 内存 TTL 缓存、封面代理重写及 style=lnreader 输出。"
```

---

### Task 6: `@acanthis-dec/web` 升级发现页（Schema 驱动四视图 + URL 状态同步）

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Create: `apps/web/src/components/explore/ExploreNovelCard.vue`
- Create: `apps/web/src/components/explore/ExploreHomePanel.vue`
- Create: `apps/web/src/components/explore/ExploreRankingsPanel.vue`
- Create: `apps/web/src/components/explore/ExploreCatalogPanel.vue`
- Modify: `apps/web/src/views/ExploreView.vue`

**Interfaces:**

- Consumes: Task 1 类型；Task 5 新增的 4 个 HTTP 端点
- Produces:
  - `apps/web/src/api/client.ts` 新增导出：
    - `fetchExploreSchema(platform: string, signal?: AbortSignal): Promise<ExploreSchema>`
    - `fetchExploreHome(platform: string, channel?: string, signal?: AbortSignal): Promise<ExploreHomeData>`
    - `fetchExploreRankings(platform: string, params: { rank: string; full: boolean; page: number }, signal?: AbortSignal): Promise<ExplorePage>`
    - `fetchExploreCatalog(platform: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<ExplorePage>`
  - `ExploreView.vue` 四视图：
    - `home`（首页推荐 + 16 出版社频道切换 + 板块“更多”联动跳转）
    - `rankings`（全部/完本切换 + 榜单选择器 + 排名卡片 + 分页）
    - `catalog`（Schema 驱动多维筛选面板 + 主题折叠展开 + 一键重置 + 精确总页数分页）
    - `cached`（原有服务端已缓存书库分页列表）

- [ ] **Step 1: 在 `apps/web/src/api/client.ts` 新增发现 API 方法**

复用 `requestJson` 实现 4 个新方法，支持 `AbortSignal` 取消过期并发请求。

- [ ] **Step 2: 拆分并实现发现子组件**

- `ExploreNovelCard.vue`：统一渲染书目卡片（封面 `rebaseMediaUrl` + 失败占位图、排名徽章、标题、作者、文库分类、状态标签、简介、最新章节、更新日期、点击跳转 `/novel/:platform/:id`）。
- `ExploreHomePanel.vue`：顶部横向频道 Pill（全站首页 + 16 出版社；带 `requiresChallenge` 标记）；按 `section.layout`（`featured`/`grid`/`rank`/`updates`）渲染各板块；点击“更多”向父组件 emit 跳转事件；503/20001 时给出清晰的 FlareSolverr 未启用提示并提供一键切回全站首页或排行榜。
- `ExploreRankingsPanel.vue`：全部/完本切换（切回“全部”时若当前选中 `allvisit` 自动回落到首个 `supportsAll` 榜单）+ 榜单 Pill + 卡片列表 + 上一页/下一页分页。
- `ExploreCatalogPanel.vue`：完全依据 `schema.catalogFilters` 动态渲染筛选组（选项超过 12 个的分组如“作品主题”默认展示前 12 项并提供展开/收起按钮），显示已激活筛选计数与“重置筛选”按钮，下方渲染结果网格与 `page / totalPages` 分页；503/20001 时清晰提示需服务端启用 FlareSolverr。

- [ ] **Step 3: 升级 `apps/web/src/views/ExploreView.vue` 与 URL Query 同步**

- 检查当前书源 `capabilities.includes("explore")`：具备时展示 4 个子标签（默认 `home`），不具备时不请求 `explore/schema` 直接回退到 `cached`。
- 保留顶部全局搜索框（提交关键词进入搜索态，清空回到当前子标签）。
- 使用 `vue-router` 的 `useRoute` / `useRouter` 将 `tab`、`channel`、`rank`、`full`、`page` 及书库筛选参数同步到 URL Query（使用 `router.replace` 避免污染返回栈），确保点进作品详情页再点返回时完整恢复浏览状态。

- [ ] **Step 4: 运行 Web 端类型检查、生产构建与定向格式化校验**

Run:

```powershell
pnpm --filter=@acanthis-dec/web run check-types
pnpm --filter=@acanthis-dec/web run build
pnpm exec biome check apps/web/src
```
Expected: 全部退出码 `0`，无 TypeScript 或 Vite 构建错误。

- [ ] **Step 5: 原子提交**

```powershell
git add apps/web/src/api/client.ts apps/web/src/components/explore apps/web/src/views/ExploreView.vue
git commit -m "feat(web): 升级发现页支持首页专题、排行榜与 Schema 驱动书库筛选" -m "新增发现 API 客户端与首页/排行榜/书库筛选组件，升级 ExploreView 为四视图并支持 URL Query 状态恢复及 Cloudflare 503 优雅提示。"
```

---

### Task 7: `lnreader-plugins` 彻底薄壳化与筛选器扩充（独立仓库）

**Files（位于 `c:\Users\ConstasJ\Coding\lnreader-plugins`）:**

- Modify: `plugins/chinese/linovelib.ts`

**Interfaces:**

- Consumes: Task 5 提供的 `GET /v1/linovelib/rankings?...&style=lnreader` 与 `GET /v1/linovelib/catalog?...&style=lnreader`
- Produces: 无 `cheerio` 依赖、版本 `1.3.0` 的纯薄壳 `Linovelib` 插件。

- [ ] **Step 1: 重构 `plugins/chinese/linovelib.ts`**

- 删除 `import { load as parseHTML } from 'cheerio';`、`coverUrlPrefix`、`proxyCoverUrl()` 及全部 HTML 解析代码；将 `site` 更新为 `'https://www.linovelib.com'`、`version` 升级为 `'1.3.0'`。
- 扩充 `filters`（均为 `FilterTypes.Picker`）：
  - `mode`：`排行榜（全部）` (`rankings`)、`排行榜（完本）` (`rankings_full`)、`书库多维筛选` (`catalog`)
  - `rank`：12 榜单 + `{ label: '总点击榜（完本）', value: 'allvisit' }`
  - `sort`：9 种书库排序（默认 `lastupdate`）
  - `region`：不限 + 5 个文库地区
  - `tag`：不限 + Spec 附录 A 全部 60 个作品主题
  - `progress`：不限 + 5 个写作进度
  - `anime`：不限 + 已动画化/未动画化
  - `words`：不限 + 5 个字数区间
  - `updated`：不限 + 4 个更新时间区间
- 实现 `popularNovels(pageNo, { showLatestNovels, filters })`：
  - `showLatestNovels` 为真：请求 `/v1/linovelib/rankings?rank=lastupdate&full=false&page=${pageNo}&style=lnreader`。
  - 否则判断 `hasCatalogFilter`（`region`/`tag`/`progress`/`anime`/`words`/`updated` 任一非 `'0'`）或 `filters.mode.value === 'catalog'`：为真则请求 `/v1/linovelib/catalog?...&page=${pageNo}&style=lnreader`；否则请求 `/v1/linovelib/rankings?rank=${rank}&full=${isFull}&page=${pageNo}&style=lnreader`，其中当 `rank === 'allvisit'` 时强制 `isFull = true`。
  - 统一校验返回 JSON 中的 `code === 0`（非 0 时抛出包含 `message` 的可读错误）。

- [ ] **Step 2: 运行 `lnreader-plugins` 校验命令**

Run（在 `c:\Users\ConstasJ\Coding\lnreader-plugins`）:

```powershell
npx eslint plugins/chinese/linovelib.ts
npx prettier --check plugins/chinese/linovelib.ts
npm run build:compile
```
Expected: 全部退出码 `0`。

- [ ] **Step 3: 在 `lnreader-plugins` 仓库原子提交**

```powershell
git -C c:\Users\ConstasJ\Coding\lnreader-plugins add plugins/chinese/linovelib.ts
git -C c:\Users\ConstasJ\Coding\lnreader-plugins commit -m "refactor(linovelib): 将榜单与书库筛选迁入 Acanthis 并彻底薄壳化" -m "移除 cheerio 与源站 HTML 解析逻辑，popularNovels 全部委托至 Acanthis /v1/linovelib/rankings 与 /catalog 接口，并扩充完本榜与 7 维书库筛选器（版本升级至 1.3.0）。"
```

---

### Task 8: Acanthis 全仓验证与 Changesets 补充

**Files:**

- Create: `.changeset/explore-and-thin-plugin.md`

- [ ] **Step 1: 新增 Changeset 文件**

按仓库 `AGENTS.md` 规范创建 `.changeset/explore-and-thin-plugin.md`，在 frontmatter 中列出直接受影响的包并选用 `minor`（向后兼容的新功能）：

- `"@acanthis-dec/core": minor`
- `"@acanthis-dec/linovelib": minor`
- `"@acanthis-dec/api-server": minor`
- `"@acanthis-dec/web": minor`

正文用简明中文概括新增的桌面端发现能力（首页、16 个出版社文库专题、13 个排行榜含完本榜、7 维书库筛选及 Web 端发现页升级）。

- [ ] **Step 2: 执行全仓验证**

Run（在 `c:\Users\ConstasJ\Coding\Acanthis`）:

```powershell
pnpm check-types
pnpm build
pnpm format-and-lint
pnpm exec changeset status
```
Expected: 全部退出码 `0`（Biome 允许既有 `.github/scripts/promote-api-server-image.mjs` 的 6 条 warning，不得有新增 error/warning）。

- [ ] **Step 3: 原子提交 Changeset**

```powershell
git add .changeset/explore-and-thin-plugin.md
git commit -m "chore(changeset): 为源站发现与多维筛选功能补充 minor changeset" -m "为 @acanthis-dec/core、@acanthis-dec/linovelib、@acanthis-dec/api-server 与 @acanthis-dec/web 补充本次发现体系升级的发版变更集。"
```
