import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateSpecs } from "hono-openapi";
import { createApp } from "../src/app";
import { openApiDocumentation } from "../src/openapi";

const OUTPUT_PATH = fileURLToPath(new URL("../openapi.json", import.meta.url));
const BIOME_BIN = fileURLToPath(
	new URL(
		process.platform === "win32"
			? "../../../node_modules/.bin/biome.cmd"
			: "../../../node_modules/.bin/biome",
		import.meta.url,
	),
);

function normalizeLineEndings(text: string): string {
	return text.replaceAll("\r\n", "\n");
}

function formatWithBiome(rawJson: string): string {
	const args = ["format", "--stdin-file-path", OUTPUT_PATH];
	return process.platform === "win32"
		? execFileSync("cmd.exe", ["/c", BIOME_BIN, ...args], {
				input: rawJson,
				encoding: "utf8",
			})
		: execFileSync(BIOME_BIN, args, {
				input: rawJson,
				encoding: "utf8",
			});
}

async function buildFormattedSpec(): Promise<string> {
	const app = createApp({
		config: {
			cors: { origin: "*" },
			docs: { enabled: false },
			host: "http://localhost:5301",
		},
		logger: {
			debug() {},
			info() {},
			warn() {},
			error() {},
		},
		storageService: {} as never,
		linovelibClient: {} as never,
		volumeEpubService: {} as never,
	});

	const spec = await generateSpecs(app, {
		documentation: openApiDocumentation,
	});

	return formatWithBiome(`${JSON.stringify(spec, null, "\t")}\n`);
}

async function main() {
	const isCheck = process.argv.includes("--check");
	const formatted = await buildFormattedSpec();

	if (isCheck) {
		let existing: string;
		try {
			existing = await readFile(OUTPUT_PATH, "utf8");
		} catch (error) {
			console.error(
				`[openapi:check] 无法读取 ${OUTPUT_PATH}，请先运行 pnpm --filter=@acanthis-dec/api-server run openapi:generate`,
				error,
			);
			process.exit(1);
		}

		if (normalizeLineEndings(existing) !== normalizeLineEndings(formatted)) {
			console.error(
				`[openapi:check] ${OUTPUT_PATH} 已与当前路由或 Schema 定义不一致，请运行 pnpm --filter=@acanthis-dec/api-server run openapi:generate 更新。`,
			);
			process.exit(1);
		}

		console.log(`[openapi:check] OpenAPI 契约检查通过: ${OUTPUT_PATH}`);
		return;
	}

	await writeFile(OUTPUT_PATH, formatted, "utf8");
	console.log(`[openapi:generate] 已生成 OpenAPI 契约文档: ${OUTPUT_PATH}`);
}

await main();
