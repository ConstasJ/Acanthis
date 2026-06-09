import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type CookieStoreType = "memory" | "file" | "database";

export type CookieStoreOptions = {
	type: CookieStoreType;
	path?: string; // For file type, the path to store cookies
};

export interface CookieStore {
	getCookies(domain: string, path?: string): Promise<Record<string, string>>;
	setCookies(
		domain: string,
		path: string,
		cookies: Record<string, string>,
	): Promise<void>;
	getCookie(
		domain: string,
		path: string,
		name: string,
	): Promise<string | undefined>;
	setCookie(
		domain: string,
		path: string,
		name: string,
		value: string,
	): Promise<void>;
	appendCookie(
		domain: string,
		path: string,
		cookies: Record<string, string>,
	): Promise<void>;
	clearCookies(domain: string, path?: string): Promise<void>;
}

export class InMemoryCookieStore implements CookieStore {
	private cache: Record<string, Record<string, Record<string, string>>> = {};

	async getCookies(
		domain: string,
		path?: string,
	): Promise<Record<string, string>> {
		return this.cache[domain]?.[path || "/"] || {};
	}

	async setCookies(
		domain: string,
		path: string,
		cookies: Record<string, string>,
	): Promise<void> {
		if (!this.cache[domain]) {
			this.cache[domain] = {};
		}
		this.cache[domain][path] = cookies;
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
		await this.setCookies(domain, path, { ...existingCookies, ...cookies });
	}

	async clearCookies(domain: string, path?: string): Promise<void> {
		if (this.cache[domain]) {
			if (path) {
				delete this.cache[domain][path];
			} else {
				delete this.cache[domain];
			}
		}
	}
}

export class FileCookieStore implements CookieStore {
	private path: string;

	constructor(path: string) {
		this.path = path;
	}

	async getCookies(
		domain: string,
		path?: string,
	): Promise<Record<string, string>> {
		const fullPath = resolve(this.path, domain, path || "/");
		if (!existsSync(fullPath)) {
			return {};
		}
		const data = await readFile(fullPath, "utf-8");
		return JSON.parse(data);
	}

	async setCookies(
		domain: string,
		path: string,
		cookies: Record<string, string>,
	): Promise<void> {
		const fullPath = resolve(this.path, domain, path);
		await writeFile(fullPath, JSON.stringify(cookies), "utf-8");
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
		await this.setCookies(domain, path, { ...existingCookies, ...cookies });
	}

	async clearCookies(domain: string, path?: string): Promise<void> {
		const fullPath = resolve(this.path, domain, path || "/");
		if (existsSync(fullPath)) {
			await writeFile(fullPath, JSON.stringify({}), "utf-8");
		}
	}
}
