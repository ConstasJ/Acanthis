import { LinovelibClient } from "@acanthis-dec/linovelib";
import { StorageService } from "@acanthis-dec/storage";
import { createLogger, format, transports } from "winston";
import { config } from "./config";

export const storageService = new StorageService({
	db: {
		path: config.data.dbPath,
	},
	dataDir: config.data.filePath,
});

export const logger = createLogger({
	level:
		config.logging?.level ?? (config.env === "development" ? "debug" : "info"),
	format: format.combine(
		format.timestamp({
			format: "YYYY-MM-DD HH:mm:ss",
		}),
		format((info) => {
			info.level = info.level.toUpperCase();
			return info;
		})(),
		format.colorize(),
		format.printf((info) => {
			return `${info.timestamp} [${info.level}]: ${info.message}`;
		}),
	),
	transports: [
		new transports.Console(),
		...(config.logging?.file?.enabled
			? [
					new transports.File({
						filename: `${config.logging.file.dir}/${config.env}.log`,
					}),
				]
			: []),
	],
});

export const linovelibClient = new LinovelibClient(
	{
		session: (() => {
			if (config.credentials?.linovelib) {
				return {
					enabled: true,
					username: config.credentials.linovelib.username,
					password: config.credentials.linovelib.password,
				};
			} else
				return {
					enabled: false,
				};
		})(),
		flareSolverr: {
			enabled: config.flaresolverr.enabled,
			host: config.flaresolverr.host,
			timeoutMs: config.flaresolverr.timeoutMs,
			sessionId: config.flaresolverr.sessionId,
		},
	},
	storageService,
	logger,
);
