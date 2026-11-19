# Acanthis 底座能力补齐设计文档

## 1. 背景与意图（Intent & Why）

Acanthis 计划在现有的 `@acanthis-dec/api-server` 之外扩展两类新终端应用：
1. **EPUB 电子书导出 CLI**：拉取轻小说分卷、正文与插图，离线打包为标准 EPUB 电子书；
2. **在线浏览 Web 客户端**：在浏览器中浏览书库、搜索作品、阅读富文本章节与插图。

现有代码库已完成核心抓取、反混淆、章节乱序还原与基础缓存，但在对接浏览器端与离线打包器时存在五处底座缺口：跨域访问受阻、正文内嵌插图防盗链且无缓存代理、缺少已缓存书库枚举接口、直链打开章节时可能因缺少目录缓存返回 404、以及源站隐藏章节链接（`javascript:cid(0)`）在末章或连续隐藏场景下无法反推真实章节 ID。

本设计在不破坏现有调用方（包括 `lnreader` 与 `acanthis` 两种输出契约）的前提下，一次性补齐上述五项底座能力。

## 2. 目标与非目标（Goals, Non-Goals & Anti-Goals）

### Goals
1. **可配置 CORS 支持**：为 `@acanthis-dec/api-server` 挂载 CORS 中间件，默认放行跨域请求，支持通过配置文件或环境变量收敛允许的 Origin。
2. **封闭式正文插图登记、代理与落盘缓存**：在章节出口动态将正文插图重写为服务端受控路由 `GET /v1/linovelib/illustration/:hash`，仅代理已在数据库登记的正文插图 URL，懒下载并持久化缓存至本地磁盘。
3. **已缓存书库分页接口**：新增 `GET /v1/linovelib/novels`，返回已完整缓存过作品详情的书目列表（过滤搜索占位记录），支持分页与 `style=acanthis|lnreader`。
4. **章节接口直链兜底**：`GET /v1/linovelib/chapter/:chapterId` 支持可选查询参数 `?novelId=`；当数据库尚无该章元数据时，自动拉取并缓存一次对应作品目录后再继续读取正文。
5. **隐藏章节 ID 双向推导**：修复 `@acanthis-dec/linovelib` 目录解析中连续隐藏章节报错与末章无法反推的问题，在“后一章首页 `url_previous` 反推”之外补充“前一章末页 `url_next` 正向链式推导”。

### Non-Goals
- 本阶段不开发 EPUB 生成器（`packages/epub`）、CLI 应用或 Web 前端应用本身。
- 不改动已持久化的章节 `.zst` 正文内容格式（磁盘缓存继续保存未改写 `host` 的源站 HTML，确保更换服务端 `host` 配置时无需清空正文缓存）。
- 不在本阶段额外引入单元测试框架（遵循仓库 `AGENTS.md` 约定，使用包级 `check-types`、`build` 与接口联调验证）。

### Anti-Goals（绝不触碰的负向边界）
- **禁止开放式图片代理（SSRF 风险）**：绝不接受未在数据库中预先登记的任意外部 URL 进行服务端抓取。
- **禁止写死源站图床域名白名单**：源站图床 CDN 域名可能随时变更，必须基于章节正文解析出的真实图片 URL 入库授信，而非依赖静态域名列表。
- **禁止破坏现有 API 响应结构**：现有路由的 JSON Envelope（`{ code, message, data }`）及字段结构保持向后兼容。

## 3. 约束条件（Constraints）

- **包边界遵循现有职责**：
  - `@acanthis-dec/storage`：只负责归一化数据的 SQLite（Drizzle + libSQL）与文件系统持久化，不掺杂 HTML 解析或站点爬虫逻辑；表结构变更必须同步生成 `migrations/` 迁移文件。
  - `@acanthis-dec/linovelib`：拥有哔哩轻小说的 HTML 结构知识（包括 `<img class="imagecontent">` 提取/重写、目录隐藏章节推导、带 `Referer` 的二进制图片抓取及队列限流）。
  - `@acanthis-dec/api-server`：负责配置校验（Zod）、中间件编排、HTTP 参数校验与缓存/客户端协调。
- **TypeScript 严格模式**：兼容 `exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`；外部输入统一通过 Zod 校验。
- **限流安全**：所有新增的章节分页请求必须继续走 `NovelChapterQueue`（`concurrency: 1`，随机间隔 `500~1000ms`），避免触发源站封禁或 Cloudflare 盾风暴。
- **代码风格与提交纪律**：使用 Biome（Tab 缩进、双引号），每完成一个独立可验证单元立即执行类型检查并进行原子化 Conventional Commit。

## 4. 备选方案权衡（Approaches）

针对影响跨包边界最大的**正文插图代理与缓存机制**，评估了以下两种方案：

| 维度 | 方案 A：入库登记 Hash 路由（已选定） | 方案 B：查询参数透传 + 域名白名单 |
| --- | --- | --- |
| 路由形态 | `GET /v1/linovelib/illustration/:hash` | `GET /v1/linovelib/image?url=<encoded>` |
| 安全性 | 仅抓取正文入库过的 URL，天然零 SSRF | 依赖域名白名单校验，配置不当易演变为开放代理 |
| 抗站点变更能力 | 源站更换图床 CDN 域名时自动兼容，零配置维护 | 源站换图床即 403，需改配置或发版 |
| 客户端成本 | 章节 HTML 出口已重写 `src`，Web/CLI/LNReader 零改造直接可用 | 若不重写 HTML 需各客户端自行解析改写 |
| 实现代价 | 需在 `@acanthis-dec/storage` 新增一张元数据表与 Drizzle 迁移 | 无需数据库迁移，但需维护白名单配置逻辑 |

**用户决策**：采纳 **方案 A**。以一次清晰的 Drizzle 表迁移换取长期免维护的安全性与全客户端开箱即用体验。

## 5. 详细设计（Detailed Design）

### 5.1 `@acanthis-dec/storage`：插图存储与书库查询

#### 1) 数据库 Schema 与迁移（`packages/storage/src/table.ts` & `migrations/`）
新增 `illustrationMetadata` 表（表名 `illustration_metadata`）：
- `id`: `integer("id").primaryKey({ autoIncrement: true })`
- `platform`: `text("platform").notNull()`（如 `"linovelib"`）
- `urlHash`: `text("url_hash").notNull()` —— 对原始图片 URL 计算 MD5 十六进制摘要（32 位小写 hex，与现有 `getCoverHash` / `getContentHash` 算法保持一致）
- `originalUrl`: `text("original_url").notNull()`
- `fileHash`: `text("file_hash")` —— 可空；首次从章节正文登记 URL 时为 `null`，待客户端实际请求图片并下载落盘后回填二进制内容 MD5
- `contentType`: `text("content_type")` —— 可空；下载落盘后回填 MIME 类型（如 `"image/jpeg"`）
- `createdAt`: `integer("created_at").notNull()`
- 唯一约束：`unique("illustration_platform_url_hash_idx").on(table.platform, table.urlHash)`

通过 `drizzle-kit generate` 生成增量 SQL 迁移文件（确保现有 `data.db` 平滑升级，同时兼容 Docker 镜像拷贝 `./migrations` 的部署约定）。

- **[工程决策] 存量未决章节一次性失效与过期章节清理**：
  1. 在本次增量 SQL 迁移末尾附加一条数据修复语句 `DELETE FROM chapters WHERE platform_id LIKE 'TOBEDETERMINED%';`。这样旧库中含 `"TOBEDETERMINED"` 的已缓存作品在升级后章节数减少，下次访问 `GET /novel/:novelId` 时会自动触发**唯一一次** `isUpdateNeeded` 重新抓取并回填真实 ID，且不会对真无法推导的章节产生每次请求死循环重抓。
  2. 在 `DatabaseService.addNovelCache` 事务中，更新完分卷与章节（保留已有行的 `contentHash`）后，同步清理该 `novelId` 下已不在本次最新 `volumes` / `chapters` 列表中的残留旧分卷与旧章节行（例如原先的 `TOBEDETERMINED*` 占位行被真实数字 ID 替代后将其删除），确保缓存章节数始终与源站目录严格一致。

#### 2) 文件系统存储（`packages/storage/src/files.ts`）
保持现有 `novels/` 与 `covers/` 目录不变，新增兄弟目录 `illustrations/`：
- 落盘路径：`${basePath}/illustrations/${fileHash.slice(0, 2)}/${fileHash}.${ext}`（复用 `getExtFromContentType`）。
- 若数据库存在 `fileHash` 但磁盘文件意外缺失，`getIllustrationData` 返回 `undefined`，由上层自动重新抓取并修复落盘。

#### 3) 已缓存书库分页查询（`packages/storage/src/db.ts` & `service.ts`）
由于 `addSearchResult` 与 `addNovelCoverMetadata` 会在 `novels` 表写入 `author = ""`、`status = "unknown"` 的占位行，书库查询必须过滤掉未拉取完整详情的记录：
- 过滤条件：`platform = 指定平台` 且 `status != "unknown"` 且 `author != ""` 且 `name != ""`。
- 排序规则：按 `updateAt DESC, id DESC` 排列（最近访问/更新的书目优先）。
- 导出类型与方法签名：
  ```ts
  export interface ListNovelsOptions {
  	page: number;
  	pageSize: number;
  }

  export interface PaginatedNovels {
  	items: NovelInfo[];
  	total: number;
  	page: number;
  	pageSize: number;
  }
  ```
- `StorageService` 暴露：
  - `getUrlHash(url: string): string`（工具函数从包根导出）
  - `registerIllustrations(platform: string, urls: string[]): Promise<void>`（去重后在事务中批量 `onConflictDoNothing` 插入）
  - `getIllustrationSourceUrl(platform: string, urlHash: string): Promise<string | undefined>`
  - `getIllustrationData(platform: string, urlHash: string): Promise<BinaryResponse | undefined>`
  - `setIllustrationData(platform: string, urlHash: string, data: Buffer, contentType: string): Promise<void>`
  - `listCachedNovels(platform: string, options: ListNovelsOptions): Promise<PaginatedNovels>`

### 5.2 `@acanthis-dec/linovelib`：插图处理与隐藏章节双向推导

#### 1) 章节 HTML 插图提取与重写（`packages/linovelib/src/chapter.ts` 或 `utils.ts`，由包根导出）
将 HTML 结构相关的解析留在 `linovelib` 包内：
- `extractChapterIllustrationUrls(html: string): string[]`：使用 Cheerio 提取章节 HTML 中所有 `img` 标签的 `http://` 或 `https://` `src` 属性并去重（若遇到 `//` 协议相对链接则补全为 `https:`）。
- `rewriteChapterIllustrations(html: string, mapUrl: (originalUrl: string) => string): string`：在不破坏原有段落与标签结构的前提下（使用 Cheerio 解析容器片段，避免包裹多余的 `<html><body>` 外壳），将上述 `img` 的 `src` 替换为 `mapUrl(originalUrl)`。
- `LinovelibClient.getIllustration(url: string, referer?: string): Promise<BinaryResponse>`：若启用了登录会话则先调用 `ensureValidSession`，随后复用 `this.getCover(url, referer || "https://www.linovelib.com/")` 拉取图片二进制数据。

#### 2) 目录隐藏章节 ID（`TOBEDETERMINED`）双向推导（`packages/linovelib/src/novel.ts`）
重构 `getNovelVolumes(novelId, title, url, fetchClient, retry, chapterQueue)`：
1. 按全书阅读顺序将所有分卷的章节展平为引用列表 `flatChapters`（保留对 `volumes` 内 `Chapter` 对象的直接引用）。
2. **第一阶段（反向单跳推导）**：遍历 `flatChapters`，仅当 `current.id === "TOBEDETERMINED"` **且紧邻下一章 `next.id` 已是合法非空章节 ID（非 `"TOBEDETERMINED"`）** 时，才请求下一章首页提取 `url_previous` 回填 `current.id`。这直接修复了原先“连续两章均为 `javascript:cid(0)` 时拼接出非法 URL 导致队列抛错崩溃”的 Bug。
3. **第二阶段（正向链式推导兜底）**：再次顺序扫描 `flatChapters`，若仍存在 `current.id === "TOBEDETERMINED"`（典型如全书最后一章，或连续隐藏章节中的前序章节）：
   - 检查紧邻前一章 `prev.id` 是否已是合法章节 ID（因为是按索引从前往后顺序扫描并原地回填，连续隐藏块只要块前有一章已知，就会逐章向后解锁！）。
   - 新增辅助函数 `parseNextChapterIdFromPrevChapter(novelId: string, prevChapterId: string, chapterQueue: NovelChapterQueue): Promise<string>`：
     - 从 `https://www.linovelib.com/novel/${novelId}/${prevChapterId}.html` 开始拉取；
     - 提取页面底部分页/脚本中的 `nextPageId`（兼容 `div.mlfy_page a:last` 与 `url_next` 正则）；
     - 当 `nextPageId.startsWith(`${prevChapterId}_`)` 时说明仍在同一章的分页内，继续翻页（设置单章最大翻页上限 `50` 防止异常死循环）；
     - 一旦拿到的 `nextPageId` 为纯数字章节 ID（匹配 `/^\d+$/` 且不等于 `prevChapterId`），即作为下一章的真实 `chapterId` 返回；若指向目录页、分卷页或解析失败则返回 `""`。
4. **[工程决策] 未决章节唯一占位符**：`chapters` 表存在 `UNIQUE(novel_id, platform_id)` 约束。若两轮推导后某章仍无法解析出真实 ID，将其最终 `chapter.id` 落为带分卷与章节序号的唯一占位符 `TOBEDETERMINED_${vIndex}_${cIndex}`（辅助函数 `isUnresolvedChapterId(id)` 统一以 `id.startsWith("TOBEDETERMINED")` 判断）。这无需重建 `chapters` 表即可避免同一作品多章未决时的覆盖丢章问题，并防止章节数不一致导致缓存永久失效。

### 5.3 `@acanthis-dec/api-server`：配置、中间件与路由升级

#### 1) CORS 与可选全局鉴权配置（`apps/api-server/src/config.ts` & `src/index.ts`）
- `ConfigSchema` 新增顶层 `cors` 与可选 `auth` 配置块：
  ```ts
  cors: z
  	.object({
  		origin: z
  			.union([z.string(), z.array(z.string())])
  			.default("*")
  			.describe("CORS 允许的 Origin，支持 '*'、单个源或源列表"),
  	})
  	.default({ origin: "*" })
  	.describe("跨域资源共享配置"),
  auth: z
  	.object({
  		token: z.string().min(1).optional().describe("可选的全局访问令牌；设置后启用 API 鉴权"),
  	})
  	.optional()
  ```
- 环境变量映射：`CORS_ORIGIN`（`"*`、单源或逗号分隔源列表）与 `AUTH_TOKEN`。
- 在 `src/index.ts` 中挂载 Hono 内置 `cors({ origin: config.cors.origin, allowHeaders: ["Content-Type", "Authorization"], allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] })`。
- 当配置了 `config.auth?.token` 时，除 `/v1/:platform/cover/*` 与 `/v1/:platform/illustration/*` 二进制图片读取路由外，所有 `/v1/*` JSON 路由均校验 `Authorization: Bearer <token>`（使用 `node:crypto` 的 `timingSafeEqual` 比对），未通过返回 `401` `{ code: 40100, message: "Unauthorized" }`。

#### 2) 多源注册与路由变更（`packages/core` & `apps/api-server`）
- 在 `@acanthis-dec/core` 新增书源描述类型 `NovelSourceDescriptor`（`{ id: string; name: string; capabilities: ("search" | "novels" | "illustrations")[] }`），并在 `api-server` 提供 `GET /v1/sources` 返回当前已挂载的书源列表（初始包含 `linovelib`），供后续 CLI 与 Web 客户端自动发现服务端支持的书源。
- 统一抽取 `resolveHost(c)` 辅助函数（保持现有逻辑 `config.host ?? c.req.header("host") ?? "http://localhost:5301"`，并去除末尾多余斜杠以防拼接双斜杠）：

1. **`GET /v1/linovelib/chapter/:chapterId?novelId=<optional>`**
   - 新增可选 query 校验：`z.object({ novelId: z.string().min(1).optional() })`。
   - 当 `storageService.getChapterFromId("linovelib", chapterId)` 为空且传入了 `novelId` 时：调用 `linovelibClient.getNovelInfo(novelId)`，成功后执行 `storageService.addNovelCache(novel)`，再重新查询一次 `getChapterFromId`。若仍未找到则按原契约返回 `404`（`code: 10000`）。
   - 拿到原始章节 HTML（无论来自 `.zst` 缓存还是新抓取；新抓取时先将**未改写的原始 HTML** 写入 `setNovelContent`）后：
     - 调用 `extractChapterIllustrationUrls(rawHtml)`；
     - 若存在插图 URL，调用 `storageService.registerIllustrations("linovelib", urls)`；
     - 调用 `rewriteChapterIllustrations(rawHtml, (url) => `${host}/v1/linovelib/illustration/${getUrlHash(url)}`)` 生成响应 HTML并返回。

2. **`GET /v1/linovelib/illustration/:hash`（新增）**
   - 参数校验：`hash: z.string().regex(/^[a-f0-9]{32}$/, "Invalid illustration hash")`。
   - 先查 `storageService.getIllustrationData("linovelib", hash)`，命中则直接带 `Content-Type` 与 `Cache-Control: public, max-age=86400` 返回二进制流。
   - 未命中文件缓存时查 `storageService.getIllustrationSourceUrl("linovelib", hash)`：
     - 若数据库无此记录，返回 `404` JSON `{ code: 10003, message: "Illustration not found" }`；
     - 若存在 `sourceUrl`，调用 `linovelibClient.getIllustration(sourceUrl)` 下载，调用 `storageService.setIllustrationData("linovelib", hash, res.data, res.mimeType)` 落盘，再返回二进制流。

3. **`GET /v1/linovelib/novels`（新增）**
   - Query 校验：
     - `page`: `z.coerce.number().int().min(1).default(1)`
     - `pageSize`: `z.coerce.number().int().min(1).max(100).default(20)`
     - `style`: `outputStyleSchema.optional()`
   - 调用 `storageService.listCachedNovels("linovelib", { page, pageSize })`。
   - 将每项的 `coverUrl` 重写为 `${host}/v1/linovelib/cover/novel/${novel.id}`，按 `style` 转换单条记录（`acanthis` 默认返回完整 `NovelInfo`，`lnreader` 复用 `transformOutputStyleForSearchResult` 返回 `LNReaderNovelItem`）。
   - 返回：`{ code: 0, message: "Success", data: { items, total, page, pageSize } }`。

## 6. 留给实施阶段自行决定的细节（Left to the Builder）

- 内部辅助函数的具体文件拆分位置（例如 `resolveHost` 放在 `apps/api-server/src/utils.ts` 还是 `linovelib.ts` 内）。
- `packages/linovelib` 中插图提取/重写函数放在新建的 `src/illustration.ts` 还是 `src/chapter.ts`，只要从 `packages/linovelib/src/index.ts` 干净导出即可。
- 错误日志的具体中文/英文措辞，保持与各包现有日志风格一致即可。
