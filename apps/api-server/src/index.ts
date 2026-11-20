import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config";
import LinovelibRoutes from "./linovelib";
import { createAuthMiddleware, createLoggerMiddleware } from "./middleware";
import { logger, storageService } from "./services";
import SourcesRoutes from "./sources";
import SyncRoutes from "./sync";

const app = new Hono().basePath("/v1");

app.use(createLoggerMiddleware(logger));
app.use(
	"*",
	cors({
		origin: config.cors.origin,
		allowHeaders: ["Content-Type", "Authorization"],
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
	}),
);
app.get("/health", (c) =>
	c.json({
		status: "ok",
		timestamp: new Date().toISOString(),
	}),
);
if (config.auth?.token) {
	app.use("*", createAuthMiddleware(config.auth.token));
}
app.route("/sources", SourcesRoutes);
app.route("/linovelib", LinovelibRoutes);
app.route("/sync", SyncRoutes);

const server = serve(
	{
		fetch: app.fetch,
		port: config.port ?? 5301,
		hostname: config.listenHost ?? "localhost",
	},
	(info) => {
		logger.info(`服务器正在监听 ${info.address}:${info.port}`);
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
