# Acanthis Agent Guide

## Repository shape

- TypeScript ESM monorepo managed by `pnpm@11.6.0` and Turbo.
- Workspaces are `apps/*`, `packages/*`, and `tools/*` from `pnpm-workspace.yaml`.
- Source packages export TypeScript sources for workspace consumers and publish `dist` artifacts through `publishConfig`.
- High-complexity boundaries have their own nested guides:
  - `apps/api-server/AGENTS.md`
  - `packages/linovelib/AGENTS.md`
  - `packages/browser-fetch/AGENTS.md`
  - `packages/storage/AGENTS.md`

## Commands and checks

- Install with `pnpm install --frozen-lockfile` when reproducing CI or Docker builds.
- Root scripts:
  - `pnpm build` -> `turbo run build`
  - `pnpm check-types` -> `turbo run check-types`
  - `pnpm format-and-lint` -> `biome check .`
  - `pnpm format-and-lint:fix` -> `biome check . --write`
  - `pnpm test` delegates to Turbo, but there are currently no test files or package test scripts.
- Use `pnpm --filter=<package> run build` or `pnpm --filter=<package> run check-types` for focused validation.
- There is no LSP-specific project wiring beyond TypeScript configs; when changing TS, at minimum run the package `check-types` and related build where practical.

## Formatting and TypeScript conventions

- Biome is the formatter/linter. It uses tabs for indentation, double quotes for JavaScript strings, recommended lint rules, and organize-imports assist.
- Shared TypeScript configs live under `tools/config-typescript`.
- Strict options are enabled, including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, and `noUncheckedSideEffectImports`.
- Avoid suppressing type errors. Model runtime boundaries with Zod schemas or existing typed option objects instead.

## Package map

- `apps/api-server`: Hono HTTP API, config/env loading, service composition, esbuild Docker bundle.
- `packages/linovelib`: scraping/client domain for linovelib, login/session handling, queues, parsing, descrambling.
- `packages/browser-fetch`: browser-like fetch client, impersonation transport, cookie stores, retries, Cloudflare/FlareSolverr integration.
- `packages/storage`: SQLite/libSQL and filesystem persistence, Drizzle schema/migrations, cookie storage adapter.
- `packages/core`: small shared content/descramble/type utilities covered by this root guide.
- `packages/deobfuscator`: small `webcrack` wrapper covered by this root guide.
- `tools/config-typescript`: shared JSON TypeScript configs.
- `tools/config-tsdown`: shared `tsdown` base config (`entry: ./src/index.ts`, `outDir: dist`, `platform: node`, `target: es2022`, declarations, sourcemaps).

## Build and deployment notes

- Library packages build with `tsdown` by spreading `tools/config-tsdown/baseConfig`.
- The API server is different: `apps/api-server/build.ts` uses esbuild to bundle `src/index.ts` to `dist/index.js` with a `createRequire` banner and explicit externals for native/runtime-heavy modules.
- CI runs lint, affected type checks, and affected builds.
- Docker publishing has two channels:
  - `docker-canary` publishes GHCR `ghcr.io/constasj/acanthis-api-server` tags `canary`, `canary-<shortsha>`, and `build-<hash12>` from `master` path changes.
  - `docker-release` (`api-server-docker` in `publish-artifacts.yml`) publishes GHCR and Docker Hub `constasj0721/acanthis-api-server` semver/latest tags from `@acanthis-dec/api-server@*` tags or manual dispatch.
- `api-server` Docker images are split into two files:
  - `apps/api-server/Dockerfile.runtime` builds the prebuilt zstd runtime base image (`node:24-slim` pinned by digest, `ca-certificates`, CPU-only native dependencies with `ONNXRUNTIME_NODE_INSTALL=skip` and architecture-pruned `onnxruntime-node`/`isolated-vm` binaries, SHA256-verified `libcurl-impersonate.so`, and `captcha_cropped.onnx`).
  - `apps/api-server/Dockerfile` builds `dist/index.js` in `builder` and layers only `packages/storage/migrations` and `dist/index.js` onto `RUNTIME_IMAGE`.
  - CI workflows (`.github/workflows/canary.yml`, `.github/workflows/publish-artifacts.yml`, and `.github/workflows/api-server-runtime.yml`) resolve or build the immutable `runtime-<hash12>@sha256:...` base via `.github/actions/ensure-api-server-runtime` and share `ghcr.io/constasj/acanthis-api-server:buildcache` with zstd OCI compression. Keep `Dockerfile`, `Dockerfile.runtime`, and workflow expectations aligned.
  - `canary.yml` computes a deterministic `build-<hash12>` tag via `.github/scripts/api-server-build-hash.mjs` (combining the resolved `RUNTIME_IMAGE` digest and build inputs with `package.json` `version` fields stripped and `*.md` excluded); when `publish-artifacts.yml` finds an existing `build-<hash12>` tag in GHCR, it skips Buildx and promotes that image with updated Release OCI labels via `crane mutate` (`.github/scripts/promote-api-server-image.mjs`) to GHCR and Docker Hub with zero layer re-uploads, falling back to a full Buildx build when missing.

## Change discipline

- Prefer small, package-scoped changes; avoid cross-package refactors unless the public types or runtime path require them.
- Do not add a test framework casually: the repository currently has no tests despite Turbo having a `test` task shape.
- If adding tests, add the missing package-level test script/config at the same time and document how CI should execute it.
- 每次改动都要提交：每完成一个独立函数、Bug 修复、小功能或文档改动，并在通过基础语法/类型检查（必要时构建）后，立即在当前 git worktree 提交一次，不要积压未提交的改动。
- 提交遵循 Conventional Commits：用中文一句话概述改动作为 description，详细改动内容放入 body；每个 commit 保持原子化，包含该主题所有可回滚的改动，但不要越界。
- 可以 commit，但不要擅自 push；push 前必须获得明确许可。
- Changesets 版本管理：
  - 凡改动 `apps/*` 或 `packages/*` 中会影响功能、公共 API、运行时行为或发布产物的代码（含私有 app 包，`.changeset/config.json` 已启用 `privatePackages: { version: true, tag: true }`），在完成功能/修复提交后必须补充 `.changeset/<kebab-case-name>.md`。
  - 纯仓库文档（如 `AGENTS.md`、README）、CI 配置或不影响包发布的维护改动无需添加 changeset。
  - 按语义化版本选择级别：`patch`（Bug 修复/容错加固/无感优化）、`minor`（向后兼容的新功能或体验增强）、`major`（破坏性变更）；frontmatter 仅列直接受影响的包名（内部依赖联动由 `updateInternalDependencies: "patch"` 自动处理），正文用简明中文概括改动。
  - 禁止手动运行 `changeset version` 或手改各包 `package.json` 版本号与 `CHANGELOG.md`，统一交由 `.github/workflows/changesets.yml` 管理发版。
  - 新增 changeset 后需执行 `pnpm exec changeset status` 与 `pnpm format-and-lint` 校验无误，并以 `chore(changeset): ...` 单独提交（同样不得擅自 push）。
