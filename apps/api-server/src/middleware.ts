import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { logger } from "./services";

function parseClientIp(c: Context): string {
	const aliRealClientIp =
		c.req.header("ali-real-client-ip") ??
		c.req.header("Ali-Real-Client-IP") ??
		"";
	if (aliRealClientIp) {
		return aliRealClientIp.trim() ?? "unknown";
	}
	const xForwardedFor =
		c.req.header("x-forwarded-for") ?? c.req.header("X-Forwarded-For") ?? "";
	if (xForwardedFor) {
		return xForwardedFor?.split(",")[0]?.trim() ?? "unknown";
	}
	const xRealIp = c.req.header("x-real-ip") ?? c.req.header("X-Real-Ip") ?? "";
	if (xRealIp) {
		return xRealIp.trim() ?? "unknown";
	}
	return getConnInfo(c).remote.address ?? "unknown";
}

export const loggerMiddleware = createMiddleware(async (c, next) => {
	const start = Date.now();
	await next();
	const end = Date.now();
	const logMessage = `method=${c.req.method} path=${c.req.path} status=${c.res.status} duration=${end - start}ms ip=${parseClientIp(c)}`;
	logger.info(logMessage);
});
