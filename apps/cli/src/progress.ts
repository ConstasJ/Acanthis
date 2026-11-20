import { stripVTControlCharacters } from "node:util";
import {
	isCI,
	S_BAR,
	S_STEP_CANCEL,
	S_STEP_ERROR,
	S_STEP_SUBMIT,
	unicode,
	unicodeOr,
} from "@clack/prompts";
import pc from "picocolors";
import type { ExportProgressEvent } from "./exporter";
import type { ExportMode } from "./types";

const ESC_CODE = 0x1b;
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const RESET_STYLE = "\x1b[0m";

const SPINNER_FRAMES = unicode ? ["◒", "◐", "◓", "◑"] : ["•", "o", "O", "0"];
const SPINNER_DELAY_MS = unicode ? 80 : 120;
const RENDER_THROTTLE_MS = 50;

const BAR_FILLED = unicodeOr("█", "#");
const BAR_EMPTY = unicodeOr("░", "-");
const ELLIPSIS = unicodeOr("…", "...");
const TRUNCATE_ELLIPSIS = unicodeOr("…", ".");
const CHEVRON = unicodeOr("›", ">");

const ICON_PENDING = unicodeOr("○", "o");
const ICON_DONE = unicodeOr("✓", "+");
const ICON_SKIPPED = unicodeOr("–", "-");

type VolumePackState =
	| "pending"
	| "packing"
	| "writing"
	| "written"
	| "skipped";
type BarColor = "cyan" | "green" | "yellow";
type VolumeVisualStatus =
	| "pending"
	| "active"
	| "done"
	| "doneWithIssues"
	| "skipped";

interface VolumeProgressState {
	index: number;
	id: string;
	title: string;
	chapterTotal: number;
	chaptersDone: number;
	chaptersIssues: number;
	mediaTotal: number;
	mediaDone: number;
	packState: VolumePackState;
}

export interface ExportProgressRendererOptions {
	output?: NodeJS.WriteStream | undefined;
	withGuide?: boolean | undefined;
	illustrations: boolean;
	mode: ExportMode;
	initialNovelTitle?: string | undefined;
}

export interface ExportProgressRenderer {
	start(initialMessage?: string): void;
	update(event: ExportProgressEvent): void;
	stop(message: string): void;
	error(message: string): void;
	cancel(message?: string): void;
}

/**
 * Returns the terminal display column width (0, 1, or 2) of a Unicode code point.
 */
export function getCodePointWidth(cp: number): number {
	if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) {
		return 0;
	}
	if (
		(cp >= 0x200b && cp <= 0x200f) ||
		(cp >= 0xfe00 && cp <= 0xfe0f) ||
		cp === 0xfeff ||
		(cp >= 0xe0100 && cp <= 0xe01ef)
	) {
		return 0;
	}
	if (
		(cp >= 0x0300 && cp <= 0x036f) ||
		(cp >= 0x1ab0 && cp <= 0x1aff) ||
		(cp >= 0x1dc0 && cp <= 0x1dff) ||
		(cp >= 0x20d0 && cp <= 0x20ff) ||
		(cp >= 0xfe20 && cp <= 0xfe2f)
	) {
		return 0;
	}
	if (
		(cp >= 0x1100 && cp <= 0x115f) ||
		cp === 0x2329 ||
		cp === 0x232a ||
		(cp >= 0x2e80 && cp <= 0x303e) ||
		(cp >= 0x3041 && cp <= 0x33ff) ||
		(cp >= 0x3400 && cp <= 0x4dbf) ||
		(cp >= 0x4e00 && cp <= 0xa4cf) ||
		(cp >= 0xa960 && cp <= 0xa97f) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe10 && cp <= 0xfe19) ||
		(cp >= 0xfe30 && cp <= 0xfe6f) ||
		(cp >= 0xff01 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1faff) ||
		(cp >= 0x20000 && cp <= 0x3ffff)
	) {
		return 2;
	}
	return 1;
}

/**
 * Computes the terminal display column width of a string, ignoring ANSI escape sequences.
 */
export function getDisplayWidth(text: string): number {
	const plain = stripVTControlCharacters(text);
	let width = 0;
	for (const ch of plain) {
		const cp = ch.codePointAt(0);
		if (cp !== undefined) {
			width += getCodePointWidth(cp);
		}
	}
	return width;
}

/**
 * Truncates a plain text string so its display width fits within `maxWidth`.
 */
export function truncatePlain(text: string, maxWidth: number): string {
	if (maxWidth <= 0) {
		return "";
	}
	if (getDisplayWidth(text) <= maxWidth) {
		return text;
	}
	const ellipsisWidth = getDisplayWidth(TRUNCATE_ELLIPSIS);
	if (maxWidth <= ellipsisWidth) {
		let out = "";
		let width = 0;
		for (const ch of text) {
			const cp = ch.codePointAt(0);
			if (cp === undefined) {
				continue;
			}
			const w = getCodePointWidth(cp);
			if (width + w > maxWidth) {
				break;
			}
			out += ch;
			width += w;
		}
		return out;
	}

	const budget = maxWidth - ellipsisWidth;
	let out = "";
	let width = 0;
	for (const ch of text) {
		const cp = ch.codePointAt(0);
		if (cp === undefined) {
			continue;
		}
		const w = getCodePointWidth(cp);
		if (width + w > budget) {
			break;
		}
		out += ch;
		width += w;
	}
	return `${out}${TRUNCATE_ELLIPSIS}`;
}

/**
 * Truncates and right-pads a plain string with spaces to match `targetWidth` columns.
 */
export function padRightPlain(text: string, targetWidth: number): string {
	if (targetWidth <= 0) {
		return "";
	}
	const truncated = truncatePlain(text, targetWidth);
	const currentWidth = getDisplayWidth(truncated);
	if (currentWidth >= targetWidth) {
		return truncated;
	}
	return `${truncated}${" ".repeat(targetWidth - currentWidth)}`;
}

/**
 * Truncates an ANSI-styled line to `maxWidth` display columns while preserving CSI sequences.
 */
export function truncateAnsi(line: string, maxWidth: number): string {
	if (maxWidth <= 0) {
		return "";
	}

	let out = "";
	let visibleWidth = 0;
	let hasAnsi = false;
	let truncated = false;
	let i = 0;

	while (i < line.length) {
		if (line.charCodeAt(i) === ESC_CODE) {
			if (line[i + 1] === "[") {
				let j = i + 2;
				while (j < line.length) {
					const code = line.charCodeAt(j);
					if (code >= 0x40 && code <= 0x7e) {
						j += 1;
						break;
					}
					j += 1;
				}
				out += line.slice(i, j);
				hasAnsi = true;
				i = j;
				continue;
			}
			i += 1;
			continue;
		}

		const cp = line.codePointAt(i);
		if (cp === undefined) {
			break;
		}
		const charLen = cp > 0xffff ? 2 : 1;
		const w = getCodePointWidth(cp);
		if (visibleWidth + w > maxWidth) {
			truncated = true;
			break;
		}
		out += line.slice(i, i + charLen);
		visibleWidth += w;
		i += charLen;
	}

	if (truncated && hasAnsi) {
		return `${out}${RESET_STYLE}`;
	}
	return out;
}

/**
 * Formats an `ExportProgressEvent` as a single plain-text log line for non-TTY or JSON runs.
 * Returns `undefined` for transient `fetching` events to avoid flooding logs.
 */
export function formatProgressLogLine(
	event: ExportProgressEvent,
): string | undefined {
	if (event.phase === "chapters") {
		if (event.chapterStatus === "fetching") {
			return undefined;
		}
		const statusLabel =
			event.chapterStatus === "skipped"
				? "Skipped"
				: event.chapterStatus === "failed"
					? "Failed"
					: "Fetched";
		const volPrefix = event.volumeTitle
			? `[${event.volumeTitle}] (${event.volumeCurrent ?? 0}/${event.volumeTotal ?? 0}) `
			: "";
		return `[chapters] (${event.current}/${event.total}) ${volPrefix}${statusLabel}: ${event.chapterTitle ?? event.message}`;
	}

	if (event.phase === "images") {
		const volPrefix = event.volumeTitle ? `[${event.volumeTitle}] ` : "";
		const detail = event.current === 0 ? event.message : "Downloaded media";
		return `[images] (${event.current}/${event.total}) ${volPrefix}${detail}`;
	}

	if (event.phase === "pack" || event.phase === "write") {
		return `[${event.phase}] (${event.current}/${event.total}) ${event.message}`;
	}

	return `[novel] ${event.message}`;
}

function formatElapsed(startTimeMs: number): string {
	const seconds = Math.max(
		0,
		Math.floor((performance.now() - startTimeMs) / 1000),
	);
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return mins > 0 ? `[${mins}m ${secs}s]` : `[${secs}s]`;
}

function renderProgressBar(
	ratio: number,
	width: number,
	color: BarColor,
): string {
	if (width <= 0) {
		return "";
	}
	const clamped = Math.min(1, Math.max(0, ratio));
	const filled = Math.round(clamped * width);
	const empty = Math.max(0, width - filled);
	const filledStr = BAR_FILLED.repeat(filled);
	const emptyStr = BAR_EMPTY.repeat(empty);
	const styledFilled =
		color === "green"
			? pc.green(filledStr)
			: color === "yellow"
				? pc.yellow(filledStr)
				: pc.cyan(filledStr);
	return `${styledFilled}${pc.dim(emptyStr)}`;
}

function stripVolumePrefix(message: string, volumeTitle?: string): string {
	if (!volumeTitle) {
		return message;
	}
	const prefix = `[${volumeTitle}] `;
	return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

function getVolumeIcon(
	status: VolumeVisualStatus,
	spinnerFrame: string,
): string {
	switch (status) {
		case "active":
			return pc.cyan(spinnerFrame);
		case "done":
			return pc.green(ICON_DONE);
		case "doneWithIssues":
			return pc.yellow(ICON_DONE);
		case "skipped":
			return pc.yellow(ICON_SKIPPED);
		default:
			return pc.dim(ICON_PENDING);
	}
}

/**
 * Creates a real-time multi-bar terminal progress renderer displaying both overall
 * and per-volume progress, active volume/chapter context, and safe TTY cleanup.
 */
export function createExportProgressRenderer(
	options: ExportProgressRendererOptions,
): ExportProgressRenderer {
	const output = options.output ?? process.stdout;
	const withGuide = options.withGuide ?? false;
	const isTty = Boolean(output.isTTY) && !isCI();

	const weightChapters = options.illustrations ? 0.7 : 0.85;
	const weightImages = options.illustrations ? 0.25 : 0.1;
	const weightFinalize = 0.05;

	let novelTitle = options.initialNovelTitle ?? "";
	let statusMessage = "Starting EPUB export...";
	let currentPhase: ExportProgressEvent["phase"] = "novel";
	let phaseCurrent = 0;
	let phaseTotal = 1;
	let overallRatio = 0;

	let volumes: VolumeProgressState[] = [];
	let maxVolumeTitleWidth = 0;
	let activeVolumeIndex: number | undefined;
	let activeVolumeTitle: string | undefined;
	let activeDetail: string | undefined;

	let started = false;
	let finished = false;
	let cursorHidden = false;
	let startTime = performance.now();
	let frameIndex = 0;
	let lastRenderedLines = 0;
	let lastRenderAt = 0;
	let dirty = false;
	let timer: ReturnType<typeof setInterval> | undefined;

	const guidePrefix = withGuide ? `${pc.gray(S_BAR)}  ` : "   ";
	const guideSpacer = withGuide ? pc.gray(S_BAR) : "";

	const isVolumeCompleteInPhase = (vol: VolumeProgressState): boolean => {
		if (currentPhase === "novel" || currentPhase === "chapters") {
			if (vol.chapterTotal === 0) {
				return activeVolumeIndex !== undefined && vol.index < activeVolumeIndex;
			}
			return vol.chaptersDone >= vol.chapterTotal;
		}
		if (currentPhase === "images") {
			return vol.mediaTotal === 0 || vol.mediaDone >= vol.mediaTotal;
		}
		return vol.packState === "written" || vol.packState === "skipped";
	};

	const computeOverallRatio = (event: ExportProgressEvent): number => {
		if (event.phase === "novel") {
			return 0;
		}
		if (event.phase === "chapters") {
			const frac = event.total > 0 ? event.current / event.total : 1;
			return frac * weightChapters;
		}
		if (event.phase === "images") {
			const frac = event.total > 0 ? event.current / event.total : 1;
			return weightChapters + frac * weightImages;
		}
		if (options.mode === "split" && volumes.length > 0) {
			let finalizeSum = 0;
			for (const vol of volumes) {
				if (vol.packState === "packing") {
					finalizeSum += 0.5;
				} else if (vol.packState === "writing") {
					finalizeSum += 0.85;
				} else if (vol.packState === "written" || vol.packState === "skipped") {
					finalizeSum += 1;
				}
			}
			return (
				weightChapters +
				weightImages +
				(finalizeSum / volumes.length) * weightFinalize
			);
		}
		const mergedStep = event.phase === "pack" ? 0.5 : 1;
		return weightChapters + weightImages + mergedStep * weightFinalize;
	};

	const formatPhaseSummary = (): string => {
		switch (currentPhase) {
			case "novel":
				return "Preparing";
			case "chapters":
				return `Chapters ${phaseCurrent}/${phaseTotal}`;
			case "images":
				return `Images ${phaseCurrent}/${phaseTotal}`;
			case "pack":
				return `Packing ${phaseCurrent}/${phaseTotal}`;
			case "write":
				return `Writing ${phaseCurrent}/${phaseTotal}`;
		}
	};

	const formatActiveLine = (budget: number): string => {
		if (activeVolumeTitle && activeDetail) {
			const sep = ` ${CHEVRON} `;
			const sepWidth = getDisplayWidth(sep);
			const innerBudget = Math.max(4, budget - sepWidth);
			const volRaw = getDisplayWidth(activeVolumeTitle);
			const detailRaw = getDisplayWidth(activeDetail);

			let volLimit: number;
			let detailLimit: number;
			if (volRaw + detailRaw <= innerBudget) {
				volLimit = volRaw;
				detailLimit = detailRaw;
			} else {
				const baseVol = Math.floor(innerBudget * 0.45);
				const baseDetail = innerBudget - baseVol;
				if (volRaw < baseVol) {
					volLimit = volRaw;
					detailLimit = innerBudget - volLimit;
				} else if (detailRaw < baseDetail) {
					detailLimit = detailRaw;
					volLimit = innerBudget - detailLimit;
				} else {
					volLimit = baseVol;
					detailLimit = baseDetail;
				}
			}

			const volPart = truncatePlain(activeVolumeTitle, volLimit);
			const detailPart = truncatePlain(activeDetail, detailLimit);
			return `${pc.cyan(volPart)} ${pc.dim(CHEVRON)} ${detailPart}`;
		}
		if (activeVolumeTitle) {
			return pc.cyan(truncatePlain(activeVolumeTitle, budget));
		}
		if (activeDetail) {
			return truncatePlain(activeDetail, budget);
		}
		return pc.dim(truncatePlain(statusMessage, budget));
	};

	const buildVolumeRow = (
		vol: VolumeProgressState,
		spinnerFrame: string,
		columns: number,
		contentBudget: number,
	): string => {
		let ratio = 0;
		let status: VolumeVisualStatus = "pending";
		let detailStyled = "";

		if (currentPhase === "novel" || currentPhase === "chapters") {
			if (vol.chapterTotal === 0) {
				const passed =
					activeVolumeIndex !== undefined && vol.index < activeVolumeIndex;
				ratio = passed ? 1 : 0;
				status = passed
					? vol.chaptersIssues > 0
						? "doneWithIssues"
						: "done"
					: vol.index === activeVolumeIndex
						? "active"
						: "pending";
			} else {
				ratio = vol.chaptersDone / vol.chapterTotal;
				if (vol.chaptersDone >= vol.chapterTotal) {
					status = vol.chaptersIssues > 0 ? "doneWithIssues" : "done";
				} else if (vol.index === activeVolumeIndex || vol.chaptersDone > 0) {
					status = "active";
				}
			}
			const countDigits = String(vol.chapterTotal).length;
			const doneStr = String(vol.chaptersDone).padStart(countDigits, " ");
			const issueSuffix =
				vol.chaptersIssues > 0
					? ` ${pc.yellow(`(!${vol.chaptersIssues})`)}`
					: "";
			detailStyled = `${pc.dim(`${doneStr}/${vol.chapterTotal} ch`)}${issueSuffix}`;
		} else if (currentPhase === "images") {
			ratio = vol.mediaTotal > 0 ? vol.mediaDone / vol.mediaTotal : 1;
			if (vol.mediaTotal === 0 || vol.mediaDone >= vol.mediaTotal) {
				status = vol.chaptersIssues > 0 ? "doneWithIssues" : "done";
			} else if (vol.index === activeVolumeIndex || vol.mediaDone > 0) {
				status = "active";
			}
			if (vol.mediaTotal > 0) {
				const countDigits = String(vol.mediaTotal).length;
				const doneStr = String(vol.mediaDone).padStart(countDigits, " ");
				detailStyled = pc.dim(`${doneStr}/${vol.mediaTotal} img`);
			} else {
				detailStyled = pc.dim("0 img");
			}
		} else {
			switch (vol.packState) {
				case "packing":
					ratio = 0.5;
					status = "active";
					detailStyled = pc.cyan("packing");
					break;
				case "writing":
					ratio = 0.85;
					status = "active";
					detailStyled = pc.cyan("writing");
					break;
				case "written":
					ratio = 1;
					status = vol.chaptersIssues > 0 ? "doneWithIssues" : "done";
					detailStyled = pc.green("written");
					break;
				case "skipped":
					ratio = 1;
					status = "skipped";
					detailStyled = pc.yellow("skipped");
					break;
				default:
					ratio = 0;
					status = "pending";
					detailStyled = pc.dim("pending");
					break;
			}
		}

		const icon = getVolumeIcon(status, spinnerFrame);
		const pctStr = `${String(Math.round(Math.min(1, Math.max(0, ratio)) * 100)).padStart(3, " ")}%`;
		const detailWidth = getDisplayWidth(detailStyled);

		if (columns < 52) {
			const titleWidth = Math.max(
				6,
				contentBudget - 2 - 2 - 4 - 2 - detailWidth,
			);
			const paddedTitle = padRightPlain(vol.title, titleWidth);
			return `${guidePrefix}${icon} ${paddedTitle}  ${pctStr}  ${detailStyled}`;
		}

		let barWidth = Math.min(18, Math.max(8, Math.floor(contentBudget * 0.22)));
		let titleWidth = Math.min(
			Math.max(maxVolumeTitleWidth, 10),
			Math.max(10, Math.floor(contentBudget * 0.36)),
		);
		const fixedOverhead = 2 + 2 + 1 + 4 + 2 + detailWidth;
		const availableForTitleAndBar = Math.max(14, contentBudget - fixedOverhead);

		if (titleWidth + barWidth > availableForTitleAndBar) {
			titleWidth = Math.max(8, availableForTitleAndBar - barWidth);
			if (titleWidth + barWidth > availableForTitleAndBar) {
				barWidth = Math.max(6, availableForTitleAndBar - titleWidth);
			}
		}

		const paddedTitle = padRightPlain(vol.title, titleWidth);
		const barColor: BarColor =
			status === "done"
				? "green"
				: status === "doneWithIssues" || status === "skipped"
					? "yellow"
					: "cyan";
		const bar = renderProgressBar(ratio, barWidth, barColor);
		return `${guidePrefix}${icon} ${paddedTitle}  ${bar} ${pctStr}  ${detailStyled}`;
	};

	const buildFrame = (): string[] => {
		const columns = Math.max(20, output.columns || 80);
		const rows = Math.max(6, output.rows || 24);
		const maxLineWidth = Math.max(19, columns - 1);
		const spinnerFrame =
			SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length] ??
			SPINNER_FRAMES[0] ??
			"*";
		const elapsed = formatElapsed(startTime);

		if (volumes.length === 0) {
			const singleLine = `${pc.magenta(spinnerFrame)}  ${statusMessage}  ${pc.dim(elapsed)}`;
			return [truncateAnsi(singleLine, maxLineWidth)];
		}

		const lines: string[] = [];
		const headerPrefix = `${pc.magenta(spinnerFrame)}  Exporting `;
		const headerSuffix = `  ${pc.dim(elapsed)}`;
		const headerBudget = Math.max(
			8,
			maxLineWidth -
				getDisplayWidth(headerPrefix) -
				getDisplayWidth(headerSuffix),
		);
		const shownNovelTitle = truncatePlain(novelTitle || "novel", headerBudget);
		lines.push(`${headerPrefix}${pc.bold(shownNovelTitle)}${headerSuffix}`);

		const contentBudget = Math.max(16, maxLineWidth - 3);
		const pctStr = `${String(Math.round(overallRatio * 100)).padStart(3, " ")}%`;
		const phaseSummary = formatPhaseSummary();
		const summaryWidth = getDisplayWidth(phaseSummary);
		const overallFixedWithSummary = 9 + 1 + 4 + 2 + summaryWidth;
		const overallBarBudget = contentBudget - overallFixedWithSummary;

		if (overallBarBudget >= 8) {
			const barWidth = Math.min(28, overallBarBudget);
			const overallBar = renderProgressBar(overallRatio, barWidth, "cyan");
			lines.push(
				`${guidePrefix}${pc.bold("Overall")}  ${overallBar} ${pctStr}  ${pc.dim(phaseSummary)}`,
			);
		} else if (contentBudget >= 24) {
			const barWidth = Math.max(6, Math.min(16, contentBudget - 16));
			const overallBar = renderProgressBar(overallRatio, barWidth, "cyan");
			lines.push(
				`${guidePrefix}${pc.bold("Overall")}  ${overallBar} ${pctStr}`,
			);
		} else {
			lines.push(`${guidePrefix}${pc.bold("Overall")}  ${pctStr}`);
		}

		const activeBudget = Math.max(8, contentBudget - 9);
		lines.push(
			`${guidePrefix}${pc.bold("Active ")}  ${formatActiveLine(activeBudget)}`,
		);

		if (rows >= 12) {
			lines.push(guideSpacer);
		}

		const availableVolRows = Math.max(1, rows - 2 - lines.length);
		const desiredMaxVolumes = Math.max(3, Math.min(10, rows - 10));
		const totalVolumes = volumes.length;

		let start = 0;
		let end = totalVolumes;
		if (totalVolumes > availableVolRows || totalVolumes > desiredMaxVolumes) {
			const windowCap = Math.max(
				1,
				Math.min(desiredMaxVolumes, Math.max(1, availableVolRows - 2)),
			);
			if (totalVolumes > windowCap) {
				const focus = Math.max(
					0,
					Math.min(totalVolumes - 1, activeVolumeIndex ?? 0),
				);
				const leadContext = Math.min(2, Math.floor((windowCap - 1) / 3));
				start = Math.max(0, focus - leadContext);
				if (start + windowCap > totalVolumes) {
					start = Math.max(0, totalVolumes - windowCap);
				}
				end = Math.min(totalVolumes, start + windowCap);
			}
		}

		if (start > 0) {
			let doneBefore = 0;
			for (let i = 0; i < start; i += 1) {
				const vol = volumes[i];
				if (vol && isVolumeCompleteInPhase(vol)) {
					doneBefore += 1;
				}
			}
			lines.push(
				`${guidePrefix}${pc.dim(`${ELLIPSIS} ${start} earlier volume(s) (${doneBefore}/${start} done)`)}`,
			);
		}

		for (let i = start; i < end; i += 1) {
			const vol = volumes[i];
			if (!vol) {
				continue;
			}
			lines.push(buildVolumeRow(vol, spinnerFrame, columns, contentBudget));
		}

		if (end < totalVolumes) {
			lines.push(
				`${guidePrefix}${pc.dim(`${ELLIPSIS} ${totalVolumes - end} more volume(s)`)}`,
			);
		}

		return lines.map((line) => truncateAnsi(line, maxLineWidth));
	};

	const renderFrame = (): void => {
		if (!isTty || finished) {
			return;
		}
		lastRenderAt = performance.now();
		dirty = false;
		const lines = buildFrame();
		let buffer = "";
		if (lastRenderedLines > 1) {
			buffer += `\x1b[${lastRenderedLines - 1}A`;
		}
		if (lastRenderedLines > 0) {
			buffer += "\r\x1b[0J";
		}
		buffer += lines.join("\n");
		output.write(buffer);
		lastRenderedLines = lines.length;
	};

	const clearRenderedBlock = (): void => {
		if (lastRenderedLines > 1) {
			output.write(`\x1b[${lastRenderedLines - 1}A\r\x1b[0J`);
		} else if (lastRenderedLines === 1) {
			output.write("\r\x1b[0J");
		}
		lastRenderedLines = 0;
	};

	const restoreCursorIfHidden = (): void => {
		if (cursorHidden) {
			output.write(CURSOR_SHOW);
			cursorHidden = false;
		}
	};

	let onResize: (() => void) | undefined;
	let onExit: (() => void) | undefined;
	let onUncaught: (() => void) | undefined;
	let onSigint: (() => void) | undefined;
	let onSigterm: (() => void) | undefined;

	const cleanupListeners = (): void => {
		if (onResize) {
			output.off("resize", onResize);
			onResize = undefined;
		}
		if (onExit) {
			process.off("exit", onExit);
			onExit = undefined;
		}
		if (onUncaught) {
			process.off("uncaughtExceptionMonitor", onUncaught);
			onUncaught = undefined;
		}
		if (onSigint) {
			process.off("SIGINT", onSigint);
			onSigint = undefined;
		}
		if (onSigterm) {
			process.off("SIGTERM", onSigterm);
			onSigterm = undefined;
		}
	};

	const stopTimer = (): void => {
		if (timer !== undefined) {
			clearInterval(timer);
			timer = undefined;
		}
	};

	const finish = (
		message: string,
		kind: "submit" | "error" | "cancel",
	): void => {
		if (finished) {
			return;
		}
		finished = true;
		stopTimer();
		cleanupListeners();

		if (!isTty) {
			if (message) {
				output.write(`${message}\n`);
			}
			return;
		}

		clearRenderedBlock();
		const icon =
			kind === "submit"
				? pc.green(S_STEP_SUBMIT)
				: kind === "error"
					? pc.red(S_STEP_ERROR)
					: pc.red(S_STEP_CANCEL);
		const elapsed = formatElapsed(startTime);
		output.write(`${icon}  ${message} ${pc.dim(elapsed)}\n`);
		restoreCursorIfHidden();
	};

	return {
		start(initialMessage?: string): void {
			if (started || finished) {
				return;
			}
			started = true;
			startTime = performance.now();
			if (initialMessage) {
				statusMessage = initialMessage;
			}

			if (!isTty) {
				if (initialMessage) {
					output.write(`${initialMessage}\n`);
				}
				return;
			}

			if (withGuide) {
				output.write(`${pc.gray(S_BAR)}\n`);
			}
			output.write(CURSOR_HIDE);
			cursorHidden = true;

			onResize = () => {
				renderFrame();
			};
			onExit = () => {
				stopTimer();
				cleanupListeners();
				restoreCursorIfHidden();
			};
			onUncaught = () => {
				stopTimer();
				cleanupListeners();
				restoreCursorIfHidden();
			};
			onSigint = () => {
				finish("Export cancelled.", "cancel");
				process.exit(130);
			};
			onSigterm = () => {
				finish("Export terminated.", "cancel");
				process.exit(143);
			};

			output.on("resize", onResize);
			process.on("exit", onExit);
			process.on("uncaughtExceptionMonitor", onUncaught);
			process.on("SIGINT", onSigint);
			process.on("SIGTERM", onSigterm);

			renderFrame();
			timer = setInterval(() => {
				frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
				if (dirty || performance.now() - lastRenderAt >= SPINNER_DELAY_MS) {
					renderFrame();
				}
			}, SPINNER_DELAY_MS);
		},

		update(event: ExportProgressEvent): void {
			if (finished) {
				return;
			}

			if (!isTty) {
				const line = formatProgressLogLine(event);
				if (line !== undefined) {
					output.write(`${line}\n`);
				}
				return;
			}

			statusMessage = event.message;
			currentPhase = event.phase;
			phaseCurrent = event.current;
			phaseTotal = event.total;

			if (event.novelTitle) {
				novelTitle = event.novelTitle;
			}

			if (event.volumes) {
				volumes = event.volumes.map((item) => ({
					index: item.index,
					id: item.id,
					title: item.title,
					chapterTotal: item.chapterTotal,
					chaptersDone: 0,
					chaptersIssues: 0,
					mediaTotal: 0,
					mediaDone: 0,
					packState: "pending",
				}));
				maxVolumeTitleWidth = volumes.reduce(
					(max, item) => Math.max(max, getDisplayWidth(item.title)),
					0,
				);
				activeVolumeIndex = volumes.length > 0 ? 0 : undefined;
				activeVolumeTitle = undefined;
				activeDetail = undefined;
			}

			if (event.phase === "chapters") {
				if (event.volumeIndex !== undefined) {
					activeVolumeIndex = event.volumeIndex;
				}
				activeVolumeTitle = event.volumeTitle;
				activeDetail = event.chapterTitle ?? event.message;

				if (
					event.chapterStatus !== "fetching" &&
					event.volumeIndex !== undefined
				) {
					const vol = volumes[event.volumeIndex];
					if (vol) {
						vol.chaptersDone = event.volumeCurrent ?? vol.chaptersDone + 1;
						if (
							event.chapterStatus === "skipped" ||
							event.chapterStatus === "failed"
						) {
							vol.chaptersIssues += 1;
						}
					}
				}
			} else if (event.phase === "images") {
				if (event.volumeMediaTotals) {
					for (let i = 0; i < event.volumeMediaTotals.length; i += 1) {
						const vol = volumes[i];
						const total = event.volumeMediaTotals[i];
						if (vol && total !== undefined) {
							vol.mediaTotal = total;
						}
					}
				}
				if (event.affectedVolumeIndices) {
					for (const idx of event.affectedVolumeIndices) {
						const vol = volumes[idx];
						if (vol) {
							vol.mediaDone = Math.min(vol.mediaTotal, vol.mediaDone + 1);
						}
					}
				}
				activeVolumeTitle = event.volumeTitle;
				activeDetail = `Downloading media (${event.current}/${event.total})`;
				const nextPendingIdx = volumes.findIndex(
					(vol) => vol.mediaDone < vol.mediaTotal,
				);
				if (nextPendingIdx !== -1) {
					activeVolumeIndex = nextPendingIdx;
				} else if (volumes.length > 0) {
					activeVolumeIndex = volumes.length - 1;
				}
			} else if (event.phase === "pack" || event.phase === "write") {
				for (const vol of volumes) {
					if (vol.packState === "writing") {
						vol.packState = "written";
					}
				}

				if (options.mode === "split" && event.volumeIndex !== undefined) {
					activeVolumeIndex = event.volumeIndex;
					activeVolumeTitle = event.volumeTitle;
					const vol = volumes[event.volumeIndex];
					if (vol) {
						if (event.phase === "pack") {
							vol.packState = "packing";
							activeDetail = "Packing EPUB";
						} else if (event.skipped) {
							vol.packState = "skipped";
							activeDetail = "Skipped existing file";
						} else {
							vol.packState = "writing";
							activeDetail = stripVolumePrefix(
								event.message,
								event.volumeTitle,
							);
						}
					}
				} else if (options.mode === "merged") {
					activeVolumeTitle = novelTitle || undefined;
					activeDetail = event.message;
					activeVolumeIndex =
						volumes.length > 0 ? volumes.length - 1 : undefined;
					const nextState: VolumePackState =
						event.phase === "pack"
							? "packing"
							: event.skipped
								? "skipped"
								: "writing";
					for (const vol of volumes) {
						vol.packState = nextState;
					}
				}
			}

			overallRatio = Math.min(
				1,
				Math.max(overallRatio, computeOverallRatio(event)),
			);

			if (performance.now() - lastRenderAt >= RENDER_THROTTLE_MS) {
				renderFrame();
			} else {
				dirty = true;
			}
		},

		stop(message: string): void {
			for (const vol of volumes) {
				if (vol.packState === "writing") {
					vol.packState = "written";
				}
			}
			overallRatio = 1;
			finish(message, "submit");
		},

		error(message: string): void {
			finish(message, "error");
		},

		cancel(message = "Export cancelled."): void {
			finish(message, "cancel");
		},
	};
}
