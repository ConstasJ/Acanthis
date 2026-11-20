# API Server OpenAPI 契约文档与 Scalar 页面实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `@acanthis-dec/api-server` 补齐由 Zod v4 与 `hono-openapi` 驱动的 OpenAPI 3.1 契约文档，在 `/v1/openapi.json` 与 `/v1/docs` 公开挂载文档与 Scalar 页面，并提供离线静态导出 `apps/api-server/openapi.json` 与 CI 防漂移校验。

**Architecture:** 通过抽取 `createApp(deps)` 应用工厂与路由工厂函数解除模块顶层对 `services.ts`（SQLite/爬虫）的初始化副作用；将 `@hono/zod-validator` 替换为 `hono-openapi` 原生支持的 `validator()` 并紧贴路由挂载 `describeRoute()`；运行时通过 `openAPIRouteHandler` 与 `@scalar/hono-api-reference` 暴露文档路由，离线脚本复用同一份 `openApiDocumentation` 调用 `generateSpecs()` 导出并校验 `apps/api-server/openapi.json`。

**Tech Stack:** TypeScript (ESM, strict), Hono `^4.13.19`, Zod `^4.6.7`, `hono-openapi`, `@scalar/hono-api-reference`, esbuild, pnpm, Biome

**Spec:** [2026-11-20-api-server-openapi-scalar-design.md](file:///c:/Users/ConstasJ/Coding/Acanthis/docs/superpowers/specs/2026-11-20-api-server-openapi-scalar-design.md)

## Global Constraints

- 严格 TypeScript 配置：`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`、`isolatedModules`、`noUncheckedSideEffectImports`；禁止抑制类型错误。
- Biome 格式化规范：Tab 缩进、双引号字符串、自动整理导入（`pnpm format-and-lint` 必须通过）。
- 不随意引入新的测试框架（仓库当前无测试框架）；使用 `check-types`、`build`、`format-and-lint`、`openapi:check` 及 `tsx` 一次性契约/路由验证命令确认行为。
- 保持现有 15 个 `/v1` 业务接口的运行时路径、状态码、响应体结构零破坏（含两处返回 `{ error: string }` 的 404 响应）。
- 不修改 `apps/api-server/Dockerfile` 与 `apps/api-server/Dockerfile.runtime`，`esbuild` 必须将新依赖完整打包进 `dist/index.js`。
- OpenAPI `info.version` 固定为独立契约版本常量 `"1.0.0"`，严禁绑定 `apps/api-server/package.json` 的 `version`。
- 遵循 Conventional Commits（中文一句话 description + 详细 body），每个原子任务验证通过后立即提交，禁止擅自 `git push`。

## Review Focus

1. **Zod v4 `preprocess`/`transform`/`coerce` 转 JSON Schema 失败或退化**：`syncQuerySchema.since`（`z.preprocess` + `z.coerce.number()`）和 `rankingsQuerySchema.full`（`z.union` + `z.transform`）经过 `hono-openapi` 生成 OpenAPI 3.1 时可能抛出异常或丢失类型；Task 2 和 Task 6 必须验证生成的 `openapi.json` 中两者均为合法的参数 schema 且无转换报错。
2. **离线脚本意外触发 native addon 或 SQLite 初始化**：`scripts/generate-openapi.ts` 导入 `src/app.ts` 或 `@acanthis-dec/linovelib` 时，若误触发 `services.ts`、`StorageService`、`onnxruntime-node` 或 `libcurl` 加载，会在无本地数据库/模型文件的 CI 环境中失败；Task 6 必须在空临时工作目录（无 `data/`、无 `config.yaml`）下验证 `openapi:check` 通过且不产生任何文件副作用。
3. **开启 `AUTH_TOKEN` 时的鉴权边界回归**：`/v1/openapi.json`、`/v1/docs`、`/v1/health` 以及 `GET /v1/linovelib/(cover|illustration)/*` 必须公开放行，而 `/v1/sources`、`/v1/sync/state` 等受保护路由仍必须返回 `401`（`code: 40100`）；Task 5 必须通过 `app.fetch` 覆盖上述放行与拦截用例。
4. **`docs.enabled = false` 时的路由隐藏与默认开启行为**：配置 `DOCS_ENABLED=false` 或 `docs.enabled: false` 时，`/v1/openapi.json` 与 `/v1/docs` 必须完全不挂载（返回 `404`），而非仅返回空内容；Task 5 必须通过 `app.fetch` 验证。
5. **`esbuild` 单文件打包与 `@scalar/hono-api-reference` / `hono-openapi` 兼容性**：新增 ESM/CJS 依赖若含动态 `require` 或额外静态资源读取，可能导致 `apps/api-server/dist/index.js` 构建或运行失败；Task 7 必须执行 `pnpm --filter=@acanthis-dec/api-server run build` 并确认打包无报错。

---

## File Structure

| 路径 | 操作 | 职责 |
|---|---|---|
| `apps/api-server/package.json` | Modify | 添加 `hono-openapi`、`@scalar/hono-api-reference`，移除 `@hono/zod-validator`，新增 `openapi:generate` 与 `openapi:check` 脚本 |
| `apps/api-server/src/config.ts` | Modify | 增加 `docs.enabled`（默认 `true`）及 `DOCS_ENABLED` 环境变量解析 |
| `apps/api-server/src/middleware.ts` | Modify | 将 `loggerMiddleware` 改为 `createLoggerMiddleware(logger)`，解除顶层 `services.ts` 依赖 |
| `apps/api-server/src/utils.ts` | Modify | `resolveHost(c, configuredHost)` 不再默认读取顶层 `config`，消除 `utils.ts` 对 `config.ts` 的顶层副作用 |
| `apps/api-server/src/schemas/common.ts` | Create | 响应信封工厂、通用错误 Schema、`OutputStyle`/LNReader Schema、通用 OpenAPI 错误响应片段与校验错误格式 |
| `apps/api-server/src/schemas/sources.ts` | Create | `NovelSourceDescriptor` 与 `SourceCapability` Zod Schema |
| `apps/api-server/src/schemas/sync.ts` | Create | Sync 请求参数、请求体与响应体 Zod Schema |
| `apps/api-server/src/schemas/linovelib.ts` | Create | Linovelib 全量请求参数（含完整枚举）与响应体 Zod Schema（含 `acanthis`/`lnreader` 多态） |
| `apps/api-server/src/openapi.ts` | Create | `OPENAPI_CONTRACT_VERSION`、`openApiDocumentation` 配置与 `scalarConfig` |
| `apps/api-server/src/sources.ts` | Modify | 改为 `createSourcesRoutes()` 并添加 `describeRoute` |
| `apps/api-server/src/sync.ts` | Modify | 改为 `createSyncRoutes(deps)`，替换为 `hono-openapi` `validator()` 并添加 `describeRoute` |
| `apps/api-server/src/linovelib.ts` | Modify | 改为 `createLinovelibRoutes(deps)`，替换为 `hono-openapi` `validator()` 并为 11 个路由添加 `describeRoute` |
| `apps/api-server/src/app.ts` | Create | 导出 `createApp(deps)`，挂载中间件、`/v1/health`、条件挂载 `/v1/openapi.json` 与 `/v1/docs`、鉴权中间件及三个业务子路由 |
| `apps/api-server/src/index.ts` | Modify | 纯运行时入口：组装 `config` 与 `services` 调用 `createApp()`，启动 `@hono/node-server` 与优雅退出 |
| `apps/api-server/scripts/generate-openapi.ts` | Create | 离线无副作用生成/校验 `apps/api-server/openapi.json` |
| `apps/api-server/openapi.json` | Create | 自动生成的静态 OpenAPI 3.1 契约文档 |
| `.github/workflows/ci.yml` | Modify | 在 `quality` job 中新增 `openapi:check` 步骤 |
| `apps/api-server/AGENTS.md` | Modify | 补充 `src/app.ts`、OpenAPI/Scalar 路由与 `openapi:generate`/`openapi:check` 文档 |
| `.changeset/<name>.md` | Create | `@acanthis-dec/api-server` 的 `minor` changeset |

---

### Task 1: 安装依赖、扩展 `docs` 配置并解耦基础模块顶层副作用

**Files:**
- Modify: `apps/api-server/package.json`
- Modify: `apps/api-server/src/config.ts`
- Modify: `apps/api-server/src/middleware.ts`
- Modify: `apps/api-server/src/utils.ts`
- Modify: `apps/api-server/src/index.ts`（临时适配 `createLoggerMiddleware`，Task 5 最终收口）
- Modify: `apps/api-server/src/linovelib.ts`、`apps/api-server/src/sync.ts`（临时传入 `config.host` 给 `resolveHost`，Task 3/4 最终改为依赖注入）

**Interfaces:**
- Produces:
  - `ConfigSchema` 新增 `docs: { enabled: boolean }`（默认 `{ enabled: true }`，支持 `DOCS_ENABLED` 环境变量）
  - `createLoggerMiddleware(logger: LoggerLike): MiddlewareHandler` in `apps/api-server/src/middleware.ts`（`LoggerLike = Pick<Logger, "info">`）
  - `resolveHost(c: Context, configuredHost?: string): string` in `apps/api-server/src/utils.ts`（不再在模块顶层导入 `./config`）

- [ ] **Step 1: 安装 `hono-openapi` 与 `@scalar/hono-api-reference`**

Run: `pnpm --filter=@acanthis-dec/api-server add hono-openapi @scalar/hono-api-reference`
Expected: `apps/api-server/package.json` 与 `pnpm-lock.yaml` 更新成功，无 peerDependency 冲突报错。

- [ ] **Step 2: 扩展 `apps/api-server/src/config.ts` 增加 `docs.enabled` 与 `DOCS_ENABLED`**

在 `ConfigSchema` 中新增：
```ts
docs: z
	.object({
		enabled: z
			.boolean()
			.default(true)
			.describe("是否启用 OpenAPI 契约与 Scalar 文档页面"),
	})
	.default({ enabled: true })
	.describe("API 文档配置"),
```
在 `getConfig()` 的 `envConfig` 中解析 `process.env.DOCS_ENABLED`：仅当环境变量有值时，将其解析为 `process.env.DOCS_ENABLED === "true"`（未设置时保持 `undefined`，不覆盖 `config.yaml` 或默认值 `true`）。

- [ ] **Step 3: 解耦 `apps/api-server/src/middleware.ts` 与 `apps/api-server/src/utils.ts`**

1. `middleware.ts`：移除 `import { logger } from "./services"`，导出 `export function createLoggerMiddleware(logger: { info: (message: string) => unknown })`，内部逻辑与原 `loggerMiddleware` 保持一致；在 `index.ts` 中改用 `createLoggerMiddleware(logger)`。
2. `utils.ts`：移除 `import { config } from "./config"`，将 `resolveHost` 签名改为 `export function resolveHost(c: Context, configuredHost?: string): string`；暂在 `linovelib.ts` 和 `sync.ts` 调用处传入 `config.host` 以保持编译通过。

- [ ] **Step 4: 验证类型检查与格式化**

Run: `pnpm --filter=@acanthis-dec/api-server run check-types && pnpm format-and-lint`
Expected: 退出码 0，无类型或 lint 错误。

- [ ] **Step 5: 提交 Task 1**

```bash
git add pnpm-lock.yaml apps/api-server/package.json apps/api-server/src/config.ts apps/api-server/src/middleware.ts apps/api-server/src/utils.ts apps/api-server/src/index.ts apps/api-server/src/linovelib.ts apps/api-server/src/sync.ts
git commit -m "feat(api-server): 引入 OpenAPI/Scalar 依赖并新增文档开关与基础模块解耦" -m "..."
```

---

### Task 2: 定义共享 Zod v4 契约 Schema 与 OpenAPI 顶层文档配置

**Files:**
- Create: `apps/api-server/src/schemas/common.ts`
- Create: `apps/api-server/src/schemas/sources.ts`
- Create: `apps/api-server/src/schemas/sync.ts`
- Create: `apps/api-server/src/schemas/linovelib.ts`
- Create: `apps/api-server/src/openapi.ts`
- Modify: `apps/api-server/src/types.ts`（如需复用 `outputStyleSchema`，避免重复定义）

**Interfaces:**
- Produces (`src/schemas/common.ts`):
  - `apiErrorSchema`: `z.object({ code: z.number().int(), message: z.string() })`
  - `legacyErrorSchema`: `z.object({ error: z.string() })`
  - `createSuccessEnvelopeSchema<T extends z.ZodType>(dataSchema: T)` → `{ code: 0, message: string, data: T }`
  - `outputStyleSchema`, `lnReaderChapterItemSchema`, `lnReaderNovelItemSchema`, `lnReaderNovelSchema`
  - `healthResponseSchema`: `{ status: z.literal("ok"), timestamp: z.iso.datetime() }`
  - `bearerSecurity`: `[{ bearerAuth: [] }]`
  - 通用 OpenAPI 响应构建工具：`jsonResponse(schema, description, headers?)`、`unauthorizedResponse`、`validationErrorResponse`、`internalErrorResponse`、`upstreamErrorResponses`（含 `502`、`503` 带 `Retry-After`/`Cache-Control`、`504` 带 `Retry-After`）
- Produces (`src/schemas/sources.ts`):
  - `sourceCapabilitySchema`, `novelSourceDescriptorSchema`, `sourcesResponseSchema`
- Produces (`src/schemas/sync.ts`):
  - `syncQuerySchema`, `bookshelfItemSchema`, `readingProgressSchema`, `syncPushSchema`, `syncGetResponseSchema`, `syncPostResponseSchema`
  - 注意：`syncQuerySchema` 的 `since` 必须确保 `hono-openapi` 能 cleanly 转为 JSON Schema（如使用 `z.union([z.literal("").transform(() => undefined), z.coerce.number().int().min(0)]).optional()` 或验证兼容写法，并附 `.meta({ description: "增量拉取游标（毫秒时间戳）" })`）。
- Produces (`src/schemas/linovelib.ts`):
  - 所有请求 Schema：`chapterParamSchema`, `chapterQuerySchema`, `novelParamSchema`, `volumeParamSchema`, `illustrationParamSchema`, `novelsQuerySchema`, `searchQuerySchema`, `homeQuerySchema`, `rankingsQuerySchema`, `catalogQuerySchema`, `novelStyleQuerySchema`
  - 枚举参数使用 `z.enum([...ALLOWED_SET] as [string, ...string[]]).default(...)` 替代原 `.refine()`，以在 OpenAPI 中完整输出合法枚举值；保留 `rankingsQuerySchema` 中 `isValidLinovelibRanking(val.rank, val.full)` 的 `.refine()` 校验。
  - 所有响应 Schema（与 `@acanthis-dec/core` 类型逐字段对齐）：`exploreSchemaResponseSchema`, `exploreHomeResponseSchema`, `rankingsResponseSchema`（`ExplorePage | LNReaderNovelItem[]`）, `catalogResponseSchema`（`ExplorePage | LNReaderNovelItem[]`）, `chapterResponseSchema`, `novelsResponseSchema`, `novelDetailResponseSchema`（`Novel | LNReaderNovel`）, `searchResponseSchema`（`NovelSearchResult[] | LNReaderNovelItem[]`）。
- Produces (`src/openapi.ts`):
  - `OPENAPI_CONTRACT_VERSION = "1.0.0"`
  - `openApiDocumentation`: 符合 `hono-openapi` `GenerateSpecOptions["documentation"]` 的完整配置（`openapi: "3.1.0"`, `info`, `servers: [{ url: "/", description: "Current server" }]`, `tags`, `components.securitySchemes.bearerAuth`）
  - `scalarConfig`: `{ url: "/v1/openapi.json", pageTitle: "Acanthis API Reference", defaultHttpClient: { targetKey: "js", clientKey: "fetch" } }`

- [ ] **Step 1: 创建 `src/schemas/common.ts`、`src/schemas/sources.ts`、`src/schemas/sync.ts`、`src/schemas/linovelib.ts`**

按上述接口实现所有 Zod v4 Schema，为关键字段补充 `.describe(...)`（面向客户端开发者与 Agent 清晰说明字段含义、单位、示例、缓存/代理 URL 规则）。用 `satisfies z.ZodType<CoreType>` 或显式类型断言在编译期保证与 `@acanthis-dec/core` 类型完全一致。

- [ ] **Step 2: 创建 `src/openapi.ts`**

定义 `OPENAPI_CONTRACT_VERSION = "1.0.0"`、`openApiDocumentation`（包含面向客户端开发者及 Agent 的清晰接入说明：统一信封、Bearer 鉴权与豁免路径、`style=acanthis|lnreader`、上游限流 `503` + `Retry-After`）与 `scalarConfig`。

- [ ] **Step 3: 验证类型检查、格式化以及复杂 Zod Schema 转 JSON Schema 无报错**

Run:
```bash
pnpm --filter=@acanthis-dec/api-server run check-types
pnpm --filter=@acanthis-dec/api-server exec tsx -e "import { resolver } from 'hono-openapi'; import { syncQuerySchema } from './src/schemas/sync'; import { rankingsQuerySchema, catalogQuerySchema, novelDetailResponseSchema } from './src/schemas/linovelib'; for (const s of [syncQuerySchema, rankingsQuerySchema, catalogQuerySchema, novelDetailResponseSchema]) { const r = await resolver(s).builder(); console.log(Boolean(r.schema)); }"
pnpm format-and-lint
```
Expected: 类型检查通过，4 个代表性复杂 Schema 全部输出 `true` 无异常，Biome 检查通过。

- [ ] **Step 4: 提交 Task 2**

```bash
git add apps/api-server/src/schemas apps/api-server/src/openapi.ts apps/api-server/src/types.ts
git commit -m "feat(api-server): 定义全量 Zod v4 契约 Schema 与 OpenAPI 顶层元数据" -m "..."
```

---

### Task 3: 改造 `sources` 与 `sync` 路由为工厂模式并接入 `hono-openapi`

**Files:**
- Modify: `apps/api-server/src/sources.ts`
- Modify: `apps/api-server/src/sync.ts`

**Interfaces:**
- Consumes: `src/schemas/common.ts`, `src/schemas/sources.ts`, `src/schemas/sync.ts`, `resolveHost` from `src/utils.ts`
- Produces:
  - `createSourcesRoutes(): Hono` in `apps/api-server/src/sources.ts`
  - `SyncRouteDeps`: `{ storageService: Pick<StorageService, "getSyncState" | "mergeSyncState">; logger: { error: (message: string) => unknown }; host?: string }`
  - `createSyncRoutes(deps: SyncRouteDeps): Hono` in `apps/api-server/src/sync.ts`

- [ ] **Step 1: 改造 `apps/api-server/src/sources.ts`**

改为导出 `createSourcesRoutes()`，为 `GET /` 挂载 `describeRoute(...)`（Tag: `Sources`, `operationId: "listSources"`, `security: bearerSecurity`, 响应 `200` + `401`）。移除默认导出或保留按 `app.ts` 统一消费的命名导出（Task 5 同步切换 `index.ts`）。

- [ ] **Step 2: 改造 `apps/api-server/src/sync.ts`**

1. 移除顶层 `import { logger, storageService } from "./services"`，改为导出 `createSyncRoutes(deps: SyncRouteDeps)`。
2. 将 `zValidator` 替换为 `hono-openapi` 的 `validator`（使用 `syncQuerySchema`、`syncPushSchema`）。
3. 为 `GET /state`（`operationId: "getSyncState"`）和 `POST /state`（`operationId: "pushSyncState"`）挂载 `describeRoute(...)`（Tag: `Sync`, `security: bearerSecurity`, 响应 `200`/`400`/`401`/`500`）。
4. 调用 `resolveHost(c, deps.host)`。

- [ ] **Step 3: 临时同步 `src/index.ts` 调用并运行类型检查与格式化**

更新 `src/index.ts` 使用 `createSourcesRoutes()` 和 `createSyncRoutes({ storageService, logger, host: config.host })`。
Run: `pnpm --filter=@acanthis-dec/api-server run check-types && pnpm format-and-lint`
Expected: 退出码 0。

- [ ] **Step 4: 提交 Task 3**

```bash
git add apps/api-server/src/sources.ts apps/api-server/src/sync.ts apps/api-server/src/index.ts
git commit -m "feat(api-server): 改造 sources 与 sync 路由并补充 OpenAPI 元数据" -m "..."
```

---

### Task 4: 改造 `linovelib` 11 个路由为工厂模式并接入 `hono-openapi`

**Files:**
- Modify: `apps/api-server/src/linovelib.ts`
- Modify: `apps/api-server/package.json`（移除已不再使用的 `@hono/zod-validator`）

**Interfaces:**
- Consumes: `src/schemas/common.ts`, `src/schemas/linovelib.ts`, `resolveHost` from `src/utils.ts`
- Produces:
  - `LinovelibRouteDeps`: `{ linovelibClient: LinovelibClient; storageService: StorageService; logger: Pick<Logger, "debug" | "info" | "warn" | "error">; host?: string }`
  - `createLinovelibRoutes(deps: LinovelibRouteDeps): Hono` in `apps/api-server/src/linovelib.ts`

- [ ] **Step 1: 改造 `apps/api-server/src/linovelib.ts` 为工厂函数并接入 `hono-openapi`**

1. 移除顶层 `import { linovelibClient, logger, storageService } from "./services"` 与 `import { config } from "./config"`，改为 `export function createLinovelibRoutes(deps: LinovelibRouteDeps)`。
2. 将所有 `zValidator(...)` 替换为 `hono-openapi` 的 `validator(...)`，引用 `src/schemas/linovelib.ts` 中的 Schema。
3. 为全部 11 个路由逐一挂载 `describeRoute(...)`（Tag: `Linovelib`）：
   - `GET /explore/schema`（`getLinovelibExploreSchema`，`Cache-Control` 响应头，`security: bearerSecurity`）
   - `GET /home`（`getLinovelibHome`，`security: bearerSecurity`）
   - `GET /rankings`（`getLinovelibRankings`，双风格响应，`security: bearerSecurity`）
   - `GET /catalog`（`getLinovelibCatalog`，双风格响应，`security: bearerSecurity`）
   - `GET /chapter/:chapterId`（`getLinovelibChapter`，含 `404` 联合 `code: 10000 | 10002` 或 `{ error: "Chapter not found" }`，`security: bearerSecurity`）
   - `GET /novels`（`listLinovelibCachedNovels`，分页双风格，`security: bearerSecurity`）
   - `GET /illustration/:hash`（`getLinovelibIllustration`，公开无需 `security`，`200` 为 `image/*` binary + `Cache-Control`，`404` 为 `code: 10003`）
   - `GET /novel/:novelId`（`getLinovelibNovel`，双风格，`404` 为 `{ error: "Novel not found" }`，`security: bearerSecurity`）
   - `GET /cover/novel/:novelId`（`getLinovelibNovelCover`，公开无需 `security`，`200` 为 `image/*` binary + `Cache-Control`，`404` 为 `code: 10001`）
   - `GET /cover/volume/:volumeId`（`getLinovelibVolumeCover`，公开无需 `security`，`200` 为 `image/*` binary + `Cache-Control`，`404` 为 `code: 10001`）
   - `GET /search`（`searchLinovelibNovels`，双风格，`security: bearerSecurity`）
4. 所有依赖 `resolveHost` 的位置均传入 `deps.host`；将 `inFlightIllustrations`、`homeCache`、`rankingsCache`、`catalogCache` 放在工厂函数内以保证实例隔离。

- [ ] **Step 2: 清理 `@hono/zod-validator` 依赖并同步 `src/index.ts`**

Run: `pnpm --filter=@acanthis-dec/api-server remove @hono/zod-validator`
同步更新 `src/index.ts` 调用 `createLinovelibRoutes({ linovelibClient, storageService, logger, host: config.host })`。

- [ ] **Step 3: 验证类型检查与格式化**

Run: `pnpm --filter=@acanthis-dec/api-server run check-types && pnpm format-and-lint`
Expected: 退出码 0，无任何对 `@hono/zod-validator` 的残留引用。

- [ ] **Step 4: 提交 Task 4**

```bash
git add pnpm-lock.yaml apps/api-server/package.json apps/api-server/src/linovelib.ts apps/api-server/src/index.ts
git commit -m "feat(api-server): 改造 linovelib 路由并补齐 11 个接口的 OpenAPI 元数据" -m "..."
```

---

### Task 5: 抽取 `src/app.ts` 挂载 `/v1/openapi.json` 与 Scalar `/v1/docs` 并验证运行时行为

**Files:**
- Create: `apps/api-server/src/app.ts`
- Modify: `apps/api-server/src/index.ts`

**Interfaces:**
- Consumes: `openApiDocumentation`, `scalarConfig` from `src/openapi.ts`; `createLoggerMiddleware`, `createAuthMiddleware` from `src/middleware.ts`; `createSourcesRoutes`, `createSyncRoutes`, `createLinovelibRoutes`
- Produces:
  - `AppDeps`: `{ config: Pick<Config, "cors" | "auth" | "docs" | "host">; logger: LinovelibRouteDeps["logger"]; storageService: StorageService; linovelibClient: LinovelibClient }`
  - `createApp(deps: AppDeps): Hono` in `apps/api-server/src/app.ts`

- [ ] **Step 1: 创建 `apps/api-server/src/app.ts`**

实现 `createApp(deps: AppDeps)`：
1. 创建 `const app = new Hono().basePath("/v1")`；
2. 挂载 `createLoggerMiddleware(deps.logger)` 与 `cors(...)`；
3. 挂载 `GET /health` 并附加 `describeRoute(...)`（Tag: `System`, `operationId: "getHealth"`, 公开无需 `security`）；
4. 当 `deps.config.docs.enabled` 为 `true` 时，在 `createAuthMiddleware` **之前**挂载：
   - `app.get("/openapi.json", openAPIRouteHandler(app, { documentation: openApiDocumentation }))`（且该路由自身用 `hide: true` 或不出现在 OpenAPI paths 中）；
   - `app.get("/docs", Scalar(scalarConfig))`；
5. 当 `deps.config.auth?.token` 存在时，挂载 `app.use("*", createAuthMiddleware(deps.config.auth.token))`；
6. 挂载 `/sources`、`/linovelib`、`/sync` 三个子路由。

- [ ] **Step 2: 精简 `apps/api-server/src/index.ts`**

`index.ts` 仅负责导入 `config`、`services`、调用 `createApp(...)`、启动 `@hono/node-server` 及注册优雅退出信号处理。

- [ ] **Step 3: 通过 `app.fetch` 验证文档端点、鉴权边界与 `docs.enabled=false`（覆盖 Review Focus #3 & #4）**

Run:
```bash
pnpm --filter=@acanthis-dec/api-server run check-types
pnpm --filter=@acanthis-dec/api-server exec tsx -e '
import { createApp } from "./src/app";
const dummyDeps = {
  config: { cors: { origin: "*" }, auth: { token: "secret" }, docs: { enabled: true }, host: "http://localhost:5301" },
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  storageService: {} as never,
  linovelibClient: {} as never,
};
const app = createApp(dummyDeps);
const specRes = await app.fetch(new Request("http://localhost/v1/openapi.json"));
const spec = await specRes.json();
const docsRes = await app.fetch(new Request("http://localhost/v1/docs"));
const docsHtml = await docsRes.text();
const healthRes = await app.fetch(new Request("http://localhost/v1/health"));
const unauthSources = await app.fetch(new Request("http://localhost/v1/sources"));
const authSources = await app.fetch(new Request("http://localhost/v1/sources", { headers: { Authorization: "Bearer secret" } }));
const disabledApp = createApp({ ...dummyDeps, config: { ...dummyDeps.config, docs: { enabled: false } } });
const disabledSpec = await disabledApp.fetch(new Request("http://localhost/v1/openapi.json"));
const disabledDocs = await disabledApp.fetch(new Request("http://localhost/v1/docs"));
console.log({
  specStatus: specRes.status,
  openapi: spec.openapi,
  version: spec.info?.version,
  pathCount: Object.keys(spec.paths ?? {}).length,
  docsStatus: docsRes.status,
  hasScalar: docsHtml.includes("scalar") || docsHtml.includes("/v1/openapi.json"),
  healthStatus: healthRes.status,
  unauthSourcesStatus: unauthSources.status,
  authSourcesStatus: authSources.status,
  disabledSpecStatus: disabledSpec.status,
  disabledDocsStatus: disabledDocs.status,
});
'
pnpm format-and-lint
```
Expected:
- `specStatus: 200`, `openapi: "3.1.0"`, `version: "1.0.0"`, `pathCount: 15`（全部 15 个业务路径，不包含 `/v1/openapi.json` 和 `/v1/docs`）
- `docsStatus: 200`, `hasScalar: true`
- `healthStatus: 200`, `unauthSourcesStatus: 401`, `authSourcesStatus: 200`
- `disabledSpecStatus: 404`, `disabledDocsStatus: 404`

- [ ] **Step 4: 提交 Task 5**

```bash
git add apps/api-server/src/app.ts apps/api-server/src/index.ts
git commit -m "feat(api-server): 抽取应用工厂并公开挂载 OpenAPI 契约与 Scalar 页面" -m "..."
```

---

### Task 6: 实现离线导出/防漂移脚本 `generate-openapi.ts`、生成 `openapi.json` 并接入 CI

**Files:**
- Create: `apps/api-server/scripts/generate-openapi.ts`
- Create: `apps/api-server/openapi.json`
- Modify: `apps/api-server/package.json`（新增 `openapi:generate` 与 `openapi:check`）
- Modify: `.github/workflows/ci.yml`（新增 `OpenAPI spec check` 步骤）

**Interfaces:**
- Consumes: `createApp` from `../src/app`, `openApiDocumentation` from `../src/openapi`, `generateSpecs` from `hono-openapi`
- Produces:
  - `pnpm --filter=@acanthis-dec/api-server run openapi:generate` → 写入格式化 JSON（Tab 缩进 + 末尾换行，匹配 Biome JSON 风格）至 `apps/api-server/openapi.json`
  - `pnpm --filter=@acanthis-dec/api-server run openapi:check` → 校验 `apps/api-server/openapi.json` 与实时生成结果逐字节一致（统一按 `\n` 归一化行尾以兼容 Windows/Linux），不一致时报错并退出码 1

- [ ] **Step 1: 创建 `apps/api-server/scripts/generate-openapi.ts` 并添加 package scripts**

实现要点：
1. 使用占位无副作用 `deps` 调用 `createApp(...)`（设置 `docs: { enabled: false }`，仅收集业务路由）；
2. 调用 `await generateSpecs(app, { documentation: openApiDocumentation })` 获取 OpenAPI 3.1 对象；
3. 序列化为 `${JSON.stringify(spec, null, "\t")}\n`；
4. 若命令行包含 `--check`：读取 `apps/api-server/openapi.json` 并将 `\r\n` 归一化为 `\n` 后比对，一致则打印成功退出 0，不一致或文件缺失则提示运行 `pnpm --filter=@acanthis-dec/api-server run openapi:generate` 并退出 1；
5. 否则写入 `apps/api-server/openapi.json`。

在 `apps/api-server/package.json` 添加：
- `"openapi:generate": "tsx scripts/generate-openapi.ts"`
- `"openapi:check": "tsx scripts/generate-openapi.ts --check"`

- [ ] **Step 2: 生成 `apps/api-server/openapi.json` 并验证无副作用与防漂移（覆盖 Review Focus #1 & #2）**

Run:
```bash
pnpm --filter=@acanthis-dec/api-server run openapi:generate
pnpm --filter=@acanthis-dec/api-server run openapi:check
pnpm format-and-lint
```
确认：
1. 未在 `apps/api-server` 生成 `data/`、`logs/` 或数据库文件；
2. `openapi.json` 包含全部 15 个 `/v1/*` 路径、`bearerAuth` 安全方案、`style` 枚举、`channel`/`rank`/`sort` 等完整枚举以及双风格响应 Schema；
3. `pnpm format-and-lint` 对生成的 `openapi.json` 零报错。

- [ ] **Step 3: 接入 `.github/workflows/ci.yml`**

在 `quality` job 的 `Type check` 之后、`Build` 之前添加：
```yaml
      - name: OpenAPI spec check
        run: pnpm --filter=@acanthis-dec/api-server run openapi:check
```

- [ ] **Step 4: 提交 Task 6**

```bash
git add apps/api-server/scripts/generate-openapi.ts apps/api-server/openapi.json apps/api-server/package.json .github/workflows/ci.yml
git commit -m "feat(api-server): 新增 OpenAPI 静态契约导出脚本并接入 CI 防漂移校验" -m "..."
```

---

### Task 7: 全量构建验证、更新 `AGENTS.md` 与补充 Changeset

**Files:**
- Modify: `apps/api-server/AGENTS.md`
- Create: `.changeset/api-server-openapi-scalar.md`

- [ ] **Step 1: 执行全量验证（覆盖 Review Focus #5）**

Run:
```bash
pnpm --filter=@acanthis-dec/api-server run check-types
pnpm --filter=@acanthis-dec/api-server run build
pnpm --filter=@acanthis-dec/api-server run openapi:check
pnpm format-and-lint
```
Expected: 全部退出码 0，`apps/api-server/dist/index.js` 成功生成。

- [ ] **Step 2: 更新 `apps/api-server/AGENTS.md`**

补充以下信息：
- `src/app.ts` 负责 Hono 路由与中间件装配，`src/index.ts` 为纯运行时入口；
- `/v1/openapi.json` 与 `/v1/docs`（Scalar）在 `docs.enabled`（默认 `true`，环境变量 `DOCS_ENABLED`）开启时公开挂载在鉴权中间件之前；
- 修改任何路由或 Schema 后必须运行 `pnpm --filter=@acanthis-dec/api-server run openapi:generate` 更新 `apps/api-server/openapi.json`，CI 通过 `openapi:check` 校验防漂移。

提交文档更新：
```bash
git add apps/api-server/AGENTS.md
git commit -m "docs(api-server): 更新 OpenAPI 契约与 Scalar 文档维护说明" -m "..."
```

- [ ] **Step 3: 补充 Changeset 并校验**

创建 `.changeset/api-server-openapi-scalar.md`：
```markdown
---
"@acanthis-dec/api-server": minor
---

新增 OpenAPI 3.1 契约端点（`/v1/openapi.json`）、Scalar 交互式文档页面（`/v1/docs`）、`docs.enabled` / `DOCS_ENABLED` 开关以及离线契约生成与防漂移校验脚本。
```
Run: `pnpm exec changeset status && pnpm format-and-lint`
Expected: `changeset status` 识别 `@acanthis-dec/api-server` 为 `minor`，Biome 检查通过。

提交 Changeset：
```bash
git add .changeset/api-server-openapi-scalar.md
git commit -m "chore(changeset): 添加 api-server OpenAPI 与 Scalar 文档变更记录" -m "..."
```
