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
  - `docker-canary` publishes GHCR `ghcr.io/constasj/acanthis-api-server` tags `canary` and `canary-<shortsha>` from `master` path changes.
  - `docker-release` publishes GHCR and Docker Hub `constasj0721/acanthis-api-server` semver/latest tags from `v*.*.*` tags.
- Docker builds depend on the downloaded `libcurl-impersonate.tar.gz`; keep `apps/api-server/Dockerfile` and workflow expectations aligned.

## Change discipline

- Prefer small, package-scoped changes; avoid cross-package refactors unless the public types or runtime path require them.
- Do not add a test framework casually: the repository currently has no tests despite Turbo having a `test` task shape.
- If adding tests, add the missing package-level test script/config at the same time and document how CI should execute it.
- Do not commit unless the current conversation explicitly asks. If committing is requested, use Conventional Commits with a concise Chinese summary.
