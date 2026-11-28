import {
	LinovelibClient,
	type LinovelibClientOptions,
} from "@acanthis-dec/linovelib";
import { StorageService } from "@acanthis-dec/storage";
import { createLogger, format, transports } from "winston";
import { config } from "./config";
import { EpubDiskCache } from "./epub/cache";
import { SharpEpubImageProcessor } from "./epub/imageProcessor";
import { InMemoryEpubJobStore } from "./epub/jobStore";
import { VolumeEpubService } from "./epub/service";

export const storageService = new StorageService({
	db: {
		path: config.data.dbPath,
		migrations: {
			enabled: true,
			directory: config.data.migrationsPath,
		},
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
		format.errors({ stack: true }),
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

const linovelibOptions: Partial<LinovelibClientOptions> = {
	flareSolverr: {
		enabled: config.flaresolverr.enabled,
		host: config.flaresolverr.host,
		timeoutMs: config.flaresolverr.timeoutMs,
		sessionId: config.flaresolverr.sessionId,
	},
};

if (config.credentials?.linovelib) {
	linovelibOptions.session = {
		enabled: true,
		username: config.credentials.linovelib.username,
		password: config.credentials.linovelib.password,
	};
} else
	linovelibOptions.session = {
		enabled: false,
	};

if (config.impersonate?.enabled) {
	linovelibOptions.impersonate = {
		enabled: true,
		profile: config.impersonate.profile,
	};
} else
	linovelibOptions.impersonate = {
		enabled: false,
	};

if (config.proxy) {
	linovelibOptions.proxy = config.proxy;
}

if (config.cookies.type === "file") {
	linovelibOptions.cookies = {
		type: "file",
		path: (() => {
			if (config.cookies.path) {
				return config.cookies.path;
			}
			throw new Error(
				"Cookie file path is required when cookie type is set to file",
			);
		})(),
	};
} else {
	linovelibOptions.cookies = {
		type: config.cookies.type,
	};
}

export const linovelibClient = new LinovelibClient(
	linovelibOptions as LinovelibClientOptions,
	storageService,
	logger,
);

export const epubJobStore = new InMemoryEpubJobStore({
	jobTtlMs: config.epub.jobTtlMs,
});

export const epubDiskCache = new EpubDiskCache({
	cacheDir: config.epub.cacheDir,
	maxCacheBytes: config.epub.maxCacheBytes,
	logger,
});

export const epubImageProcessor = new SharpEpubImageProcessor(logger);

export const volumeEpubService = new VolumeEpubService({
	platform: "linovelib",
	linovelibClient,
	storageService,
	jobStore: epubJobStore,
	diskCache: epubDiskCache,
	imageProcessor: epubImageProcessor,
	logger,
	maxConcurrentJobs: config.epub.maxConcurrentJobs,
});
