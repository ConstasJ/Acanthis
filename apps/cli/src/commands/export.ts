import { isCI } from "@clack/prompts";
import { defineCommand } from "citty";
import pc from "picocolors";
import { AcanthisApiClient } from "../client";
import { runExport } from "../exporter";
import {
	createExportProgressRenderer,
	formatProgressLogLine,
} from "../progress";
import type { ExportMode, ExportSummary } from "../types";
import { parseNovelIdOrUrl } from "../utils";
import {
	CliValidationError,
	commonApiArgs,
	resolveCommandConfig,
	writeJsonOutput,
	writeProgressLine,
	writeWarningLine,
} from "./shared";

export const exportCommand = defineCommand({
	meta: {
		name: "export",
		description: "Export a novel to split or merged EPUB 3.0 file(s)",
	},
	args: {
		novelIdOrUrl: {
			type: "positional",
			description: "Novel ID or URL",
			required: true,
		},
		...commonApiArgs,
		output: {
			type: "string",
			alias: "o",
			description:
				"Base output directory (supports relative paths and ~; defaults to current directory)",
			valueHint: "dir",
		},
		subdir: {
			type: "boolean",
			default: true,
			description:
				"Create a subdirectory named after the novel title inside the base output directory",
			negativeDescription:
				"Write EPUB file(s) directly into the base output directory without a novel subdirectory",
		},
		mode: {
			type: "string",
			alias: "m",
			default: "split",
			description: "Export mode: split or merged",
			valueHint: "split|merged",
		},
		merged: {
			type: "boolean",
			default: false,
			description: "Shortcut for --mode merged",
		},
		volumes: {
			type: "string",
			alias: "v",
			description: "Volume selection (e.g. 1,3-5 or volume IDs)",
			valueHint: "spec",
		},
		illustrations: {
			type: "boolean",
			default: true,
			description: "Download and embed chapter illustrations",
			negativeDescription: "Skip chapter illustrations (cover only)",
		},
		strict: {
			type: "boolean",
			default: false,
			description:
				"Abort with exit code 1 on unresolved chapters or media download failures",
		},
		overwrite: {
			type: "boolean",
			default: false,
			description: "Overwrite existing .epub files",
		},
	},
	async run({ args }) {
		const isJson = Boolean(args.json);

		const rawMode =
			typeof args.mode === "string" ? args.mode.trim().toLowerCase() : "split";
		if (rawMode !== "split" && rawMode !== "merged") {
			throw new CliValidationError(
				`Invalid --mode value "${String(args.mode)}". Expected "split" or "merged".`,
			);
		}
		const effectiveMode: ExportMode = args.merged ? "merged" : rawMode;

		const rawNovelInput =
			typeof args.novelIdOrUrl === "string" ? args.novelIdOrUrl : "";
		try {
			parseNovelIdOrUrl(rawNovelInput);
		} catch (error) {
			throw new CliValidationError(
				error instanceof Error ? error.message : String(error),
				{ cause: error },
			);
		}

		let volumesSpec: string | undefined;
		if (args.volumes !== undefined) {
			if (typeof args.volumes !== "string" || args.volumes.trim() === "") {
				throw new CliValidationError(
					"Invalid --volumes (-v) value: volume selection cannot be empty.",
				);
			}
			volumesSpec = args.volumes;
		}

		const config = await resolveCommandConfig({
			server: args.server,
			source: args.source,
			token: args.token,
			output: args.output,
		});

		const client = new AcanthisApiClient(config.serverUrl, config.token);
		const useRichProgress =
			!isJson &&
			Boolean(process.stdout.isTTY) &&
			Boolean(process.stderr.isTTY) &&
			!isCI();
		const progressRenderer = useRichProgress
			? createExportProgressRenderer({
					withGuide: false,
					illustrations: args.illustrations !== false,
					mode: effectiveMode,
				})
			: undefined;

		if (progressRenderer) {
			progressRenderer.start(`Exporting novel from ${config.defaultSource}...`);
		}

		let summary: ExportSummary;
		try {
			summary = await runExport(
				client,
				{
					novelIdOrUrl: rawNovelInput,
					serverUrl: config.serverUrl,
					source: config.defaultSource,
					token: config.token,
					outputDir: config.outputDir,
					subdir: args.subdir !== false,
					mode: effectiveMode,
					volumes: volumesSpec,
					illustrations: args.illustrations !== false,
					strict: Boolean(args.strict),
					overwrite: Boolean(args.overwrite),
					json: isJson,
				},
				{
					onProgress: (event) => {
						if (progressRenderer) {
							progressRenderer.update(event);
						} else {
							const line = formatProgressLogLine(event);
							if (line !== undefined) {
								writeProgressLine(line, isJson);
							}
						}
					},
					onWarning: (message) => {
						if (!progressRenderer) {
							writeWarningLine(message, isJson);
						}
					},
				},
			);
			if (progressRenderer) {
				progressRenderer.stop(`Exported "${summary.novelTitle}"`);
			}
		} catch (error) {
			if (progressRenderer) {
				progressRenderer.error("Export failed");
			}
			throw error;
		}

		if (isJson) {
			writeJsonOutput(summary);
			return;
		}

		process.stdout.write(
			`\n${pc.bold(summary.novelTitle)} ${pc.dim(`(source=${summary.source}, mode=${summary.mode})`)}\n`,
		);
		for (const file of summary.files) {
			const statusLabel = file.skipped
				? pc.yellow("SKIPPED")
				: pc.green("WRITTEN");
			process.stdout.write(
				`  ${statusLabel}  ${file.path} ${pc.dim(`(${file.chapterCount} chapters)`)}\n`,
			);
		}
		if (progressRenderer && summary.warnings.length > 0) {
			for (const warning of summary.warnings) {
				writeWarningLine(warning, false);
			}
		}
	},
});
