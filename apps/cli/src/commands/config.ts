import { defineCommand } from "citty";
import pc from "picocolors";
import {
	getConfigFilePath,
	loadCliConfig,
	readStoredConfig,
	resetCliConfig,
	saveCliConfigValue,
} from "../config";
import type { CliConfigKey } from "../types";
import { CliValidationError, writeJsonOutput } from "./shared";

const VALID_ACTIONS = ["get", "set", "list", "reset", "path"] as const;
type ConfigAction = (typeof VALID_ACTIONS)[number];

const VALID_KEYS: readonly CliConfigKey[] = [
	"serverUrl",
	"token",
	"defaultSource",
	"outputDir",
];

function parseAction(raw: unknown): ConfigAction {
	if (typeof raw !== "string" || !VALID_ACTIONS.includes(raw as ConfigAction)) {
		throw new CliValidationError(
			`Invalid config action "${String(raw ?? "")}". Expected one of: ${VALID_ACTIONS.join(", ")}`,
		);
	}
	return raw as ConfigAction;
}

function parseConfigKey(raw: unknown): CliConfigKey {
	if (typeof raw !== "string" || !VALID_KEYS.includes(raw as CliConfigKey)) {
		throw new CliValidationError(
			`Invalid config key "${String(raw ?? "")}". Expected one of: ${VALID_KEYS.join(", ")}`,
		);
	}
	return raw as CliConfigKey;
}

export const configCommand = defineCommand({
	meta: {
		name: "config",
		description: "Manage persistent CLI configuration (get, set, list, reset, path)",
	},
	args: {
		action: {
			type: "positional",
			description: "Config action: get, set, list, reset, path",
			required: true,
		},
		key: {
			type: "positional",
			description: `Config key (${VALID_KEYS.join(", ")})`,
			required: false,
		},
		value: {
			type: "positional",
			description: "Config value (required for set)",
			required: false,
		},
		json: {
			type: "boolean",
			default: false,
			description: "Output structured JSON only to stdout",
		},
	},
	async run({ args }) {
		const action = parseAction(args.action);
		const isJson = Boolean(args.json);

		switch (action) {
			case "path": {
				const configPath = getConfigFilePath();
				if (isJson) {
					writeJsonOutput({ path: configPath });
				} else {
					process.stdout.write(`${configPath}\n`);
				}
				return;
			}
			case "list": {
				const configPath = getConfigFilePath();
				const stored = await readStoredConfig();
				const resolved = await loadCliConfig();
				if (isJson) {
					writeJsonOutput({ path: configPath, stored, resolved });
					return;
				}
				process.stdout.write(`${pc.dim(`Config file: ${configPath}`)}\n`);
				for (const key of VALID_KEYS) {
					const val = resolved[key];
					process.stdout.write(
						`${pc.cyan(key)}: ${val !== undefined ? val : pc.dim("(not set)")}\n`,
					);
				}
				return;
			}
			case "get": {
				const key = parseConfigKey(args.key);
				const stored = await readStoredConfig();
				const resolved = await loadCliConfig();
				const value = resolved[key];
				if (isJson) {
					writeJsonOutput({
						key,
						value: value ?? null,
						storedValue: stored[key] ?? null,
					});
					return;
				}
				process.stdout.write(`${value ?? "(not set)"}\n`);
				return;
			}
			case "set": {
				const key = parseConfigKey(args.key);
				if (typeof args.value !== "string") {
					throw new CliValidationError(
						`Missing value for "config set ${key} <value>"`,
					);
				}
				const updated = await saveCliConfigValue(key, args.value);
				if (isJson) {
					writeJsonOutput({
						key,
						value: updated[key] ?? null,
						config: updated,
					});
					return;
				}
				process.stdout.write(
					`${pc.green("Updated")} ${pc.cyan(key)} = ${updated[key] ?? "(cleared)"}\n`,
				);
				return;
			}
			case "reset": {
				const configPath = getConfigFilePath();
				await resetCliConfig();
				if (isJson) {
					writeJsonOutput({ reset: true, path: configPath });
					return;
				}
				process.stdout.write(
					`${pc.green("Reset")} CLI configuration (${configPath})\n`,
				);
				return;
			}
		}
	},
});
