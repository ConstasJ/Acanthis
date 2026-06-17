# @acanthis-dec/api-server

[中文文档](./README.zh-CN.md) | [Workspace README](../../README.md)

Deployable HTTP service for Acanthis. It wires configuration, storage, logging, and the supported source adapters into a Hono server mounted under `/v1`.

## Installation

From the workspace root:

```powershell
pnpm install --frozen-lockfile
```

Focused commands:

```powershell
pnpm --filter=@acanthis-dec/api-server run dev
pnpm --filter=@acanthis-dec/api-server run build
pnpm --filter=@acanthis-dec/api-server run check-types
```

## Usage

Start the development server:

```powershell
pnpm --filter=@acanthis-dec/api-server run dev
```

The default listen address is `http://localhost:5301`. The service reads `.env` and optional `config.yaml` from `process.cwd()`.

Minimal `config.yaml` example:

```yaml
host: http://localhost:5301
listenHost: localhost
port: 5301
data:
  filePath: data
  dbPath: data/data.db
  migrationsPath: migrations
flaresolverr:
  enabled: true
  host: http://localhost:8191
cookies:
  type: memory
```

Request examples:

```powershell
curl "http://localhost:5301/v1/linovelib/search?keyword=example"
curl "http://localhost:5301/v1/linovelib/novel/example-id"
curl "http://localhost:5301/v1/linovelib/chapter/example-chapter-id"
```

## API

All routes are mounted under `/v1/linovelib`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/chapter/:chapterId` | Returns chapter content from cache or the configured adapter. |
| `GET` | `/novel/:novelId` | Returns normalized novel metadata; accepts optional `style` query. |
| `GET` | `/cover/novel/:novelId` | Returns novel cover binary data. |
| `GET` | `/cover/volume/:volumeId` | Returns volume cover binary data. |
| `GET` | `/search?keyword=<text>` | Searches normalized metadata and caches results. |

Successful JSON routes use:

```json
{
	"code": 0,
	"message": "Success",
	"data": {}
}
```

Configuration is defined by `ConfigSchema` in `src/config.ts`. Important environment variables include `HOST`, `LISTEN_HOST`, `PORT`, `DATA_FILE_PATH`, `DATA_DB_PATH`, `DATA_MIGRATIONS_PATH`, `IMPERSONATE_ENABLED`, `IMPERSONATE_PROFILE`, `FLARESOLVERR_ENABLED`, `FLARESOLVERR_HOST`, `FLARESOLVERR_TIMEOUT_MS`, `COOKIE_TYPE`, `COOKIE_PATH`, `PROXY_URL`, `LINOVELIB_USERNAME`, and `LINOVELIB_PASSWORD`.
