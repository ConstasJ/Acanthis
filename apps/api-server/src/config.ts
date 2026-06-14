import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deepmerge } from "deepmerge-ts";
import dotenv from "dotenv";
import YAML from "js-yaml";
import { z } from "zod";
import { browserProfileNames } from "@acanthis-dec/browser-fetch";

export const ConfigSchema = z.object({
	env: z
		.enum(["development", "production", "test"])
		.default("development")
		.describe("应用环境配置"),
	host: z
		.string()
		.default("http://localhost:5301")
		.describe("服务器对外访问的地址，通常用于生成链接等场景"),
	listenHost: z.string().default("localhost").describe("服务器监听的地址"),
	port: z.number().default(5301).describe("服务器监听的端口号"),
	data: z
		.object({
			filePath: z.string().default("data").describe("数据文件存储路径"),
			dbPath: z.string().default("data/data.db").describe("数据库文件路径"),
			migrationsPath: z
				.string()
				.default("migrations")
				.describe("数据库迁移文件路径"),
		})
		.describe("数据存储相关配置"),
	impersonate: z
		.object({
			enabled: z.boolean().default(true).describe("是否启用浏览器指纹模拟"),
			profile: z
				.enum(browserProfileNames)
				.default("chrome149-linux")
				.describe("浏览器指纹配置"),
		})
		.describe("浏览器指纹模拟配置"),
	flaresolverr: z
		.object({
			enabled: z.boolean().default(true).describe("是否启用 Flaresolverr"),
			host: z
				.string()
				.default("http://localhost:8191")
				.describe("Flaresolverr 服务器地址"),
			timeoutMs: z.number().default(60000).describe("请求超时时间（毫秒）"),
			sessionId: z
				.string()
				.default("acanthis-api-server")
				.describe("Flaresolverr 会话 ID"),
		})
		.describe("Flaresolverr 配置"),
	credentials: z
		.object({
			linovelib: z
				.object({
					username: z.string().describe("哔哩轻小说账号用户名"),
					password: z.string().describe("哔哩轻小说账号密码"),
				})
				.optional()
				.describe("哔哩轻小说账号配置，提供后将启用相关功能"),
		})
		.optional()
		.describe("第三方服务账号配置"),
	logging: z
		.object({
			level: z
				.enum(["error", "warn", "info", "debug"])
				.default("info")
				.describe("日志级别，默认为 info，开发环境默认为 debug"),
			file: z
				.object({
					enabled: z.boolean().default(false).describe("是否启用文件日志"),
					dir: z.string().default("logs").describe("文件日志存储目录"),
				})
				.optional()
				.describe("文件日志配置，启用后将日志输出到指定目录"),
		})
		.optional()
		.describe("日志配置"),
	proxy: z.string().optional().describe("全局代理地址，格式为 http://host:port 或 https://host:port"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function getConfig(): Config {
	dotenv.config();

	const env = process.env.NODE_ENV ?? "development";

	const configPath = resolve(process.cwd(), "./config.yaml");
	try {
		let fileConfig = {};
		if (existsSync(configPath)) {
			fileConfig = YAML.load(readFileSync(configPath, "utf8")) as Record<
				string,
				unknown
			>;
		}
		const envConfig: Record<string, unknown> = {
			env,
			host: process.env.HOST ?? `http://localhost:${process.env.PORT ?? 5301}`,
			listenHost: process.env.LISTEN_HOST,
			port: process.env.PORT ? parseInt(process.env.PORT, 10) : undefined,
			data: {
				filePath: process.env.DATA_FILE_PATH,
				dbPath: process.env.DATA_DB_PATH,
				migrationsPath: process.env.DATA_MIGRATIONS_PATH,
			},
			impersonate: {
				enabled: process.env.IMPERSONATE_ENABLED
					? process.env.IMPERSONATE_ENABLED === "true"
					: undefined,
				profile: process.env.IMPERSONATE_PROFILE as
					| Config["impersonate"]["profile"]
					| undefined,
			},
			flaresolverr: {
				enabled: process.env.FLARESOLVERR_ENABLED
					? process.env.FLARESOLVERR_ENABLED === "true"
					: undefined,
				host: process.env.FLARESOLVERR_HOST,
				timeoutMs: process.env.FLARESOLVERR_TIMEOUT_MS
					? parseInt(process.env.FLARESOLVERR_TIMEOUT_MS, 10)
					: undefined,
				sessionId: process.env.FLARESOLVERR_SESSION_ID,
			},
			credentials: {
				linovelib: process.env.LINOVELIB_USERNAME
					? {
							username: process.env.LINOVELIB_USERNAME,
							password: process.env.LINOVELIB_PASSWORD ?? "",
						}
					: undefined,
			},
			logging: {
				file: {
					enabled: process.env.LOGGING_FILE_ENABLED
						? process.env.LOGGING_FILE_ENABLED === "true"
						: undefined,
					dir: process.env.LOGGING_FILE_DIR,
				},
			},
			proxy: process.env.PROXY_URL,
		};
		const mergedRaw = deepmerge(fileConfig, envConfig);
		const config = ConfigSchema.safeParse(mergedRaw);
		if (!config.success) {
			console.error("❌ Invalid configuration:");
			console.error(z.treeifyError(config.error));
			process.exit(1);
		}
		return Object.freeze(config.data);
	} catch (error) {
		console.error(`Failed to load config from ${configPath}:`, error);
		throw error;
	}
}

export const config = getConfig();
