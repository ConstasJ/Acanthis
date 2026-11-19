import { baseConfig } from "@acanthis-dec/config-tsdown";
import { defineConfig } from "tsdown";

const DIRECT_EXTERNAL_PACKAGES = new Set([
	"@clack/prompts",
	"citty",
	"picocolors",
	"zod",
]);

function isDirectExternalPackage(id: string): boolean {
	if (DIRECT_EXTERNAL_PACKAGES.has(id)) {
		return true;
	}
	for (const pkg of DIRECT_EXTERNAL_PACKAGES) {
		if (id.startsWith(`${pkg}/`)) {
			return true;
		}
	}
	return false;
}

export default defineConfig({
	...baseConfig,
	dts: false,
	banner: {
		js: "#!/usr/bin/env node",
	},
	deps: {
		alwaysBundle: (id) =>
			!id.startsWith("node:") &&
			!id.startsWith(".") &&
			!id.startsWith("/") &&
			!isDirectExternalPackage(id),
		onlyBundle: false,
	},
	outExtensions: () => ({
		js: ".mjs",
	}),
});
