import type {
	Novel,
	NovelSearchResult,
	NovelSourceDescriptor,
} from "@acanthis-dec/core";
import {
	cancel,
	confirm,
	intro,
	isCancel,
	log,
	multiselect,
	note,
	outro,
	password,
	select,
	spinner,
	text,
} from "@clack/prompts";
import pc from "picocolors";
import {
	AcanthisApiClient,
	ApiClientError,
	normalizeServerUrl,
	type PaginatedNovelsResponse,
} from "./client";
import { loadCliConfig, saveCliConfigValue } from "./config";
import { runExport } from "./exporter";
import type { ExportMode, ResolvedCliConfig } from "./types";
import { isUnresolvedChapterId, parseNovelIdOrUrl } from "./utils";

class WizardCancelledError extends Error {
	constructor() {
		super("Wizard cancelled by user");
		this.name = "WizardCancelledError";
	}
}

function unwrapPrompt<T>(value: T | symbol): T {
	if (isCancel(value)) {
		cancel("Operation cancelled.");
		throw new WizardCancelledError();
	}
	return value;
}

async function connectAndSelectSource(
	initialConfig: ResolvedCliConfig,
): Promise<{
	serverUrl: string;
	token: string | undefined;
	source: string;
	client: AcanthisApiClient;
}> {
	let serverUrl = initialConfig.serverUrl;
	let token = initialConfig.token;

	while (true) {
		const client = new AcanthisApiClient(serverUrl, token);
		const probeSpinner = spinner();
		probeSpinner.start(`Connecting to ${serverUrl}...`);
		let sources: NovelSourceDescriptor[];
		try {
			sources = await client.getSources();
			probeSpinner.stop(`Connected to ${serverUrl}`);
		} catch (error) {
			probeSpinner.error(`Failed to connect to ${serverUrl}`);
			const isAuthFailure =
				error instanceof ApiClientError &&
				(error.status === 401 || error.code === 40100);
			log.error(
				isAuthFailure
					? "Authentication failed (401). Please verify your API token or server URL."
					: error instanceof Error
						? error.message
						: String(error),
			);

			const retryAction = unwrapPrompt(
				await select({
					message: "How would you like to proceed?",
					options: [
						{ value: "server", label: "Change server URL" },
						{ value: "token", label: "Set / update Bearer token" },
						{ value: "retry", label: "Retry current connection" },
						{ value: "exit", label: "Exit" },
					],
				}),
			);

			if (retryAction === "exit") {
				cancel("Exited.");
				throw new WizardCancelledError();
			}

			if (retryAction === "server") {
				const rawUrl = unwrapPrompt(
					await text({
						message: "Enter Acanthis API server URL:",
						initialValue: serverUrl,
						placeholder: "http://localhost:5301",
						validate: (value) => {
							if (!value?.trim()) {
								return "Server URL cannot be empty";
							}
							try {
								normalizeServerUrl(value);
								return undefined;
							} catch (err) {
								return err instanceof Error ? err.message : "Invalid URL";
							}
						},
					}),
				);
				serverUrl = normalizeServerUrl(rawUrl);

				const shouldSaveUrl = unwrapPrompt(
					await confirm({
						message: "Save this server URL to user config?",
						initialValue: true,
					}),
				);
				if (shouldSaveUrl) {
					await saveCliConfigValue("serverUrl", serverUrl);
					log.success(`Saved serverUrl = ${serverUrl}`);
				}
			} else if (retryAction === "token") {
				const enteredToken = unwrapPrompt(
					await password({
						message: "Enter Bearer token (leave empty to clear):",
					}),
				);
				token = enteredToken.trim() || undefined;
				const shouldSaveToken = unwrapPrompt(
					await confirm({
						message: "Save this token to user config?",
						initialValue: false,
					}),
				);
				if (shouldSaveToken) {
					await saveCliConfigValue("token", token ?? "");
					log.success(
						token ? "Saved token to user config." : "Cleared saved token.",
					);
				}
			}
			continue;
		}

		if (sources.length === 0) {
			throw new Error("Server returned no available novel sources.");
		}

		if (sources.length === 1) {
			const soleSource = sources[0];
			if (!soleSource) {
				throw new Error("Server returned no available novel sources.");
			}
			log.info(
				`Using source: ${pc.bold(soleSource.name)} (${pc.cyan(soleSource.id)})`,
			);
			return {
				serverUrl,
				token,
				source: soleSource.id,
				client,
			};
		}

		const hasDefault = sources.some(
			(item) => item.id === initialConfig.defaultSource,
		);
		const fallbackSourceId = sources[0]?.id ?? initialConfig.defaultSource;
		const chosenSource = unwrapPrompt(
			await select({
				message: "Select novel source:",
				initialValue: hasDefault
					? initialConfig.defaultSource
					: fallbackSourceId,
				options: sources.map((item) => ({
					value: item.id,
					label: item.name,
					hint: `${item.id} [${item.capabilities.join(", ")}]`,
				})),
			}),
		);

		return {
			serverUrl,
			token,
			source: chosenSource,
			client,
		};
	}
}

async function browseLibraryForNovelId(
	client: AcanthisApiClient,
	source: string,
): Promise<string | undefined> {
	let page = 1;
	const pageSize = 10;

	while (true) {
		const spin = spinner();
		spin.start(`Loading cached library (page ${page})...`);
		let res: PaginatedNovelsResponse;
		try {
			res = await client.listNovels(source, page, pageSize);
			spin.stop(
				`Loaded page ${res.page} (${res.items.length} of ${res.total})`,
			);
		} catch (error) {
			spin.error("Failed to load cached library");
			log.error(error instanceof Error ? error.message : String(error));
			return undefined;
		}

		if (res.items.length === 0) {
			log.warn("No cached novels found on the server.");
			return undefined;
		}

		const totalPages = Math.max(1, Math.ceil(res.total / res.pageSize));
		const options: Array<{ value: string; label: string; hint?: string }> =
			res.items.map((item) => ({
				value: `novel:${item.id}`,
				label: item.title,
				hint: `${item.author} · id=${item.id}`,
			}));

		if (page < totalPages) {
			options.push({
				value: "nav:next",
				label: `Next page (${page + 1}/${totalPages})`,
			});
		}
		if (page > 1) {
			options.push({
				value: "nav:prev",
				label: `Previous page (${page - 1}/${totalPages})`,
			});
		}
		options.push({
			value: "nav:back",
			label: "Back to action menu",
		});

		const picked = unwrapPrompt(
			await select({
				message: `Cached library — Page ${page}/${totalPages}:`,
				options,
			}),
		);

		if (picked === "nav:next") {
			page += 1;
			continue;
		}
		if (picked === "nav:prev") {
			page -= 1;
			continue;
		}
		if (picked === "nav:back") {
			return undefined;
		}
		return picked.slice("novel:".length);
	}
}

async function searchForNovelId(
	client: AcanthisApiClient,
	source: string,
): Promise<string | undefined> {
	while (true) {
		const keyword = unwrapPrompt(
			await text({
				message: "Enter search keyword:",
				validate: (value) =>
					value?.trim() ? undefined : "Keyword cannot be empty",
			}),
		).trim();

		const spin = spinner();
		spin.start(`Searching "${keyword}"...`);
		let results: NovelSearchResult[];
		try {
			results = await client.searchNovels(source, keyword);
			spin.stop(`Found ${results.length} result(s)`);
		} catch (error) {
			spin.error("Search failed");
			log.error(error instanceof Error ? error.message : String(error));
			return undefined;
		}

		if (results.length === 0) {
			const retry = unwrapPrompt(
				await confirm({
					message: `No novels matched "${keyword}". Search again?`,
					initialValue: true,
				}),
			);
			if (retry) {
				continue;
			}
			return undefined;
		}

		const picked = unwrapPrompt(
			await select({
				message: "Select a novel from search results:",
				options: [
					...results.map((item) => ({
						value: `novel:${item.id}`,
						label: item.title,
						hint: `id=${item.id}`,
					})),
					{ value: "action:again", label: "Search with another keyword" },
					{ value: "action:back", label: "Back to action menu" },
				],
			}),
		);

		if (picked === "action:again") {
			continue;
		}
		if (picked === "action:back") {
			return undefined;
		}
		return picked.slice("novel:".length);
	}
}

async function pickNovelId(
	client: AcanthisApiClient,
	source: string,
): Promise<string> {
	while (true) {
		const action = unwrapPrompt(
			await select({
				message: "Choose how to select a novel:",
				options: [
					{
						value: "browse",
						label: "Browse cached library",
						hint: "Paginated list from server cache",
					},
					{
						value: "search",
						label: "Search by keyword",
						hint: "Query source search endpoint",
					},
					{
						value: "direct",
						label: "Enter novel ID or URL directly",
						hint: "e.g. 3590 or https://www.linovelib.com/novel/3590.html",
					},
				],
			}),
		);

		if (action === "browse") {
			const picked = await browseLibraryForNovelId(client, source);
			if (picked) {
				return picked;
			}
			continue;
		}

		if (action === "search") {
			const picked = await searchForNovelId(client, source);
			if (picked) {
				return picked;
			}
			continue;
		}

		const rawInput = unwrapPrompt(
			await text({
				message: "Enter novel ID or URL:",
				placeholder: "3590",
				validate: (value) => {
					if (!value?.trim()) {
						return "Novel ID or URL cannot be empty";
					}
					try {
						parseNovelIdOrUrl(value);
						return undefined;
					} catch (error) {
						return error instanceof Error ? error.message : "Invalid input";
					}
				},
			}),
		);
		return parseNovelIdOrUrl(rawInput);
	}
}

function summarizeNovel(novel: Novel): {
	totalChapters: number;
	unresolvedCount: number;
} {
	let totalChapters = 0;
	let unresolvedCount = 0;
	for (const volume of novel.volumes) {
		totalChapters += volume.chapters.length;
		for (const chapter of volume.chapters) {
			if (isUnresolvedChapterId(chapter.id)) {
				unresolvedCount += 1;
			}
		}
	}
	return { totalChapters, unresolvedCount };
}

export async function runInteractiveWizard(): Promise<void> {
	intro(pc.bgCyan(pc.black(" Acanthis EPUB Export Wizard ")));

	try {
		const config = await loadCliConfig();
		const { serverUrl, token, source, client } =
			await connectAndSelectSource(config);

		const novelId = await pickNovelId(client, source);

		const novelSpinner = spinner();
		novelSpinner.start(`Fetching novel ${novelId}...`);
		let novel: Novel;
		try {
			novel = await client.getNovel(source, novelId);
			novelSpinner.stop(`Loaded "${novel.title}"`);
		} catch (error) {
			novelSpinner.error("Failed to fetch novel details");
			throw error;
		}

		const { totalChapters, unresolvedCount } = summarizeNovel(novel);
		const summaryLines = [
			`Title:    ${novel.title}`,
			`Author:   ${novel.author}`,
			`Status:   ${novel.status}`,
			`Volumes:  ${novel.volumes.length}`,
			`Chapters: ${totalChapters}`,
		];
		if (unresolvedCount > 0) {
			summaryLines.push(
				pc.yellow(
					`Warning:  ${unresolvedCount} unresolved TOBEDETERMINED chapter(s) will be skipped unless strict mode is enabled.`,
				),
			);
		}
		note(summaryLines.join("\n"), "Novel Summary");

		if (novel.volumes.length === 0) {
			log.warn("This novel has no volumes to export.");
			outro("Done.");
			return;
		}

		const selectedVolumeIndices = unwrapPrompt(
			await multiselect({
				message:
					"Select volumes to export (space to toggle, enter to confirm):",
				initialValues: novel.volumes.map((_, index) => String(index + 1)),
				required: true,
				options: novel.volumes.map((volume, index) => {
					const unresolvedInVol = volume.chapters.filter((ch) =>
						isUnresolvedChapterId(ch.id),
					).length;
					const hintParts = [`${volume.chapters.length} chapters`];
					if (unresolvedInVol > 0) {
						hintParts.push(`${unresolvedInVol} unresolved`);
					}
					return {
						value: String(index + 1),
						label: `${index + 1}. ${volume.title}`,
						hint: hintParts.join(", "),
					};
				}),
			}),
		);

		const mode = unwrapPrompt(
			await select<ExportMode>({
				message: "Select export mode:",
				initialValue: "split",
				options: [
					{
						value: "split",
						label: "Split (one EPUB per volume)",
						hint: "Recommended for light novels",
					},
					{
						value: "merged",
						label: "Merged (single EPUB for all selected volumes)",
					},
				],
			}),
		);

		const outputDir = unwrapPrompt(
			await text({
				message: "Output directory:",
				initialValue: config.outputDir,
				defaultValue: config.outputDir,
				validate: (value) =>
					value?.trim() ? undefined : "Output directory cannot be empty",
			}),
		).trim();

		const illustrations = unwrapPrompt(
			await confirm({
				message: "Download and embed chapter illustrations?",
				initialValue: true,
			}),
		);

		const overwrite = unwrapPrompt(
			await confirm({
				message: "Overwrite existing EPUB files if present?",
				initialValue: false,
			}),
		);

		const exportSpinner = spinner();
		exportSpinner.start("Starting EPUB export...");
		const summary = await (async () => {
			try {
				const result = await runExport(
					client,
					{
						novelIdOrUrl: novel.id,
						serverUrl,
						source,
						token,
						outputDir,
						mode,
						volumes: selectedVolumeIndices.join(","),
						illustrations,
						strict: false,
						overwrite,
						json: false,
					},
					{
						onProgress: (event) => {
							exportSpinner.message(`[${event.phase}] ${event.message}`);
						},
					},
				);
				exportSpinner.stop(`Exported "${result.novelTitle}"`);
				return result;
			} catch (error) {
				exportSpinner.error("Export failed");
				throw error;
			}
		})();

		const writtenCount = summary.files.filter((f) => !f.skipped).length;
		const skippedCount = summary.files.filter((f) => f.skipped).length;

		const resultLines = summary.files.map((file) => {
			const tag = file.skipped ? pc.yellow("[SKIPPED]") : pc.green("[WRITTEN]");
			return `${tag} ${file.path} (${file.chapterCount} chapters)`;
		});
		note(
			resultLines.join("\n"),
			`Files (${writtenCount} written, ${skippedCount} skipped)`,
		);

		if (summary.warnings.length > 0) {
			for (const warning of summary.warnings) {
				log.warn(warning);
			}
		}

		outro("Export complete.");
	} catch (error) {
		if (error instanceof WizardCancelledError) {
			return;
		}
		throw error;
	}
}
