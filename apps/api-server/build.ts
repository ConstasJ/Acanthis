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
	],
}).catch(() => {
	process.exit(1);
});
