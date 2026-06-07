import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type CookieStoreType = "memory" | "file" | "database";

export type CookieStoreOptions = {
	type: CookieStoreType;
	path?: string; // For file type, the path to store cookies
};

export interface CookieStore {
	getCookies(origin: string): Promise<Record<string, string>>;
	setCookies(origin: string, cookies: Record<string, string>): Promise<void>;
	getCookie(origin: string, name: string): Promise<string | undefined>;
	setCookie(origin: string, name: string, value: string): Promise<void>;
	appendCookie(origin: string, cookies: Record<string, string>): Promise<void>;
	clearCookies(origin: string): Promise<void>;
}

export class InMemoryCookieStore implements CookieStore {
	private cache: Record<string, Record<string, string>> = {};

	async getCookies(origin: string): Promise<Record<string, string>> {
		return this.cache[origin] || {};
	}

	async setCookies(
		origin: string,
		cookies: Record<string, string>,
	): Promise<void> {
		this.cache[origin] = cookies;
	}

	async getCookie(origin: string, name: string): Promise<string | undefined> {
		const cookies = await this.getCookies(origin);
		return cookies[name];
	}

	async setCookie(origin: string, name: string, value: string): Promise<void> {
		const cookies = await this.getCookies(origin);
		cookies[name] = value;
		await this.setCookies(origin, cookies);
	}

	async appendCookie(
		origin: string,
		cookies: Record<string, string>,
	): Promise<void> {
		const existingCookies = await this.getCookies(origin);
		await this.setCookies(origin, { ...existingCookies, ...cookies });
	}

	async clearCookies(origin: string): Promise<void> {
		delete this.cache[origin];
	}
}

export class FileCookieStore implements CookieStore {
	private path: string;

	constructor(path: string) {
		this.path = path;
	}

	async getCookies(origin: string): Promise<Record<string, string>> {
		const fullPath = resolve(this.path, origin);
		if (!existsSync(fullPath)) {
			return {};
		}
		const data = await readFile(fullPath, "utf-8");
		return JSON.parse(data);
	}

	async setCookies(
		origin: string,
		cookies: Record<string, string>,
	): Promise<void> {
		const fullPath = resolve(this.path, origin);
		await writeFile(fullPath, JSON.stringify(cookies), "utf-8");
	}

	async getCookie(origin: string, name: string): Promise<string | undefined> {
		const cookies = await this.getCookies(origin);
		return cookies[name];
	}

	async setCookie(origin: string, name: string, value: string): Promise<void> {
		const cookies = await this.getCookies(origin);
		cookies[name] = value;
		await this.setCookies(origin, cookies);
	}

	async appendCookie(
		origin: string,
		cookies: Record<string, string>,
	): Promise<void> {
		const existingCookies = await this.getCookies(origin);
		await this.setCookies(origin, { ...existingCookies, ...cookies });
	}

	async clearCookies(origin: string): Promise<void> {
		const fullPath = resolve(this.path, origin);
		if (existsSync(fullPath)) {
			await writeFile(fullPath, JSON.stringify({}), "utf-8");
		}
	}
}
