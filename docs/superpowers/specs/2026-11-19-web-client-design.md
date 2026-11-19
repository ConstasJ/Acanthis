# Acanthis 在线浏览 Web 客户端与多源跨端同步设计文档

## 1. 背景与意图（Intent & Why）

在第一步（服务端缓存、插图代理与目录修复底座）和第二步（平台无关 `@acanthis-dec/epub` 与 `@acanthis-dec/cli`）的基础上，第三步构建面向日常阅读的在线网页客户端 **`@acanthis-dec/web`（`apps/web`）**，并同步补齐支撑它的**单后端多书源发现**与**单用户跨设备阅读同步**后端切片。

核心使用场景：
- 用户日常以**手机端阅读为主、桌面端阅读为辅**，采用**前后端分离部署**（静态前端托管于 Cloudflare Pages / Nginx 等，连接自托管 `@acanthis-dec/api-server`）；
- 书架收藏与阅读进度支持**手机、电脑及后续规划的 Compose Multiplatform（CMP）原生 App 跨设备无缝同步**；
- 客户端采用**单后端多源（Multi-Source per Server）**模型——不绑定单一站点路径，自动发现并对接服务端已启用的所有书源适配器（如当前的 `linovelib` 及未来扩展的其他站点包）。

## 2. 目标与非目标（Goals, Non-Goals & Anti-Goals）

### Goals
1. **单后端多源协议打通**：服务端提供 `GET /v1/sources` 书源发现接口；客户端所有路由、缓存、书架与阅读进度统一使用 `(platform, novelId)` 复合标识寻址。
2. **跨平台通用阅读进度与单用户书架同步**：在 `@acanthis-dec/storage` 与 `@acanthis-dec/api-server` 增加单用户书架（含软删除墓碑 `deletedAt`）与块级阅读进度（`paragraphIndex`）持久化及增量同步接口，配套可选的 `AUTH_TOKEN` 鉴权。
3. **移动端优先、本地优先（Local-First）的 Vue 3 PWA**：
   - 基于 Vue 3 + Vite + Vue Router + Pinia + Tailwind CSS v4 + `vite-plugin-pwa` 构建；
   - 采用**经典三栏底导（书架 / 书源·发现 / 设置）**，桌面端自适应切换为左侧窄导航栏（Navigation Rail）；
   - 阅读进度与书架操作先写本地 IndexedDB，节流及切后台时静默同步至服务端，并自动预缓存“下一章”正文保障手机弱网体验。
4. **可切换阅读模式与网页直出 EPUB**：阅读器默认采用**上下滚动模式**，支持一键切换为**左右翻页模式**（共享同一 `paragraphIndex` 锚点，切换不丢位置）；作品详情页与阅读器内直接复用 `@acanthis-dec/epub`（Web Worker）在浏览器本地打包下载 `.epub`。

### Non-Goals
- **不做多用户账号注册/登录体系**：本阶段按个人自托管单用户设计，仅提供全局可选 `AUTH_TOKEN` 访问保护。
- **不做客户端挂载多后端实例聚合**：一个客户端实例同一时间对接一个配置的 `api-server` 地址，多书源完全由该服务端挂载的适配器决定。
- **不在本阶段实现 CMP 原生客户端**：但同步协议与 `paragraphIndex` 锚点设计直接保证未来 CMP 客户端零改造接入。

### Anti-Goals
- **禁止以像素高度（`scrollTop`）作为跨端同步基准**：不同屏幕尺寸与未来原生客户端像素高度不可比，必须使用章节内容块序号 `paragraphIndex`（`0-based`）。
- **禁止未经净化的 `v-html` 直出**：所有章节富文本必须先经 `DOMPurify` 严格白名单过滤后再拆块渲染，彻底阻断 XSS。
- **禁止把鉴权 Token 拼入图片查询参数或依赖跨站 Cookie**：分离部署下移动端 Safari（ITP）会拦截跨站 Cookie，URL 带 Token 易泄露至日志；JSON 接口统一走 `Authorization: Bearer <token>`，已入库登记的封面与插图二进制路由保持免 Header 直连以兼容原生 `<img src>` 与浏览器缓存。

## 3. 约束条件（Constraints）

- **工具链适配**：
  - 根 `.gitignore` 当前包含 `*.html` 规则，新建 `apps/web/index.html` 时需在 `.gitignore` 添加 `!apps/web/index.html` 例外；
  - `turbo.json` 的 `build` 与 `check-types` 任务 `inputs` 需补充 `**/*.vue`、`index.html` 与 `vite.config.ts`；
  - **[工程决策] `vue-tsc` 与 `typescript@7.0.2` 兼容**：工作区 `catalog` 当前将 `typescript` 设为 `7.0.2`（原生编译器已移除 `./lib/tsc` 导出），而 `vue-tsc` 依赖传统 TS JS API；因此仅在 `apps/web/package.json` 局部声明 `"typescript": "^5.8.3"` 配合 `vue-tsc --noEmit`（其余包保持 `catalog:` 的 `7.0.2` 不变），并在 `apps/web/tsconfig.json` 中显式覆盖 `"types": ["vite/client"]` 与 `"jsx": "preserve"`。
- **跨步实施基线**：三步按 **第一步（底座） -> 第二步（EPUB 与 CLI） -> 第三步（多源同步与 Web 客户端）** 顺序推进；本设计新增的 `GET /v1/sources` 与可选 `AUTH_TOKEN` 鉴权在实施计划阶段直接前置并入第一步底座任务，CLI 的 `--source <platform>`（默认 `"linovelib"`）与 `--token`（环境变量 `ACANTHIS_API_TOKEN`）直接并入第二步任务，避免跨步返工二次改表或补丁。

## 4. 备选方案权衡（Approaches）

### 4.1 状态与同步架构
| 维度 | 方案 1：本地优先 PWA + 时间戳增量同步（已选定） | 方案 2：纯在线无状态 SPA | 方案 3：WebSocket / SSE 实时长连接同步 |
| --- | --- | --- | --- |
| 手机弱网与锁屏可靠性 | IndexedDB 秒存 + 下一章预取 + `keepalive` 后台刷写，不丢进度 | 弱网切章白屏等待，划走后台易丢最后进度 | 移动端唤醒重连复杂且耗电 |
| 跨端一致性（含未来 CMP） | 基于 `updatedAt`（Last-Write-Wins）+ 软删除墓碑确定性收敛 | 无离线能力 | 对单人阅读属于过度设计 |
| 实现复杂度 | 适中（增加一层轻量 IndexedDB 同步队列） | 最低 | 最高 |

### 4.2 移动端主界面信息架构
经原型对比，选定 **方案 A（经典三栏底导：书架 / 书源·发现 / 设置）**：书架聚焦跨源收藏与顶部“继续阅读”大卡片；发现页通过顶部书源胶囊切换服务端支持的各平台书库与搜索；桌面宽屏自动转为左侧 Navigation Rail。

## 5. 详细设计（Detailed Design）

### 5.1 共享类型与后端扩展（`core` / `storage` / `api-server`）

#### 1) 书源发现与同步共享类型（`@acanthis-dec/core`）
在 `packages/core/src/types.ts` 新增跨端通用模型：
```ts
export type SourceCapability = "search" | "novels" | "illustrations";

export interface NovelSourceDescriptor {
	id: string; // 如 "linovelib"
	name: string; // 如 "哔哩轻小说"
	capabilities: SourceCapability[];
}

export interface BookshelfItem {
	platform: string;
	novelId: string;
	title: string;
	author: string;
	coverUrl: string;
	addedAt: number;
	updatedAt: number;
	deletedAt: number | null; // 非 null 表示已从书架移除（软删除墓碑）
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
	paragraphIndex: number; // 0-based 内容块序号
	totalParagraphs: number;
	deviceLabel: string;
	updatedAt: number;
}
```

#### 2) 同步数据表（`@acanthis-dec/storage`）
在 `packages/storage/src/table.ts` 新增两张表并生成 Drizzle 迁移：
- `bookshelf_items`：`id`（自增主键）、`platform`、`novel_id`、`title`、`author`、`cover_url`、`added_at`、`updated_at`（客户端事件时间）、`server_updated_at`（服务端单调写入游标）、`deleted_at`（可空整数），唯一索引 `UNIQUE(platform, novel_id)`。
- `reading_progress`：`id`（自增主键）、`platform`、`novel_id`、`novel_title`、`cover_url`、`volume_id`、`volume_title`、`chapter_id`、`chapter_title`、`paragraph_index`、`total_paragraphs`、`device_label`、`updated_at`（客户端事件时间）、`server_updated_at`（服务端单调写入游标），唯一索引 `UNIQUE(platform, novel_id)`。

**[工程决策] LWW 新旧比较与离线重放游标分离**：
- **新旧裁决（基于 `updatedAt`）**：客户端上报的 `updatedAt` 在服务端先执行时钟漂移钳制 `effectiveUpdatedAt = Math.min(input.updatedAt, Date.now() + 60_000)`；仅当库中不存在对应 `(platform, novelId)` 记录，或 `effectiveUpdatedAt >= existing.updatedAt` 时更新该行。
- **增量游标（基于 `serverUpdatedAt`）**：每当某行在服务端实际写入或更新时，将其 `server_updated_at` 设为服务端单调递增时间戳 `cursorNow = Math.max(Date.now(), lastCursor + 1)`。`GET /v1/sync/state?since=<cursor>` 按 `server_updated_at > cursor` 过滤并返回新的 `cursor`。这样即使设备 A 离线数小时后重连补推较早 `updatedAt` 的进度，已被服务端采纳的变更仍会获得最新的 `server_updated_at`，确保设备 B 增量拉取时绝不漏同步。

#### 3) 服务端鉴权、多源注册与同步路由（`@acanthis-dec/api-server`）
1. **可选鉴权配置**：
   - `ConfigSchema` 新增 `auth: z.object({ token: z.string().min(1).optional() }).optional()`，映射环境变量 `AUTH_TOKEN`；
   - `cors` 中间件显式配置 `allowHeaders: ["Content-Type", "Authorization"]`、`allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]`；
   - 当配置了 `auth.token` 时，除 `/v1/:platform/cover/*` 与 `/v1/:platform/illustration/*` 二进制图片读取路由外，所有 `/v1/*` JSON 路由均校验 `Authorization: Bearer <token>`（使用 `node:crypto` 的 `timingSafeEqual` 比对），未通过返回 `401` `{ code: 40100, message: "Unauthorized" }`。
2. **新增路由（均采用统一的 `{ code: 0, message: "Success", data: ... }` JSON Envelope，保证 Web 与未来 CMP 客户端契约一致）**：
   - `GET /v1/sources`：`data` 返回服务端当前注册启用的 `NovelSourceDescriptor[]`（初始注册 `linovelib`：`{ id: "linovelib", name: "哔哩轻小说", capabilities: ["search", "novels", "illustrations"] }`）。
   - `GET /v1/sync/state?since=<optional cursor>`：
     - 未传 `since`（或 `since = 0`）时返回全部 `deletedAt IS NULL` 的有效书架项与全部阅读进度；
     - 传入 `since > 0` 时按 `server_updated_at > since` 返回增量书架项（**包含 `deletedAt != null` 的墓碑项**，以便其他设备同步删除本地收藏）与增量阅读进度，并在 `data` 中附带最新游标 `cursor: number`；
     - 返回前将书架与进度中的 `coverUrl` 统一规范化为 `${host}/v1/${platform}/cover/novel/${novelId}`。
   - `POST /v1/sync/state`：接收 `{ bookshelf?: BookshelfItem[], progress?: ReadingProgress[] }`，在单个事务内按 Last-Write-Wins 批量合并入库；`data` 仅返回**本次请求所提交 `(platform, novelId)` 键对应的合并后权威记录** `{ bookshelf: BookshelfItem[], progress: ReadingProgress[], serverTime: number }`，避免高频防抖上报时每次回传全表数据。

### 5.2 前端应用架构（`apps/web` — `@acanthis-dec/web`）

#### 1) 路由与页面职责
- `/`（**书架页 `BookshelfView`**）：
  - 顶部“继续阅读”主卡片：取全量 `reading_progress` 中 `updatedAt` 最大的一条，展示封面、书名、书源角标、卷章名、段落百分比及 `deviceLabel`（如 `手机端 · 10 分钟前`），点击直达对应章节与段落；
  - 收藏网格：展示所有 `deletedAt === null` 的书架项，左上角带书源短名徽标，支持按“最近阅读 / 最近添加”切换排序及长按/菜单移除收藏。
- `/explore`（**发现与书源页 `ExploreView`**）：
  - 顶部渲染 `/v1/sources` 返回的书源切换胶囊（记住上次选中的 `platform`）；
  - 未搜索时默认分页加载当前书源的已缓存书库 `GET /v1/:platform/novels?page=...`；
  - 搜索框触发 `GET /v1/:platform/search?keyword=...`，内置加载等待提示（说明源站可能需要数秒过验证码）与请求取消控制（`AbortController`）。
- `/novel/:platform/:novelId`（**作品详情页 `NovelDetailView`**）：
  - 展示作品元数据、加入/移出书架切换按钮、“开始阅读 / 续读至第 X 章”主按钮；
  - 分卷折叠列表：展示分卷封面与章节列表，`id` 以 `"TOBEDETERMINED"` 开头的未决章节置灰禁用并标注“源站暂未公开链接”；
  - **浏览器内导出 EPUB**：支持单卷旁点击“导出本卷 EPUB”或顶部“批量选卷/整书导出”，在独立 **Web Worker** 中拉取缺失章节/插图并调用 `@acanthis-dec/epub` 生成 `.epub` 触发浏览器下载，主线程展示进度条不卡顿。
- `/read/:platform/:novelId/:chapterId`（**沉浸式阅读页 `ReaderView`**）：
  - 详见 5.2.2 阅读器引擎设计。
- `/settings`（**设置页 `SettingsView`**）：
  - 服务端配置：`API Base URL`（默认读取构建环境变量 `import.meta.env.VITE_DEFAULT_API_BASE_URL || "http://localhost:5301"`）与可选 `Access Token` 输入框，提供“测试连接”按钮（请求 `GET /v1/sources` 验证连通性与鉴权）；
  - 阅读外观全局默认值、手动立即同步按钮、离线章节缓存统计与一键清空。
  - 若首次打开应用且未配置有效后端（请求失败或 `401`），在书架/发现页展示温和引导卡片跳转 `/settings`。

#### 2) 阅读器引擎与双模式切换细节
1. **安全净化与内容分块（`parseChapterBlocks`）**：
   - 先使用 `DOMPurify.sanitize` 执行严格标签/属性白名单清洗（仅保留 `h1-h6, p, img, br, hr, ruby, rt, rp, span, em, strong, b, i`，剥离一切事件处理器与脚本）；
   - 将净化后的 DOM 顶层子节点拆解为有序数组 `ReaderBlock[]`（标题块、段落 HTML 块、插图块），对所有图片 URL 执行与 CLI 相同的 **`apiBaseUrl` 媒体重定基**（将 `/v1/...` 路径重写到当前配置的 `apiBaseUrl` 域名下），并为每个块绑定 `0-based` 的 `blockIndex`。
2. **上下滚动模式（`mode = "scroll"`，默认）**：
   - 单栏流式渲染 `ReaderBlock[]`，底部提供“上一章 / 目录 / 下一章”操作栏；
   - 使用 `IntersectionObserver`（或滚动节流计算视口上 1/4 基准线命中的 `[data-block-index]`）实时更新当前 `paragraphIndex`。
3. **左右翻页模式（`mode = "paginated"`，可随时切换）**：
   - 在固定视口高度容器内使用 CSS 多栏布局（`column-width` + `column-gap` + `break-inside: avoid` 防止插图跨页裂开），通过水平偏移切换页码；
   - 点击屏幕左 1/3 上一页、右 1/3 下一页、中间 1/3 唤出/收起控制菜单，支持移动端左右触摸滑动（Swipe）与桌面端键盘方向键翻页；
   - 翻页后计算当前页首个可见 `[data-block-index]` 更新 `paragraphIndex`；**从滚动切到翻页或从翻页切回滚动时，均直接根据当前 `paragraphIndex` 反查对应 DOM 节点立即对齐位置**。
4. **下一章静默预取**：进入某章阅读稳定 1.5 秒后，根据本地缓存目录定位紧邻下一章（非 `TOBEDETERMINED*`），若 IndexedDB 尚未缓存则静默请求并存入本地 `cachedChapters`。

#### 3) 本地优先存储与同步状态机（IndexedDB + Pinia）
IndexedDB 库 `acanthis-web` 包含 5 个 Object Store：
- `bookshelf`（主键 `${platform}:${novelId}`）
- `progress`（主键 `${platform}:${novelId}`）
- `dirtyQueue`（记录待推送的本地变更键，离线或请求失败时保留，网络恢复后自动重推）
- `novels`（作品目录元数据缓存）
- `chapters`（章节正文缓存，带 LRU / 容量上限清理策略，默认最多保留最近阅读的 200 章正文避免撑爆手机存储）

**同步触发时机**：
1. 应用冷启动及每次从后台切回前台（`document.visibilityState === "visible"`）时：携带上次成功的 `lastSyncServerTime` 调用 `GET /v1/sync/state?since=...` 拉取增量，若有待推送的 `dirtyQueue` 先调用 `POST /v1/sync/state` 合并。
2. 阅读位置变动时：立即更新内存与 IndexedDB；防抖 2 秒后调用 `POST /v1/sync/state`；切章或触发 `visibilitychange -> hidden` / `pagehide` 时，使用 `fetch(..., { keepalive: true })` 立即刷写最新进度（携带 `Authorization` Header，解决移动端直接划走标签页丢进度的问题）。
3. **跨设备进度跳转体验**：打开阅读器时若拉取到的远端进度更新时间晚于本地：
   - 若远端仍在同一章但段落不同（差值 ≥ 3 段）：直接平滑定位至远端段落并弹出轻量 Toast `已同步至上次阅读位置`；
   - 若远端在不同章节：不强行打断当前页面，底部浮现提示条 `其他设备（${deviceLabel}）已读到「${chapterTitle}」，是否跳转？`。

#### 4) 多形态开源构建与分发体系（Pages 平台 + GitHub Release 静态包 + Docker 镜像）

为同时满足作者自用的**阿里云 ESA（函数和 Pages）**托管与其他开源用户的多样化自托管需求，提供三套开箱即用的交付通道：

1. **Git 直连静态托管平台（阿里云 ESA / Cloudflare Pages / Vercel）**：
   - **过滤安装构建策略**：Monorepo 根部存在后端专用的原生编译依赖（`isolated-vm`、`better-sqlite3`、`onnxruntime-node`、`koffi`）；静态平台统一使用 `pnpm install --filter=@acanthis-dec/web... --frozen-lockfile` 与 `pnpm --filter=@acanthis-dec/web... run build`，仅安装并按拓扑顺序构建 `@acanthis-dec/core`、`@acanthis-dec/epub` 与 `@acanthis-dec/web`。
   - **阿里云 ESA 原生配置（仓库根目录 `esa.jsonc`）**：
     ```jsonc
     {
     	"name": "acanthis-web",
     	"installCommand": "pnpm install --filter=@acanthis-dec/web... --frozen-lockfile",
     	"buildCommand": "pnpm --filter=@acanthis-dec/web... run build",
     	"assets": {
     		"directory": "./apps/web/dist",
     		"notFoundStrategy": "singlePageApplication"
     	}
     }
     ```
     利用 `notFoundStrategy: "singlePageApplication"` 让边缘节点对未命中物理文件的浏览器导航请求自动返回 `200 OK` 与 `index.html`，无缝支持 Vue Router History 模式。
   - **Cloudflare Pages / Netlify / Vercel 兼容**：在 `apps/web/public/_redirects` 内置 `/* /index.html 200`，并在 `apps/web/vercel.json` 提供等效 SPA rewrite 规则。

2. **运行时环境变量注入机制（免重编译配置默认后端地址）**：
   - 默认服务端地址按以下优先级解析：用户在 `/settings` 手动保存的 `localStorage` 值 > `window.__ACANTHIS_CONFIG__?.defaultApiBaseUrl`（由 `public/config.js` 提供，默认为空占位对象） > 构建期 `import.meta.env.VITE_DEFAULT_API_BASE_URL` > `"http://localhost:5301"`。
   - 这样无论是 Pages 构建期注入 `VITE_DEFAULT_API_BASE_URL`，还是 Docker 容器启动期动态生成 `/usr/share/nginx/html/config.js`，均可免改代码预设默认 `api-server` 地址。

3. **预构建静态归档与容器镜像工作流（`apps/web/Dockerfile` & `.github/workflows/web-release.yml`）**：
   - **`apps/web/Dockerfile`**：多阶段构建，构建阶段执行 `--filter=@acanthis-dec/web...` 过滤安装与打包；运行阶段基于 `nginx:alpine`，内置 SPA `try_files $uri $uri/ /index.html;` 路由回退、静态带哈希资源长缓存头，以及启动时读取环境变量 `DEFAULT_API_BASE_URL` 写入 `config.js` 的轻量脚本（无原生 C++ 依赖，支持 `linux/amd64` 与 `linux/arm64` 双架构）。
   - **`.github/workflows/web-release.yml`**（监听 `@acanthis-dec/web@*` Git Tag 与 `workflow_dispatch`）：
     1. 构建静态产物并打包为 `acanthis-web-v${VERSION}-dist.zip` 与 `SHA256SUMS.txt` 上传至对应 GitHub Release，方便宿主机 Nginx / Caddy / 面板用户免装 Node 直接下载解压部署；
     2. 构建多架构 Docker 镜像推送至 `ghcr.io/constasj/acanthis-web` 与 Docker Hub `constasj0721/acanthis-web`。
   - **CI 持续集成更新（`.github/workflows/ci.yml`）**：在 `changes` 过滤器中补充 `apps/web/**` 与 `esa.jsonc`，由 `quality` 任务自动执行 Lint、`vue-tsc` 类型检查与构建验证（并可按相同模式在 `master` 变更时推送 `ghcr.io/constasj/acanthis-web:canary` 镜像）。

## 6. 留给实施阶段自行决定的细节（Left to the Builder）

- 具体配色色板数值（亮色、羊皮纸护眼色、OLED 纯黑深色三套 CSS 变量值）与图标库选型（推荐纯按需 Tree-shaking 的 `lucide-vue-next` 或 `@iconify/vue`）。
- Web Worker 导出 EPUB 时的消息通信协议细节及并发拉图数量（建议复用 CLI 的 `concurrency = 4`）。
- `deviceLabel` 的默认生成文案（例如根据 `navigator.userAgent` 简明归类为 `iOS Web` / `Android Web` / `Desktop Web`，并允许在设置页自定义设备备注名）。
