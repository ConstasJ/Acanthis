import type { BookshelfItem, ReadingProgress } from "@acanthis-dec/core";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
	fetchSyncState,
	postSyncState,
	type SyncStatePushPayload,
} from "@/api/client";
import { type DirtySyncEntry, makeCompositeKey, webDb } from "@/db/indexedDb";
import { useSettingsStore } from "@/stores/settings";

export const DEBOUNCE_PUSH_MS = 2000;
export const KEEPALIVE_MAX_BYTES = 60 * 1024;

export interface ToggleBookshelfEntry {
	platform: string;
	novelId: string;
	title: string;
	author: string;
	coverUrl: string;
}

function makeDirtyKey(
	kind: "bookshelf" | "progress",
	platform: string,
	novelId: string,
): string {
	return `${kind}:${platform}:${novelId}`;
}

function cloneBookshelfItem(item: BookshelfItem): BookshelfItem {
	return {
		platform: item.platform,
		novelId: item.novelId,
		title: item.title,
		author: item.author,
		coverUrl: item.coverUrl,
		addedAt: item.addedAt,
		updatedAt: item.updatedAt,
		deletedAt: item.deletedAt,
	};
}

function cloneReadingProgress(item: ReadingProgress): ReadingProgress {
	return {
		platform: item.platform,
		novelId: item.novelId,
		novelTitle: item.novelTitle,
		coverUrl: item.coverUrl,
		volumeId: item.volumeId,
		volumeTitle: item.volumeTitle,
		chapterId: item.chapterId,
		chapterTitle: item.chapterTitle,
		paragraphIndex: item.paragraphIndex,
		totalParagraphs: item.totalParagraphs,
		deviceLabel: item.deviceLabel,
		updatedAt: item.updatedAt,
	};
}

export function applyKeepalivePayloadLimit(
	payload: SyncStatePushPayload,
	maxBytes = KEEPALIVE_MAX_BYTES,
): SyncStatePushPayload | null {
	const hasBookshelf = (payload.bookshelf?.length ?? 0) > 0;
	const hasProgress = (payload.progress?.length ?? 0) > 0;
	if (!hasBookshelf && !hasProgress) {
		return null;
	}

	const encoder = new TextEncoder();
	if (encoder.encode(JSON.stringify(payload)).byteLength <= maxBytes) {
		return payload;
	}

	if (payload.progress && payload.progress.length > 0) {
		let latestProgress = payload.progress[0];
		for (const item of payload.progress) {
			if (!latestProgress || item.updatedAt > latestProgress.updatedAt) {
				latestProgress = item;
			}
		}
		if (latestProgress) {
			const degraded: SyncStatePushPayload = {
				progress: [cloneReadingProgress(latestProgress)],
			};
			if (encoder.encode(JSON.stringify(degraded)).byteLength <= maxBytes) {
				return degraded;
			}
		}
	}

	if (payload.bookshelf && payload.bookshelf.length > 0) {
		let latestBookshelf = payload.bookshelf[0];
		for (const item of payload.bookshelf) {
			if (!latestBookshelf || item.updatedAt > latestBookshelf.updatedAt) {
				latestBookshelf = item;
			}
		}
		if (latestBookshelf) {
			const degraded: SyncStatePushPayload = {
				bookshelf: [cloneBookshelfItem(latestBookshelf)],
			};
			if (encoder.encode(JSON.stringify(degraded)).byteLength <= maxBytes) {
				return degraded;
			}
		}
	}

	return null;
}

export const useLibraryStore = defineStore("library", () => {
	const bookshelfMap = ref<Map<string, BookshelfItem>>(new Map());
	const progressMap = ref<Map<string, ReadingProgress>>(new Map());
	const dirtyMap = new Map<string, DirtySyncEntry>();

	const hydrated = ref<boolean>(false);
	const syncStatus = ref<"idle" | "syncing" | "error">("idle");
	const lastSyncError = ref<string | null>(null);
	const lastSyncedAt = ref<number | null>(null);

	let hydratePromise: Promise<void> | null = null;
	let inFlightSyncPromise: Promise<void> | null = null;
	let pushDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	const activeBookshelf = computed<BookshelfItem[]>(() => {
		const list: BookshelfItem[] = [];
		for (const item of bookshelfMap.value.values()) {
			if (item.deletedAt === null) {
				list.push(item);
			}
		}
		return list;
	});

	const continueReadingItem = computed<ReadingProgress | null>(() => {
		let latest: ReadingProgress | null = null;
		for (const item of progressMap.value.values()) {
			if (!latest || item.updatedAt > latest.updatedAt) {
				latest = item;
			}
		}
		return latest;
	});

	function isInBookshelf(platform: string, novelId: string): boolean {
		const item = bookshelfMap.value.get(makeCompositeKey(platform, novelId));
		return item !== undefined && item.deletedAt === null;
	}

	function getProgress(
		platform: string,
		novelId: string,
	): ReadingProgress | undefined {
		return progressMap.value.get(makeCompositeKey(platform, novelId));
	}

	function mergeBookshelfItem(remote: BookshelfItem): BookshelfItem | null {
		const key = makeCompositeKey(remote.platform, remote.novelId);
		const local = bookshelfMap.value.get(key);
		if (!local || remote.updatedAt >= local.updatedAt) {
			const accepted = cloneBookshelfItem(remote);
			bookshelfMap.value.set(key, accepted);
			return accepted;
		}
		return null;
	}

	function mergeProgressItem(remote: ReadingProgress): ReadingProgress | null {
		const key = makeCompositeKey(remote.platform, remote.novelId);
		const local = progressMap.value.get(key);
		if (!local || remote.updatedAt >= local.updatedAt) {
			const accepted = cloneReadingProgress(remote);
			progressMap.value.set(key, accepted);
			return accepted;
		}
		return null;
	}

	async function hydrate(): Promise<void> {
		if (hydrated.value) {
			return;
		}
		if (hydratePromise !== null) {
			return hydratePromise;
		}

		hydratePromise = (async () => {
			try {
				const [bookshelfList, progressList, dirtyList] = await Promise.all([
					webDb.getAllBookshelf(),
					webDb.getAllProgress(),
					webDb.getDirtyEntries(),
				]);

				for (const item of bookshelfList) {
					const key = makeCompositeKey(item.platform, item.novelId);
					const existing = bookshelfMap.value.get(key);
					if (!existing || item.updatedAt > existing.updatedAt) {
						bookshelfMap.value.set(key, cloneBookshelfItem(item));
					}
				}

				for (const item of progressList) {
					const key = makeCompositeKey(item.platform, item.novelId);
					const existing = progressMap.value.get(key);
					if (!existing || item.updatedAt > existing.updatedAt) {
						progressMap.value.set(key, cloneReadingProgress(item));
					}
				}

				for (const entry of dirtyList) {
					const existing = dirtyMap.get(entry.key);
					if (!existing || entry.updatedAt > existing.updatedAt) {
						dirtyMap.set(entry.key, { ...entry });
					}
				}

				hydrated.value = true;
			} finally {
				hydratePromise = null;
			}
		})();

		return hydratePromise;
	}

	function buildDirtyPayloadFromEntries(entries: Iterable<DirtySyncEntry>): {
		payload: SyncStatePushPayload;
		pushedSnapshot: Map<string, number>;
	} {
		const bookshelfToPush: BookshelfItem[] = [];
		const progressToPush: ReadingProgress[] = [];
		const pushedSnapshot = new Map<string, number>();

		for (const entry of entries) {
			const compositeKey = makeCompositeKey(entry.platform, entry.novelId);
			if (entry.kind === "bookshelf") {
				const item = bookshelfMap.value.get(compositeKey);
				if (item) {
					bookshelfToPush.push(cloneBookshelfItem(item));
					pushedSnapshot.set(entry.key, entry.updatedAt);
				}
			} else {
				const item = progressMap.value.get(compositeKey);
				if (item) {
					progressToPush.push(cloneReadingProgress(item));
					pushedSnapshot.set(entry.key, entry.updatedAt);
				}
			}
		}

		const payload: SyncStatePushPayload = {};
		if (bookshelfToPush.length > 0) {
			payload.bookshelf = bookshelfToPush;
		}
		if (progressToPush.length > 0) {
			payload.progress = progressToPush;
		}

		return { payload, pushedSnapshot };
	}

	async function pushDirtyQueue(): Promise<void> {
		const diskEntries = await webDb.getDirtyEntries();
		const mergedEntries = new Map<string, DirtySyncEntry>();
		for (const entry of diskEntries) {
			mergedEntries.set(entry.key, entry);
		}
		for (const [key, entry] of dirtyMap.entries()) {
			const existing = mergedEntries.get(key);
			if (!existing || entry.updatedAt > existing.updatedAt) {
				mergedEntries.set(key, entry);
			}
		}

		const { payload, pushedSnapshot } = buildDirtyPayloadFromEntries(
			mergedEntries.values(),
		);
		if (!payload.bookshelf?.length && !payload.progress?.length) {
			return;
		}

		// Intentionally do NOT write pushResult.serverTime to lastSyncServerTime.
		const pushResult = await postSyncState(payload);

		const latestDiskEntries = await webDb.getDirtyEntries();
		const latestDiskMap = new Map<string, DirtySyncEntry>();
		for (const entry of latestDiskEntries) {
			latestDiskMap.set(entry.key, entry);
		}

		const keysToDelete: string[] = [];
		for (const [dirtyKey, pushedUpdatedAt] of pushedSnapshot.entries()) {
			const inMem = dirtyMap.get(dirtyKey);
			const onDisk = latestDiskMap.get(dirtyKey);
			const modifiedMidFlight =
				(inMem !== undefined && inMem.updatedAt > pushedUpdatedAt) ||
				(onDisk !== undefined && onDisk.updatedAt > pushedUpdatedAt);
			if (!modifiedMidFlight) {
				keysToDelete.push(dirtyKey);
				dirtyMap.delete(dirtyKey);
			}
		}

		if (keysToDelete.length > 0) {
			await webDb.deleteDirtyEntries(keysToDelete);
		}

		const acceptedBookshelf: BookshelfItem[] = [];
		for (const remoteItem of pushResult.bookshelf) {
			const accepted = mergeBookshelfItem(remoteItem);
			if (accepted) {
				acceptedBookshelf.push(accepted);
			}
		}

		const acceptedProgress: ReadingProgress[] = [];
		for (const remoteItem of pushResult.progress) {
			const accepted = mergeProgressItem(remoteItem);
			if (accepted) {
				acceptedProgress.push(accepted);
			}
		}

		await Promise.all([
			webDb.bulkPutBookshelf(acceptedBookshelf),
			webDb.bulkPutProgress(acceptedProgress),
		]);
	}

	function clearDebounceTimer(): void {
		if (pushDebounceTimer !== null) {
			clearTimeout(pushDebounceTimer);
			pushDebounceTimer = null;
		}
	}

	function scheduleDebouncedPush(): void {
		clearDebounceTimer();
		pushDebounceTimer = setTimeout(() => {
			pushDebounceTimer = null;
			void pushDirtyQueue().catch(() => {
				// Keep dirtyQueue intact for retry on next syncNow() or flushOnLeave().
			});
		}, DEBOUNCE_PUSH_MS);
	}

	async function syncNow(): Promise<void> {
		if (inFlightSyncPromise !== null) {
			return inFlightSyncPromise;
		}

		inFlightSyncPromise = (async () => {
			const settingsStore = useSettingsStore();
			await hydrate();
			syncStatus.value = "syncing";
			lastSyncError.value = null;

			try {
				await pushDirtyQueue();

				const pullResult = await fetchSyncState(
					settingsStore.lastSyncServerTime,
				);

				const acceptedBookshelf: BookshelfItem[] = [];
				for (const remoteItem of pullResult.bookshelf) {
					const accepted = mergeBookshelfItem(remoteItem);
					if (accepted) {
						acceptedBookshelf.push(accepted);
					}
				}

				const acceptedProgress: ReadingProgress[] = [];
				for (const remoteItem of pullResult.progress) {
					const accepted = mergeProgressItem(remoteItem);
					if (accepted) {
						acceptedProgress.push(accepted);
					}
				}

				await Promise.all([
					webDb.bulkPutBookshelf(acceptedBookshelf),
					webDb.bulkPutProgress(acceptedProgress),
				]);

				// Advance cursor strictly from GET /v1/sync/state response.
				settingsStore.setLastSyncServerTime(pullResult.cursor);

				syncStatus.value = "idle";
				lastSyncedAt.value = Date.now();
			} catch (err) {
				syncStatus.value = "error";
				lastSyncError.value = err instanceof Error ? err.message : String(err);
			} finally {
				inFlightSyncPromise = null;
			}
		})();

		return inFlightSyncPromise;
	}

	async function toggleBookshelf(entry: ToggleBookshelfEntry): Promise<boolean> {
		const compositeKey = makeCompositeKey(entry.platform, entry.novelId);
		const existing = bookshelfMap.value.get(compositeKey);
		const now = Date.now();
		const isCurrentlyActive = existing !== undefined && existing.deletedAt === null;

		let updated: BookshelfItem;
		let added: boolean;
		if (isCurrentlyActive) {
			updated = {
				platform: existing.platform,
				novelId: existing.novelId,
				title: entry.title || existing.title,
				author: entry.author || existing.author,
				coverUrl: entry.coverUrl || existing.coverUrl,
				addedAt: existing.addedAt,
				updatedAt: now,
				deletedAt: now,
			};
			added = false;
		} else {
			updated = {
				platform: entry.platform,
				novelId: entry.novelId,
				title: entry.title,
				author: entry.author,
				coverUrl: entry.coverUrl,
				addedAt: now,
				updatedAt: now,
				deletedAt: null,
			};
			added = true;
		}

		const dirtyKey = makeDirtyKey("bookshelf", entry.platform, entry.novelId);
		const dirtyEntry: DirtySyncEntry = {
			key: dirtyKey,
			kind: "bookshelf",
			platform: entry.platform,
			novelId: entry.novelId,
			updatedAt: now,
		};

		bookshelfMap.value.set(compositeKey, updated);
		dirtyMap.set(dirtyKey, dirtyEntry);

		await Promise.all([
			webDb.putBookshelf(updated),
			webDb.putDirtyEntry(dirtyEntry),
		]);

		scheduleDebouncedPush();
		return added;
	}

	async function updateReadingProgress(
		progress: ReadingProgress,
	): Promise<void> {
		const clean = cloneReadingProgress(progress);
		const compositeKey = makeCompositeKey(clean.platform, clean.novelId);
		const dirtyKey = makeDirtyKey("progress", clean.platform, clean.novelId);
		const dirtyEntry: DirtySyncEntry = {
			key: dirtyKey,
			kind: "progress",
			platform: clean.platform,
			novelId: clean.novelId,
			updatedAt: clean.updatedAt,
		};

		progressMap.value.set(compositeKey, clean);
		dirtyMap.set(dirtyKey, dirtyEntry);

		await Promise.all([
			webDb.putProgress(clean),
			webDb.putDirtyEntry(dirtyEntry),
		]);

		scheduleDebouncedPush();
	}

	function flushOnLeave(): void {
		clearDebounceTimer();
		if (dirtyMap.size === 0) {
			return;
		}

		const { payload } = buildDirtyPayloadFromEntries(dirtyMap.values());
		const safePayload = applyKeepalivePayloadLimit(payload);
		if (!safePayload) {
			return;
		}

		// Fire-and-forget with keepalive; keep dirtyQueue intact if it fails.
		void postSyncState(safePayload, { keepalive: true }).catch(() => {});
	}

	return {
		bookshelfMap,
		progressMap,
		hydrated,
		activeBookshelf,
		continueReadingItem,
		syncStatus,
		lastSyncError,
		lastSyncedAt,
		isInBookshelf,
		getProgress,
		hydrate,
		syncNow,
		toggleBookshelf,
		updateReadingProgress,
		flushOnLeave,
	};
});
