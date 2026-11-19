import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	type Cookie,
	type CookieOptions,
	type CookieStoreItem,
	type CookiesInit,
	type CookiesStore,
	cookieItemToCookie,
	cookieStoreSign,
	isCookiesStore,
	makeKey,
	matchesDomain,
	matchesPath,
} from "./basic";

type SerializedCookie = Omit<
	CookieStoreItem,
	"expires" | "createdAt" | "lastAccessedAt"
> & {
	expires?: string | number | Date | undefined;
	createdAt?: string | number | Date | undefined;
	lastAccessedAt?: string | number | Date | undefined;
};

function toDate(value: unknown): Date | undefined {
	if (value === null || value === undefined) return undefined;
	const date =
		value instanceof Date ? value : new Date(value as string | number);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeCookie(raw: unknown): CookieStoreItem | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const candidate = raw as Partial<SerializedCookie>;
	if (
		typeof candidate.name !== "string" ||
		typeof candidate.value !== "string"
	) {
		return undefined;
	}

	const createdAt = toDate(candidate.createdAt) ?? new Date();
	const sameSite =
		candidate.sameSite === "Strict" ||
		candidate.sameSite === "None" ||
		candidate.sameSite === "Lax"
			? candidate.sameSite
			: "Lax";

	return {
		name: candidate.name,
		value: candidate.value,
		domain: typeof candidate.domain === "string" ? candidate.domain : undefined,
		path: typeof candidate.path === "string" ? candidate.path : undefined,
		expires: toDate(candidate.expires),
		maxAge: typeof candidate.maxAge === "number" ? candidate.maxAge : undefined,
		secure:
			typeof candidate.secure === "boolean" ? candidate.secure : undefined,
		httpOnly:
			typeof candidate.httpOnly === "boolean" ? candidate.httpOnly : undefined,
		sameSite,
		createdAt,
		lastAccessedAt: toDate(candidate.lastAccessedAt) ?? createdAt,
	};
}

export class FileCookiesStore implements CookiesStore {
	[cookieStoreSign] = true as const;
	private filePath: string;
	private cookiesCache: Map<string, CookieStoreItem> = new Map();
	private loadPromise: Promise<void> | null = null;
	private savePromise: Promise<void> | null = null;
	private saveQueued = false;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	private async _ensureParentExists(): Promise<void> {
		try {
			const parent = dirname(this.filePath);
			if (!existsSync(parent)) {
				await mkdir(parent, { recursive: true });
			} else if (existsSync(parent) && !(await stat(parent)).isDirectory()) {
				await rm(parent);
				await mkdir(parent, { recursive: true });
			}
		} catch (error) {
			console.error("Error ensuring cookie file path exists:", error);
		}
	}

	private async _readFromDisk(): Promise<void> {
		try {
			await this._ensureParentExists();
			if (!existsSync(this.filePath)) {
				return;
			}
			const data = await readFile(this.filePath, "utf-8");
			const parsed: unknown = JSON.parse(data);
			if (!Array.isArray(parsed)) {
				return;
			}
			this.cookiesCache.clear();
			for (const raw of parsed) {
				const cookie = normalizeCookie(raw);
				if (cookie) {
					this.cookiesCache.set(
						makeKey(cookie.name, cookie.domain, cookie.path),
						cookie,
					);
				}
			}
		} catch (error) {
			console.error("Error loading cookies from file:", error);
		}
	}

	private async _writeToDisk(): Promise<void> {
		try {
			await this._ensureParentExists();
			const cookies = Array.from(this.cookiesCache.values());
			await writeFile(this.filePath, JSON.stringify(cookies, null, 2), "utf-8");
		} catch (error) {
			console.error("Error saving cookies to file:", error);
		}
	}

	/**
	 * 确保本次会话已经读取过磁盘上的 cookie。
	 * 构造器是同步的，所以这里做懒加载；所有公开的读写方法都会先等待它。
	 */
	private async _ensureLoaded(): Promise<void> {
		if (!this.loadPromise) {
			this.loadPromise = this._readFromDisk();
		}
		await this.loadPromise;
	}

	/**
	 * 把当前缓存写入磁盘；写入期间又发生的修改会在本轮写完后再次落盘。
	 */
	private async _persist(): Promise<void> {
		if (this.savePromise) {
			this.saveQueued = true;
			return this.savePromise;
		}

		this.savePromise = (async () => {
			try {
				do {
					this.saveQueued = false;
					await this._writeToDisk();
				} while (this.saveQueued);
			} finally {
				this.savePromise = null;
			}
		})();

		return this.savePromise;
	}

	/** 强制从磁盘重新加载 cookie 文件。 */
	async load(): Promise<void> {
		this.loadPromise = this._readFromDisk();
		await this.loadPromise;
	}

	/** 立即把当前 cookie 缓存写入磁盘。 */
	async save(): Promise<void> {
		await this._ensureLoaded();
		await this._persist();
	}

	async set(
		name: string,
		value: string,
		options?: CookieOptions,
	): Promise<void> {
		await this._ensureLoaded();
		const key = makeKey(name, options?.domain, options?.path);
		const cookie: CookieStoreItem = {
			name,
			value,
			domain: options?.domain,
			path: options?.path,
			expires: options?.expires,
			maxAge: options?.maxAge,
			secure: options?.secure,
			httpOnly: options?.httpOnly,
			sameSite: options?.sameSite ?? "Lax",
			createdAt: new Date(),
			lastAccessedAt: new Date(),
		};
		this.cookiesCache.set(key, cookie);
		await this._persist();
	}

	async get(
		name: string,
		domain?: string,
		path?: string,
	): Promise<string | null> {
		await this._ensureLoaded();
		const key = makeKey(name, domain, path);
		const exact = this.cookiesCache.get(key);
		if (exact) {
			exact.lastAccessedAt = new Date();
			return exact.value;
		}
		for (const cookie of this.cookiesCache.values()) {
			if (cookie.name !== name) continue;
			if (domain && cookie.domain && !matchesDomain(cookie.domain, domain))
				continue;
			if (path && cookie.path && !matchesPath(cookie.path, path)) continue;
			cookie.lastAccessedAt = new Date();
			return cookie.value;
		}
		return null;
	}

	async getCookie(
		name: string,
		domain?: string,
		path?: string,
	): Promise<Cookie | null> {
		await this._ensureLoaded();
		const key = makeKey(name, domain, path);
		const exact = this.cookiesCache.get(key);
		if (exact) {
			exact.lastAccessedAt = new Date();
			return cookieItemToCookie(exact);
		}
		for (const cookie of this.cookiesCache.values()) {
			if (cookie.name !== name) continue;
			if (domain && cookie.domain && !matchesDomain(cookie.domain, domain))
				continue;
			if (path && cookie.path && !matchesPath(cookie.path, path)) continue;
			cookie.lastAccessedAt = new Date();
			return cookieItemToCookie(cookie);
		}
		return null;
	}

	async delete(name: string, domain?: string, path?: string): Promise<boolean> {
		await this._ensureLoaded();
		const key = makeKey(name, domain, path);
		if (this.cookiesCache.has(key)) {
			this.cookiesCache.delete(key);
			await this._persist();
			return true;
		}
		for (const [key, cookie] of this.cookiesCache.entries()) {
			if (cookie.name !== name) continue;
			if (domain && cookie.domain && !matchesDomain(cookie.domain, domain))
				continue;
			if (path && cookie.path && !matchesPath(cookie.path, path)) continue;
			this.cookiesCache.delete(key);
			await this._persist();
			return true;
		}
		return false;
	}

	async clear(domain?: string, path?: string): Promise<void> {
		await this._ensureLoaded();
		if (!domain && !path) {
			this.cookiesCache.clear();
			await this._persist();
			return;
		}
		for (const [key, cookie] of this.cookiesCache.entries()) {
			if (domain && cookie.domain && !matchesDomain(cookie.domain, domain)) {
				continue;
			}
			if (path && cookie.path && !matchesPath(cookie.path, path)) {
				continue;
			}
			this.cookiesCache.delete(key);
		}
		await this._persist();
	}

	async has(name: string, domain?: string, path?: string): Promise<boolean> {
		return (await this.get(name, domain, path)) !== null;
	}

	async getForUrl(url: string | URL): Promise<Cookie[]> {
		await this._ensureLoaded();
		const parsedUrl = url instanceof URL ? url : new URL(url);
		const hostname = parsedUrl.hostname;
		const pathname = parsedUrl.pathname || "/";
		const isSecure = parsedUrl.protocol === "https:";
		const now = new Date();

		const result = [...this.cookiesCache.values()].filter((cookie) => {
			// Check secure flag
			if (cookie.secure && !isSecure) {
				return false;
			}

			// Check domain match
			if (cookie.domain && !matchesDomain(cookie.domain, hostname)) {
				return false;
			}

			// Check path match
			if (cookie.path && !matchesPath(cookie.path, pathname)) {
				return false;
			}

			// Check expiration
			if (cookie.expires && cookie.expires < now) {
				return false;
			}
			if (cookie.maxAge !== undefined) {
				const age = (now.getTime() - cookie.createdAt.getTime()) / 1000;
				if (age > cookie.maxAge) {
					return false;
				}
			}

			return true;
		});
		result.forEach((cookie) => {
			cookie.lastAccessedAt = new Date();
		});
		return result.map(cookieItemToCookie);
	}

	async update(init: CookiesInit): Promise<void> {
		await this._ensureLoaded();
		if (isCookiesStore(init)) {
			for await (const cookie of init) {
				await this.set(cookie.name, cookie.value, {
					domain: cookie.domain,
					path: cookie.path,
					secure: cookie.secure,
					httpOnly: cookie.httpOnly,
					sameSite: cookie.sameSite ?? "Lax",
					expires: cookie.expires,
					maxAge: cookie.maxAge,
				});
			}
		} else if (Array.isArray(init)) {
			for (const item of init) {
				if (typeof item === "object" && "name" in item && "value" in item) {
					await this.set(item.name, item.value, item);
				}
			}
		} else if (typeof init === "object") {
			if (Symbol.iterator in init) {
				for (const [name, value] of init as Iterable<[string, string]>) {
					await this.set(name, value);
				}
			} else {
				for (const [name, value] of Object.entries(init)) {
					await this.set(name, value);
				}
			}
		}
	}

	[Symbol.asyncIterator](): AsyncIterator<Cookie> {
		let snapshot: Cookie[] | null = null;
		let index = 0;
		return {
			next: async (): Promise<IteratorResult<Cookie>> => {
				if (!snapshot) {
					await this._ensureLoaded();
					snapshot = Array.from(this.cookiesCache.values()).map(
						cookieItemToCookie,
					);
				}
				if (index < snapshot.length) {
					const cookie = snapshot[index++];
					if (cookie) {
						return { value: cookie, done: false };
					}
				}
				return { value: undefined, done: true };
			},
		};
	}
}
