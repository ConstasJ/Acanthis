import { copyFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";

/**
 * 规避 esbuild 单文件打包动态 import("impers") 时丢失顶层 await 的问题：
 * impers/dist/index.js 仅通过 `export * from "./public.js"` 转发包含 TLA（libcurl.js）的模块，
 * esbuild 在单文件 ESM 模式下生成入口 __esm 包装时会漏掉对 init_public() 的 await，
 * 导致首次调用时 `this.impers.Session` 尚未初始化（`is not a constructor`）。
 * 显式前置 `import "./public.js"` 可强制 esbuild 正确生成 `await init_public()`。
 */
const fixImpersTlaPlugin: Plugin = {
	name: "fix-impers-tla",
	setup(pluginBuild) {
		pluginBuild.onLoad(
			{ filter: /[\\/]impers[\\/]dist[\\/]index\.js$/ },
			async (args) => {
				const source = await readFile(args.path, "utf8");
				return {
					contents: `import "./public.js";\n${source}`,
					loader: "js",
				};
			},
		);
	},
};

await build({
	entryPoints: ["src/index.ts"],
	bundle: true,
	minify: true,
	platform: "node",
	format: "esm",
	target: "esnext",
	outfile: "dist/index.js",
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	plugins: [fixImpersTlaPlugin],
	external: [
		"@babel/preset-typescript/package.json",
		"@libsql/client",
		"isolated-vm",
		"koffi",
		"onnxruntime-node",
		// hono-openapi / @standard-community/* 的可选多校验库动态导入（服务端仅使用 Zod v4）
		"@valibot/to-json-schema",
		"effect",
		"sury",
		"zod-openapi",
		"zod-to-json-schema",
	],
}).catch(() => {
	process.exit(1);
});

// 验证码识别模型是运行时从磁盘加载的，需要跟服务端 bundle 放在同一目录。
await copyFile(
	fileURLToPath(
		new URL(
			"../../packages/linovelib/assets/captcha_cropped.onnx",
			import.meta.url,
		),
	),
	fileURLToPath(new URL("./dist/captcha_cropped.onnx", import.meta.url)),
);
