import type {
	BookshelfCategory,
	BookshelfItem,
	NovelStatus,
	ReadingProgress,
} from "@acanthis-dec/core";
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
export const MAX_CATEGORY_NAME_LENGTH = 32;

export interface ToggleBookshelfEntry {
	platform: string;
	novelId: string;
	title: string;
	author: string;
	coverUrl: string;
	genres?: string[];
	status?: NovelStatus;
	categoryIds?: string[];
}

function makeDirtyKey(
	kind: "bookshelf" | "progress",
	platform: string,
	novelId: string,
): string {
	return `${kind}:${platform}:${novelId}`;
}

function makeCategoryDirtyKey(categoryId: string): string {
	return `category:${categoryId}`;
}

function normalizeStringList(values: readonly string[] | undefined): string[] {
	if (!values || values.length === 0) {
		return [];
	}
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (trimmed && !seen.has(trimmed)) {
			seen.add(trimmed);
			result.push(trimmed);
		}
	}
	return result;
}

function normalizeNovelStatus(status: NovelStatus | undefined): NovelStatus {
	if (status === "ongoing" || status === "completed" || status === "unknown") {
		return status;
	}
	return "unknown";
}

function normalizeNullableTimestamp(
	value: number | null | undefined,
): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	return null;
}

function maxNullable(
	a: number | null | undefined,
	b: number | null | undefined,
): number | null {
	const left = normalizeNullableTimestamp(a);
	const right = normalizeNullableTimestamp(b);
	if (left === null) {
		return right;
	}
	if (right === null) {
		return left;
	}
	return Math.max(left, right);
}

export function normalizeCategoryName(rawName: string): string {
	const trimmed = rawName.trim();
	if (trimmed.length < 1) {
		throw new Error("书架名称不能为空");
	}
	if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
		throw new Error(`书架名称不能超过 ${MAX_CATEGORY_NAME_LENGTH} 个字符`);
	}
	return trimmed;
}

function generateCategoryId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	return `cat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
		categoryIds: normalizeStringList(item.categoryIds),
		genres: normalizeStringList(item.genres),
		status: normalizeNovelStatus(item.status),
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
		historyHiddenAt: normalizeNullableTimestamp(item.historyHiddenAt),
	};
}

function cloneCategory(item: BookshelfCategory): BookshelfCategory {
	return {
		id: item.id,
		name: item.name,
		sortOrder: Math.trunc(item.sortOrder),
		createdAt: item.createdAt,
		updatedAt: item.updatedAt,
		deletedAt: normalizeNullableTimestamp(item.deletedAt),
	};
}

function isHistoryVisible(item: ReadingProgress): boolean {
	const hiddenAt = normalizeNullableTimestamp(item.historyHiddenAt);
	return hiddenAt === null || item.updatedAt > hiddenAt;
}

export function applyKeepalivePayloadLimit(
	payload: SyncStatePushPayload,
	maxBytes = KEEPALIVE_MAX_BYTES,
): SyncStatePushPayload | null {
	const hasBookshelf = (payload.bookshelf?.length ?? 0) > 0;
	const hasProgress = (payload.progress?.length ?? 0) > 0;
	const hasCategories = (payload.categories?.length ?? 0) > 0;
	if (!hasBookshelf && !hasProgress && !hasCategories) {
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

	if (payload.categories && payload.categories.length > 0) {
		let latestCategory = payload.categories[0];
		for (const item of payload.categories) {
			if (!latestCategory || item.updatedAt > latestCategory.updatedAt) {
				latestCategory = item;
			}
		}
		if (latestCategory) {
			const degraded: SyncStatePushPayload = {
				categories: [cloneCategory(latestCategory)],
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
	const categoriesMap = ref<Map<string, BookshelfCategory>>(new Map());
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

	const activeCategories = computed<BookshelfCategory[]>(() => {
		const list: BookshelfCategory[] = [];
		for (const category of categoriesMap.value.values()) {
			if (category.deletedAt === null) {
				list.push(category);
			}
		}
		list.sort((a, b) => {
			if (a.sortOrder !== b.sortOrder) {
				return a.sortOrder - b.sortOrder;
			}
			if (a.createdAt !== b.createdAt) {
				return a.createdAt - b.createdAt;
			}
			return a.id.localeCompare(b.id);
		});
		return list;
	});

	const activeCategoryIdSet = computed<Set<string>>(
		() => new Set(activeCategories.value.map((category) => category.id)),
	);

	const historyList = computed<ReadingProgress[]>(() => {
		const list: ReadingProgress[] = [];
		for (const item of progressMap.value.values()) {
			if (isHistoryVisible(item)) {
				list.push(item);
			}
		}
		list.sort((a, b) => {
			if (b.updatedAt !== a.updatedAt) {
				return b.updatedAt - a.updatedAt;
			}
			return makeCompositeKey(a.platform, a.novelId).localeCompare(
				makeCompositeKey(b.platform, b.novelId),
			);
		});
		return list;
	});

	const continueReadingItem = computed<ReadingProgress | null>(
		() => historyList.value[0] ?? null,
	);

	function isInBookshelf(platform: string, novelId: string): boolean {
		const item = bookshelfMap.value.get(makeCompositeKey(platform, novelId));
		return item !== undefined && item.deletedAt === null;
	}

	function getBookshelfItem(
		platform: string,
		novelId: string,
	): BookshelfItem | undefined {
		return bookshelfMap.value.get(makeCompositeKey(platform, novelId));
	}

	function getProgress(
		platform: string,
		novelId: string,
	): ReadingProgress | undefined {
		return progressMap.value.get(makeCompositeKey(platform, novelId));
	}

	function getEffectiveCategoryIds(item: BookshelfItem): string[] {
		const validIds = activeCategoryIdSet.value;
		const seen = new Set<string>();
		const effective: string[] = [];
		for (const id of item.categoryIds ?? []) {
			if (validIds.has(id) && !seen.has(id)) {
				seen.add(id);
				effective.push(id);
			}
		}
		return effective;
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
		if (!local) {
			const accepted = cloneReadingProgress(remote);
			progressMap.value.set(key, accepted);
			return accepted;
		}

		const localHiddenAt = normalizeNullableTimestamp(local.historyHiddenAt);
		const mergedHiddenAt = maxNullable(localHiddenAt, remote.historyHiddenAt);
		if (remote.updatedAt >= local.updatedAt) {
			const accepted: ReadingProgress = {
				...cloneReadingProgress(remote),
				historyHiddenAt: mergedHiddenAt,
			};
			progressMap.value.set(key, accepted);
			return accepted;
		}

		if (mergedHiddenAt !== localHiddenAt) {
			const updatedLocal: ReadingProgress = {
				...cloneReadingProgress(local),
				historyHiddenAt: mergedHiddenAt,
			};
			progressMap.value.set(key, updatedLocal);
			return updatedLocal;
		}

		return null;
	}

	function mergeCategoryItem(
		remote: BookshelfCategory,
	): BookshelfCategory | null {
		const local = categoriesMap.value.get(remote.id);
		if (!local || remote.updatedAt >= local.updatedAt) {
			const accepted = cloneCategory(remote);
			categoriesMap.value.set(remote.id, accepted);
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
				const [bookshelfList, progressList, categoriesList, dirtyList] =
					await Promise.all([
						webDb.getAllBookshelf(),
						webDb.getAllProgress(),
						webDb.getAllCategories(),
						webDb.getDirtyEntries(),
					]);

				if (webDb.consumeSchemaUpgradeFlag()) {
					useSettingsStore().setLastSyncServerTime(0);
				}

				for (const item of bookshelfList) {
					const key = makeCompositeKey(item.platform, item.novelId);
					const existing = bookshelfMap.value.get(key);
					if (!existing || item.updatedAt > existing.updatedAt) {
						bookshelfMap.value.set(key, cloneBookshelfItem(item));
					}
				}

				for (const item of progressList) {
					mergeProgressItem(item);
				}

				for (const category of categoriesList) {
					const existing = categoriesMap.value.get(category.id);
					if (!existing || category.updatedAt > existing.updatedAt) {
						categoriesMap.value.set(category.id, cloneCategory(category));
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
		const categoriesToPush: BookshelfCategory[] = [];
		const pushedSnapshot = new Map<string, number>();

		for (const entry of entries) {
			if (entry.kind === "bookshelf") {
				const compositeKey = makeCompositeKey(entry.platform, entry.novelId);
				const item = bookshelfMap.value.get(compositeKey);
				if (item) {
					bookshelfToPush.push(cloneBookshelfItem(item));
					pushedSnapshot.set(entry.key, entry.updatedAt);
				}
			} else if (entry.kind === "progress") {
				const compositeKey = makeCompositeKey(entry.platform, entry.novelId);
				const item = progressMap.value.get(compositeKey);
				if (item) {
					progressToPush.push(cloneReadingProgress(item));
					pushedSnapshot.set(entry.key, entry.updatedAt);
				}
			} else if (entry.kind === "category") {
				const category = categoriesMap.value.get(entry.novelId);
				if (category) {
					categoriesToPush.push(cloneCategory(category));
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
		if (categoriesToPush.length > 0) {
			payload.categories = categoriesToPush;
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
		if (
			!payload.bookshelf?.length &&
			!payload.progress?.length &&
			!payload.categories?.length
		) {
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

		const acceptedCategories: BookshelfCategory[] = [];
		for (const remoteCategory of pushResult.categories ?? []) {
			const accepted = mergeCategoryItem(remoteCategory);
			if (accepted) {
				acceptedCategories.push(accepted);
			}
		}

		await Promise.all([
			webDb.bulkPutBookshelf(acceptedBookshelf),
			webDb.bulkPutProgress(acceptedProgress),
			webDb.bulkPutCategories(acceptedCategories),
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

				const acceptedCategories: BookshelfCategory[] = [];
				for (const remoteCategory of pullResult.categories ?? []) {
					const accepted = mergeCategoryItem(remoteCategory);
					if (accepted) {
						acceptedCategories.push(accepted);
					}
				}

				await Promise.all([
					webDb.bulkPutBookshelf(acceptedBookshelf),
					webDb.bulkPutProgress(acceptedProgress),
					webDb.bulkPutCategories(acceptedCategories),
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

	async function toggleBookshelf(
		entry: ToggleBookshelfEntry,
	): Promise<boolean> {
		const compositeKey = makeCompositeKey(entry.platform, entry.novelId);
		const existing = bookshelfMap.value.get(compositeKey);
		const now = Date.now();
		const isCurrentlyActive =
			existing !== undefined && existing.deletedAt === null;

		const nextGenres =
			entry.genres && entry.genres.length > 0
				? normalizeStringList(entry.genres)
				: normalizeStringList(existing?.genres);
		const nextStatus: NovelStatus =
			entry.status && entry.status !== "unknown"
				? entry.status
				: normalizeNovelStatus(existing?.status);

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
				categoryIds: normalizeStringList(existing.categoryIds),
				genres: nextGenres,
				status: nextStatus,
			};
			added = false;
		} else {
			const validIds = activeCategoryIdSet.value;
			const initialCategoryIds = normalizeStringList(entry.categoryIds).filter(
				(id) => validIds.has(id),
			);
			updated = {
				platform: entry.platform,
				novelId: entry.novelId,
				title: entry.title,
				author: entry.author,
				coverUrl: entry.coverUrl,
				addedAt: now,
				updatedAt: now,
				deletedAt: null,
				categoryIds: initialCategoryIds,
				genres: nextGenres,
				status: nextStatus,
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

	async function setBookshelfCategories(
		platform: string,
		novelId: string,
		categoryIds: string[],
	): Promise<void> {
		const compositeKey = makeCompositeKey(platform, novelId);
		const existing = bookshelfMap.value.get(compositeKey);
		if (!existing || existing.deletedAt !== null) {
			return;
		}

		const validIds = activeCategoryIdSet.value;
		const filteredIds = normalizeStringList(categoryIds).filter((id) =>
			validIds.has(id),
		);
		const now = Date.now();
		const updated: BookshelfItem = {
			...cloneBookshelfItem(existing),
			categoryIds: filteredIds,
			updatedAt: now,
		};

		const dirtyKey = makeDirtyKey("bookshelf", platform, novelId);
		const dirtyEntry: DirtySyncEntry = {
			key: dirtyKey,
			kind: "bookshelf",
			platform,
			novelId,
			updatedAt: now,
		};

		bookshelfMap.value.set(compositeKey, updated);
		dirtyMap.set(dirtyKey, dirtyEntry);

		await Promise.all([
			webDb.putBookshelf(updated),
			webDb.putDirtyEntry(dirtyEntry),
		]);

		scheduleDebouncedPush();
	}

	async function createCategory(name: string): Promise<BookshelfCategory> {
		const normalizedName = normalizeCategoryName(name);
		const now = Date.now();
		let nextSortOrder = 0;
		for (const category of activeCategories.value) {
			if (category.sortOrder >= nextSortOrder) {
				nextSortOrder = category.sortOrder + 1;
			}
		}

		const created: BookshelfCategory = {
			id: generateCategoryId(),
			name: normalizedName,
			sortOrder: nextSortOrder,
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
		};

		const dirtyKey = makeCategoryDirtyKey(created.id);
		const dirtyEntry: DirtySyncEntry = {
			key: dirtyKey,
			kind: "category",
			platform: "",
			novelId: created.id,
			updatedAt: now,
		};

		categoriesMap.value.set(created.id, created);
		dirtyMap.set(dirtyKey, dirtyEntry);

		await Promise.all([
			webDb.putCategory(created),
			webDb.putDirtyEntry(dirtyEntry),
		]);

		scheduleDebouncedPush();
		return created;
	}

	async function renameCategory(
		id: string,
		name: string,
	): Promise<BookshelfCategory> {
		const normalizedName = normalizeCategoryName(name);
		const existing = categoriesMap.value.get(id);
		if (!existing || existing.deletedAt !== null) {
			throw new Error("书架不存在或已删除");
		}

		const now = Date.now();
		const updated: BookshelfCategory = {
			...cloneCategory(existing),
			name: normalizedName,
			updatedAt: now,
		};

		const dirtyKey = makeCategoryDirtyKey(id);
		const dirtyEntry: DirtySyncEntry = {
			key: dirtyKey,
			kind: "category",
			platform: "",
			novelId: id,
			updatedAt: now,
		};

		categoriesMap.value.set(id, updated);
		dirtyMap.set(dirtyKey, dirtyEntry);

		await Promise.all([
			webDb.putCategory(updated),
			webDb.putDirtyEntry(dirtyEntry),
		]);

		scheduleDebouncedPush();
		return updated;
	}

	async function deleteCategory(id: string): Promise<void> {
		const existing = categoriesMap.value.get(id);
		if (!existing || existing.deletedAt !== null) {
			return;
		}

		const now = Date.now();
		const updated: BookshelfCategory = {
			...cloneCategory(existing),
			updatedAt: now,
			deletedAt: now,
		};

		const dirtyKey = makeCategoryDirtyKey(id);
		const dirtyEntry: DirtySyncEntry = {
			key: dirtyKey,
			kind: "category",
			platform: "",
			novelId: id,
			updatedAt: now,
		};

		categoriesMap.value.set(id, updated);
		dirtyMap.set(dirtyKey, dirtyEntry);

		await Promise.all([
			webDb.putCategory(updated),
			webDb.putDirtyEntry(dirtyEntry),
		]);

		scheduleDebouncedPush();
	}

	async function reorderCategories(orderedIds: string[]): Promise<void> {
		const currentActive = activeCategories.value;
		if (currentActive.length <= 1) {
			return;
		}

		const activeById = new Map<string, BookshelfCategory>();
		for (const category of currentActive) {
			activeById.set(category.id, category);
		}

		const finalOrder: BookshelfCategory[] = [];
		const seen = new Set<string>();
		for (const id of orderedIds) {
			const category = activeById.get(id);
			if (category && !seen.has(id)) {
				seen.add(id);
				finalOrder.push(category);
			}
		}
		for (const category of currentActive) {
			if (!seen.has(category.id)) {
				seen.add(category.id);
				finalOrder.push(category);
			}
		}

		const now = Date.now();
		const updatedCategories: BookshelfCategory[] = [];
		const dirtyEntries: DirtySyncEntry[] = [];

		for (let index = 0; index < finalOrder.length; index += 1) {
			const category = finalOrder[index];
			if (!category || category.sortOrder === index) {
				continue;
			}
			const updated: BookshelfCategory = {
				...cloneCategory(category),
				sortOrder: index,
				updatedAt: now,
			};
			categoriesMap.value.set(updated.id, updated);
			updatedCategories.push(updated);

			const dirtyKey = makeCategoryDirtyKey(updated.id);
			const dirtyEntry: DirtySyncEntry = {
				key: dirtyKey,
				kind: "category",
				platform: "",
				novelId: updated.id,
				updatedAt: now,
			};
			dirtyMap.set(dirtyKey, dirtyEntry);
			dirtyEntries.push(dirtyEntry);
		}

		if (updatedCategories.length === 0) {
			return;
		}

		await Promise.all([
			webDb.bulkPutCategories(updatedCategories),
			webDb.bulkPutDirtyEntries(dirtyEntries),
		]);

		scheduleDebouncedPush();
	}

	async function updateReadingProgress(
		progress: ReadingProgress,
	): Promise<void> {
		const compositeKey = makeCompositeKey(progress.platform, progress.novelId);
		const existing = progressMap.value.get(compositeKey);
		const mergedHiddenAt = maxNullable(
			existing?.historyHiddenAt,
			progress.historyHiddenAt,
		);
		const effectiveUpdatedAt =
			mergedHiddenAt !== null
				? Math.max(progress.updatedAt, mergedHiddenAt + 1)
				: progress.updatedAt;

		const clean: ReadingProgress = {
			...cloneReadingProgress(progress),
			updatedAt: effectiveUpdatedAt,
			historyHiddenAt: mergedHiddenAt,
		};

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

	async function removeHistoryItem(
		platform: string,
		novelId: string,
	): Promise<void> {
		const compositeKey = makeCompositeKey(platform, novelId);
		const existing = progressMap.value.get(compositeKey);
		if (!existing || !isHistoryVisible(existing)) {
			return;
		}

		const now = Date.now();
		const hiddenAt = Math.max(
			now,
			existing.updatedAt,
			existing.historyHiddenAt ?? 0,
		);
		const updated: ReadingProgress = {
			...cloneReadingProgress(existing),
			historyHiddenAt: hiddenAt,
		};

		const dirtyKey = makeDirtyKey("progress", platform, novelId);
		const dirtyEntry: DirtySyncEntry = {
			key: dirtyKey,
			kind: "progress",
			platform,
			novelId,
			updatedAt: hiddenAt,
		};

		progressMap.value.set(compositeKey, updated);
		dirtyMap.set(dirtyKey, dirtyEntry);

		await Promise.all([
			webDb.putProgress(updated),
			webDb.putDirtyEntry(dirtyEntry),
		]);

		scheduleDebouncedPush();
	}

	async function clearAllHistory(): Promise<number> {
		const visibleItems = historyList.value;
		if (visibleItems.length === 0) {
			return 0;
		}

		const now = Date.now();
		const updatedItems: ReadingProgress[] = [];
		const dirtyEntries: DirtySyncEntry[] = [];

		for (const item of visibleItems) {
			const hiddenAt = Math.max(now, item.updatedAt, item.historyHiddenAt ?? 0);
			const updated: ReadingProgress = {
				...cloneReadingProgress(item),
				historyHiddenAt: hiddenAt,
			};
			const compositeKey = makeCompositeKey(item.platform, item.novelId);
			progressMap.value.set(compositeKey, updated);
			updatedItems.push(updated);

			const dirtyKey = makeDirtyKey("progress", item.platform, item.novelId);
			const dirtyEntry: DirtySyncEntry = {
				key: dirtyKey,
				kind: "progress",
				platform: item.platform,
				novelId: item.novelId,
				updatedAt: hiddenAt,
			};
			dirtyMap.set(dirtyKey, dirtyEntry);
			dirtyEntries.push(dirtyEntry);
		}

		await Promise.all([
			webDb.bulkPutProgress(updatedItems),
			webDb.bulkPutDirtyEntries(dirtyEntries),
		]);

		scheduleDebouncedPush();
		return updatedItems.length;
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
		categoriesMap,
		hydrated,
		activeBookshelf,
		activeCategories,
		historyList,
		continueReadingItem,
		syncStatus,
		lastSyncError,
		lastSyncedAt,
		isInBookshelf,
		getBookshelfItem,
		getProgress,
		getEffectiveCategoryIds,
		hydrate,
		syncNow,
		toggleBookshelf,
		setBookshelfCategories,
		createCategory,
		renameCategory,
		deleteCategory,
		reorderCategories,
		updateReadingProgress,
		removeHistoryItem,
		clearAllHistory,
		flushOnLeave,
	};
});
