import {
	type Cookie,
	type CookieOptions,
	type CookiesInit,
	type CookiesStore,
	cookieStoreSign,
	isCookiesStore,
	matchesDomain,
	matchesPath,
} from "@acanthis-dec/browser-fetch";
import { eq } from "drizzle-orm";
import type { DatabaseService, DrizzleInstance } from "./db";
import { type CookieRow, cookies } from "./table";

export class DatabaseCookieStore implements CookiesStore {
	private db: DrizzleInstance;
	[cookieStoreSign] = true as const;

	constructor(dbService: DatabaseService) {
		this.db = dbService.db;
	}

	async set(
		name: string,
		value: string,
		options?: CookieOptions,
	): Promise<void> {
		const cookie: Omit<CookieRow, "id"> = {
			name,
			value,
			domain: options?.domain ?? "",
			path: options?.path ?? "/",
			expires: options?.expires?.getTime() ?? null,
			maxAge: options?.maxAge ?? null,
			secure: options?.secure ?? false,
			httpOnly: options?.httpOnly ?? false,
			sameSite: options?.sameSite ?? "Lax",
			createdAt: Date.now(),
			lastAccessedAt: Date.now(),
		};
		await this.db
			.insert(cookies)
			.values(cookie)
			.onConflictDoUpdate({
				target: [cookies.domain, cookies.path, cookies.name],
				set: {
					value: cookie.value,
					expires: cookie.expires,
					maxAge: cookie.maxAge,
					secure: cookie.secure,
					httpOnly: cookie.httpOnly,
					sameSite: cookie.sameSite,
					createdAt: cookie.createdAt,
					lastAccessedAt: Date.now(),
				},
			})
			.run();
	}
	async get(
		name: string,
		domain?: string,
		path?: string,
	): Promise<string | null> {
		const result = await this.db.query.cookies.findFirst({
			where: {
				name,
				domain: domain ?? "",
				path: path ?? "/",
			},
		});
		if (result) {
			await this.db
				.update(cookies)
				.set({ lastAccessedAt: Date.now() })
				.where(eq(cookies.id, result.id))
				.run();
			return result.value;
		}
		const candidates = await this.db.query.cookies.findMany({
			where: {
				name,
			},
		});
		const hit = candidates.find((cookie) => {
			if (domain && cookie.domain && !matchesDomain(cookie.domain, domain))
				return false;
			if (path && cookie.path && !matchesPath(cookie.path, path)) return false;
			return true;
		});

		if (!hit) return null;

		await this.db
			.update(cookies)
			.set({ lastAccessedAt: Date.now() })
			.where(eq(cookies.id, hit.id))
			.run();

		return hit.value;
	}
	async getCookie(
		name: string,
		domain?: string,
		path?: string,
	): Promise<Cookie | null> {
		const result = await this.db.query.cookies.findFirst({
			where: {
				name,
				domain: domain ?? "",
				path: path ?? "/",
			},
		});
		if (result) {
			await this.db
				.update(cookies)
				.set({ lastAccessedAt: Date.now() })
				.where(eq(cookies.id, result.id))
				.run();
			return {
				name: result.name,
				value: result.value,
				domain: result.domain,
				path: result.path,
				expires: result.expires ? new Date(result.expires) : undefined,
				maxAge: result.maxAge ?? undefined,
				secure: result.secure ?? undefined,
				httpOnly: result.httpOnly ?? undefined,
				sameSite: result.sameSite ?? "Lax",
			};
		}
		const candidates = await this.db.query.cookies.findMany({
			where: {
				name,
			},
		});
		const hit = candidates.find((cookie) => {
			if (domain && cookie.domain && !matchesDomain(cookie.domain, domain))
				return false;
			if (path && cookie.path && !matchesPath(cookie.path, path)) return false;
			return true;
		});

		if (!hit) return null;

		await this.db
			.update(cookies)
			.set({ lastAccessedAt: Date.now() })
			.where(eq(cookies.id, hit.id))
			.run();

		return {
			name: hit.name,
			value: hit.value,
			domain: hit.domain,
			path: hit.path,
			expires: hit.expires ? new Date(hit.expires) : undefined,
			maxAge: hit.maxAge ?? undefined,
			secure: hit.secure ?? undefined,
			httpOnly: hit.httpOnly ?? undefined,
			sameSite: hit.sameSite ?? "Lax",
		};
	}
	async delete(name: string, domain?: string, path?: string): Promise<boolean> {
		const result = await this.db.query.cookies.findFirst({
			where: {
				name,
				domain: domain ?? "",
				path: path ?? "/",
			},
		});
		if (result) {
			await this.db.delete(cookies).where(eq(cookies.id, result.id)).run();
			return true;
		}
		const candidates = await this.db.query.cookies.findMany({
			where: {
				name,
			},
		});
		const hit = candidates.find((cookie) => {
			if (domain && cookie.domain && !matchesDomain(cookie.domain, domain))
				return false;
			if (path && cookie.path && !matchesPath(cookie.path, path)) return false;
			return true;
		});

		if (!hit) return false;

		await this.db.delete(cookies).where(eq(cookies.id, hit.id)).run();
		return true;
	}
	async clear(domain?: string, path?: string): Promise<void> {
		if (!domain && !path) {
			await this.db.delete(cookies).run();
			return;
		}
		await this.db.transaction(async (tx) => {
			const candidates = await tx.query.cookies.findMany();
			const toDelete = candidates.filter((cookie) => {
				if (domain && cookie.domain && !matchesDomain(cookie.domain, domain))
					return false;
				if (path && cookie.path && !matchesPath(cookie.path, path))
					return false;
				return true;
			});
			for (const cookie of toDelete) {
				await tx.delete(cookies).where(eq(cookies.id, cookie.id)).run();
			}
		});
	}
	async has(name: string, domain?: string, path?: string): Promise<boolean> {
		return (await this.get(name, domain, path)) !== null;
	}
	async getForUrl(url: string | URL): Promise<Cookie[]> {
		const parsedUrl = typeof url === "string" ? new URL(url) : url;
		const hostname = parsedUrl.hostname;
		const pathname = parsedUrl.pathname;
		const secure = parsedUrl.protocol === "https:";
		const candidates = await this.db.query.cookies.findMany();
		return candidates
			.filter((cookie) => {
				const now = Date.now();
				if (cookie.secure && !secure) return false;
				if (cookie.domain && !matchesDomain(cookie.domain, hostname))
					return false;
				if (cookie.path && !matchesPath(cookie.path, pathname)) return false;
				if (cookie.expires && cookie.expires < now) return false;
				if (cookie.maxAge) {
					const age = (now - cookie.createdAt) / 1000;
					if (age > cookie.maxAge) return false;
				}
				return true;
			})
			.map((cookie) => ({
				name: cookie.name,
				value: cookie.value,
				domain: cookie.domain,
				path: cookie.path,
				expires: cookie.expires ? new Date(cookie.expires) : undefined,
				maxAge: cookie.maxAge ?? undefined,
				secure: cookie.secure ?? undefined,
				httpOnly: cookie.httpOnly ?? undefined,
				sameSite: cookie.sameSite ?? "Lax",
			}));
	}
	async update(init: CookiesInit): Promise<void> {
		if (isCookiesStore(init)) {
			for await (const cookie of init) {
				await this.set(cookie.name, cookie.value, {
					domain: cookie.domain,
					path: cookie.path,
					expires: cookie.expires,
					maxAge: cookie.maxAge,
					secure: cookie.secure,
					httpOnly: cookie.httpOnly,
					sameSite: cookie.sameSite ?? "Lax",
				});
			}
		} else if (Array.isArray(init)) {
			for (const cookie of init) {
				await this.set(cookie.name, cookie.value, {
					domain: cookie.domain,
					path: cookie.path,
					expires: cookie.expires,
					maxAge: cookie.maxAge,
					secure: cookie.secure,
					httpOnly: cookie.httpOnly,
					sameSite: cookie.sameSite ?? "Lax",
				});
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
		const allCookies = this.db.query.cookies.findMany();
		let index = 0;
		return {
			next: async () => {
				const cookies = await allCookies;
				if (index < cookies.length) {
					// biome-ignore lint/style/noNonNullAssertion: We check index against cookies.length, so this is safe
					const cookie = cookies[index++]!;
					return {
						value: {
							name: cookie.name,
							value: cookie.value,
							domain: cookie.domain,
							path: cookie.path,
							expires: cookie.expires ? new Date(cookie.expires) : undefined,
							maxAge: cookie.maxAge ?? undefined,
							secure: cookie.secure ?? undefined,
							httpOnly: cookie.httpOnly ?? undefined,
							sameSite: cookie.sameSite ?? "Lax",
						},
					};
				}
				return { done: true, value: undefined };
			},
		};
	}
}
