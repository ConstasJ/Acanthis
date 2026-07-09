# API Server Agent Guide

## Scope

This directory is the deployable HTTP service for Acanthis. It wires configuration, storage, logging, linovelib clients, Hono routes, build bundling, and Docker runtime behavior.

## Runtime entrypoints

- `src/index.ts` creates the Hono app, applies `basePath("/v1")`, mounts logger middleware and `/linovelib`, starts `@hono/node-server`, and closes both `storageService` and the HTTP server on shutdown signals.
- `src/linovelib.ts` owns the public API routes for chapters, novels, covers, and search. It validates query/param input with `@hono/zod-validator`, uses storage caches, and returns JSON result envelopes.
- `src/services.ts` constructs singleton service dependencies: `StorageService`, Winston logger, and `LinovelibClient` options.
- `src/config.ts` loads `.env` and optional `config.yaml` from `process.cwd()`, then deep-merges them into the Zod config schema.

## Configuration and services

- Defaults include port `5301`, localhost listen host, data/log/cookie paths under local data directories, impersonation profile `chrome-latest-linux`, and FlareSolverr enabled with a default local endpoint.
- Cookie storage supports memory, file, and database modes. Database cookie mode requires the shared `StorageService` passed into linovelib.
- Logger behavior is centralized in `src/services.ts`; route code should log through the configured logger, not ad-hoc console calls.
- Keep Hono route schemas close to route definitions so request surface changes remain visible.

## Build and deployment

- `pnpm --filter=@acanthis-dec/api-server run dev` runs `tsx watch src/index.ts`.
- `pnpm --filter=@acanthis-dec/api-server run build` runs `tsx build.ts`, not `tsdown`.
- `build.ts` bundles `src/index.ts` with esbuild for Node ESM, minifies, writes `dist/index.js`, injects `createRequire`, and externalizes native/runtime-heavy dependencies such as `@libsql/client`, `isolated-vm`, and `koffi`.
- `Dockerfile` builds from the monorepo, copies the bundled API server plus `packages/storage/migrations`, installs runtime native dependencies in a minimal package, sets `LIBCURL_PATH`, exposes `5301`, and runs `node index.js`.

## Editing guidance

- Treat route output shapes as API contracts. If changing them, update every affected client-facing code path in the same change.
- Keep config additions represented in the Zod schema, env/config-yaml merge behavior, and service construction.
- When touching deployment/build behavior, verify both `pnpm --filter=@acanthis-dec/api-server run build` and the Dockerfile/workflow expectations.
- This app depends on nested package guides for linovelib and storage behavior; read those before changing cross-package contracts.
