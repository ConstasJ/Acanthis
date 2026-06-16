import type { BinaryResponse } from "@acanthis-dec/browser-fetch";
import type { Chapter, Novel, NovelSearchResult } from "@acanthis-dec/core";
import type z from "zod";
import { DatabaseCookieStore } from "./cookies";
import { type DatabaseOptions, DatabaseService } from "./db";
import { FSStorageService } from "./files";

export interface StorageServiceOptions {
	dataDir?: string;
	db: DatabaseOptions;
}

export class StorageService {
	private db: DatabaseService;
	private files: FSStorageService;
	private cookieStore: DatabaseCookieStore;

	constructor(options: StorageServiceOptions) {
		this.db = new DatabaseService(options.db);
		this.files = new FSStorageService(options.dataDir ?? "", this.db);
		this.cookieStore = new DatabaseCookieStore(this.db);
	}

	async getNovelContent(hash: string): Promise<string | undefined> {
		return await this.files.getNovelContent(hash);
	}

	async setNovelContent(content: string): Promise<string> {
		return await this.files.setNovelContent(content);
	}

	async getCoverData(
		type: "novel" | "volume",
		platform: string,
		platformId: string,
	): Promise<BinaryResponse | undefined> {
		return await this.files.getCoverData(type, platform, platformId);
	}

	async setCoverData(
		type: "novel" | "volume",
		url: string,
		data: Buffer,
		contentType: string,
		platform: string,
		platformId: string,
	): Promise<void> {
		await this.files.setCoverData(
			type,
			url,
			platform,
			platformId,
			data,
			contentType,
		);
	}

	async addSearchResult(
		keyword: string,
		platform: string,
		results: NovelSearchResult[],
	): Promise<void> {
		await this.db.addSearchResult(keyword, platform, results);
	}

	async searchNovels(
		keyword: string,
		platform: string,
	): Promise<NovelSearchResult[] | undefined> {
		const data = await this.db.searchNovels(keyword, platform);
		return data ? data.data : undefined;
	}

	async getNovelCache(platform: string, platformId: string) {
		const data = await this.db.getNovelCache(platform, platformId);
		return data ? data.data : undefined;
	}

	async addNovelCache(novel: Novel) {
		await this.db.addNovelCache(novel);
	}

	async getVolumeMeta(platform: string, platformId: string) {
		return await this.db.getVolumeMeta(platform, platformId);
	}

	async getChapterFromTitle(
		title: string,
	): Promise<Partial<Chapter> | undefined> {
		return await this.db.getChapterFromTitle(title);
	}

	async getChapterFromId(
		platform: string,
		platformId: string,
	): Promise<Chapter | undefined> {
		return await this.db.getChapterFromId(platform, platformId);
	}

	async addNovelContentHash(
		platform: string,
		chapterId: string,
		contentHash: string,
	) {
		await this.db.addNovelContentHash(platform, chapterId, contentHash);
	}

	getCookieStore() {
		return this.cookieStore;
	}

	async getCache<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
		return await this.db.getCache(key, schema);
	}

	async setCache<T>(key: string, value: T): Promise<void> {
		await this.db.setCache(key, value);
	}

	close() {
		this.db.close();
	}
}
