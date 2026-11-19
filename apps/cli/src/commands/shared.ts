import pc from "picocolors";
import { ApiClientError } from "../client";
import { CliConfigError, loadCliConfig } from "../config";
import type { ResolvedCliConfig } from "../types";
import { VolumeSelectionError } from "../utils";

export const serverTokenArgs = {
	server: {
		type: "string",
		alias: "s",
		description: "Acanthis API server base URL",
		valueHint: "url",
	},
	token: {
		type: "string",
		alias: "t",
		description: "Optional Bearer auth token",
		valueHint: "token",
	},
	json: {
		type: "boolean",
		default: false,
		description: "Output structured JSON only to stdout",
	},
} as const;

export const commonApiArgs = {
	...serverTokenArgs,
	source: {
		type: "string",
		description: "Novel source identifier",
		valueHint: "platform",
	},
} as const;

export class CliValidationError extends Error {
	readonly exitCode = 2;

	constructor(message: string, options?: { cause?: unknown }) {
		super(
			message,
			options?.cause !== undefined ? { cause: options.cause } : undefined,
		);
		this.name = "CliValidationError";
	}
}

export function isCittyCliError(error: unknown): boolean {
	return error instanceof Error && error.name === "CLIError";
}

export function getErrorExitCode(error: unknown): number {
	if (
		error instanceof CliConfigError ||
		error instanceof CliValidationError ||
		error instanceof VolumeSelectionError ||
		isCittyCliError(error)
	) {
		return 2;
	}
	if (error instanceof ApiClientError) {
		return error.exitCode;
	}
	return 1;
}

export function formatErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function writeJsonOutput(payload: unknown): void {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function writeProgressLine(message: string, json: boolean): void {
	if (json) {
		process.stderr.write(`${message}\n`);
		return;
	}
	process.stderr.write(`${pc.dim(message)}\n`);
}

export function writeWarningLine(message: string, json: boolean): void {
	if (json) {
		process.stderr.write(`[warn] ${message}\n`);
		return;
	}
	process.stderr.write(`${pc.yellow("Warning:")} ${message}\n`);
}

export function writeErrorLine(message: string, json: boolean): void {
	if (json) {
		process.stderr.write(`${JSON.stringify({ error: message })}\n`);
		return;
	}
	process.stderr.write(`${pc.red("Error:")} ${message}\n`);
}

export function optionalStringArg(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function parsePositiveIntArg(
	raw: unknown,
	flagName: string,
): number | undefined {
	const value = optionalStringArg(raw);
	if (value === undefined) {
		return undefined;
	}
	if (!/^\d+$/.test(value)) {
		throw new CliValidationError(
			`Invalid value for ${flagName}: "${value}". Expected a positive integer.`,
		);
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new CliValidationError(
			`Invalid value for ${flagName}: "${value}". Expected a positive integer >= 1.`,
		);
	}
	return parsed;
}

export async function resolveCommandConfig(args: {
	server?: unknown;
	source?: unknown;
	token?: unknown;
	output?: unknown;
}): Promise<ResolvedCliConfig> {
	const overrides: Partial<ResolvedCliConfig> = {};
	const serverUrl = optionalStringArg(args.server);
	if (serverUrl !== undefined) {
		overrides.serverUrl = serverUrl;
	}
	const defaultSource = optionalStringArg(args.source);
	if (defaultSource !== undefined) {
		overrides.defaultSource = defaultSource;
	}
	const token = optionalStringArg(args.token);
	if (token !== undefined) {
		overrides.token = token;
	}
	const outputDir = optionalStringArg(args.output);
	if (outputDir !== undefined) {
		overrides.outputDir = outputDir;
	}
	return await loadCliConfig(overrides);
}
