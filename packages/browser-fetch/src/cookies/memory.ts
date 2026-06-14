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
} from "./index";

export class InMemoryCookiesStore implements CookiesStore {
	private cookies: Map<string, CookieStoreItem> = new Map();
	[cookieStoreSign] = true as const;

	async set(
		name: string,
		value: string,
		options?: CookieOptions,
	): Promise<void> {
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
		this.cookies.set(key, cookie);
	}

	async get(
		name: string,
		domain?: string,
		path?: string,
	): Promise<string | null> {
		const key = makeKey(name, domain, path);
		const exact = this.cookies.get(key);
		if (exact) {
			exact.lastAccessedAt = new Date();
			return exact.value;
		}

		// If no exact match, find cookies that match domain and path
		for (const cookie of this.cookies.values()) {
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
		const key = makeKey(name, domain, path);
		const exact = this.cookies.get(key);
		if (exact) {
			exact.lastAccessedAt = new Date();
			return cookieItemToCookie(exact);
		}

		// If no exact match, find cookies that match domain and path
		for (const cookie of this.cookies.values()) {
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
		const key = makeKey(name, domain, path);
		if (this.cookies.has(key)) {
			this.cookies.delete(key);
			return true;
		}
		for (const [key, cookie] of this.cookies.entries()) {
			if (cookie.name !== name) continue;
			if (domain && cookie.domain && !matchesDomain(cookie.domain, domain))
				continue;
			if (path && cookie.path && !matchesPath(cookie.path, path)) continue;
			this.cookies.delete(key);
			return true;
		}
		return false;
	}

	async clear(domain?: string, path?: string): Promise<void> {
		if (!domain && !path) {
			this.cookies.clear();
			return;
		}
		for (const [key, cookie] of this.cookies.entries()) {
			if (domain && cookie.domain && !matchesDomain(cookie.domain, domain))
				continue;
			if (path && cookie.path && !matchesPath(cookie.path, path)) continue;
			this.cookies.delete(key);
		}
	}

	async getForUrl(url: string | URL): Promise<Cookie[]> {
		const parsedUrl = typeof url === "string" ? new URL(url) : url;
		const hostname = parsedUrl.hostname;
		const pathname = parsedUrl.pathname || "/";
		const isSecure = parsedUrl.protocol === "https:";
		const now = new Date();

		const result = [...this.cookies.values()].filter((cookie) => {
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

	async has(name: string, domain?: string, path?: string): Promise<boolean> {
		return (await this.get(name, domain, path)) !== null;
	}

	async update(init: CookiesInit): Promise<void> {
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
					this.set(item.name, item.value, item);
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
		const cookies = Array.from(this.cookies.values()).map(cookieItemToCookie);
		let index = 0;
		return {
			next: async (): Promise<IteratorResult<Cookie>> => {
				if (index < cookies.length) {
					// biome-ignore lint/style/noNonNullAssertion: We check index against cookies.length, so this is safe
					return { value: cookies[index++]!, done: false };
				} else {
					return { value: undefined, done: true };
				}
			},
		};
	}
}
