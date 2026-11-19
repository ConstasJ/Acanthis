import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import z from "zod";
import { normalizeServerUrl } from "./client";
import type {
	CliConfigKey,
	CliStoredConfig,
	ResolvedCliConfig,
} from "./types";

const DEFAULT_SERVER_URL = "http://localhost:5301";
const DEFAULT_SOURCE = "linovelib";
const DEFAULT_OUTPUT_DIR = ".";

const VALID_CONFIG_KEYS: readonly CliConfigKey[] = [
	"serverUrl",
	"token",
	"defaultSource",
	"outputDir",
];

const storedConfigSchema = z.object({
	serverUrl: z.string().optional(),
	token: z.string().optional(),
	defaultSource: z.string().optional(),
	outputDir: z.string().optional(),
});

export class CliConfigError extends Error {
	readonly exitCode = 2;

	constructor(message: string, options?: { cause?: unknown }) {
		super(
			message,
			options?.cause !== undefined ? { cause: options.cause } : undefined,
		);
		this.name = "CliConfigError";
	}
}

function nonEmpty(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function getConfigFilePath(): string {
	if (process.platform === "win32") {
		const appData =
			nonEmpty(process.env.APPDATA) ??
			path.join(os.homedir(), "AppData", "Roaming");
		return path.join(appData, "acanthis", "config.json");
	}
	const xdgConfigHome =
		nonEmpty(process.env.XDG_CONFIG_HOME) ?? path.join(os.homedir(), ".config");
	return path.join(xdgConfigHome, "acanthis", "config.json");
}

export async function readStoredConfig(): Promise<CliStoredConfig> {
	const filePath = getConfigFilePath();
	let raw: string;
	try {
		raw = await fs.readFile(filePath, "utf8");
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return {};
		}
		throw new CliConfigError(`Failed to read CLI config file: ${filePath}`, {
			cause: error,
		});
	}

	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(raw);
	} catch (error) {
		throw new CliConfigError(
			`Invalid JSON in CLI config file (${filePath}): ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}

	const validation = storedConfigSchema.safeParse(parsedJson);
	if (!validation.success) {
		throw new CliConfigError(
			`Invalid CLI config schema in ${filePath}: ${validation.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ")}`,
		);
	}

	return validation.data;
}

export async function loadCliConfig(
	overrides?: Partial<ResolvedCliConfig>,
): Promise<ResolvedCliConfig> {
	const stored = await readStoredConfig();

	const rawServerUrl =
		nonEmpty(overrides?.serverUrl) ??
		nonEmpty(process.env.ACANTHIS_SERVER_URL) ??
		nonEmpty(stored.serverUrl) ??
		DEFAULT_SERVER_URL;

	let serverUrl: string;
	try {
		serverUrl = normalizeServerUrl(rawServerUrl);
	} catch (error) {
		throw new CliConfigError(
			`Invalid serverUrl "${rawServerUrl}": ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}

	const token =
		nonEmpty(overrides?.token) ??
		nonEmpty(process.env.ACANTHIS_API_TOKEN) ??
		nonEmpty(stored.token);

	const defaultSource =
		nonEmpty(overrides?.defaultSource) ??
		nonEmpty(process.env.ACANTHIS_SOURCE) ??
		nonEmpty(stored.defaultSource) ??
		DEFAULT_SOURCE;

	const outputDir =
		nonEmpty(overrides?.outputDir) ??
		nonEmpty(process.env.ACANTHIS_OUTPUT_DIR) ??
		nonEmpty(stored.outputDir) ??
		DEFAULT_OUTPUT_DIR;

	return {
		serverUrl,
		token,
		defaultSource,
		outputDir,
	};
}

export async function saveCliConfigValue(
	key: CliConfigKey,
	value: string,
): Promise<ResolvedCliConfig> {
	if (!VALID_CONFIG_KEYS.includes(key)) {
		throw new CliConfigError(
			`Invalid config key "${String(key)}". Expected one of: ${VALID_CONFIG_KEYS.join(", ")}`,
		);
	}

	const current = await readStoredConfig();
	const next: CliStoredConfig = { ...current };
	const trimmed = value.trim();

	switch (key) {
		case "serverUrl": {
			if (!trimmed) {
				throw new CliConfigError("Config value for serverUrl cannot be empty");
			}
			try {
				next.serverUrl = normalizeServerUrl(trimmed);
			} catch (error) {
				throw new CliConfigError(
					`Invalid serverUrl "${trimmed}": ${error instanceof Error ? error.message : String(error)}`,
					{ cause: error },
				);
			}
			break;
		}
		case "token": {
			if (!trimmed) {
				delete next.token;
			} else {
				next.token = trimmed;
			}
			break;
		}
		case "defaultSource": {
			if (!trimmed) {
				throw new CliConfigError(
					"Config value for defaultSource cannot be empty",
				);
			}
			next.defaultSource = trimmed;
			break;
		}
		case "outputDir": {
			if (!trimmed) {
				throw new CliConfigError("Config value for outputDir cannot be empty");
			}
			next.outputDir = trimmed;
			break;
		}
	}

	const filePath = getConfigFilePath();
	const dir = path.dirname(filePath);
	await fs.mkdir(dir, { recursive: true });

	const tempPath = path.join(
		dir,
		`.config.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
	);

	try {
		await fs.writeFile(tempPath, `${JSON.stringify(next, null, "\t")}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		await fs.rename(tempPath, filePath);
	} catch (error) {
		await fs.rm(tempPath, { force: true }).catch(() => {});
		throw new CliConfigError(`Failed to write CLI config file: ${filePath}`, {
			cause: error,
		});
	}

	return await loadCliConfig();
}

export async function resetCliConfig(): Promise<void> {
	const filePath = getConfigFilePath();
	await fs.rm(filePath, { force: true });
}
