# Linovelib Package Agent Guide

## Scope

This package is the linovelib domain adapter. It coordinates browser-like fetching, login/session handling, scraping, parsing, queues, deobfuscation, and optional persistence.

## Important paths

- `src/client.ts` is the main public client composition point. It builds `BrowserFetchClient`, configures queues, default impersonation, FlareSolverr, cookies, and optional login/session behavior.
- `src/chapter.ts`, `src/info.ts`, `src/search.ts`, and `src/cover.ts` implement scraping workflows.
- `src/coefficients.ts` parses deobfuscated JavaScript with Babel and extracts descramble coefficients.
- `src/session.ts` validates and refreshes authenticated session behavior.
- `src/queue.ts` defines queue wrappers around chapter, novel info, and search work.
- `src/index.ts` is the package export surface.

## Runtime contracts

- Workspace consumers import the TypeScript source through the package export; published consumers use `dist/index.mjs` and `dist/index.d.mts`.
- `LinovelibClient` defaults to browser impersonation and FlareSolverr support through `packages/browser-fetch`.
- Database cookie storage requires a `StorageService` from `packages/storage`; do not silently fall back to another store when database mode is requested.
- Keep queue behavior explicit. Concurrency or retry changes affect API server latency and scraping load.

## Babel/deobfuscation cautions

- `src/coefficients.ts` intentionally normalizes `@babel/traverse` as `default ?? module` before calling it. Preserve this interop shape unless both bundled and direct TS execution paths are verified.
- Coefficient extraction is part of the chapter descrambling path. If changing AST traversal, manually exercise a minimal coefficient extraction path or an end-to-end chapter parsing path.
- Keep deobfuscation concerns separated: this package orchestrates extraction, while `packages/deobfuscator` wraps `webcrack`.

## Editing guidance

- Prefer adding parser logic near the scraping function that owns the source HTML/JS shape.
- Validate external page-derived data with existing schemas before passing it to core descramble/content utilities.
- Avoid broad client option reshapes unless API server service construction is updated at the same time.
- Verify with `pnpm --filter=@acanthis-dec/linovelib run check-types` and `pnpm --filter=@acanthis-dec/linovelib run build` after package changes.
