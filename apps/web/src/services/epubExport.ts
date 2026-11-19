import type { Novel } from "@acanthis-dec/core";
import { webDb } from "@/db/indexedDb";
import { isUnresolvedChapterId } from "@/utils/epubHtml";
import type {
	EpubExportProgress,
	EpubWorkerRequest,
	EpubWorkerResponse,
} from "@/workers/protocol";

export type { EpubExportProgress, EpubExportStage } from "@/workers/protocol";

export interface ExportVolumeEpubOptions {
	apiBaseUrl: string;
	authToken: string;
	novel: Novel;
	volumeId: string;
	onProgress?: ((progress: EpubExportProgress) => void) | undefined;
	signal?: AbortSignal | undefined;
}

export interface ExportNovelEpubOptions {
	apiBaseUrl: string;
	authToken: string;
	novel: Novel;
	volumeIds: string[];
	onProgress?: ((progress: EpubExportProgress) => void) | undefined;
	signal?: AbortSignal | undefined;
}

function createAbortError(): DOMException {
	return new DOMException("已取消 EPUB 导出", "AbortError");
}

function triggerEpubDownload(fileName: string, buffer: ArrayBuffer): void {
	const blob = new Blob([buffer], { type: "application/epub+zip" });
	const objectUrl = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = objectUrl;
	link.download = fileName;
	link.style.display = "none";
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => {
		URL.revokeObjectURL(objectUrl);
	}, 60_000);
}

async function preloadCachedChapters(
	novel: Novel,
	volumeIds: readonly string[],
	signal?: AbortSignal,
): Promise<Record<string, string>> {
	const selectedIdSet = new Set(volumeIds);
	const chapterIds: string[] = [];
	const seen = new Set<string>();

	for (const volume of novel.volumes) {
		if (!selectedIdSet.has(volume.id)) {
			continue;
		}
		for (const chapter of volume.chapters) {
			if (isUnresolvedChapterId(chapter.id) || seen.has(chapter.id)) {
				continue;
			}
			seen.add(chapter.id);
			chapterIds.push(chapter.id);
		}
	}

	const cachedChapters: Record<string, string> = {};
	if (chapterIds.length === 0) {
		return cachedChapters;
	}

	const results = await Promise.all(
		chapterIds.map(async (chapterId) => {
			if (signal?.aborted) {
				return null;
			}
			try {
				const record = await webDb.getChapterCache(novel.platform, chapterId);
				return record && record.content.length > 0
					? { chapterId, content: record.content }
					: null;
			} catch {
				return null;
			}
		}),
	);

	for (const entry of results) {
		if (entry) {
			cachedChapters[entry.chapterId] = entry.content;
		}
	}

	return cachedChapters;
}

async function runWorkerExport(options: {
	kind: "volume" | "novel";
	apiBaseUrl: string;
	authToken: string;
	novel: Novel;
	volumeIds: string[];
	onProgress?: ((progress: EpubExportProgress) => void) | undefined;
	signal?: AbortSignal | undefined;
}): Promise<void> {
	if (options.signal?.aborted) {
		throw createAbortError();
	}

	// Strip Vue reactive proxies before structured cloning to the Web Worker.
	const plainNovel = JSON.parse(JSON.stringify(options.novel)) as Novel;
	const plainVolumeIds = options.volumeIds.map((id) => String(id));

	const cachedChapters = await preloadCachedChapters(
		plainNovel,
		plainVolumeIds,
		options.signal,
	);
	if (options.signal?.aborted) {
		throw createAbortError();
	}

	await new Promise<void>((resolve, reject) => {
		const worker = new Worker(
			new URL("../workers/epub.worker.ts", import.meta.url),
			{ type: "module" },
		);

		let settled = false;

		const cleanup = (): void => {
			worker.onmessage = null;
			worker.onerror = null;
			worker.onmessageerror = null;
			if (options.signal) {
				options.signal.removeEventListener("abort", handleAbort);
			}
		};

		const fail = (error: unknown): void => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			worker.terminate();
			reject(error instanceof Error ? error : new Error(String(error)));
		};

		const handleAbort = (): void => {
			fail(createAbortError());
		};

		if (options.signal) {
			if (options.signal.aborted) {
				fail(createAbortError());
				return;
			}
			options.signal.addEventListener("abort", handleAbort, { once: true });
		}

		worker.onmessage = (event: MessageEvent<EpubWorkerResponse>): void => {
			if (settled) {
				return;
			}
			const payload = event.data;
			if (payload.type === "progress") {
				options.onProgress?.({
					stage: payload.stage,
					completed: payload.completed,
					total: payload.total,
					message: payload.message,
				});
				return;
			}

			if (payload.type === "done") {
				settled = true;
				cleanup();
				worker.terminate();
				try {
					triggerEpubDownload(payload.fileName, payload.buffer);
					resolve();
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
				}
				return;
			}

			fail(new Error(payload.message));
		};

		worker.onerror = (event: ErrorEvent): void => {
			fail(new Error(event.message || "EPUB 导出 Worker 执行异常"));
		};

		worker.onmessageerror = (): void => {
			fail(new Error("EPUB 导出 Worker 消息解析失败"));
		};

		const request: EpubWorkerRequest = {
			kind: options.kind,
			apiBaseUrl: options.apiBaseUrl,
			authToken: options.authToken,
			novel: plainNovel,
			volumeIds: plainVolumeIds,
			cachedChapters,
		};
		worker.postMessage(request);
	});
}

export async function exportVolumeEpub(
	options: ExportVolumeEpubOptions,
): Promise<void> {
	await runWorkerExport({
		kind: "volume",
		apiBaseUrl: options.apiBaseUrl,
		authToken: options.authToken,
		novel: options.novel,
		volumeIds: [options.volumeId],
		onProgress: options.onProgress,
		signal: options.signal,
	});
}

export async function exportNovelEpub(
	options: ExportNovelEpubOptions,
): Promise<void> {
	if (options.volumeIds.length === 0) {
		throw new Error("请至少选择一卷再导出 EPUB");
	}
	await runWorkerExport({
		kind: "novel",
		apiBaseUrl: options.apiBaseUrl,
		authToken: options.authToken,
		novel: options.novel,
		volumeIds: options.volumeIds,
		onProgress: options.onProgress,
		signal: options.signal,
	});
}
