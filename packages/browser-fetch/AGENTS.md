# Browser Fetch Package Agent Guide

## Scope

This package provides the browser-like HTTP layer used by linovelib. It handles impersonation transport, request defaults, retries, cookies, Cloudflare challenge flows, and optional FlareSolverr integration.

## Important paths

- `src/client.ts` contains `BrowserFetchClient` and most request/challenge orchestration.
- `src/transport/` contains the impersonation transport integration around `@constasj/impers`.
- `src/cookies/` contains memory, file, and database cookie store implementations plus shared cookie types.
- `src/profiles.ts` defines browser profile choices such as the default `chrome-latest-linux`.
- `src/errors.ts`, `src/schema.ts`, and `src/types.ts` define the public typed surface.
- `src/index.ts` is the package export surface.

## Runtime contracts

- Default behavior should continue to look like a modern browser request unless a caller explicitly configures otherwise.
- Cookie stores are interchangeable through the package types; do not add store-specific assumptions in `BrowserFetchClient`.
- FlareSolverr and Cloudflare handling are optional runtime paths. Keep the disabled path simple and avoid requiring FlareSolverr-only dependencies for normal requests.
- Retries should preserve method/body/header semantics and cookie updates.

## Editing guidance

- `src/client.ts` is already the central hotspot. Keep new logic narrow; extract only when it names a real transport, cookie, retry, or challenge concept.
- When changing cookie behavior, verify memory/file/database store contracts together or document which store is intentionally unaffected.
- When changing transport behavior, check both direct request behavior and the linovelib caller expectations.
- Verify with `pnpm --filter=@acanthis-dec/browser-fetch run check-types` and `pnpm --filter=@acanthis-dec/browser-fetch run build` after package changes.
