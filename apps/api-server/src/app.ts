import type { LinovelibClient } from "@acanthis-dec/linovelib";
import type { StorageService } from "@acanthis-dec/storage";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { describeRoute, generateSpecs } from "hono-openapi";
import type { Config } from "./config";
import type { VolumeEpubService } from "./epub/service";
import { createLinovelibRoutes, type LinovelibRouteDeps } from "./linovelib";
import { createAuthMiddleware, createLoggerMiddleware } from "./middleware";
import { openApiDocumentation, scalarConfig } from "./openapi";
import { healthResponseSchema, jsonResponse } from "./schemas/common";
import { createSourcesRoutes } from "./sources";
import { createSyncRoutes } from "./sync";
import { resolveHost } from "./utils";

export interface AppDeps {
	config: Pick<Config, "cors" | "auth" | "docs" | "host">;
	logger: LinovelibRouteDeps["logger"];
	storageService: StorageService;
	linovelibClient: LinovelibClient;
	volumeEpubService: VolumeEpubService;
}

export function createApp(deps: AppDeps) {
	const app = new Hono().basePath("/v1");

	app.use(createLoggerMiddleware(deps.logger));
	app.use(
		"*",
		cors({
			origin: deps.config.cors.origin,
			allowHeaders: ["Content-Type", "Authorization"],
			allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		}),
	);

	app.get(
		"/health",
		describeRoute({
			tags: ["System"],
			operationId: "getHealth",
			summary: "服务健康检查",
			description:
				"返回当前服务端运行状态与 ISO 8601 时间戳；在启用 AUTH_TOKEN 时仍公开可访问，适用于健康探针检查",
			responses: {
				200: jsonResponse(healthResponseSchema, "服务运行正常"),
			},
		}),
		(c) =>
			c.json({
				status: "ok",
				timestamp: new Date().toISOString(),
			}),
	);

	if (deps.config.docs.enabled) {
		let specPromise:
			| Promise<Awaited<ReturnType<typeof generateSpecs>>>
			| undefined;
		app.get("/openapi.json", async (c) => {
			if (!specPromise) {
				specPromise = generateSpecs(app, {
					documentation: openApiDocumentation,
					exclude: ["/v1/openapi.json", "/v1/docs"],
				});
			}
			const baseSpec = await specPromise;
			return c.json({
				...baseSpec,
				servers: [
					{
						url: resolveHost(c, deps.config.host),
						description: "当前服务端实例（保留 /v1 路由前缀）",
					},
				],
			});
		});
		app.get("/docs", Scalar(scalarConfig));
	}

	if (deps.config.auth?.token) {
		app.use("*", createAuthMiddleware(deps.config.auth.token));
	}

	app.route("/sources", createSourcesRoutes());
	app.route(
		"/linovelib",
		createLinovelibRoutes({
			linovelibClient: deps.linovelibClient,
			storageService: deps.storageService,
			volumeEpubService: deps.volumeEpubService,
			logger: deps.logger,
			host: deps.config.host,
		}),
	);
	app.route(
		"/sync",
		createSyncRoutes({
			storageService: deps.storageService,
			logger: deps.logger,
			host: deps.config.host,
		}),
	);

	return app;
}
