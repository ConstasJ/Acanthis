import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

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
	external: [
		"@babel/preset-typescript/package.json",
		"@libsql/client",
		"isolated-vm",
		"koffi",
		"onnxruntime-node",
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
