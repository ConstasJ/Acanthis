import { LinovelibClient } from "@acanthis-dec/linovelib";
import { StorageService } from "@acanthis-dec/storage";
import * as winston from "winston";
import { config } from "./config";

export const storageService = new StorageService({
	db: {
		path: config.data.dbPath ?? "data/db.sqlite",
	},
	dataDir: config.data.filePath ?? "data",
});

export const logger = winston.createLogger({
	level:
		config.logging?.level ?? (config.env === "development" ? "debug" : "info"),
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.cli(),
		winston.format.errors({ stack: true }),
		winston.format.printf(({ timestamp, level, message }) => {
			return `${timestamp} [${level.toUpperCase()}]: ${message}`;
		}),
	),
	transports: [
		new winston.transports.Console(),
		...(config.logging?.file?.enabled
			? [
					new winston.transports.File({
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
	},
	storageService,
	logger,
);
