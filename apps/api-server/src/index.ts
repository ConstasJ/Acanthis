import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config";
import LinovelibRoutes from "./linovelib";
import { loggerMiddleware } from "./middleware";
import { logger } from "./services";

const app = new Hono();

app.use(loggerMiddleware);
app.route("/linovelib", LinovelibRoutes);

const server = serve(
	{
		fetch: app.fetch,
		port: config.port ?? 5301,
		hostname: config.listenHost ?? "localhost",
	},
	(info) => {
		logger.info(`Server is listening on ${info.address}:${info.port}`);
	},
);

process.on("SIGINT", () => {
	logger.info("Received SIGINT, shutting down server...");
	server.close();
	process.exit(0);
});
process.on("SIGTERM", () => {
	logger.info("Received SIGTERM, shutting down server...");
	server.close((err) => {
		if (err) {
			console.error(err);
			process.exit(1);
		}
		process.exit(0);
	});
});
