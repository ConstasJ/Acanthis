# API Server Agent Guide

## Scope

This directory is the deployable HTTP service for Acanthis. It wires configuration, storage, logging, linovelib clients, Hono routes, build bundling, and Docker runtime behavior.

## Runtime entrypoints

- `src/index.ts` is the runtime entrypoint: it loads `config` and singleton `services`, calls `createApp(...)`, starts `@hono/node-server`, and closes both `storageService` and the HTTP server on shutdown signals.
- `src/app.ts` builds the Hono app (`basePath("/v1")`), mounts logger/CORS middleware, `/health`, optional public `/openapi.json` and Scalar `/docs` routes before `createAuthMiddleware`, and `/sources`, `/linovelib`, `/sync`.
- `src/linovelib.ts`, `src/sources.ts`, and `src/sync.ts` export route factories (`createLinovelibRoutes`, `createSourcesRoutes`, `createSyncRoutes`) using `hono-openapi` (`describeRoute`, `validator`) and shared schemas under `src/schemas/`.
- `src/openapi.ts` defines `OPENAPI_CONTRACT_VERSION` (kept independent of `package.json` `version` to preserve Docker zero-rebuild image promotion), OpenAPI 3.1 metadata, and Scalar configuration.
- `src/services.ts` constructs singleton service dependencies: `StorageService`, Winston logger, and `LinovelibClient` options.
- `src/config.ts` loads `.env` and optional `config.yaml` from `process.cwd()`, then deep-merges them into the Zod config schema.

## Configuration and services

- Defaults include port `5301`, localhost listen host, data/log/cookie paths under local data directories, impersonation profile `chrome-latest-linux`, FlareSolverr enabled with a default local endpoint, and `docs.enabled` (`DOCS_ENABLED`) set to `true`.
- When `docs.enabled` is `true`, `/v1/openapi.json` and `/v1/docs` (Scalar UI) are mounted ahead of `createAuthMiddleware` so clients and agents can inspect the contract even when `AUTH_TOKEN` is configured.
- Cookie storage supports memory, file, and database modes. Database cookie mode requires the shared `StorageService` passed into linovelib.
- Logger behavior is centralized in `src/services.ts`; route code should log through the injected logger, not ad-hoc console calls.
- Keep Hono route schemas in `src/schemas/` and `describeRoute` metadata close to route definitions so request surface changes remain visible.

## Build and deployment

- `pnpm --filter=@acanthis-dec/api-server run dev` runs `tsx watch src/index.ts`.
- `pnpm --filter=@acanthis-dec/api-server run openapi:generate` regenerates `apps/api-server/openapi.json` without side effects; `openapi:check` verifies no drift against routes/schemas and runs in CI.
- `pnpm --filter=@acanthis-dec/api-server run build` runs `tsx build.ts`, not `tsdown`.
- `build.ts` bundles `src/index.ts` with esbuild for Node ESM, minifies, writes `dist/index.js`, injects `createRequire`, and externalizes native/runtime-heavy dependencies (`@libsql/client`, `isolated-vm`, `koffi`, `onnxruntime-node`) plus optional non-Zod-v4 adapters referenced dynamically by `hono-openapi`/`@standard-community/*`. It also copies the linovelib captcha model (`packages/linovelib/assets/captcha_cropped.onnx`) to `dist/captcha_cropped.onnx` for standalone non-Docker runs.
- `Dockerfile.runtime` builds the shared runtime base image (`node:24-slim` pinned by digest, `ca-certificates`, runtime native dependencies with `ONNXRUNTIME_NODE_INSTALL=skip` and target-arch pruning for `onnxruntime-node`/`isolated-vm`, SHA256-verified `libcurl-impersonate.so` copied without static archives or headers, and `captcha_cropped.onnx`), sets `LIBCURL_PATH` and `LINOVELIB_CAPTCHA_MODEL_PATH`, and exposes `5301` with the `/app/data` volume.
- `Dockerfile` installs `@acanthis-dec/api-server...` workspace dependencies with `ONNXRUNTIME_NODE_INSTALL=skip`, builds `dist/index.js`, and layers only `packages/storage/migrations` and `dist/index.js` onto `RUNTIME_IMAGE` before running `node index.js`.
- CI builds fingerprint `builder` inputs and `RUNTIME_IMAGE` via `.github/scripts/api-server-build-hash.mjs` (ignoring `*.md` and `package.json` `version`) into `build-<hash12>`, enabling release builds to promote matching canary images with updated OCI labels via `crane mutate` (`.github/scripts/promote-api-server-image.mjs`) instead of rebuilding.
- Without `captcha_cropped.onnx` or the `onnxruntime-node` native library in the runtime image, search requests fail even though the rest of the API works.

## Editing guidance

- Treat route output shapes as API contracts. If changing them, update every affected client-facing code path and regenerate `apps/api-server/openapi.json` via `pnpm --filter=@acanthis-dec/api-server run openapi:generate` in the same change.
- Keep config additions represented in the Zod schema, env/config-yaml merge behavior, and service construction.
- When touching deployment/build behavior, verify both `pnpm --filter=@acanthis-dec/api-server run build` and the Dockerfile/workflow expectations.
- This app depends on nested package guides for linovelib and storage behavior; read those before changing cross-package contracts.
