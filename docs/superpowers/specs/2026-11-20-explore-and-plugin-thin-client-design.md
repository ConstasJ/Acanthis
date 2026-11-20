# 源站发现（首页 / 排行榜 / 书库多维筛选 / 出版社专题）与 LNReader 插件薄壳化设计文档

## 1. 背景与意图（Intent & Why）

在完成底座能力补齐、EPUB 导出与独立 Web 客户端之后，Acanthis 已具备“搜索 → 详情 → 阅读 / 同步 / 导出”的完整下游能力，但仍缺少最关键的上游入口——**主动发现新书与逛站体验**：

1. **Web 端（`@acanthis-dec/web`）**：目前 `ExploreView` 只能翻阅“服务端已缓存书库”或按已知书名“实时搜索”，无法像逛原站一样浏览首页推荐、各类排行榜、完本榜、最近更新、具体出版社文库专题，或按题材/进度/动画化/字数/更新时间多维筛选找书。
2. **LNReader 插件（`ConstasJ/lnreader-plugins` 的 `plugins/chinese/linovelib.ts`）**：详情、章节与搜索早已全面迁入 Acanthis，唯独 `popularNovels` 仍残留在客户端直连移动端站点（`www.bilinovel.com`）并用 `cheerio` 硬解析 HTML，既受限流/域名变更影响，也只支持单一的 12 项榜单筛选。

本设计以桌面端站点 `https://www.linovelib.com` 为上游数据源，在 Acanthis 中建立一套**跨书源通用、Schema 驱动的发现与筛选体系**，同时让 `linovelib` 插件彻底移除 HTML 解析与源站域名耦合，降级为纯 HTTP 转发的轻量薄壳，并获得远超原插件的多维筛选能力。

## 2. 目标与非目标（Goals, Non-Goals & Anti-Goals）

### Goals

1. **跨书源通用发现契约（`@acanthis-dec/core`）**：扩展 `SourceCapability` 增加 `"explore"`，定义通用的发现元数据（`ExploreSchema`）、聚合首页板块（`ExploreHomeData` / `ExploreSection`）、书目卡片（`ExploreNovelItem`）及分页结果（`ExplorePage`）。
2. **完整覆盖桌面端四大发现入口（`@acanthis-dec/linovelib`）**：
   - **全站首页**（`/`）：解析焦点推荐、强推榜、新书精选、新书榜、热门小说、各文库推荐、经典完本、完本推荐、热点榜、最近更新等聚合板块。
   - **16 个出版社文库专题页**（`/wenku/{channel}/1.html`）：电击文库、富士见文库、角川文库、MF文库J、Fami通文库、GA文库、HJ文库、一迅社、集英社、小学馆、讲谈社、少女文库、其他文库、华文轻小说、Web轻小说、韩国轻小说，复用与首页同构的聚合板块模型。
   - **排行榜与完本榜**（`/top/{rank}/{page}.html` 与 `/topfull/{rank}/{page}.html`）：支持 12/13 个榜单 × 全部/完本切换与分页。
   - **7 维书库筛选**（`/wenku/{sort}_{tag}_{progress}_{anime}_{region}_0_0_{words}_{page}_{updated}.html`）：支持排序（9 项）、文库地区（5+1 项）、作品主题（60+1 项）、写作进度（5+1 项）、是否动画化（2+1 项）、作品字数（5+1 项）、更新时间（4+1 项）自由组合，并解析精确总页数。
3. **受控抓取、缓存与兼容路由（`@acanthis-dec/api-server`）**：
   - 新增 `/v1/linovelib/explore/schema`、`/v1/linovelib/home`、`/v1/linovelib/rankings`、`/v1/linovelib/catalog`。
   - 提供服务端内存 TTL 缓存、Single-flight 并发合并与轻量限速队列，保护源站并避免高频触发 Cloudflare。
   - `rankings` 与 `catalog` 支持 `style=acanthis|lnreader` 输出适配，封面 URL 统一重写为服务端代理路径 `/v1/linovelib/cover/novel/:novelId`。
4. **Web 端完整发现体验（`@acanthis-dec/web`）**：将 `ExploreView` 升级为「首页推荐（含 16 个出版社频道切换）/ 排行榜 / 书库筛选 / 本地已缓存」四大视图，榜单与筛选面板完全由 `/explore/schema` 动态驱动；未开启 FlareSolverr 导致 CF 拦截时优雅提示且不影响无 CF 视图。
5. **LNReader 插件彻底薄壳化（`lnreader-plugins`）**：移除 `cheerio` 依赖、源站直连逻辑与本地封面 URL 拼接，`popularNovels` 全部委托给 Acanthis，并大幅扩充插件侧筛选条件（榜单 + 完本 + 地区/主题/进度/动画化/字数/更新时间/排序）。

### Non-Goals

- 不在本阶段将首页/榜单/书库列表结果写入 SQLite 持久化表（属于高时效动态列表，采用服务端内存 TTL 缓存即可，避免污染已缓存书库与数据库膨胀）。
- 不在本阶段新增其他小说网站书源，但 `@acanthis-dec/core` 与 `@acanthis-dec/web` 必须按多书源契约设计，不写死 `linovelib` 专属筛选选项。
- 不改变现有 `/v1/linovelib/novel/:id`、`/chapter/:id`、`/search`、`/novels`、`/cover/*`、`/illustration/*` 路由的行为与响应结构。

### Anti-Goals（绝不触碰的负向边界）

- **禁止无 CF 路径被有 CF 路径拖垮**：`/top/`、`/topfull/` 与首页 `/` 实测无需过 Cloudflare，绝不能把它们和需要 FlareSolverr 的 `/wenku/*` 强耦合在同一必经链路上，确保未部署 FlareSolverr 的用户依然能正常逛首页和全部排行榜。
- **禁止前端硬编码筛选项**：Web 端不得把 60 个题材标签、16 个出版社文库、13 个榜单写死在 Vue 组件里，必须由 `GET /v1/:platform/explore/schema` 动态下发。
- **禁止在 `linovelib.ts` 插件中保留任何源站 HTML 解析**：完成本次改造后，LNReader 插件中不再出现 `cheerio` 或源站域名抓取逻辑。

## 3. 约束条件（Constraints）

- **实测源站特征（桌面端 `https://www.linovelib.com`）**：
  - `/`（首页）、`/top.html`、`/top/{rank}/{page}.html`、`/topfull/{rank}/{page}.html`：无 Cloudflare 拦截，直接返回完整 HTML。
  - `/wenku/`、`/wenku/{sort}_{tag}_..._{page}_{updated}.html`、`/wenku/{channel}/1.html`：受 Cloudflare 保护，需通过 `BrowserFetchClient` 配合 FlareSolverr 解盾；若未开启 FlareSolverr 或解盾失败，抛出 `CloudflareBlockError`，API 层统一映射为 `503`（`code: 20001`）。
  - `/top/{rank}/{page}.html` 与 `/topfull/{rank}/{page}.html` 每页 30 条 `.rank_d_list`，第 1 页与第 2 页 HTML 中均无总页数 DOM（`.rank_d_pagesize` 为空），需以 `items.length >= 30` 推断 `hasNextPage`（`totalPages` 为 `undefined`）。
  - `/wenku/{sort}_..._{page}_{updated}.html` 使用 `.store_collist .bookbox` 列表与 `<em id="pagestats">{page}/{totalPages}</em>`，可精准提取 `totalPages` 与 `hasNextPage = page < totalPages`。
  - `/wenku/{channel}/1.html` 为该出版社文库的聚合专题页（包含新书榜、热门、推荐、热点榜、经典完本、完本推荐、收藏榜、最新更新等板块，不分页），与首页 `/` 同构。
- **工程规范**：
  - 遵循仓库 TypeScript 严格模式（`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`）与 Biome 格式（Tab、双引号）。
  - 外部参数与响应契约使用 Zod 校验。
  - 涉及 `packages/*` 与 `apps/*` 公共 API/运行时行为变更后需补充 Changeset，并按原子化提交规范提交（不自动 push）。
  - `lnreader-plugins` 位于独立工作区 `c:\Users\ConstasJ\Coding\lnreader-plugins`，受 Hermes/ES5 运行时约束，需运行该仓库的 `eslint`、`prettier --check`、`build:compile` 校验。

## 4. 备选方案权衡（Approaches）

| 维度       | 方案 1：Schema 驱动的三入口发现架构（已选定）                              | 方案 2：统一单一 `/browse` 端点                               |
| :--------- | :------------------------------------------------------------------------- | :------------------------------------------------------------ |
| 接口划分   | `/explore/schema` + `/home`（含 `channel` 专题）+ `/rankings` + `/catalog` | `/home` + 单一 `/browse`（服务端按参数路由到榜单或书库）      |
| 语义清晰度 | 榜单独有能力（鸡蛋榜/新书榜/完本总榜/排名序号）与书库 7 维组合筛选互不冲突 | 榜单独有值与书库 7 维筛选共享同一参数空间，冲突与降级规则隐晦 |
| CF 隔离性  | 无 CF 的首页/排行榜与需 CF 的书库/出版社专题天然隔离                       | 同一接口下部分参数触发 CF、部分不触发，缓存与错误语义混乱     |
| 客户端体验 | Web 端天然对应 4 个直观 Tab，LNReader 插件按筛选条件清晰分发               | 前端难以区分“榜单浏览”与“多维书库检索”两种心智模型            |

**用户决策**：采纳 **方案 1**，并将 16 个出版社文库专题页一并纳入发现体系（作为 `/home?channel=<slug>` 的同构频道视图）。

## 5. 详细设计（Detailed Design）

### 5.1 `@acanthis-dec/core`：通用发现契约（`packages/core/src/types.ts`）

1. 扩展 `SourceCapability`：

   ```ts
   export type SourceCapability = "search" | "novels" | "illustrations" | "explore";
   ```
2. 新增通用发现数据结构：

   ```ts
   export interface ExploreFilterOption {
   	value: string;
   	label: string;
   }

   export interface ExploreFilterGroup {
   	key: string;
   	label: string;
   	defaultValue: string;
   	options: ExploreFilterOption[];
   }

   export interface ExploreChannelOption {
   	id: string;
   	label: string;
   	requiresChallenge?: boolean;
   }

   export interface ExploreRankingOption {
   	id: string;
   	label: string;
   	supportsAll: boolean;
   	supportsFull: boolean;
   }

   export interface ExploreSchema {
   	platform: string;
   	supportsHome: boolean;
   	channels: ExploreChannelOption[];
   	rankings: ExploreRankingOption[];
   	catalogRequiresChallenge?: boolean;
   	catalogFilters: ExploreFilterGroup[];
   }

   export interface ExploreNovelItem {
   	id: string;
   	platform: string;
   	title: string;
   	coverUrl?: string;
   	author?: string;
   	summary?: string;
   	status?: NovelStatus;
   	category?: string;
   	genres?: string[];
   	latestChapter?: string;
   	latestChapterId?: string;
   	wordCount?: string;
   	updatedAt?: string;
   	rank?: number;
   }

   export type ExploreSectionLayout = "featured" | "grid" | "rank" | "updates";

   export interface ExploreSectionMoreTarget {
   	type: "ranking" | "catalog" | "channel";
   	params: Record<string, string>;
   }

   export interface ExploreSection {
   	id: string;
   	title: string;
   	layout: ExploreSectionLayout;
   	items: ExploreNovelItem[];
   	more?: ExploreSectionMoreTarget;
   }

   export interface ExploreHomeData {
   	platform: string;
   	channel: string;
   	title: string;
   	sections: ExploreSection[];
   }

   export interface ExplorePage {
   	platform: string;
   	items: ExploreNovelItem[];
   	page: number;
   	totalPages?: number;
   	hasNextPage: boolean;
   }
   ```

   > 所有可选字段严格遵守 `exactOptionalPropertyTypes` 约定，在构造对象时仅在有值时赋值或显式标注 `| undefined`。

### 5.2 `@acanthis-dec/linovelib`：桌面端发现解析与队列

新增 `packages/linovelib/src/explore/` 目录：

1. **`schema.ts`**：定义 `LINOVELIB_EXPLORE_SCHEMA` 常量及强类型白名单集合：
   - **16 个频道（`channels`）**：`home`（全站首页，`requiresChallenge: false`）以及 16 个出版社文库（`requiresChallenge: true`）：`dengekibunko`（电击文库）、`fujimibunko`（富士见文库）、`kadokawabunko`（角川文库）、`emuefubunkojei`（MF文库J）、`famitsubunko`（Fami通文库）、`gagraphicbunko`（GA文库）、`hobbyjapanbunko`（HJ文库）、`ichijinsha`（一迅社）、`shueisha`（集英社）、`shogakukan`（小学馆）、`kodansha`（讲谈社）、`teenagebunko`（少女文库）、`other`（其他文库）、`chineselightnovel`（华文轻小说）、`weblightnovel`（Web轻小说）、`koreanlightnovel`（韩国轻小说）。
   - **13 个榜单（`rankings`）**：
     - `monthvisit`（月点击榜）、`weekvisit`（周点击榜）、`monthvote`（月推荐榜）、`weekvote`（周推荐榜）、`monthflower`（月鲜花榜）、`weekflower`（周鲜花榜）、`monthegg`（月鸡蛋榜）、`weekegg`（周鸡蛋榜）、`lastupdate`（最近更新）、`postdate`（最新入库）、`goodnum`（收藏榜）、`newhot`（新书榜）：`supportsAll: true, supportsFull: true`
     - `allvisit`（总点击榜）：`supportsAll: false, supportsFull: true`（桌面端 `/topfull/allvisit/1.html` 为完本默认总榜）
   - **7 组书库筛选器（`catalogFilters`）**：
     - `sort`（排序方式，默认 `lastupdate`）：`lastupdate`, `weekvisit`, `monthvisit`, `weekvote`, `monthvote`, `weekflower`, `monthflower`, `goodnum`, `postdate`
     - `region`（文库地区，默认 `0`）：`0` 不限、`1` 日本轻小说、`2` 华文轻小说、`3` Web轻小说、`4` 轻改漫画、`5` 韩国轻小说
     - `tag`（作品主题，默认 `0`）：`0` 不限 + 实测获取的全部 60 个主题 ID 与标签名（完整映射表见附录 A）
     - `progress`（写作进度，默认 `0`）：`0` 不限、`1` 新书上传、`2` 情节展开、`3` 精彩纷呈、`4` 接近尾声、`5` 已经完本
     - `anime`（是否动画化，默认 `0`）：`0` 不限、`1` 已动画化、`2` 未动画化
     - `words`（作品字数，默认 `0`）：`0` 不限、`1` 30万以下、`2` 30-50万、`3` 50-100万、`4` 100-200万、`5` 200万以上
     - `updated`（更新时间，默认 `0`）：`0` 不限、`1` 三日内、`2` 七日内、`3` 半月内、`4` 一月内
2. **`rankings.ts`**：
   - 请求 `https://www.linovelib.com/${full ? "topfull" : "top"}/${rank}/${page}.html`。
   - 解析 `.rank_d_list`：提取 `novelId`（`/novel/(\d+)\.html`）、`title`、封面（优先 `img[data-original]`，过滤占位图 `book-cover-no.svg`，回退 `novelIdToCoverUrl(id)`）、作者/文库/连载状态（`.rank_d_b_cate` 按 `|` 切分）、简介（`.rank_d_b_info`）、最新章节（`.rank_d_b_last a` 去除 `.rank_d_lastchapter` 前缀）、更新日期（`.rank_d_b_time`）、排名（`(page - 1) * 30 + index + 1`）。
   - `hasNextPage` 按 `items.length >= 30` 推断（若页面为空或不足 30 条则为 `false`）。
3. **`catalog.ts`**：
   - 拼接 URL：`https://www.linovelib.com/wenku/${sort}_${tag}_${progress}_${anime}_${region}_0_0_${words}_${page}_${updated}.html`（参数经白名单校验，防止路径注入）。
   - 解析 `.store_collist .bookbox`：提取 `novelId`、`title`、封面（`img[data-original]` 回退 `novelIdToCoverUrl(id)`）、`.bookilnk span` 中的作者/文库/状态/更新日期、`.bookintro` 简介、`.bookupdate b` 空白分隔标签数组。
   - 解析 `#pagestats`（如 `1/183`）提取 `totalPages` 与 `hasNextPage = page < totalPages`；若结果为空无 `#pagestats`，则返回 `totalPages: 1, hasNextPage: false`。
4. **`home.ts`**：
   - `channel === "home"` 请求 `https://www.linovelib.com/`；其他频道请求 `https://www.linovelib.com/wenku/${channel}/1.html`。
   - 按页面视觉区块解析为结构化的 `ExploreSection[]`：
     - **全站首页**：焦点推荐（`featured`）、强推榜（`rank`）、新书精选（`grid`）、新书榜（`rank`）、热门小说与各文库精选（`grid`，`more` 指向对应 `channel`）、经典完本与完本推荐（`grid`）、热点榜（`rank`）、最近更新（`updates`，包含最新章节名/章节 ID/字数/更新时间，`more` 指向 `ranking: { rank: "lastupdate" }`）。
     - **出版社文库专题页**：按页面中各模块标题（新书榜、热门、推荐、热点榜、经典完本、完本推荐、收藏榜、最新更新）解析 `.mind-book` 卡片、榜单条目与底部文字/更新列表，自动去重合并为同类 `ExploreSection[]`。
5. **队列与 `LinovelibClient` 暴露**：
   - 在 `packages/linovelib/src/queue.ts` 新增 `NovelExploreQueue`（`concurrency: 2`，请求间隔 `300~600ms`，避免阻塞正在下载章节的 `NovelChapterQueue` 与 `NovelInfoQueue`）。
   - `LinovelibClient` 新增四个公开方法：
     - `getExploreSchema(): ExploreSchema`
     - `getExploreHome(channel?: string): Promise<ExploreHomeData>`
     - `getRankings(options: LinovelibRankingOptions): Promise<ExplorePage>`
     - `getCatalog(options: LinovelibCatalogOptions): Promise<ExplorePage>`

### 5.3 `@acanthis-dec/api-server`：路由、缓存与 LNReader 兼容

1. **`apps/api-server/src/sources.ts`**：将 `linovelib` 的 `capabilities` 更新为 `["search", "novels", "illustrations", "explore"]`。
2. **`apps/api-server/src/linovelib.ts`**：新增 4 个受鉴权保护（与现有 `/v1/linovelib/*` 一致）的只读路由：
   - `GET /v1/linovelib/explore/schema`：直接返回 `linovelibClient.getExploreSchema()`（静态元数据，加 `Cache-Control: public, max-age=3600`）。
   - `GET /v1/linovelib/home`：查询参数 `?channel=home`（默认 `"home"`，白名单校验）。
   - `GET /v1/linovelib/rankings`：查询参数 `?rank=monthvisit&full=false&page=1&style=acanthis|lnreader`（默认 `style=acanthis`；若 `full=false` 且 `rank=allvisit` 时返回 400 校验错误）。
   - `GET /v1/linovelib/catalog`：查询参数 `?sort=lastupdate&region=0&tag=0&progress=0&anime=0&words=0&updated=0&page=1&style=acanthis|lnreader`。
3. **封面重写与 `style=lnreader` 适配**：
   - 所有返回的 `ExploreNovelItem` 封面统一改写为 `${host}/v1/linovelib/cover/novel/${item.id}`（直接复用现有代理端点，彻底消除防盗链）。
   - 当 `rankings` 或 `catalog` 传入 `style=lnreader` 时，`data` 直接返回 LNReader `Plugin.NovelItem[]`（`{ name: item.title, path: item.id, cover: proxiedCoverUrl }`），与现有 `/search?style=lnreader` 保持完全一致的契约。
4. **内存 TTL 缓存 + Single-flight 并发合并**：
   - 新增轻量级内存缓存工具（按规范化后的路由键缓存，TTL 默认 5 分钟，上限如 200 条 LRU/FIFO 淘汰，防止内存无限增长）。
   - 相同缓存键的并发回源共享同一个 `inFlight` Promise，避免多人同时刷新首页或书库筛选时重复打向上游或并发触发 FlareSolverr。
   - 错误处理完全复用现有 `handleLinovelibError`（`CloudflareBlockError` -> 503 + `Retry-After: 15`）。

### 5.4 `@acanthis-dec/web`：升级发现页（`ExploreView.vue`）

1. **API 客户端（`apps/web/src/api/client.ts`）**：新增 `fetchExploreSchema`、`fetchExploreHome`、`fetchExploreRankings`、`fetchExploreCatalog`，并复用 `rebaseMediaUrl` 处理封面。
2. **视图组织（`apps/web/src/views/ExploreView.vue`）**：
   - 顶部保留书源切换与全局搜索框（输入关键词提交后进入搜索结果态，清除后回到当前发现子视图）。
   - 若当前书源具备 `"explore"` 能力，拉取 `explore/schema` 并展示四个子视图 Tab：
     - **首页推荐**：顶部提供横向可滚动的频道 Pill（全站首页 + 16 个出版社文库；带挑战标记的频道在触发 503 时内联提示需服务端启用 FlareSolverr），下方按 `section.layout` 渲染焦点卡片、书目网格、榜单列、最近更新列表，板块右上角“更多”可一键跳转到对应排行榜/频道/书库。
     - **排行榜**：提供「全部 / 完本」切换 + 榜单 Pill 选择器（随全部/完本自动过滤可用榜单）+ 带排名序号、作者、文库、简介、最新章节与更新时间的卡片列表 + 上一页/下一页分页。
     - **书库筛选**：完全由 `schema.catalogFilters` 动态渲染筛选面板（桌面端展开/可折叠，移动端折叠面板 + 已选条件 Badge 与一键重置），60 个作品主题支持折叠展开或快速筛选，下方展示书目卡片与带精确总页数（`page / totalPages`）的分页栏。
     - **本地已缓存**：保留现有的服务端已缓存书库分页列表，作为离线/高速兜底浏览入口。
   - 若某书源不具备 `"explore"` 能力，自动回退为仅显示「本地已缓存 + 搜索」。
   - 所有选中的 Tab、频道、榜单、筛选条件与页码同步到 URL Query（或组件状态保留），从作品详情页返回时保持浏览位置不丢失。

### 5.5 `lnreader-plugins`：`plugins/chinese/linovelib.ts` 彻底薄壳化

1. **删除项**：
   - 移除 `import { load as parseHTML } from 'cheerio';`
   - 移除 `coverUrlPrefix`、`proxyCoverUrl()` 及 `popularNovels` 内所有 `www.bilinovel.com` 直连与 DOM 解析代码（`site` 属性仍按 LNReader 插件接口要求保留为 `https://www.linovelib.com`，仅用于标识/跳转原站）。
2. **筛选器扩充（`filters`）**：
   - 保留 `rank`（12 榜单 + 完本总点击榜 `allvisit`，文案标注为 `总点击榜（完本）`），并新增：
     - `mode`：`排行榜（全部）` / `排行榜（完本）` / `书库多维筛选`（默认 `排行榜（全部）`；或在任一书库筛选维非“不限”时自动切到书库筛选，用户零学习成本）
     - `sort`（书库排序：更新时间、周/月点击、周/月推荐、周/月鲜花、收藏数、入库时间）
     - `region`（文库地区：不限、日本轻小说、华文轻小说、Web轻小说、轻改漫画、韩国轻小说）
     - `tag`（作品主题：不限 + 附录 A 中的 60 个题材标签）
     - `progress`（写作进度：不限、新书上传、情节展开、精彩纷呈、接近尾声、已经完本）
     - `anime`（是否动画化：不限、已动画化、未动画化）
     - `words`（作品字数：不限、30万以下、30-50万、50-100万、100-200万、200万以上）
     - `updated`（更新时间：不限、三日内、七日内、半月内、一月内）
3. **分发逻辑（`popularNovels`）**：
   - `showLatestNovels === true`：请求 `${this.serverUrl}/v1/linovelib/rankings?rank=lastupdate&full=false&page=${pageNo}&style=lnreader`。
   - 否则：若用户选择了“书库多维筛选”模式，或任意一个书库筛选维度（`region`/`tag`/`progress`/`anime`/`words`/`updated`）不为 `"0"`，则请求 `${this.serverUrl}/v1/linovelib/catalog?...&page=${pageNo}&style=lnreader`；其余情况请求 `${this.serverUrl}/v1/linovelib/rankings?rank=${rank}&full=${isFull}&page=${pageNo}&style=lnreader`。
   - **[工程决策] `allvisit` 冲突兜底**：服务端保持对 `rank=allvisit&full=false` 返回 400 的严格校验；在 LNReader 插件侧（因其静态 Picker 无法随 `mode` 动态隐藏选项），当 `rank === "allvisit"` 时自动按 `full=true` 请求，避免用户在默认模式下点选报错。
   - 插件版本号升级至 `1.3.0`。

## 6. 留给实施者的空间（Left to the Builder）

- 首页 `/` 与出版社文库页 `/wenku/{channel}/1.html` 各子板块的精确 CSS 选择器提取细节与空值兜底逻辑（以实测 HTML 为准，确保某单一板块 DOM 微调时不导致整页解析崩溃）。
- `apps/web` 中筛选面板的响应式排版、折叠动画、骨架屏加载态以及 URL Query 同步细节。
- 内存 TTL 缓存的轻量封装位置（`apps/api-server/src/cache.ts` 或 `utils.ts`）及日志级别。
- `lnreader-plugins` 侧针对 `filters` 在 LNReader UI 中的标签命名简洁度与 `1.3.0` 构建检查。

## 附录 A：实测 `/wenku/` 60 个作品主题（`tag`）映射表

| ID    | 标签     | ID    | 标签     | ID    | 标签   | ID    | 标签     |
| :---- | :------- | :---- | :------- | :---- | :----- | :---- | :------- |
| `64`  | 恋爱     | `48`  | 后宫     | `63`  | 校园   | `27`  | 百合     |
| `26`  | 转生     | `47`  | 异世界   | `15`  | 奇幻   | `61`  | 冒险     |
| `222` | 欢乐向   | `231` | 女性视角 | `219` | 龙傲天 | `96`  | 魔法     |
| `67`  | 青春     | `31`  | 性转     | `198` | 病娇   | `217` | 妹妹     |
| `225` | 青梅竹马 | `18`  | 战斗     | `256` | NTR    | `223` | 人外     |
| `227` | 大小姐   | `189` | 黑暗     | `68`  | 悬疑   | `56`  | 科幻     |
| `201` | 伪娘     | `55`  | 战争     | `185` | 萝莉   | `229` | 复仇     |
| `199` | 斗智     | `131` | 异能     | `241` | 猎奇   | `191` | 轻文学   |
| `60`  | 职场     | `226` | 经营     | `246` | JK     | `135` | 机战     |
| `261` | 女儿     | `221` | 末日     | `220` | 犯罪   | `239` | 旅行     |
| `124` | 惊悚     | `98`  | 治愈     | `97`  | 推理   | `205` | 日本文学 |
| `248` | 游戏     | `228` | 耽美     | `211` | 美食   | `245` | 群像     |
| `249` | 大逃杀   | `233` | 音乐     | `132` | 格斗   | `28`  | 热血     |
| `180` | 温馨     | `224` | 脑洞     | `328` | 恶役   | `304` | JC       |
| `254` | 间谍     | `146` | 竞技     | `263` | 宅文化 | `333` | 同人     |
