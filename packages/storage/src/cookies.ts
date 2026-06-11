import type { CookieStore } from "@acanthis-dec/browser-fetch";
import type { DatabaseService } from "./db";

export class DatabaseCookieStore implements CookieStore {
	private db: DatabaseService;

	constructor(db: DatabaseService) {
		this.db = db;
	}
	async getCookies(
		domain: string,
		path?: string,
	): Promise<Record<string, string>> {
		const cookies = await this.db.getCookies(domain, path || "/");
		const result: Record<string, string> = {};
		for (const cookie of cookies) {
			result[cookie.name] = cookie.value;
		}
		return result;
	}
	async setCookies(
		domain: string,
		path: string,
		cookies: Record<string, string>,
	): Promise<void> {
		await this.db.setCookies(
			domain,
			path,
			Object.entries(cookies).map(([name, value]) => ({
				domain,
				path,
				name,
				value,
			})),
		);
	}
	async getCookie(
		domain: string,
		path: string,
		name: string,
	): Promise<string | undefined> {
		const cookies = await this.getCookies(domain, path);
		return cookies[name];
	}
	async setCookie(
		domain: string,
		path: string,
		name: string,
		value: string,
	): Promise<void> {
		const cookies = await this.getCookies(domain, path);
		cookies[name] = value;
		await this.setCookies(domain, path, cookies);
	}
	async appendCookie(
		domain: string,
		path: string,
		cookies: Record<string, string>,
	): Promise<void> {
		const existingCookies = await this.getCookies(domain, path);
		Object.assign(existingCookies, cookies);
		await this.setCookies(domain, path, existingCookies);
	}
	async clearCookies(domain: string, path?: string): Promise<void> {
		await this.setCookies(domain, path || "/", {});
	}
}
