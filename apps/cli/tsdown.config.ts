import { baseConfig } from "@acanthis-dec/config-tsdown";
import { defineConfig } from "tsdown";

export default defineConfig({
	...baseConfig,
	dts: false,
	banner: {
		js: "#!/usr/bin/env node",
	},
	outExtensions: () => ({
		js: ".mjs",
	}),
});
