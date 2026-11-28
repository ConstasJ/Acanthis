import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { config } from "./config";
import {
	linovelibClient,
	logger,
	storageService,
	volumeEpubService,
} from "./services";

const app = createApp({
	config,
	logger,
	storageService,
	linovelibClient,
	volumeEpubService,
});

const server = serve(
	{
		fetch: app.fetch,
		port: config.port ?? 5301,
		hostname: config.listenHost ?? "localhost",
	},
	(info) => {
		logger.info(`服务器正在监听 ${info.address}:${info.port}`);
		logger.debug(
			`[Config] env=${config.env} logLevel=${logger.level} auth=${Boolean(config.auth?.token)} docs=${config.docs.enabled} cookies=${config.cookies.type} session=${Boolean(config.credentials?.linovelib)} impersonate=${config.impersonate?.enabled ? config.impersonate.profile : "disabled"} flareSolverr=${config.flaresolverr.enabled ? config.flaresolverr.host : "disabled"} proxy=${Boolean(config.proxy)}`,
		);
	},
);

async function onExit(signal: string) {
	logger.info(`收到 ${signal}，正在关闭服务器...`);
	try {
		await storageService.close(logger.debug.bind(logger));
		logger.info("数据库连接已成功关闭。正在关闭服务器...");
		await new Promise<void>((resolve, reject) =>
			server.close((err) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			}),
		);
		logger.info("服务器已成功关闭。");
		process.exit(0);
	} catch (error) {
		logger.error(`关闭服务器时发生错误: ${error}`);
		process.exit(1);
	}
}

["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
	process.on(signal, () => {
		onExit(signal);
	});
});
