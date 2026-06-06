import type { UserConfig } from "tsdown";
import { defineConfig } from "tsdown";

export const baseConfig: UserConfig = defineConfig({
	entry: ["./src/index.ts"],
	outDir: "dist",
	platform: "node",
	target: "es2022",
	dts: true,
	clean: true,
	sourcemap: true,
	report: "ci-only",
});
