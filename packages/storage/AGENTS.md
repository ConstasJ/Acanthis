# Storage Package Agent Guide

## Scope

This package owns persistence for Acanthis: SQLite/libSQL access, Drizzle schema and migrations, filesystem-backed content/cache/cover storage, and database-backed cookie storage.

## Important paths

- `src/service.ts` is the high-level `StorageService` facade used by the API server and linovelib.
- `src/db.ts` owns database connection, migration, and close behavior.
- `src/table.ts` is the Drizzle schema source.
- `src/cookies.ts` implements database cookie storage for browser-fetch integration.
- `src/files.ts` owns filesystem storage behavior.
- `src/type.ts` and `src/utils.ts` define package-local types and helpers.
- `migrations/` contains generated Drizzle migrations and must stay aligned with `src/table.ts`.

## Runtime contracts

- `StorageService` composes database, filesystem, and cookie storage. API server shutdown calls `storageService.close()`; keep close semantics reliable.
- Database cookie storage is consumed through `packages/browser-fetch`/`packages/linovelib`; maintain their expected cookie-store interface.
- Filesystem storage paths are part of deployed data layout. Avoid renaming cache/content/cover directories without migration or compatibility handling.
- Migrations are copied into the API Docker image, so migration path changes must also update deployment assumptions.

## Editing guidance

- Schema changes require both `src/table.ts` updates and a corresponding migration under `migrations/`.
- Keep exported TypeScript types and helpers aligned with database table changes.
- Avoid mixing scraping/domain parsing into storage; this package should persist already-normalized data.
- Verify with `pnpm --filter=@acanthis-dec/storage run check-types` and `pnpm --filter=@acanthis-dec/storage run build` after package changes.
