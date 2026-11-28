import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { browserProfileNames } from "@acanthis-dec/browser-fetch";
import { deepmergeCustom } from "deepmerge-ts";
import dotenv from "dotenv";
import { load } from "js-yaml";
import { z } from "zod";

export const ConfigSchema = z
	.object({
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
					.default("chrome-latest-linux")
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
		cookies: z.object({
			type: z
				.enum(["memory", "file", "database"])
				.default("memory")
				.describe("Cookie 存储方式"),
			path: z
				.string()
				.default("cookies.json")
				.describe("Cookie 文件存储路径，仅在 type 为 file 时使用")
				.optional(),
		}),
		proxy: z
			.string()
			.optional()
			.describe("全局代理地址，格式为 http://host:port 或 https://host:port"),
		cors: z
			.object({
				origin: z
					.union([z.string(), z.array(z.string())])
					.default("*")
					.describe("CORS 允许的 Origin，支持 '*'、单个源或源列表"),
			})
			.default({ origin: "*" })
			.describe("跨域资源共享配置"),
		auth: z
			.object({
				token: z
					.string()
					.min(1)
					.optional()
					.describe("可选的全局访问令牌；设置后启用 API 鉴权"),
			})
			.optional()
			.describe("API 鉴权配置"),
		docs: z
			.object({
				enabled: z
					.boolean()
					.default(true)
					.describe("是否启用 OpenAPI 契约与 Scalar 文档页面"),
			})
			.default({ enabled: true })
			.describe("API 文档配置"),
		epub: z
			.object({
				cacheDir: z
					.string()
					.min(1)
					.optional()
					.describe(
						"EPUB 产物磁盘缓存目录（默认位于 data.filePath 下的 epub-cache 子目录）",
					),
				maxCacheBytes: z
					.number()
					.int()
					.positive()
					.default(536870912)
					.describe("EPUB 磁盘缓存上限（字节），超出按 LRU 淘汰，默认 512MB"),
				jobTtlMs: z
					.number()
					.int()
					.positive()
					.default(1800000)
					.describe(
						"已完成/失败任务记录在内存中的保留时长（毫秒），默认 30 分钟",
					),
				maxConcurrentJobs: z
					.number()
					.int()
					.min(1)
					.default(1)
					.describe("最大并发 EPUB 构建任务数，默认 1"),
			})
			.default({
				maxCacheBytes: 536870912,
				jobTtlMs: 1800000,
				maxConcurrentJobs: 1,
			})
			.describe("按卷 EPUB 异步构建与磁盘缓存配置"),
	})
	.transform((parsed) => ({
		...parsed,
		epub: {
			...parsed.epub,
			cacheDir:
				parsed.epub.cacheDir ?? join(parsed.data.filePath, "epub-cache"),
		},
	}));

export type Config = z.infer<typeof ConfigSchema>;

export function getConfig(): Config {
	dotenv.config({ quiet: true });

	const env = process.env.NODE_ENV ?? "development";

	const configPath = resolve(process.cwd(), "./config.yaml");
	try {
		let fileConfig = {};
		if (existsSync(configPath)) {
			fileConfig = load(readFileSync(configPath, "utf8")) as Record<
				string,
				unknown
			>;
		}
		const rawHost = process.env.HOST?.trim();
		const envConfig: Record<string, unknown> = {
			env,
			host: rawHost ? rawHost : undefined,
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
			cookies: {
				type: process.env.COOKIE_TYPE as Config["cookies"]["type"] | undefined,
				path: process.env.COOKIE_PATH,
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
		const rawCorsOrigin = process.env.CORS_ORIGIN?.trim();
		if (rawCorsOrigin) {
			let parsedOrigin: string | string[] | undefined;
			if (rawCorsOrigin === "*") {
				parsedOrigin = "*";
			} else if (rawCorsOrigin.includes(",")) {
				const origins = rawCorsOrigin
					.split(",")
					.map((origin) => origin.trim())
					.filter(Boolean);
				if (origins.length > 0) {
					parsedOrigin = origins;
				}
			} else {
				parsedOrigin = rawCorsOrigin;
			}
			if (parsedOrigin !== undefined) {
				envConfig.cors = { origin: parsedOrigin };
			}
		}
		const rawAuthToken = process.env.AUTH_TOKEN?.trim();
		if (rawAuthToken) {
			envConfig.auth = { token: rawAuthToken };
		}
		const rawDocsEnabled = process.env.DOCS_ENABLED?.trim();
		if (rawDocsEnabled) {
			envConfig.docs = {
				enabled: rawDocsEnabled.toLowerCase() === "true",
			};
		}
		const epubEnv: Record<string, unknown> = {};
		const rawEpubCacheDir = process.env.EPUB_CACHE_DIR?.trim();
		if (rawEpubCacheDir) {
			epubEnv.cacheDir = rawEpubCacheDir;
		}
		const rawEpubMaxCacheBytes = process.env.EPUB_MAX_CACHE_BYTES?.trim();
		if (rawEpubMaxCacheBytes) {
			epubEnv.maxCacheBytes = parseInt(rawEpubMaxCacheBytes, 10);
		}
		const rawEpubJobTtlMs = process.env.EPUB_JOB_TTL_MS?.trim();
		if (rawEpubJobTtlMs) {
			epubEnv.jobTtlMs = parseInt(rawEpubJobTtlMs, 10);
		}
		const rawEpubMaxConcurrentJobs =
			process.env.EPUB_MAX_CONCURRENT_JOBS?.trim();
		if (rawEpubMaxConcurrentJobs) {
			epubEnv.maxConcurrentJobs = parseInt(rawEpubMaxConcurrentJobs, 10);
		}
		if (Object.keys(epubEnv).length > 0) {
			envConfig.epub = epubEnv;
		}
		const mergeConfig = deepmergeCustom({ mergeArrays: false });
		const mergedRaw = mergeConfig(fileConfig, envConfig);
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
