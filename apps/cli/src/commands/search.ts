import { defineCommand } from "citty";
import pc from "picocolors";
import { AcanthisApiClient } from "../client";
import {
	CliValidationError,
	commonApiArgs,
	resolveCommandConfig,
	writeJsonOutput,
} from "./shared";

export const searchCommand = defineCommand({
	meta: {
		name: "search",
		description: "Search novels by keyword on the configured source",
	},
	args: {
		keyword: {
			type: "positional",
			description: "Keyword to search for",
			required: true,
		},
		...commonApiArgs,
	},
	async run({ args }) {
		const keyword =
			typeof args.keyword === "string" ? args.keyword.trim() : "";
		if (!keyword) {
			throw new CliValidationError("Search keyword cannot be empty");
		}

		const config = await resolveCommandConfig({
			server: args.server,
			source: args.source,
			token: args.token,
		});
		const client = new AcanthisApiClient(config.serverUrl, config.token);
		const results = await client.searchNovels(config.defaultSource, keyword);

		if (args.json) {
			writeJsonOutput(results);
			return;
		}

		if (results.length === 0) {
			process.stdout.write(`No novels found for "${keyword}".\n`);
			return;
		}

		for (const item of results) {
			process.stdout.write(
				`${pc.cyan(`[${item.id}]`)} ${pc.bold(item.title)} ${pc.dim(`(${item.platform})`)}\n`,
			);
		}
	},
});
