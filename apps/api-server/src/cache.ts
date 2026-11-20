interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

export interface MemoryTtlCacheOptions {
	ttlMs?: number | undefined;
	maxEntries?: number | undefined;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 200;

/**
 * Lightweight in-memory TTL cache with LRU eviction and single-flight deduplication.
 */
export class MemoryTtlCache<T> {
	private readonly entries = new Map<string, CacheEntry<T>>();
	private readonly inFlight = new Map<string, Promise<T>>();
	private readonly ttlMs: number;
	private readonly maxEntries: number;

	constructor(options?: MemoryTtlCacheOptions) {
		this.ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS;
		this.maxEntries = options?.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
	}

	get size(): number {
		return this.entries.size;
	}

	get(key: string): T | undefined {
		const entry = this.entries.get(key);
		if (!entry) {
			return undefined;
		}
		if (entry.expiresAt <= Date.now()) {
			this.entries.delete(key);
			return undefined;
		}
		// Refresh insertion order for LRU eviction.
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.value;
	}

	set(key: string, value: T): void {
		if (this.maxEntries <= 0) {
			return;
		}
		if (this.entries.has(key)) {
			this.entries.delete(key);
		} else {
			this.pruneExpired();
			while (this.entries.size >= this.maxEntries) {
				const oldestKey = this.entries.keys().next().value;
				if (oldestKey === undefined) {
					break;
				}
				this.entries.delete(oldestKey);
			}
		}
		this.entries.set(key, {
			value,
			expiresAt: Date.now() + this.ttlMs,
		});
	}

	delete(key: string): boolean {
		return this.entries.delete(key);
	}

	clear(): void {
		this.entries.clear();
	}

	private pruneExpired(): void {
		const now = Date.now();
		for (const [key, entry] of this.entries.entries()) {
			if (entry.expiresAt <= now) {
				this.entries.delete(key);
			}
		}
	}

	async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
		const cached = this.get(key);
		if (cached !== undefined) {
			return cached;
		}

		const existingInFlight = this.inFlight.get(key);
		if (existingInFlight) {
			return await existingInFlight;
		}

		const loadPromise = (async () => {
			const value = await loader();
			this.set(key, value);
			return value;
		})().finally(() => {
			if (this.inFlight.get(key) === loadPromise) {
				this.inFlight.delete(key);
			}
		});

		this.inFlight.set(key, loadPromise);
		return await loadPromise;
	}
}
