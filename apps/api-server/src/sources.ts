import type { NovelSourceDescriptor } from "@acanthis-dec/core";
import { Hono } from "hono";

const SOURCES: NovelSourceDescriptor[] = [
	{
		id: "linovelib",
		name: "哔哩轻小说",
		capabilities: ["search", "novels", "illustrations"],
	},
];

const app = new Hono();

app.get("/", (c) => {
	return c.json({
		code: 0,
		message: "Success",
		data: SOURCES,
	});
});

export default app;
