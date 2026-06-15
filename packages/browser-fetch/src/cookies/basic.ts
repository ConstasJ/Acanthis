interface CookiesStoreMap {
	memory: Record<never, never>;
	file: {
		path: string;
	};
	custom: {
		store: CookiesStore;
	};
}

export type CookiesStoreType = keyof CookiesStoreMap;

export type CookiesStoreOptions = {
	[K in keyof CookiesStoreMap]: { type: K } & CookiesStoreMap[K];
}[keyof CookiesStoreMap];

export interface Cookie {
	name: string;
	value: string;
	domain?: string | undefined;
	path?: string | undefined;
	expires?: Date | undefined;
	maxAge?: number | undefined;
	secure?: boolean | undefined;
	httpOnly?: boolean | undefined;
	sameSite?: "Strict" | "Lax" | "None";
}

export interface CookieOptions {
	domain?: string | undefined;
	path?: string | undefined;
	expires?: Date | undefined;
	maxAge?: number | undefined;
	secure?: boolean | undefined;
	httpOnly?: boolean | undefined;
	sameSite?: "Strict" | "Lax" | "None";
}

export type CookiesInit =
	| CookieStore
	| Record<string, string>
	| Iterable<[string, string]>
	| Cookie[];

export const cookieStoreSign = Symbol("CookieStore");
export interface CookiesStore extends AsyncIterable<Cookie> {
	[cookieStoreSign]: true;
	set(name: string, value: string, options?: CookieOptions): Promise<void>;
	get(name: string, domain?: string, path?: string): Promise<string | null>;
	getCookie(
		name: string,
		domain?: string,
		path?: string,
	): Promise<Cookie | null>;
	delete(name: string, domain?: string, path?: string): Promise<boolean>;
	clear(domain?: string, path?: string): Promise<void>;
	has(name: string, domain?: string, path?: string): Promise<boolean>;
	getForUrl(url: string | URL): Promise<Cookie[]>;
	update(init: CookiesInit): Promise<void>;
	[Symbol.asyncIterator](): AsyncIterator<Cookie>;
}

export function isCookiesStore(obj: unknown): obj is CookiesStore {
	return (
		typeof obj === "object" &&
		obj !== null &&
		(obj as { [cookieStoreSign]: true })[cookieStoreSign] === true
	);
}

export interface CookieStoreItem extends Cookie {
	createdAt: Date;
	lastAccessedAt: Date;
}

export function cookieItemToCookie(item: CookieStoreItem): Cookie {
	return {
		name: item.name,
		value: item.value,
		domain: item.domain,
		path: item.path,
		expires: item.expires,
		maxAge: item.maxAge,
		secure: item.secure,
		httpOnly: item.httpOnly,
		sameSite: item.sameSite ?? "Lax",
	};
}

export function makeKey(name: string, domain?: string, path?: string): string {
	const normalizedDomain = domain?.replace(/^\./, "") || "";
	return `${normalizedDomain}|${path || "/"}|${name}`;
}
/**
 * Check if cookie domain matches request domain
 */

export function matchesDomain(
	cookieDomain: string,
	requestDomain: string,
): boolean {
	// Normalize domains
	const cookie = cookieDomain.toLowerCase().replace(/^\./, "");
	const request = requestDomain.toLowerCase();

	// Exact match
	if (cookie === request) {
		return true;
	}

	// Subdomain match (cookie domain .example.com matches sub.example.com)
	if (request.endsWith(`.${cookie}`)) {
		return true;
	}

	return false;
}
/**
 * Check if cookie path matches request path
 */

export function matchesPath(cookiePath: string, requestPath: string): boolean {
	// Exact match
	if (cookiePath === requestPath) {
		return true;
	}

	// Path prefix match
	if (requestPath.startsWith(cookiePath)) {
		// Ensure we're matching at a path boundary
		if (cookiePath.endsWith("/")) {
			return true;
		}
		if (requestPath[cookiePath.length] === "/") {
			return true;
		}
	}

	return false;
}
