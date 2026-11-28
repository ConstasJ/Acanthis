# @acanthis-dec/api-server

## 1.5.0

### Minor Changes

- d93ed34: 支持 KOReader（KO1）按卷 EPUB 异步打包、墨水屏图片瘦身与三端段落级阅读进度同步：
  
  - 跨端 `DeviceKind` 枚举新增 `"ereader"`，同步更新核心类型、SQLite 读写归一化、OpenAPI 契约与 Web 端电纸书图标/标签展示。
  - `@acanthis-dec/epub` 新增可选 `syncMetadata`，支持在合成章节标题前写入与 `chapterParser.ts` 对齐的 `id="b<N>"` 段落锚点及 `OEBPS/acanthis-manifest.json` 同步清单。
  - `@acanthis-dec/api-server` 新增 `/v1/linovelib/epub` 按卷异步构建、进度查询、批量/单卷状态检测与 `ETag`/`304` 流式下载接口，支持磁盘指纹 LRU 缓存、`GET /v1/linovelib/novel/:novelId?cachedOnly=true` 及基于 `sharp` 的 `profile=eink` 单通道灰度图片瘦身，并同步更新 `Dockerfile.runtime`。

### Patch Changes

- Updated dependencies [d93ed34]
  - @acanthis-dec/core@1.5.0
  - @acanthis-dec/epub@0.2.0
  - @acanthis-dec/storage@1.3.0
  - @acanthis-dec/linovelib@1.4.7

## 1.4.4

### Patch Changes

- Updated dependencies [d4cebf0]
  - @acanthis-dec/linovelib@1.4.6

## 1.4.3

### Patch Changes

- b2c6329: 阅读进度同步新增 `deviceKind`（`desktop` / `mobile` / `unknown`）设备种类字段与数据库迁移，Web 端历史记录、继续阅读与跨设备进度提示按设备操作系统种类显示 PC 或移动设备图标。
- Updated dependencies [b2c6329]
  - @acanthis-dec/core@1.4.1
  - @acanthis-dec/storage@1.2.2
  - @acanthis-dec/linovelib@1.4.5

## 1.4.2

### Patch Changes

- 68499b1: 修复 `api-server` 使用 esbuild 单文件打包动态导入 `impers` 时丢失顶层 `await` 导致运行时报错 `this.impers.Session is not a constructor` 的问题。

## 1.4.1

### Patch Changes

- bd1db4a: 增强搜索链路容错与去重并补充全链路可观测 debug 日志：
  
  - `@acanthis-dec/api-server`：将 `SearchRateLimitError` / `SearchVerificationError` 映射为 `503 + Retry-After`；为 `/v1/linovelib/search` 增加 `keyword` `trim()` 归一化、同关键词 single-flight 并发合并与 2 分钟空结果内存负缓存；为 `MemoryTtlCache`（`/home`、`/rankings`、`/catalog`）、`/search`、`/novel`、`/chapter`、`/cover`、带 query 的 HTTP 请求以及服务启动生效配置摘要补充 `debug` 日志。
  - `@acanthis-dec/linovelib`：将 `logger` 注入 `BrowserFetchClient`、`SearchSession`、登录会话与章节解扰链路；加固搜索翻页上限（15 页）、防死循环保护、瞬断重试与验证码提交后的限流页检测；导出 `SearchRateLimitError` 与 `SearchVerificationError`。
  - `@acanthis-dec/browser-fetch`：支持通过 `BrowserFetchClientOptions.logger` 注入可选 logger，记录上游请求耗时/状态、Cloudflare 验证页检测、FlareSolverr 求解耗时与响应复用以及 `pRetry` 重试信息。
- Updated dependencies [bd1db4a]
  - @acanthis-dec/linovelib@1.4.4
  - @acanthis-dec/storage@1.2.1

## 1.4.0

### Minor Changes

- 70f4f56: 新增图书馆阅读历史、多对多自定义多书架与元数据标签筛选能力：
  - **阅读历史（LNReader 风格）**：扩展同步协议 `ReadingProgress.historyHiddenAt`（独立 max-wins 合并），Web 端新增「历史」一级导航与历史记录页，支持按自然日分组、实时搜索、一键继续阅读、单条删除与二次确认清空并跨端同步。
  - **多对多自定义多书架**：新增 `bookshelf_categories` 表与同步实体，支持自定义书架的新建、重命名、排序与软删除（不删书、自动回落「默认」），支持一本书同时归属多个书架。
  - **元数据标签与状态筛选**：书架条目同步补全 `genres` 与 `status` 快照支持离线组合筛选；新增 `GET /v1/linovelib/genres` 并扩展 `GET /v1/linovelib/novels` 支持 `genres`（AND 交集）、`status`、`q` 筛选；作品详情页标签支持点击跳转书架筛选并可直达服务器缓存查看。

### Patch Changes

- Updated dependencies [70f4f56]
  - @acanthis-dec/core@1.4.0
  - @acanthis-dec/storage@1.2.0
  - @acanthis-dec/linovelib@1.4.3

## 1.3.2

### Patch Changes

- db77e76: 修复 Scalar 文档页面 Server 栏显示 `..` 且请求拼接出 `/../v1/` 的问题：将静态契约 `servers` 恢复为 `/`，并在运行时 `GET /v1/openapi.json` 中通过 `resolveHost` 动态填充完整对外访问地址（兼容子目录反代）。

## 1.3.1

### Patch Changes

- c613bb1: 修复 API Server 反向代理部署在子目录时 Scalar 文档页无法拉取 OpenAPI Spec 及在线调试丢失子目录前缀的问题（将 `scalarConfig.url` 改为 `./openapi.json`，`servers[0].url` 改为 `..`）。

## 1.3.0

### Minor Changes

- 3af0894: 新增 OpenAPI 3.1 契约端点（`/v1/openapi.json`）、Scalar 交互式文档页面（`/v1/docs`）、`docs.enabled` / `DOCS_ENABLED` 文档开关，以及离线契约生成与防漂移校验脚本；同时将 `@acanthis-dec/browser-fetch` 的 `impers` 改为首次请求时延迟加载，消除顶层导入原生库与网络下载副作用。

### Patch Changes

- 5754b17: 为 api-server Docker 镜像添加基于 `/v1/health` 的 `HEALTHCHECK`，使用内置 Node `fetch` 探活并自动适配 `PORT` 与 `LISTEN_HOST` 环境变量。
- 51e3cc7: 请求日志中间件跳过 `/v1/health` 路径，避免容器健康检查探针周期性刷屏日志。
- @acanthis-dec/linovelib@1.4.2
  - @acanthis-dec/storage@1.1.5

## 1.2.1

### Patch Changes

- @acanthis-dec/linovelib@1.4.1
  - @acanthis-dec/storage@1.1.4

## 1.2.0

### Minor Changes

- e33a4c1: 新增桌面端源站发现能力（全站首页、16 个出版社文库专题、13 个排行榜含完本榜与 7 维书库筛选），并升级 Web 端发现页为 Schema 驱动的四视图浏览体验。

### Patch Changes

- Updated dependencies [e33a4c1]
  - @acanthis-dec/core@1.3.0
  - @acanthis-dec/linovelib@1.4.0
  - @acanthis-dec/storage@1.1.3

## 1.1.3

### Patch Changes

- a7db5c2: 为 API Server 新增免鉴权健康检查端点 `/v1/health`，并为 Web 入口页补充标准页面描述 meta 标签。

## 1.1.2

### Patch Changes

- 986b128: 修复插图与封面回源请求在传输停滞时长时间卡死队列的问题：修正 `ImpersTransport` 向 `impers` 传递 `timeout`/`connectTimeout` 的毫秒与秒单位错配（原会导致超时被放大 1000 倍至 8.33 小时），补充 `TCP_KEEPALIVE`、低速停滞检测、JS 兜底超时、损坏会话回收与瞬态 `CurlError` 映射，加固 `FlareSolverrClient` 请求超时；为 `NovelMediaQueue` 补充显式超时、网络重试上限与全生命周期调试日志；在 API Server 中将上游 `NetworkError` 映射为 `502`/`504`（带 `Cache-Control: no-store`）并补充插图回源调试日志
- 370745e: 拆分 api-server 运行时基础镜像、精简原生依赖与 libcurl-impersonate 产物，并启用 zstd 镜像层压缩与共享构建缓存，大幅降低每次拉取新版本镜像的增量下载体积。
- Updated dependencies [986b128]
  - @acanthis-dec/linovelib@1.3.2
  - @acanthis-dec/storage@1.1.2

## 1.1.1

### Patch Changes

- 6716664: 完善插图与封面抓取链路的 Cloudflare 拦截处理：`browser-fetch` 在未启用 FlareSolverr 或重复挑战时统一抛出 `CloudflareBlockError`；`linovelib` 新增 `NovelMediaQueue` 提供串行限速、共享冷却、同 URL 去重、标准图片请求头及 Cloudflare 阶梯退避重试并合并并发会话校验；`api-server` 为 `/illustration/:hash` 增加单飞缓存合并并将 `CloudflareBlockError`/`FlareSolverrError`/`404`/`5xx` 映射为带 `Cache-Control: no-store` 与 `Retry-After` 的规范 HTTP 状态码
- Updated dependencies [6716664]
  - @acanthis-dec/linovelib@1.3.1
  - @acanthis-dec/storage@1.1.1

## 1.1.0

### Minor Changes

- 125e219: 新增跨设备书架与阅读进度同步底座：补充 `BookshelfItem` 与 `ReadingProgress` 共享类型、SQLite 同步数据表与 Drizzle 增量迁移、基于客户端 `updatedAt` 时钟钳制 LWW 与服务端单调游标 `serverUpdatedAt` 的软删除合并逻辑，以及受鉴权保护的 `GET/POST /v1/sync/state` 接口
- 125e219: 补齐多端底座能力：新增书源能力描述与 `/v1/sources` 发现接口、CORS 与可选 `AUTH_TOKEN` Bearer 鉴权、章节插图提取重写与封闭式磁盘缓存代理 `/v1/linovelib/illustration/:hash`、书库分页 `/v1/linovelib/novels`、章节直链 `?novelId=` 兜底、目录隐藏章节 ID 双向推导与事务残留清理，并修复已缓存作品离线降级与冷库迁移初始化竞态问题

### Patch Changes

- Updated dependencies [125e219]
- Updated dependencies [125e219]
  - @acanthis-dec/core@1.2.0
  - @acanthis-dec/storage@1.1.0
  - @acanthis-dec/linovelib@1.3.0

## 1.0.9

### Patch Changes

- Updated dependencies [6c2a0e8]
  - @acanthis-dec/linovelib@1.2.0
  - @acanthis-dec/storage@1.0.8

## 1.0.8

### Patch Changes

- Updated dependencies [99cbf29]
  - @acanthis-dec/linovelib@1.1.2

## 1.0.7

### Patch Changes

- Updated dependencies [19203d3]
- Updated dependencies [8654d2b]
  - @acanthis-dec/linovelib@1.1.1
  - @acanthis-dec/storage@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [31e0ddb]
- Updated dependencies [8949718]
  - @acanthis-dec/linovelib@1.1.0
  - @acanthis-dec/core@1.1.0
  - @acanthis-dec/storage@1.0.6

## 1.0.5

### Patch Changes

- 7c60833: 新增了 Chrome 150 的 porfile，同时重构了 profile 体系
- Updated dependencies [7c60833]
  - @acanthis-dec/linovelib@1.0.5
  - @acanthis-dec/storage@1.0.5

## 1.0.4

### Patch Changes

- 3dfabee: 针对 api-server 的设置和输出格式进行调整，确保正常工作
- Updated dependencies [07ff2b5]
- Updated dependencies [1e4b6f1]
  - @acanthis-dec/linovelib@1.0.4
  - @acanthis-dec/storage@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [27ddae6]
  - @acanthis-dec/storage@1.0.3
  - @acanthis-dec/linovelib@1.0.3

## 1.0.2

### Patch Changes

- a63414f: 调整/linovelib/cover/novel 的行为，现在它可以直接从上游获取封面 URL 了
- Updated dependencies [3901772]
- Updated dependencies [51130dc]
  - @acanthis-dec/linovelib@1.0.2
  - @acanthis-dec/core@1.0.2
  - @acanthis-dec/storage@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies
  - @acanthis-dec/core@1.0.1
  - @acanthis-dec/linovelib@1.0.1
  - @acanthis-dec/storage@1.0.1

## 1.0.0

### Major Changes

- 初次发版，基本完成了首次重构，真不容易

### Patch Changes

- Updated dependencies
  - @acanthis-dec/core@1.0.0
  - @acanthis-dec/linovelib@1.0.0
  - @acanthis-dec/storage@1.0.0
