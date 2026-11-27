import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import {
	isCancel,
	S_BAR,
	S_BAR_END,
	symbol,
	symbolBar,
	text,
	unicodeOr,
} from "@clack/prompts";
import pc from "picocolors";
import { getDisplayWidth, truncateAnsi, truncatePlain } from "./progress";

const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const CHEVRON = unicodeOr("▸", ">");
const ARROW_RIGHT = unicodeOr("→", "->");
const ELLIPSIS = unicodeOr("…", "...");

export const DIR_PROMPT_CANCEL = Symbol("acanthis:dir-prompt-cancel");

/**
 * Checks whether a value returned from `promptDirectory` indicates cancellation.
 */
export function isDirectoryPromptCancel(value: unknown): value is symbol {
	return value === DIR_PROMPT_CANCEL;
}

export interface DirectoryCompletionOptions {
	cwd?: string | undefined;
	homeDir?: string | undefined;
	cache?: Map<string, string[]> | undefined;
	platform?: NodeJS.Platform | undefined;
}

export interface DirectoryCompletionResult {
	matches: string[];
	labels: string[];
	commonPrefix: string;
	ghostSuffix: string;
	resolvedParentDir: string;
}

export interface DirectoryPromptOptions {
	message: string;
	initialValue?: string | undefined;
	placeholder?: string | undefined;
	preview?: ((value: string) => string | undefined) | undefined;
	validate?: ((value: string) => string | undefined) | undefined;
	input?: NodeJS.ReadStream | undefined;
	output?: NodeJS.WriteStream | undefined;
}

function resolveBaseWithContext(
	rawDir: string,
	cwd: string,
	homeDir: string,
): string {
	const trimmed = rawDir.trim();
	if (!trimmed) {
		return path.resolve(cwd);
	}
	if (trimmed === "~") {
		return homeDir;
	}
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return path.resolve(homeDir, trimmed.slice(2));
	}
	return path.resolve(cwd, trimmed);
}

function detectSeparator(
	rawInput: string,
	platform: NodeJS.Platform,
): "/" | "\\" {
	if (rawInput.includes("/")) {
		return "/";
	}
	if (rawInput.includes("\\")) {
		return "\\";
	}
	return platform === "win32" ? "\\" : "/";
}

function listSubdirectories(
	dirPath: string,
	cache?: Map<string, string[]>,
): string[] {
	const cached = cache?.get(dirPath);
	if (cached !== undefined) {
		return cached;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dirPath, { withFileTypes: true });
	} catch {
		return [];
	}

	const dirs: string[] = [];
	for (const entry of entries) {
		if (entry.isDirectory()) {
			dirs.push(entry.name);
			continue;
		}
		if (entry.isSymbolicLink()) {
			try {
				if (fs.statSync(path.join(dirPath, entry.name)).isDirectory()) {
					dirs.push(entry.name);
				}
			} catch {
				// Ignore broken symlinks or inaccessible targets
			}
		}
	}

	dirs.sort((a, b) =>
		a.localeCompare(b, "en", { sensitivity: "base", numeric: true }),
	);
	cache?.set(dirPath, dirs);
	return dirs;
}

function computeLongestCommonPrefix(values: readonly string[]): string {
	if (values.length === 0) {
		return "";
	}
	const firstValue = values[0];
	if (firstValue === undefined) {
		return "";
	}
	if (values.length === 1) {
		return firstValue;
	}

	const splitValues = values.map((v) => [...v]);
	const firstChars = splitValues[0] ?? [];
	let prefix = "";

	for (let i = 0; i < firstChars.length; i += 1) {
		const targetChar = firstChars[i];
		if (targetChar === undefined) {
			break;
		}
		const targetLower = targetChar.toLowerCase();
		let allMatch = true;
		for (let j = 1; j < splitValues.length; j += 1) {
			const candidateChar = splitValues[j]?.[i];
			if (
				candidateChar === undefined ||
				candidateChar.toLowerCase() !== targetLower
			) {
				allMatch = false;
				break;
			}
		}
		if (!allMatch) {
			break;
		}
		prefix += targetChar;
	}

	return prefix;
}

/**
 * Computes the remaining suffix to render as inline ghost text for a candidate path.
 */
export function computeGhostSuffix(
	rawInput: string,
	candidate: string | undefined,
): string {
	if (!candidate) {
		return "";
	}
	if (
		candidate.length > rawInput.length &&
		candidate.toLowerCase().startsWith(rawInput.toLowerCase())
	) {
		return candidate.slice(rawInput.length);
	}
	return "";
}

/**
 * Computes matching subdirectory completions for a partially typed path.
 */
export function getDirectoryCompletions(
	rawInput: string,
	options?: DirectoryCompletionOptions,
): DirectoryCompletionResult {
	const cwd = options?.cwd ?? process.cwd();
	const homeDir = options?.homeDir ?? os.homedir();
	const platform = options?.platform ?? process.platform;
	const sep = detectSeparator(rawInput, platform);

	let dirPrefixDisplay = "";
	let searchDirFs = cwd;
	let namePrefix = "";

	if (rawInput === "") {
		dirPrefixDisplay = "";
		searchDirFs = cwd;
		namePrefix = "";
	} else if (rawInput === ".") {
		dirPrefixDisplay = `.${sep}`;
		searchDirFs = cwd;
		namePrefix = "";
	} else if (rawInput === "..") {
		dirPrefixDisplay = `..${sep}`;
		searchDirFs = path.resolve(cwd, "..");
		namePrefix = "";
	} else if (rawInput === "~") {
		dirPrefixDisplay = `~${sep}`;
		searchDirFs = homeDir;
		namePrefix = "";
	} else if (rawInput.endsWith("/") || rawInput.endsWith("\\")) {
		dirPrefixDisplay = rawInput;
		searchDirFs = resolveBaseWithContext(rawInput, cwd, homeDir);
		namePrefix = "";
	} else {
		const lastSepIdx = Math.max(
			rawInput.lastIndexOf("/"),
			rawInput.lastIndexOf("\\"),
		);
		if (lastSepIdx >= 0) {
			dirPrefixDisplay = rawInput.slice(0, lastSepIdx + 1);
			namePrefix = rawInput.slice(lastSepIdx + 1);
			searchDirFs = resolveBaseWithContext(dirPrefixDisplay, cwd, homeDir);
		} else {
			dirPrefixDisplay = "";
			namePrefix = rawInput;
			searchDirFs = cwd;
		}
	}

	const allDirs = listSubdirectories(searchDirFs, options?.cache);
	const includeHidden = namePrefix.startsWith(".");
	const namePrefixLower = namePrefix.toLowerCase();

	const filtered = allDirs.filter((name) => {
		if (!includeHidden && name.startsWith(".")) {
			return false;
		}
		if (namePrefix.length === 0) {
			return true;
		}
		return name.toLowerCase().startsWith(namePrefixLower);
	});

	if (namePrefix.length > 0 && platform !== "win32") {
		filtered.sort((a, b) => {
			const aExact = a.startsWith(namePrefix) ? 0 : 1;
			const bExact = b.startsWith(namePrefix) ? 0 : 1;
			if (aExact !== bExact) {
				return aExact - bExact;
			}
			return a.localeCompare(b, "en", {
				sensitivity: "base",
				numeric: true,
			});
		});
	}

	const matches = filtered.map((name) => `${dirPrefixDisplay}${name}${sep}`);
	const labels = filtered.map((name) => `${name}${sep}`);
	const commonPrefix = computeLongestCommonPrefix(matches);
	const ghostSuffix = computeGhostSuffix(rawInput, matches[0]);

	return {
		matches,
		labels,
		commonPrefix,
		ghostSuffix,
		resolvedParentDir: searchDirFs,
	};
}

function stripNonPrintable(str: string): string {
	let cleaned = "";
	for (const ch of str) {
		const cp = ch.codePointAt(0);
		if (cp !== undefined && cp >= 0x20 && cp !== 0x7f) {
			cleaned += ch;
		}
	}
	return cleaned;
}

function deleteLastPathSegment(beforeCursor: string): string {
	if (!beforeCursor) {
		return "";
	}
	const chars = [...beforeCursor];
	while (chars.length > 0) {
		const last = chars[chars.length - 1];
		if (last === "/" || last === "\\") {
			chars.pop();
		} else {
			break;
		}
	}
	while (chars.length > 0) {
		const last = chars[chars.length - 1];
		if (last === "/" || last === "\\") {
			break;
		}
		chars.pop();
	}
	return chars.join("");
}

/**
 * Prompts the user for a directory path with zsh-autosuggestions / PSReadLine-style
 * inline ghost suggestions, Tab/Shift+Tab cycling, arrow selection, and path preview.
 */
export async function promptDirectory(
	options: DirectoryPromptOptions,
): Promise<string | symbol> {
	const input = (options.input ?? process.stdin) as NodeJS.ReadStream & {
		setRawMode?: (mode: boolean) => void;
	};
	const output = options.output ?? process.stdout;

	if (!input.isTTY || !output.isTTY) {
		const validateFn = options.validate;
		const fallbackOpts: Parameters<typeof text>[0] = {
			message: options.message,
			...(options.initialValue !== undefined
				? {
						initialValue: options.initialValue,
						defaultValue: options.initialValue,
					}
				: {}),
			...(options.placeholder !== undefined
				? { placeholder: options.placeholder }
				: {}),
			...(validateFn !== undefined
				? {
						validate: (val: string | undefined) => validateFn(val ?? ""),
					}
				: {}),
		};
		const result = await text(fallbackOpts);
		return isCancel(result) ? DIR_PROMPT_CANCEL : result;
	}

	return await new Promise<string | symbol>((resolve) => {
		let buffer = options.initialValue ?? ".";
		let cursor = [...buffer].length;
		let errorMessage = "";
		let selectedIndex = 0;
		let lastRenderedLines = 0;
		let settled = false;

		let tabCycle:
			| {
					candidates: string[];
					labels: string[];
					index: number;
			  }
			| undefined;

		const dirCache = new Map<string, string[]>();
		let completions = getDirectoryCompletions(buffer, { cache: dirCache });

		const refreshSuggestions = (resetSelection = true): void => {
			tabCycle = undefined;
			completions = getDirectoryCompletions(buffer, { cache: dirCache });
			if (completions.matches.length === 0) {
				selectedIndex = 0;
			} else if (resetSelection) {
				selectedIndex = 0;
			} else if (selectedIndex >= completions.matches.length) {
				selectedIndex = completions.matches.length - 1;
			}
		};

		const buildActiveInputDisplay = (): string => {
			const chars = [...buffer];
			const before = chars.slice(0, cursor).join("");

			if (cursor < chars.length) {
				const atCursor = chars[cursor] ?? " ";
				const after = chars.slice(cursor + 1).join("");
				return `${before}${pc.inverse(atCursor)}${after}`;
			}

			if (tabCycle) {
				return `${buffer}${pc.inverse(" ")}`;
			}

			const activeCandidate = completions.matches[selectedIndex];
			const ghostSuffix = computeGhostSuffix(buffer, activeCandidate);
			if (ghostSuffix.length > 0) {
				const ghostChars = [...ghostSuffix];
				const firstGhost = ghostChars[0] ?? " ";
				const restGhost = ghostChars.slice(1).join("");
				return `${buffer}${pc.inverse(firstGhost)}${pc.dim(restGhost)}`;
			}

			if (buffer.length === 0 && options.placeholder) {
				const placeholderChars = [...options.placeholder];
				const firstPh = placeholderChars[0] ?? " ";
				const restPh = placeholderChars.slice(1).join("");
				return `${pc.inverse(firstPh)}${pc.dim(restPh)}`;
			}

			return `${buffer}${pc.inverse(" ")}`;
		};

		const renderState = (
			state: "active" | "error" | "submit" | "cancel",
		): void => {
			const columns = Math.max(20, output.columns || 80);
			const rows = Math.max(8, output.rows || 24);
			const maxLineWidth = Math.max(19, columns - 1);

			const lines: string[] = [];
			lines.push(`${symbol(state)}  ${options.message}`);

			if (state === "submit") {
				lines.push(`${pc.gray(S_BAR)}  ${pc.dim(buffer)}`);
			} else if (state === "cancel") {
				if (buffer.length > 0) {
					lines.push(`${pc.gray(S_BAR)}  ${pc.strikethrough(pc.dim(buffer))}`);
				}
				lines.push(pc.gray(S_BAR));
			} else {
				const bar = `${symbolBar(state)}  `;
				const barEnd =
					state === "error" ? pc.yellow(S_BAR_END) : pc.cyan(S_BAR_END);
				lines.push(`${bar}${buildActiveInputDisplay()}`);

				const activeLabels = tabCycle ? tabCycle.labels : completions.labels;
				const activeHighlight = tabCycle ? tabCycle.index : selectedIndex;
				const hasPreview = options.preview !== undefined;
				const reservedRows = hasPreview ? 6 : 5;
				const maxVisible = Math.max(2, Math.min(5, rows - reservedRows));

				if (activeLabels.length > 0) {
					let start = 0;
					let end = activeLabels.length;
					if (activeLabels.length > maxVisible) {
						const half = Math.floor(maxVisible / 2);
						start = Math.max(0, activeHighlight - half);
						if (start + maxVisible > activeLabels.length) {
							start = Math.max(0, activeLabels.length - maxVisible);
						}
						end = Math.min(activeLabels.length, start + maxVisible);
					}

					const labelBudget = Math.max(10, maxLineWidth - 6);
					for (let i = start; i < end; i += 1) {
						const rawLabel = activeLabels[i] ?? "";
						const shownLabel = truncatePlain(rawLabel, labelBudget);
						if (i === activeHighlight) {
							lines.push(`${bar}  ${pc.cyan(CHEVRON)} ${pc.cyan(shownLabel)}`);
						} else {
							lines.push(`${bar}    ${pc.dim(shownLabel)}`);
						}
					}

					const hiddenCount = activeLabels.length - (end - start);
					if (hiddenCount > 0) {
						lines.push(
							`${bar}    ${pc.dim(`${ELLIPSIS} +${hiddenCount} more`)}`,
						);
					}
				}

				if (options.preview) {
					const previewText = options.preview(buffer);
					if (previewText) {
						const previewBudget = Math.max(10, maxLineWidth - 6);
						const shownPreview = truncatePlain(previewText, previewBudget);
						lines.push(`${bar}${pc.dim(`${ARROW_RIGHT} ${shownPreview}`)}`);
					}
				}

				if (state === "error" && errorMessage) {
					lines.push(`${barEnd}  ${pc.yellow(errorMessage)}`);
				} else {
					const hintText =
						"Tab: complete • →: accept • ↑/↓: pick • Enter: confirm";
					const hintBudget = Math.max(10, maxLineWidth - 3);
					const shownHint =
						getDisplayWidth(hintText) <= hintBudget
							? hintText
							: "Tab • → • ↑/↓ • Enter";
					lines.push(`${barEnd}  ${pc.dim(shownHint)}`);
				}
			}

			const clampedLines = lines.map((line) =>
				truncateAnsi(line, maxLineWidth),
			);

			let frame = "";
			if (lastRenderedLines > 1) {
				frame += `\x1b[${lastRenderedLines - 1}A`;
			}
			if (lastRenderedLines > 0) {
				frame += "\r\x1b[0J";
			}
			frame += clampedLines.join("\n");
			if (state === "submit" || state === "cancel") {
				frame += "\n";
			}
			output.write(frame);
			lastRenderedLines = clampedLines.length;
		};

		const rl = readline.createInterface({
			input,
			tabSize: 2,
			prompt: "",
			escapeCodeTimeout: 50,
			terminal: true,
		});

		const onResize = (): void => {
			if (!settled) {
				renderState(errorMessage ? "error" : "active");
			}
		};

		const onExit = (): void => {
			output.write(CURSOR_SHOW);
		};

		const cleanup = (): void => {
			if (settled) {
				return;
			}
			settled = true;
			input.off("keypress", onKeypress);
			output.off("resize", onResize);
			process.off("exit", onExit);
			(rl as readline.Interface & { terminal: boolean }).terminal = false;
			rl.close();
			rawInputSetMode(false);
			output.write(CURSOR_SHOW);
		};

		const rawInputSetMode = (mode: boolean): void => {
			if (input.isTTY && typeof input.setRawMode === "function") {
				input.setRawMode(mode);
			}
		};

		const acceptCandidate = (candidate: string): void => {
			buffer = candidate;
			cursor = [...buffer].length;
			errorMessage = "";
			refreshSuggestions(true);
		};

		const onKeypress = (
			str: string | undefined,
			key: readline.Key | undefined,
		): void => {
			if (settled) {
				return;
			}

			const keyName = key?.name ?? "";

			if (keyName === "escape" || (key?.ctrl && keyName === "c")) {
				renderState("cancel");
				cleanup();
				resolve(DIR_PROMPT_CANCEL);
				return;
			}

			if (keyName === "return" || keyName === "enter") {
				tabCycle = undefined;
				const validationError = options.validate?.(buffer);
				if (validationError) {
					errorMessage = validationError;
					renderState("error");
					return;
				}
				errorMessage = "";
				renderState("submit");
				cleanup();
				resolve(buffer);
				return;
			}

			if (keyName === "tab") {
				errorMessage = "";
				if (tabCycle && tabCycle.candidates.length > 0) {
					const len = tabCycle.candidates.length;
					tabCycle.index = key?.shift
						? (tabCycle.index - 1 + len) % len
						: (tabCycle.index + 1) % len;
					const nextCandidate = tabCycle.candidates[tabCycle.index];
					if (nextCandidate !== undefined) {
						buffer = nextCandidate;
						cursor = [...buffer].length;
					}
					renderState("active");
					return;
				}

				if (completions.matches.length === 1 && completions.matches[0]) {
					acceptCandidate(completions.matches[0]);
					renderState("active");
					return;
				}

				if (completions.matches.length > 1) {
					if (
						completions.commonPrefix.length > buffer.length &&
						completions.commonPrefix
							.toLowerCase()
							.startsWith(buffer.toLowerCase())
					) {
						buffer = completions.commonPrefix;
						cursor = [...buffer].length;
						refreshSuggestions(true);
						renderState("active");
						return;
					}

					const initialIdx = key?.shift
						? completions.matches.length - 1
						: selectedIndex;
					const chosen = completions.matches[initialIdx];
					if (chosen !== undefined) {
						tabCycle = {
							candidates: completions.matches,
							labels: completions.labels,
							index: initialIdx,
						};
						buffer = chosen;
						cursor = [...buffer].length;
					}
					renderState("active");
					return;
				}

				renderState("active");
				return;
			}

			if (keyName === "up" || keyName === "down") {
				errorMessage = "";
				const delta = keyName === "up" ? -1 : 1;
				if (tabCycle && tabCycle.candidates.length > 0) {
					const len = tabCycle.candidates.length;
					tabCycle.index = (tabCycle.index + delta + len) % len;
					const nextCandidate = tabCycle.candidates[tabCycle.index];
					if (nextCandidate !== undefined) {
						buffer = nextCandidate;
						cursor = [...buffer].length;
					}
				} else if (completions.matches.length > 0) {
					const len = completions.matches.length;
					selectedIndex = (selectedIndex + delta + len) % len;
				}
				renderState("active");
				return;
			}

			if (keyName === "right") {
				errorMessage = "";
				if (tabCycle) {
					refreshSuggestions(true);
					renderState("active");
					return;
				}
				const chars = [...buffer];
				if (cursor < chars.length) {
					cursor += 1;
					renderState("active");
					return;
				}
				const activeCandidate = completions.matches[selectedIndex];
				if (
					activeCandidate &&
					computeGhostSuffix(buffer, activeCandidate).length > 0
				) {
					acceptCandidate(activeCandidate);
					renderState("active");
				}
				return;
			}

			if (keyName === "end" || (key?.ctrl && keyName === "e")) {
				errorMessage = "";
				if (tabCycle) {
					refreshSuggestions(true);
					renderState("active");
					return;
				}
				const chars = [...buffer];
				if (cursor < chars.length) {
					cursor = chars.length;
					renderState("active");
					return;
				}
				const activeCandidate = completions.matches[selectedIndex];
				if (
					activeCandidate &&
					computeGhostSuffix(buffer, activeCandidate).length > 0
				) {
					acceptCandidate(activeCandidate);
					renderState("active");
				}
				return;
			}

			if (keyName === "left") {
				errorMessage = "";
				tabCycle = undefined;
				cursor = Math.max(0, cursor - 1);
				renderState("active");
				return;
			}

			if (keyName === "home" || (key?.ctrl && keyName === "a")) {
				errorMessage = "";
				tabCycle = undefined;
				cursor = 0;
				renderState("active");
				return;
			}

			if (keyName === "backspace") {
				errorMessage = "";
				tabCycle = undefined;
				if (cursor > 0) {
					const chars = [...buffer];
					chars.splice(cursor - 1, 1);
					buffer = chars.join("");
					cursor -= 1;
					refreshSuggestions(true);
				}
				renderState("active");
				return;
			}

			if (keyName === "delete") {
				errorMessage = "";
				tabCycle = undefined;
				const chars = [...buffer];
				if (cursor < chars.length) {
					chars.splice(cursor, 1);
					buffer = chars.join("");
					refreshSuggestions(true);
				}
				renderState("active");
				return;
			}

			if (key?.ctrl && keyName === "u") {
				errorMessage = "";
				tabCycle = undefined;
				if (cursor > 0) {
					const chars = [...buffer];
					buffer = chars.slice(cursor).join("");
					cursor = 0;
					refreshSuggestions(true);
				}
				renderState("active");
				return;
			}

			if (key?.ctrl && keyName === "w") {
				errorMessage = "";
				tabCycle = undefined;
				if (cursor > 0) {
					const chars = [...buffer];
					const before = chars.slice(0, cursor).join("");
					const after = chars.slice(cursor).join("");
					const newBefore = deleteLastPathSegment(before);
					buffer = `${newBefore}${after}`;
					cursor = [...newBefore].length;
					refreshSuggestions(true);
				}
				renderState("active");
				return;
			}

			if (!key?.ctrl && !key?.meta && str !== undefined && str.length > 0) {
				const printable = stripNonPrintable(str);
				if (printable.length > 0) {
					errorMessage = "";
					const chars = [...buffer];
					const insertedChars = [...printable];
					chars.splice(cursor, 0, ...insertedChars);
					buffer = chars.join("");
					cursor += insertedChars.length;
					refreshSuggestions(true);
					renderState("active");
				}
			}
		};

		rl.prompt();
		output.write(`${pc.gray(S_BAR)}\n${CURSOR_HIDE}`);
		input.on("keypress", onKeypress);
		output.on("resize", onResize);
		process.on("exit", onExit);
		rawInputSetMode(true);
		renderState("active");
	});
}
