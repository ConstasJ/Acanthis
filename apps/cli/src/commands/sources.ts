import { defineCommand } from "citty";
import pc from "picocolors";
import { AcanthisApiClient } from "../client";
import {
	resolveCommandConfig,
	serverTokenArgs,
	writeJsonOutput,
} from "./shared";

export const sourcesCommand = defineCommand({
	meta: {
		name: "sources",
		description: "List novel sources available on the Acanthis API server",
	},
	args: {
		...serverTokenArgs,
	},
	async run({ args }) {
		const config = await resolveCommandConfig({
			server: args.server,
			token: args.token,
		});
		const client = new AcanthisApiClient(config.serverUrl, config.token);
		const sources = await client.getSources();

		if (args.json) {
			writeJsonOutput(sources);
			return;
		}

		if (sources.length === 0) {
			process.stdout.write("No sources reported by server.\n");
			return;
		}

		for (const source of sources) {
			const capabilities =
				source.capabilities.length > 0
					? source.capabilities.join(", ")
					: "none";
			process.stdout.write(
				`${pc.cyan(source.id)}  ${pc.bold(source.name)}  ${pc.dim(`[${capabilities}]`)}\n`,
			);
		}
	},
});
