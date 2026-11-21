import type { ApiReferenceConfiguration } from "@scalar/hono-api-reference";
import type { GenerateSpecOptions } from "hono-openapi";

export const OPENAPI_CONTRACT_VERSION = "1.0.0";

const API_DESCRIPTION = [
	"Acanthis API Server 为 Acanthis 客户端及自动化 Agent 提供统一的小说源发现、检索、详情目录、解扰章节正文、媒体缓存代理及跨端同步能力。",
	"",
	"### 接入约定",
	"- **路由前缀**：所有接口均挂载在 `/v1` 前缀下。",
	'- **统一响应信封**：除 `GET /v1/health`、图片二进制接口与两处历史 404（`{ "error": string }`）外，业务 JSON 响应均采用 `{ "code": number, "message": string, "data"?: ... }`，其中 `code: 0` 表示成功。',
	"- **鉴权策略**：当服务端设置 `AUTH_TOKEN` 时，除 `/v1/health`、`/v1/openapi.json`、`/v1/docs` 与 `GET /v1/{platform}/(cover|illustration)/*` 外，其余接口均需在请求头传入 `Authorization: Bearer <token>`。",
	"- **输出风格切换**：部分查询与详情接口支持 `style=acanthis | lnreader` 参数，默认为 `acanthis`，传入 `lnreader` 时返回兼容 LNReader 插件协议的精简结构。",
	"- **上游限流与重试**：当上游站点触发 Cloudflare 拦截、429 限流或超时时，服务端返回 `502` / `503` / `504` 并附带 `Retry-After` 与 `Cache-Control: no-store` 响应头，客户端应按提示退避重试。",
].join("\n");

export const openApiDocumentation: GenerateSpecOptions["documentation"] = {
	openapi: "3.1.0",
	info: {
		title: "Acanthis API Server",
		version: OPENAPI_CONTRACT_VERSION,
		description: API_DESCRIPTION,
	},
	servers: [
		{
			url: "/",
			description: "当前服务端实例（保留 /v1 路由前缀）",
		},
	],
	tags: [
		{
			name: "System",
			description: "服务健康检查与运行状态",
		},
		{
			name: "Sources",
			description: "已接入小说源及其能力声明",
		},
		{
			name: "Linovelib",
			description: "哔哩轻小说发现、检索、目录详情、章节正文与封面/插图代理",
		},
		{
			name: "Sync",
			description: "跨端书架与阅读进度增量同步（LWW 合并）",
		},
	],
	components: {
		securitySchemes: {
			bearerAuth: {
				type: "http",
				scheme: "bearer",
				description:
					"全局访问令牌；仅当服务端启用 AUTH_TOKEN 时必需，通过 Authorization: Bearer <token> 传入",
			},
		},
	},
};

export const scalarConfig: Partial<ApiReferenceConfiguration> = {
	url: "./openapi.json",
	pageTitle: "Acanthis API Reference",
	defaultHttpClient: {
		targetKey: "js",
		clientKey: "fetch",
	},
};
