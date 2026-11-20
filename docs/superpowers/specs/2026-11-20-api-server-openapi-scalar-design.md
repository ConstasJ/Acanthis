# API Server OpenAPI 契约文档与 Scalar 页面设计

- **日期**：2026-11-20
- **范围**：`apps/api-server`
- **状态**：待审阅

## 1. 意图与背景

为 `@acanthis-dec/api-server` 补齐一份准确、完整的 **OpenAPI 3.1 契约文档**，并在服务上挂载 **Scalar 交互式 API 文档页面**，同时支持离线生成仓库内静态 `openapi.json`。

**核心受众**：Acanthis 客户端开发者及其 AI Agent，用于理解接口语义、对接鉴权与缓存行为、生成客户端类型/请求代码以及在线调试接口。

## 2. 目标、非目标与反目标

### 目标
- **完整覆盖现有 15 个 `/v1` 业务接口**：包含路径参数、查询参数（含枚举值与默认值）、请求体、成功响应体、双输出风格（`style=acanthis | lnreader`）、二进制图片响应、业务错误码（`10000`–`40100`）以及关键响应头（`Cache-Control`、`Retry-After`）。
- **代码即契约（Single Source of Truth）**：请求校验与 OpenAPI 参数定义共用同一份 Zod v4 Schema，路由元数据紧贴路由定义，降低后续迭代中的文档漂移风险。
- **开箱即用的在线文档与调试**：挂载 Scalar 页面，在启用 `AUTH_TOKEN` 时公开展示契约，支持开发者在页面中填入 Bearer Token 调试受保护接口。
- **离线可读的静态契约**：提供 `openapi:generate` 脚本并在 `apps/api-server/openapi.json` 生成静态文档，客户端开发者及 Agent 无需启动数据库或爬虫依赖即可直接查阅。

### 非目标
- 不修改现有任何业务接口的路径、状态码或 JSON 响应结构（遵守既有 API 契约；包括当前两处返回 `{ error: string }` 的 404 响应，文档应如实记录而非擅自变更）。
- 不搭建独立的文档站点、不引入前端构建管线，也不内置离线打包的 Scalar JS 静态资源（保持 `@scalar/hono-api-reference` 默认轻量 HTML 渲染）。
- 不修改 `Dockerfile` 或 `Dockerfile.runtime` 的镜像层结构。

### 反目标
- **契约漂移**：禁止维护一份与 Zod 路由校验脱节的手写 YAML/JSON。
- **离线脚本产生运行时副作用**：执行 `openapi:generate` 时不得初始化 SQLite 数据库、迁移、文件日志、`LinovelibClient` 或监听端口。
- **破坏单文件打包**：新增依赖必须能正常被 `apps/api-server/build.ts` 的 esbuild 打包进 `dist/index.js`，无需额外复制静态文件到生产镜像。

## 3. 约束条件

1. **技术栈**：Hono `^4.13.19`、Zod `^4.6.7`、TypeScript 严格模式（含 `exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`）。
2. **构建与部署**：`apps/api-server/build.ts` 使用 esbuild 将 `src/index.ts` 打包为单个 `dist/index.js`；`Dockerfile` 生产阶段仅复制 `packages/storage/migrations` 和 `dist/index.js`。
3. **鉴权现状**：当 `config.auth?.token` 存在时，`createAuthMiddleware` 拦截其后挂载的所有路由（仅放行 `OPTIONS` 及 `GET /v1/:platform/(cover|illustration)/*`）。`GET /v1/health` 挂载在鉴权中间件之前。

## 4. 方案对比与选型

前期已排除以下两类方案：
- **`@hono/zod-openapi`**：依赖 Zod v3 生态内部结构，与项目当前 Zod v4 存在类型和运行时摩擦，且需侵入式替换为 `OpenAPIHono` + `createRoute`。
- **纯手写静态 `openapi.yaml`/`openapi.json`**：极易随路由迭代漂移，违背面向客户端开发者与 Agent 的可靠性目标。

剩余两个可行方案均搭配 `@scalar/hono-api-reference`：

| 方案 | 做法 | 优点 | 权衡 |
|---|---|---|---|
| **方案 A：`hono-openapi` 路由级代码即契约（已选定）** | 引入 `hono-openapi` + `@scalar/hono-api-reference`，在现有路由旁挂载 `describeRoute()`，并将 `@hono/zod-validator` 替换为 `hono-openapi` 的 `validator()`（原生支持 Zod v4 Standard Schema）；运行时通过 `openAPIRouteHandler` 暴露 `/v1/openapi.json`，离线脚本通过 `generateSpecs(app)` 导出 `apps/api-server/openapi.json`。 | 路由与契约强绑定；请求校验与文档共用同一份 Zod Schema；天然支持离线静态导出；符合 `apps/api-server/AGENTS.md` 规范。 | 需小幅调整 4 个路由文件的中间件签名并新增两个轻量依赖。 |
| **方案 B：Zod v4 原生 `z.toJSONSchema()` + 集中式 OpenAPI 组装** | 保留 `@hono/zod-validator` 不动，新增 `src/openapi.ts` 手动用 `z.toJSONSchema()` 组装完整 OpenAPI 3.1 对象。 | 零 OpenAPI 中间件依赖，对现有路由零侵入，结构完全手控。 | 路由定义与文档定义分离，后续增改接口容易漏同步。 |

**选定结果**：采用 **方案 A**，并配备 `openapi:generate` 脚本生成仓库内静态 `apps/api-server/openapi.json`。

## 5. 详细设计

### 5.1 路由挂载与访问控制

- **挂载路径**（复用现有 `/v1` basePath）：
  - `GET /v1/openapi.json`：返回 OpenAPI 3.1 JSON 契约文档。
  - `GET /v1/docs`：挂载 `@scalar/hono-api-reference` 渲染 Scalar 交互式文档页面，指向 `/v1/openapi.json`。
- **鉴权策略**：上述两个路由与 `/v1/health` 一样注册在 `createAuthMiddleware` **之前**，因此即使配置了 `AUTH_TOKEN`，契约与文档页也保持**公开可访问**，方便开发者和 Agent 直接拉取契约并在 Scalar 页面中填写 Bearer Token 调试受保护接口。
- **配置开关**：在 `src/config.ts` 的 `ConfigSchema` 中新增：
  ```ts
  docs: z
    .object({
      enabled: z.boolean().default(true).describe("是否启用 OpenAPI 与 Scalar 文档路由"),
    })
    .default({ enabled: true })
    .describe("API 文档配置"),
  ```
  同时支持环境变量 `DOCS_ENABLED`（`"false"` 关闭，默认启用）和 `config.yaml` 的 `docs.enabled` 配置。当 `docs.enabled === false` 时，不注册 `/v1/openapi.json` 和 `/v1/docs`。

### 5.2 应用工厂解耦（支持无副作用离线导出）

当前 `src/index.ts`、`src/linovelib.ts`、`src/sync.ts`、`src/middleware.ts` 在模块顶层直接 import `src/services.ts`（会立即创建 `StorageService`、运行 SQLite 迁移并初始化 `LinovelibClient`），导致无法安全地在离线脚本中构造 Hono `app`。

改造方式：
1. 新增 `src/app.ts`，导出 `createApp(deps: AppDeps)`，负责装配 `/v1` `Hono` 实例、中间件、文档路由（条件挂载）以及业务子路由。
2. 将 `src/linovelib.ts` 和 `src/sync.ts` 改为工厂函数（`createLinovelibRoutes(deps)`、`createSyncRoutes(deps)`），`src/sources.ts` 导出 `createSourcesRoutes()`，路由处理函数通过闭包参数访问 `storageService`、`linovelibClient`、`logger` 和 `host`，不再在模块顶层 import `src/services.ts`。
3. `src/middleware.ts` 的 `loggerMiddleware` 改为 `createLoggerMiddleware(logger)`。
4. `src/index.ts` 保持作为唯一运行时入口：加载 `config` 与 `services`，调用 `createApp(...)`，启动 `@hono/node-server` 并注册退出信号处理。
5. 新增离线生成脚本 `scripts/generate-openapi.ts`：使用不含真实 I/O 的占位 `deps` 调用 `createApp(...)`，通过 `hono-openapi` 的 `generateSpecs(app, openApiDocumentation)` 生成 OpenAPI 3.1 JSON 并写入 `apps/api-server/openapi.json`。

> **注意**：`src/linovelib.ts` 仍会从 `@acanthis-dec/linovelib` 导入枚举常量（`LINOVELIB_CHANNEL_IDS` 等）与工具函数；实现时需确认静态导入路径不会触发 `onnxruntime-node` 或 `libcurl` 的顶层加载，如有顶层副作用则从纯常量入口导入或做轻量解耦。

### 5.3 OpenAPI 3.1 契约规范与覆盖清单

#### 顶层文档信息
- `openapi`: `"3.1.0"`
- `info`:
  - `title`: `"Acanthis API Server"`
  - `version`: 独立维护的 API 契约版本常量（初始 `"1.0.0"`，随 `/v1` 契约演进手动调整；**不绑定 `apps/api-server/package.json` 的 `version`**，以避免破坏 `.github/scripts/api-server-build-hash.mjs` 与 `crane mutate` 的 Docker 零重建晋升机制及 Changesets 发版流程 — *架构决策*）
  - `description`: 面向客户端开发者与 Agent 的简明接入说明（包含 `/v1` 前缀、统一响应信封 `{ code, message, data }`、Bearer Token 鉴权规则、封面/插图公开访问规则、`style=acanthis|lnreader` 差异、Cloudflare/上游限流 `503` + `Retry-After` 重试语义）。
- `servers`: 默认包含 `[{ url: "/", description: "Current server" }]`（运行时或离线生成均保持相对根路径，方便客户端/Scalar 直接对当前部署域名发请求；路径保留 `/v1/...` 完整前缀）。
- `components.securitySchemes`:
  - `bearerAuth`: `{ type: "http", scheme: "bearer", description: "当服务端配置 AUTH_TOKEN 时必填；/v1/health、/v1/openapi.json、/v1/docs 及封面/插图 GET 接口无需鉴权" }`
- `tags`:
  - `System`：健康检查与服务状态
  - `Sources`：已接入小说源及其能力声明
  - `Linovelib`：哔哩轻小说探索、检索、详情、章节与媒体代理
  - `Sync`：跨端书架与阅读进度同步

#### 全量 15 个接口清单与关键契约细节

| Tag | Method & Path | 鉴权 | 关键参数 / 请求体 | 关键响应与特殊说明 |
|---|---|---|---|---|
| System | `GET /v1/health` | 公开 | 无 | `200`: `{ status: "ok", timestamp: string (date-time) }` |
| Sources | `GET /v1/sources` | Bearer（可选） | 无 | `200`: 信封包裹 `NovelSourceDescriptor[]` |
| Sync | `GET /v1/sync/state` | Bearer（可选） | Query: `since?` (int >= 0, 毫秒时间戳) | `200`: 信封包裹 `{ bookshelf, progress, cursor }`；`400`/`401`/`500` |
| Sync | `POST /v1/sync/state` | Bearer（可选） | JSON: `{ bookshelf?, progress? }` | `200`: 信封包裹 `{ bookshelf, progress, serverTime }`；`400`/`401`/`500` |
| Linovelib | `GET /v1/linovelib/explore/schema` | Bearer（可选） | 无 | `200`: 信封包裹 `ExploreSchema`（含 `Cache-Control: public, max-age=3600`） |
| Linovelib | `GET /v1/linovelib/home` | Bearer（可选） | Query: `channel`（枚举 `LINOVELIB_CHANNEL_IDS`，默认 `"home"`） | `200`: 信封包裹 `ExploreHomeData` |
| Linovelib | `GET /v1/linovelib/rankings` | Bearer（可选） | Query: `rank`（枚举）, `full`（boolean/0/1，默认 `false`）, `page`（int >= 1，默认 `1`）, `style?` | `200`: 信封包裹 `ExplorePage`（`acanthis`）或 `LNReaderNovelItem[]`（`lnreader`） |
| Linovelib | `GET /v1/linovelib/catalog` | Bearer（可选） | Query: `sort`, `region`, `tag`, `progress`, `anime`, `words`, `updated`, `page`, `style?` | `200`: 信封包裹 `ExplorePage`（`acanthis`）或 `LNReaderNovelItem[]`（`lnreader`） |
| Linovelib | `GET /v1/linovelib/search` | Bearer（可选） | Query: `keyword`（必填）, `style?` | `200`: 信封包裹 `NovelSearchResult[]`（`acanthis`）或 `LNReaderNovelItem[]`（`lnreader`） |
| Linovelib | `GET /v1/linovelib/novels` | Bearer（可选） | Query: `page`（默认 1）, `pageSize`（1–100，默认 20）, `style?` | `200`: 信封包裹分页 `{ items: NovelInfo[] \| LNReaderNovelItem[], total, page, pageSize }` |
| Linovelib | `GET /v1/linovelib/novel/:novelId` | Bearer（可选） | Path: `novelId`; Query: `style?` | `200`: 信封包裹 `Novel`（`acanthis`）或 `LNReaderNovel`（`lnreader`）；`404`: `{ error: "Novel not found" }` |
| Linovelib | `GET /v1/linovelib/chapter/:chapterId` | Bearer（可选） | Path: `chapterId`; Query: `novelId?`（用于未命中缓存时的回源兜底） | `200`: 信封包裹 `{ content: string }`（HTML，插图 URL 已重写为代理路径）；`404`: `code: 10000` / `10002` 或 `{ error: "Chapter not found" }` |
| Linovelib | `GET /v1/linovelib/cover/novel/:novelId` | 公开 | Path: `novelId` | `200`: `image/*` 二进制流（`Cache-Control: public, max-age=86400`）；`404`: `code: 10001` |
| Linovelib | `GET /v1/linovelib/cover/volume/:volumeId` | 公开 | Path: `volumeId` | `200`: `image/*` 二进制流（`Cache-Control: public, max-age=86400`）；`404`: `code: 10001` |
| Linovelib | `GET /v1/linovelib/illustration/:hash` | 公开 | Path: `hash`（32 位十六进制 MD5） | `200`: `image/*` 二进制流（`Cache-Control: public, max-age=86400`）；`404`: `code: 10003` |

#### 通用错误响应建模
- `400 Bad Request`：参数校验失败（由 `validator` 返回）
- `401 Unauthorized`：`{ code: 40100, message: "Unauthorized" }`（仅需鉴权的接口）
- `500 Internal Server Error`：`{ code: 20000, message: "Internal Server Error" }`
- `502 Bad Gateway`：`{ code: 20003, message: string }`（上游 5xx / 网络异常，可能带 `Retry-After`）
- `503 Service Unavailable`：`{ code: 20001 | 20002, message: string }`（Cloudflare 拦截 / FlareSolverr 失败 / 上游 429，附 `Retry-After: 15` 与 `Cache-Control: no-store`）
- `504 Gateway Timeout`：`{ code: 20003, message: string }`（上游超时，附 `Retry-After: 5`）

#### Schema 建模注意点（Zod v4 + `hono-openapi`）
- 现有的 `createAllowedStringSchema(allowedSet, defaultValue)` 使用 `.refine()`，JSON Schema 无法自动推导枚举列表；应改用 `z.enum([...allowedSet] as [string, ...string[]])`（保留同样运行时校验语义），使 OpenAPI 自动输出完整的 `enum` 列表，方便客户端和 Agent 准确获知合法值。
- 现有的 `syncQuerySchema` 的 `since` 使用 `z.preprocess(...)`、`rankingsQuerySchema` 的 `full` 使用 `z.transform(...)`；实现时需验证 `hono-openapi` 对 Zod v4 `preprocess`/`transform`/`coerce` 转换出的 JSON Schema 是否干净无报错，必要时用 Zod v4 `.meta()` 或显式 `override` 保证输出合法的 OpenAPI 3.1 参数类型（如 `integer` / `boolean`）。
- 所有共享 DTO Schema 应与 `@acanthis-dec/core` 类型对齐（可用 `satisfies z.ZodType<...>` 或类型断言检查，避免字段遗漏或类型漂移）。

### 5.4 Scalar 页面配置

- 使用 `@scalar/hono-api-reference` 提供的 `Scalar(...)` 中间件挂载在 `GET /v1/docs`：
  - `url`: `"/v1/openapi.json"`
  - `pageTitle`: `"Acanthis API Reference"`
  - `defaultHttpClient`: `{ targetKey: "js", clientKey: "fetch" }`（或合适默认值）
- 保持默认 CDN 加载方式，避免向 Docker 镜像引入大体积静态资源。

### 5.5 静态契约导出脚本与 CI 防漂移校验

- 在 `apps/api-server/package.json` 增加两个脚本：
  - `"openapi:generate": "tsx scripts/generate-openapi.ts"`：生成并写入格式化后的 `apps/api-server/openapi.json`。
  - `"openapi:check": "tsx scripts/generate-openapi.ts --check"`：在内存中重新生成 OpenAPI 文档并与仓库现有 `apps/api-server/openapi.json` 做内容比对，不一致时输出差异提示并以非零退出码失败。
- 输出文件：`apps/api-server/openapi.json`（提交入仓库）。
- 运行时 `GET /v1/openapi.json` 与 `scripts/generate-openapi.ts` 复用同一份 `openApiDocumentation` 配置，确保在线文档与静态文件完全一致。
- CI 集成：在 `.github/workflows/ci.yml` 的 `quality` job 中新增 `OpenAPI spec check` 步骤，运行 `pnpm --filter=@acanthis-dec/api-server run openapi:check`，确保后续改动路由或 Schema 时强制同步静态契约。

### 5.6 留给实现者决定的细节

- `apps/api-server/src/schemas/` 下的文件拆分粒度（按领域拆分或集中单文件）。
- `hono-openapi` `validator()` 校验失败时是否需要自定义错误回调以保持与原 `@hono/zod-validator` 兼容的 400 响应格式。
- `apps/api-server/AGENTS.md` 文档同步更新、Biome 检查及 Changeset 补充（属于标准收尾流程）。
