import { defineCommand } from "citty";
import pc from "picocolors";
import { AcanthisApiClient } from "../client";
import {
	commonApiArgs,
	parsePositiveIntArg,
	resolveCommandConfig,
	writeJsonOutput,
} from "./shared";

export const listCommand = defineCommand({
	meta: {
		name: "list",
		description: "List cached novels stored on the Acanthis API server",
	},
	args: {
		page: {
			type: "string",
			description: "Page number (1-based)",
			valueHint: "number",
		},
		"page-size": {
			type: "string",
			description: "Number of items per page",
			valueHint: "number",
		},
		...commonApiArgs,
	},
	async run({ args }) {
		const page = parsePositiveIntArg(args.page, "--page");
		const pageSize = parsePositiveIntArg(args["page-size"], "--page-size");

		const config = await resolveCommandConfig({
			server: args.server,
			source: args.source,
			token: args.token,
		});
		const client = new AcanthisApiClient(config.serverUrl, config.token);
		const result = await client.listNovels(
			config.defaultSource,
			page,
			pageSize,
		);

		if (args.json) {
			writeJsonOutput(result);
			return;
		}

		process.stdout.write(
			`${pc.bold(`Page ${result.page}`)} ${pc.dim(`(${result.items.length} shown, total ${result.total}, pageSize ${result.pageSize})`)}\n`,
		);
		if (result.items.length === 0) {
			process.stdout.write("No cached novels found.\n");
			return;
		}

		for (const item of result.items) {
			process.stdout.write(
				`${pc.cyan(`[${item.id}]`)} ${pc.bold(item.title)} — ${item.author} ${pc.dim(`[${item.status}]`)}\n`,
			);
		}
	},
});
