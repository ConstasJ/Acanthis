import type { NovelSourceDescriptor } from "@acanthis-dec/core";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
	bearerSecurity,
	jsonResponse,
	unauthorizedResponse,
} from "./schemas/common";
import { sourcesResponseSchema } from "./schemas/sources";

const SOURCES: NovelSourceDescriptor[] = [
	{
		id: "linovelib",
		name: "哔哩轻小说",
		capabilities: ["search", "novels", "illustrations", "explore"],
	},
];

export function createSourcesRoutes() {
	const app = new Hono();

	app.get(
		"/",
		describeRoute({
			tags: ["Sources"],
			operationId: "listSources",
			summary: "获取已接入小说源列表",
			description: "返回当前服务端启用的小说源及其支持的功能能力清单",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(sourcesResponseSchema, "成功返回已接入小说源列表"),
				401: unauthorizedResponse,
			},
		}),
		(c) => {
			return c.json({
				code: 0,
				message: "Success",
				data: SOURCES,
			});
		},
	);

	return app;
}
