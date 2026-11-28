import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_MANIFESTS = [
	".dockerignore",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"package.json",
];

const EXTRA_WORKSPACE_MANIFESTS = [
	"apps/cli/package.json",
	"apps/web/package.json",
];

const SOURCE_DIRS = [
	"tools/config-typescript",
	"tools/config-tsdown",
	"packages/core",
	"packages/deobfuscator",
	"packages/browser-fetch",
	"packages/epub",
	"packages/storage",
	"packages/linovelib",
	"apps/api-server",
];

const IGNORED_DIRS = new Set(["node_modules", "dist", ".turbo", ".git"]);

function parseArgs(argv) {
	let runtimeImage = "";
	let listFiles = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--list") {
			listFiles = true;
		} else if (arg === "--runtime-image") {
			const next = argv[i + 1];
			if (next === undefined) {
				throw new Error("Missing value for --runtime-image");
			}
			runtimeImage = next;
			i++;
		} else if (arg.startsWith("--runtime-image=")) {
			runtimeImage = arg.slice("--runtime-image=".length);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return { runtimeImage, listFiles };
}

function compareCodePoints(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}

function toPosixPath(relPath) {
	return relPath.replaceAll("\\", "/");
}

function normalizeFileContent(relPath, rawBuffer) {
	if (basename(relPath) === "package.json") {
		const parsed = JSON.parse(rawBuffer.toString("utf8"));
		delete parsed.version;
		return Buffer.from(JSON.stringify(parsed), "utf8");
	}
	return rawBuffer;
}

function collectDirFiles(rootDir, relDir, out) {
	const absDir = resolve(rootDir, relDir);
	const entries = readdirSync(absDir, { withFileTypes: true });
	entries.sort((a, b) => compareCodePoints(a.name, b.name));

	for (const entry of entries) {
		const relPath = toPosixPath(join(relDir, entry.name));
		if (entry.isDirectory()) {
			if (!IGNORED_DIRS.has(entry.name)) {
				collectDirFiles(rootDir, relPath, out);
			}
			continue;
		}

		if (!entry.isFile()) {
			const absPath = resolve(rootDir, relPath);
			if (statSync(absPath).isDirectory()) {
				if (!IGNORED_DIRS.has(entry.name)) {
					collectDirFiles(rootDir, relPath, out);
				}
				continue;
			}
		}

		if (entry.name.toLowerCase().endsWith(".md")) {
			continue;
		}

		out.push(relPath);
	}
}

export function computeBuildHash({
	rootDir = process.cwd(),
	runtimeImage = "",
	listFiles = false,
} = {}) {
	const files = [...ROOT_MANIFESTS, ...EXTRA_WORKSPACE_MANIFESTS];
	for (const dir of SOURCE_DIRS) {
		collectDirFiles(rootDir, dir, files);
	}

	const hash = createHash("sha256");
	hash.update("schema=v1\n");
	hash.update(`runtime-image=${runtimeImage}\n`);

	for (const relPath of files) {
		const absPath = resolve(rootDir, relPath);
		const raw = readFileSync(absPath);
		const normalized = normalizeFileContent(relPath, raw);
		hash.update(`file\0${relPath}\0${normalized.length}\0`);
		hash.update(normalized);
		hash.update("\0");
		if (listFiles) {
			console.error(relPath);
		}
	}

	return hash.digest("hex").slice(0, 12);
}

const isCli =
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
	const { runtimeImage, listFiles } = parseArgs(process.argv.slice(2));
	const buildHash = computeBuildHash({ runtimeImage, listFiles });
	process.stdout.write(`${buildHash}\n`);
}
