import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config";
import LinovelibRoutes from "./linovelib";

const app = new Hono();

app.route("/linovelib", LinovelibRoutes);

serve({
	fetch: app.fetch,
	port: config.port ?? 5301,
});
