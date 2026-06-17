# @acanthis-dec/api-server

[English README](./README.md) | [工作区 README](../../README.zh-CN.md)

Acanthis 的可部署 HTTP 服务。它把配置、存储、日志和已支持的来源适配器接入 Hono，并将服务挂载在 `/v1` 下。

## 安装

从工作区根目录安装：

```powershell
pnpm install --frozen-lockfile
```

常用局部命令：

```powershell
pnpm --filter=@acanthis-dec/api-server run dev
pnpm --filter=@acanthis-dec/api-server run build
pnpm --filter=@acanthis-dec/api-server run check-types
```

## 用法

启动开发服务：

```powershell
pnpm --filter=@acanthis-dec/api-server run dev
```

默认监听地址为 `http://localhost:5301`。服务会从 `process.cwd()` 读取 `.env` 与可选的 `config.yaml`。

最小 `config.yaml` 示例：

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

请求示例：

```powershell
curl "http://localhost:5301/v1/linovelib/search?keyword=example"
curl "http://localhost:5301/v1/linovelib/novel/example-id"
curl "http://localhost:5301/v1/linovelib/chapter/example-chapter-id"
```

## API

所有路由挂载在 `/v1/linovelib` 下。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/chapter/:chapterId` | 从缓存或配置适配器返回章节正文。 |
| `GET` | `/novel/:novelId` | 返回统一后的作品元数据；支持可选 `style` 查询参数。 |
| `GET` | `/cover/novel/:novelId` | 返回作品封面二进制数据。 |
| `GET` | `/cover/volume/:volumeId` | 返回分卷封面二进制数据。 |
| `GET` | `/search?keyword=<text>` | 搜索统一元数据并缓存结果。 |

成功的 JSON 路由返回：

```json
{
	"code": 0,
	"message": "Success",
	"data": {}
}
```

配置由 `src/config.ts` 中的 `ConfigSchema` 定义。常用环境变量包括 `HOST`、`LISTEN_HOST`、`PORT`、`DATA_FILE_PATH`、`DATA_DB_PATH`、`DATA_MIGRATIONS_PATH`、`IMPERSONATE_ENABLED`、`IMPERSONATE_PROFILE`、`FLARESOLVERR_ENABLED`、`FLARESOLVERR_HOST`、`FLARESOLVERR_TIMEOUT_MS`、`COOKIE_TYPE`、`COOKIE_PATH`、`PROXY_URL`、`LINOVELIB_USERNAME` 和 `LINOVELIB_PASSWORD`。
