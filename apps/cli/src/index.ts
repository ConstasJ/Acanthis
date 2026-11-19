import {
	type ArgsDef,
	type CommandDef,
	defineCommand,
	renderUsage,
	runCommand,
	showUsage,
	type SubCommandsDef,
} from "citty";
import pkg from "../package.json" with { type: "json" };
import { configCommand } from "./commands/config";
import { exportCommand } from "./commands/export";
import { infoCommand } from "./commands/info";
import { listCommand } from "./commands/list";
import { searchCommand } from "./commands/search";
import {
	CliValidationError,
	formatErrorMessage,
	getErrorExitCode,
	isCittyCliError,
	writeErrorLine,
} from "./commands/shared";
import { sourcesCommand } from "./commands/sources";
import { runInteractiveWizard } from "./interactive";

const subCommands: SubCommandsDef = {
	export: exportCommand,
	search: searchCommand,
	list: listCommand,
	sources: sourcesCommand,
	info: infoCommand,
	config: configCommand,
};

export const mainCommand = defineCommand<ArgsDef>({
	meta: {
		name: "acanthis",
		version: pkg.version,
		description: "Dual-mode EPUB 3.0 export CLI for Acanthis",
	},
	subCommands,
});

function hasFlagBeforeDoubleDash(
	rawArgs: readonly string[],
	flags: readonly string[],
): boolean {
	for (const arg of rawArgs) {
		if (arg === "--") {
			break;
		}
		if (flags.includes(arg)) {
			return true;
		}
	}
	return false;
}

const VALUE_FLAGS_BEFORE_SUBCOMMAND = new Set([
	"-s",
	"--server",
	"--source",
	"-t",
	"--token",
]);

function findFirstPositionalToken(
	rawArgs: readonly string[],
): { token: string; index: number } | undefined {
	for (let i = 0; i < rawArgs.length; i += 1) {
		const arg = rawArgs[i];
		if (arg === undefined || arg === "--") {
			return undefined;
		}
		if (arg.startsWith("-")) {
			if (!arg.includes("=") && VALUE_FLAGS_BEFORE_SUBCOMMAND.has(arg)) {
				i += 1;
			}
			continue;
		}
		return { token: arg, index: i };
	}
	return undefined;
}

async function resolveSubCommandByName(
	name: string,
): Promise<CommandDef<ArgsDef> | undefined> {
	if (!Object.hasOwn(subCommands, name)) {
		return undefined;
	}
	const entry = subCommands[name];
	if (entry === undefined) {
		return undefined;
	}
	return typeof entry === "function" ? await entry() : await entry;
}

async function main(): Promise<void> {
	const rawArgs = process.argv.slice(2);
	const firstToken = findFirstPositionalToken(rawArgs);
	const matchedSubCommand = firstToken
		? await resolveSubCommandByName(firstToken.token)
		: undefined;

	if (hasFlagBeforeDoubleDash(rawArgs, ["--help", "-h"])) {
		if (matchedSubCommand) {
			await showUsage(matchedSubCommand, mainCommand);
		} else {
			await showUsage(mainCommand);
		}
		return;
	}

	if (
		rawArgs.length === 1 &&
		(rawArgs[0] === "--version" || rawArgs[0] === "-v" || rawArgs[0] === "-V")
	) {
		process.stdout.write(`${pkg.version}\n`);
		return;
	}

	const isJson = hasFlagBeforeDoubleDash(rawArgs, ["--json"]);

	try {
		if (!firstToken) {
			if (rawArgs.length === 0) {
				if (process.stdin.isTTY && process.stdout.isTTY) {
					await runInteractiveWizard();
					return;
				}
				await showUsage(mainCommand);
				process.exitCode = 1;
				return;
			}
			throw new CliValidationError(
				`Missing command before option "${rawArgs[0] ?? ""}"`,
			);
		}

		if (!matchedSubCommand) {
			throw new CliValidationError(`Unknown command "${firstToken.token}"`);
		}

		const subRawArgs = [
			...rawArgs.slice(0, firstToken.index),
			...rawArgs.slice(firstToken.index + 1),
		];
		await runCommand(matchedSubCommand, { rawArgs: subRawArgs });
	} catch (error) {
		const exitCode = getErrorExitCode(error);
		writeErrorLine(formatErrorMessage(error), isJson);
		if (
			!isJson &&
			(isCittyCliError(error) || error instanceof CliValidationError)
		) {
			const usage = await renderUsage(
				matchedSubCommand ?? mainCommand,
				matchedSubCommand ? mainCommand : undefined,
			);
			process.stderr.write(`\n${usage}\n`);
		}
		process.exitCode = exitCode;
	}
}

void main();
