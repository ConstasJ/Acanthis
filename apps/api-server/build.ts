import { build } from "esbuild";

await build({
	entryPoints: ["src/index.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "esnext",
	outfile: "dist/index.js",
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	external: [
		"@babel/preset-typescript/package.json",
		"better-sqlite3",
		"isolated-vm",
		"koffi",
	],
}).catch(() => {
	process.exit(1);
});
