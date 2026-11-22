import type {
	BookshelfCategory,
	BookshelfItem,
	Novel,
	NovelStatus,
	ReadingProgress,
} from "@acanthis-dec/core";
import { normalizeDeviceKind } from "@/config/runtime";

const DB_NAME = "acanthis-web";
const DB_VERSION = 2;

const STORES = {
	bookshelf: "bookshelf",
	progress: "progress",
	categories: "categories",
	dirtyQueue: "dirtyQueue",
	novels: "novels",
	chapters: "chapters",
} as const;

export interface CachedChapterRecord {
	key: string;
	platform: string;
	novelId: string;
	chapterId: string;
	title: string;
	content: string;
	accessedAt: number;
}

export interface ChapterCacheStats {
	count: number;
	totalBytes: number;
}

export interface DirtySyncEntry {
	key: string;
	kind: "bookshelf" | "progress" | "category";
	platform: string;
	novelId: string;
	updatedAt: number;
}

type StoredBookshelfRecord = BookshelfItem & { compositeKey: string };
type StoredProgressRecord = ReadingProgress & { compositeKey: string };
type StoredNovelRecord = Novel & { compositeKey: string };

let dbPromise: Promise<IDBDatabase> | null = null;
let migratedFromV1 = false;

export function makeCompositeKey(platform: string, novelId: string): string {
	return `${platform}:${novelId}`;
}

export function makeChapterCacheKey(
	platform: string,
	chapterId: string,
): string {
	return `${platform}:${chapterId}`;
}

function normalizeStringArray(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const seen = new Set<string>();
	const result: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== "string") {
			continue;
		}
		const trimmed = entry.trim();
		if (trimmed && !seen.has(trimmed)) {
			seen.add(trimmed);
			result.push(trimmed);
		}
	}
	return result;
}

function normalizeNovelStatus(raw: unknown): NovelStatus {
	if (raw === "ongoing" || raw === "completed" || raw === "unknown") {
		return raw;
	}
	return "unknown";
}

function normalizeNullableTimestamp(raw: unknown): number | null {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return raw;
	}
	return null;
}

function stripBookshelfRecord(record: StoredBookshelfRecord): BookshelfItem {
	return {
		platform: record.platform,
		novelId: record.novelId,
		title: record.title,
		author: record.author,
		coverUrl: record.coverUrl,
		addedAt: record.addedAt,
		updatedAt: record.updatedAt,
		deletedAt: record.deletedAt,
		categoryIds: normalizeStringArray(record.categoryIds),
		genres: normalizeStringArray(record.genres),
		status: normalizeNovelStatus(record.status),
	};
}

function stripProgressRecord(record: StoredProgressRecord): ReadingProgress {
	return {
		platform: record.platform,
		novelId: record.novelId,
		novelTitle: record.novelTitle,
		coverUrl: record.coverUrl,
		volumeId: record.volumeId,
		volumeTitle: record.volumeTitle,
		chapterId: record.chapterId,
		chapterTitle: record.chapterTitle,
		paragraphIndex: record.paragraphIndex,
		totalParagraphs: record.totalParagraphs,
		deviceLabel: record.deviceLabel,
		deviceKind: normalizeDeviceKind(record.deviceKind),
		updatedAt: record.updatedAt,
		historyHiddenAt: normalizeNullableTimestamp(record.historyHiddenAt),
	};
}

function stripCategoryRecord(record: BookshelfCategory): BookshelfCategory {
	return {
		id: record.id,
		name: record.name,
		sortOrder:
			typeof record.sortOrder === "number" && Number.isFinite(record.sortOrder)
				? Math.trunc(record.sortOrder)
				: 0,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		deletedAt: normalizeNullableTimestamp(record.deletedAt),
	};
}

function stripNovelRecord(record: StoredNovelRecord): Novel {
	const { compositeKey: _compositeKey, ...novel } = record;
	return novel;
}

function stripChapterRecord(record: CachedChapterRecord): CachedChapterRecord {
	return {
		key: record.key,
		platform: record.platform,
		novelId: record.novelId,
		chapterId: record.chapterId,
		title: record.title,
		content: record.content,
		accessedAt: record.accessedAt,
	};
}

function toPlainClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error("IndexedDB request failed"));
	});
}

function transactionDone(tx: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onabort = () =>
			reject(tx.error ?? new Error("IndexedDB transaction aborted"));
		tx.onerror = () =>
			reject(tx.error ?? new Error("IndexedDB transaction failed"));
	});
}

function openDb(): Promise<IDBDatabase> {
	if (dbPromise !== null) {
		return dbPromise;
	}

	if (typeof indexedDB === "undefined") {
		return Promise.reject(
			new Error("IndexedDB is not available in this environment"),
		);
	}

	dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event) => {
			const db = request.result;
			if (event.oldVersion > 0 && event.oldVersion < 2) {
				migratedFromV1 = true;
			}

			if (!db.objectStoreNames.contains(STORES.bookshelf)) {
				db.createObjectStore(STORES.bookshelf, { keyPath: "compositeKey" });
			}
			if (!db.objectStoreNames.contains(STORES.progress)) {
				db.createObjectStore(STORES.progress, { keyPath: "compositeKey" });
			}
			if (!db.objectStoreNames.contains(STORES.categories)) {
				db.createObjectStore(STORES.categories, { keyPath: "id" });
			}
			if (!db.objectStoreNames.contains(STORES.dirtyQueue)) {
				db.createObjectStore(STORES.dirtyQueue, { keyPath: "key" });
			}
			if (!db.objectStoreNames.contains(STORES.novels)) {
				db.createObjectStore(STORES.novels, { keyPath: "compositeKey" });
			}
			if (!db.objectStoreNames.contains(STORES.chapters)) {
				const chapterStore = db.createObjectStore(STORES.chapters, {
					keyPath: "key",
				});
				chapterStore.createIndex("by_accessedAt", "accessedAt", {
					unique: false,
				});
			}
		};

		request.onsuccess = () => {
			const db = request.result;
			db.onversionchange = () => {
				db.close();
				dbPromise = null;
			};
			resolve(db);
		};

		request.onerror = () => {
			dbPromise = null;
			reject(request.error ?? new Error("Failed to open IndexedDB"));
		};

		request.onblocked = () => {
			dbPromise = null;
			reject(new Error("IndexedDB upgrade blocked by another open connection"));
		};
	});

	return dbPromise;
}

export const webDb = {
	consumeSchemaUpgradeFlag(): boolean {
		const flag = migratedFromV1;
		migratedFromV1 = false;
		return flag;
	},

	async getAllBookshelf(): Promise<BookshelfItem[]> {
		const db = await openDb();
		const tx = db.transaction(STORES.bookshelf, "readonly");
		const store = tx.objectStore(STORES.bookshelf);
		const records = await requestToPromise(
			store.getAll() as IDBRequest<StoredBookshelfRecord[]>,
		);
		await transactionDone(tx);
		return records.map(stripBookshelfRecord);
	},

	async putBookshelf(item: BookshelfItem): Promise<void> {
		await this.bulkPutBookshelf([item]);
	},

	async bulkPutBookshelf(items: BookshelfItem[]): Promise<void> {
		if (items.length === 0) {
			return;
		}
		const db = await openDb();
		const tx = db.transaction(STORES.bookshelf, "readwrite");
		const store = tx.objectStore(STORES.bookshelf);
		for (const item of items) {
			const record: StoredBookshelfRecord = {
				...stripBookshelfRecord(item as StoredBookshelfRecord),
				compositeKey: makeCompositeKey(item.platform, item.novelId),
			};
			store.put(record);
		}
		await transactionDone(tx);
	},

	async getAllProgress(): Promise<ReadingProgress[]> {
		const db = await openDb();
		const tx = db.transaction(STORES.progress, "readonly");
		const store = tx.objectStore(STORES.progress);
		const records = await requestToPromise(
			store.getAll() as IDBRequest<StoredProgressRecord[]>,
		);
		await transactionDone(tx);
		return records.map(stripProgressRecord);
	},

	async putProgress(item: ReadingProgress): Promise<void> {
		await this.bulkPutProgress([item]);
	},

	async bulkPutProgress(items: ReadingProgress[]): Promise<void> {
		if (items.length === 0) {
			return;
		}
		const db = await openDb();
		const tx = db.transaction(STORES.progress, "readwrite");
		const store = tx.objectStore(STORES.progress);
		for (const item of items) {
			const record: StoredProgressRecord = {
				...stripProgressRecord(item as StoredProgressRecord),
				compositeKey: makeCompositeKey(item.platform, item.novelId),
			};
			store.put(record);
		}
		await transactionDone(tx);
	},

	async getAllCategories(): Promise<BookshelfCategory[]> {
		const db = await openDb();
		const tx = db.transaction(STORES.categories, "readonly");
		const store = tx.objectStore(STORES.categories);
		const records = await requestToPromise(
			store.getAll() as IDBRequest<BookshelfCategory[]>,
		);
		await transactionDone(tx);
		return records.map(stripCategoryRecord);
	},

	async putCategory(category: BookshelfCategory): Promise<void> {
		await this.bulkPutCategories([category]);
	},

	async bulkPutCategories(categories: BookshelfCategory[]): Promise<void> {
		if (categories.length === 0) {
			return;
		}
		const db = await openDb();
		const tx = db.transaction(STORES.categories, "readwrite");
		const store = tx.objectStore(STORES.categories);
		for (const category of categories) {
			store.put(stripCategoryRecord(category));
		}
		await transactionDone(tx);
	},

	async getDirtyEntries(): Promise<DirtySyncEntry[]> {
		const db = await openDb();
		const tx = db.transaction(STORES.dirtyQueue, "readonly");
		const store = tx.objectStore(STORES.dirtyQueue);
		const records = await requestToPromise(
			store.getAll() as IDBRequest<DirtySyncEntry[]>,
		);
		await transactionDone(tx);
		return records.map((entry) => ({
			key: entry.key,
			kind: entry.kind,
			platform: entry.platform,
			novelId: entry.novelId,
			updatedAt: entry.updatedAt,
		}));
	},

	async putDirtyEntry(entry: DirtySyncEntry): Promise<void> {
		await this.bulkPutDirtyEntries([entry]);
	},

	async bulkPutDirtyEntries(entries: DirtySyncEntry[]): Promise<void> {
		if (entries.length === 0) {
			return;
		}
		const db = await openDb();
		const tx = db.transaction(STORES.dirtyQueue, "readwrite");
		const store = tx.objectStore(STORES.dirtyQueue);
		for (const entry of entries) {
			store.put({
				key: entry.key,
				kind: entry.kind,
				platform: entry.platform,
				novelId: entry.novelId,
				updatedAt: entry.updatedAt,
			} satisfies DirtySyncEntry);
		}
		await transactionDone(tx);
	},

	async deleteDirtyEntries(keys: string[]): Promise<void> {
		if (keys.length === 0) {
			return;
		}
		const db = await openDb();
		const tx = db.transaction(STORES.dirtyQueue, "readwrite");
		const store = tx.objectStore(STORES.dirtyQueue);
		for (const key of keys) {
			store.delete(key);
		}
		await transactionDone(tx);
	},

	async getNovelCache(
		platform: string,
		novelId: string,
	): Promise<Novel | null> {
		const db = await openDb();
		const tx = db.transaction(STORES.novels, "readonly");
		const store = tx.objectStore(STORES.novels);
		const record = await requestToPromise(
			store.get(makeCompositeKey(platform, novelId)) as IDBRequest<
				StoredNovelRecord | undefined
			>,
		);
		await transactionDone(tx);
		return record ? stripNovelRecord(record) : null;
	},

	async putNovelCache(novel: Novel): Promise<void> {
		const db = await openDb();
		const tx = db.transaction(STORES.novels, "readwrite");
		const store = tx.objectStore(STORES.novels);
		const plain = toPlainClone(novel);
		const record: StoredNovelRecord = {
			...plain,
			compositeKey: makeCompositeKey(plain.platform, plain.id),
		};
		store.put(record);
		await transactionDone(tx);
	},

	async getChapterCache(
		platform: string,
		chapterId: string,
	): Promise<CachedChapterRecord | null> {
		const db = await openDb();
		const tx = db.transaction(STORES.chapters, "readwrite");
		const store = tx.objectStore(STORES.chapters);
		const key = makeChapterCacheKey(platform, chapterId);
		const existing = await requestToPromise(
			store.get(key) as IDBRequest<CachedChapterRecord | undefined>,
		);
		if (!existing) {
			await transactionDone(tx);
			return null;
		}
		const touched = stripChapterRecord({
			...existing,
			accessedAt: Date.now(),
		});
		store.put(touched);
		await transactionDone(tx);
		return touched;
	},

	async putChapterCache(
		record: CachedChapterRecord,
		maxEntries = 200,
	): Promise<void> {
		const db = await openDb();
		const tx = db.transaction(STORES.chapters, "readwrite");
		const store = tx.objectStore(STORES.chapters);
		const normalized = stripChapterRecord({
			...record,
			key: record.key || makeChapterCacheKey(record.platform, record.chapterId),
		});
		store.put(normalized);

		const limit = Math.max(0, Math.floor(maxEntries));
		const total = await requestToPromise(store.count());
		const excess = total - limit;
		if (excess > 0) {
			const index = store.index("by_accessedAt");
			await new Promise<void>((resolve, reject) => {
				let deleted = 0;
				const cursorRequest = index.openCursor(null, "next");
				cursorRequest.onsuccess = () => {
					const cursor = cursorRequest.result;
					if (!cursor || deleted >= excess) {
						resolve();
						return;
					}
					cursor.delete();
					deleted += 1;
					cursor.continue();
				};
				cursorRequest.onerror = () =>
					reject(
						cursorRequest.error ?? new Error("LRU eviction cursor failed"),
					);
			});
		}

		await transactionDone(tx);
	},

	async getChapterCacheStats(): Promise<ChapterCacheStats> {
		const db = await openDb();
		const tx = db.transaction(STORES.chapters, "readonly");
		const store = tx.objectStore(STORES.chapters);
		const records = await requestToPromise(
			store.getAll() as IDBRequest<CachedChapterRecord[]>,
		);
		await transactionDone(tx);
		const encoder = new TextEncoder();
		let totalBytes = 0;
		for (const item of records) {
			totalBytes += encoder.encode(item.content).byteLength;
		}
		return {
			count: records.length,
			totalBytes,
		};
	},

	async clearChapterCache(): Promise<void> {
		const db = await openDb();
		const tx = db.transaction(STORES.chapters, "readwrite");
		const store = tx.objectStore(STORES.chapters);
		store.clear();
		await transactionDone(tx);
	},
};
