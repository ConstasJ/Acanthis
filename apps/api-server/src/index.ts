import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config";
import LinovelibRoutes from "./linovelib";
import { loggerMiddleware } from "./middleware";

const app = new Hono();

app.use(loggerMiddleware);
app.route("/linovelib", LinovelibRoutes);

serve({
	fetch: app.fetch,
	port: config.port ?? 5301,
});
