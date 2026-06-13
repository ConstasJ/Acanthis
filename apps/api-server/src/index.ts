import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config";
import LinovelibRoutes from "./linovelib";
import { loggerMiddleware } from "./middleware";
import { logger } from "./services";

const app = new Hono();

app.use(loggerMiddleware);
app.route("/linovelib", LinovelibRoutes);

serve({
	fetch: app.fetch,
	port: config.port ?? 5301,
	hostname: config.listenHost ?? "localhost", 
}, (info) => {
	logger.info(`Server is listening on ${info.address}:${info.port}`);
});
