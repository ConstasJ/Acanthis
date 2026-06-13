import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deepmerge } from "deepmerge-ts";
import dotenv from "dotenv";
import YAML from "js-yaml";
import { z } from "zod";

export const ConfigSchema = z.object({
	env: z.enum(["development", "production", "test"]).default("development"),
	host: z.string().default("http://localhost:5301").optional(),
	port: z.number().default(5301).optional(),
	data: z.object({
		filePath: z.string().default("data").optional(),
		dbPath: z.string().default("data/db.sqlite").optional(),
	}),
	impersonate: z.object({
		enabled: z.boolean().default(true),
		profile: z
			.enum(["chrome149-windows", "chrome149-linux", "chrome149-android"])
			.default("chrome149-linux"),
	}),
	flaresolverr: z.object({
		enabled: z.boolean().default(true),
		host: z.string().default("http://localhost:8191").optional(),
		timeoutMs: z.number().default(60000).optional(),
	}),
	credentials: z
		.object({
			linovelib: z
				.object({
					username: z.string().describe("Username for Linovelib"),
					password: z.string().describe("Password for Linovelib"),
				})
				.optional(),
		})
		.optional(),
	logging: z
		.object({
			level: z
				.enum(["error", "warn", "info", "debug"])
				.default("info")
				.optional(),
			file: z
				.object({
					enabled: z.boolean().default(false),
					dir: z.string().default("logs").optional(),
				})
				.optional(),
		})
		.optional(),
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
			port: process.env.PORT ? parseInt(process.env.PORT, 10) : undefined,
			data: {
				filePath: process.env.DATA_FILE_PATH,
				dbPath: process.env.DATA_DB_PATH,
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
