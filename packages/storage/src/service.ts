import type { Chapter, Novel, NovelSearchResult } from "@acanthis-dec/core";
import type z from "zod";
import { DatabaseCookieStore } from "./cookies";
import { type DatabaseOptions, DatabaseService } from "./db";
import { FSStorageService } from "./files";
import type { ChapterWithNovelId } from "./type";

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

	async getNovelContent(
		novelId: string,
		chapterId: string,
	): Promise<string | undefined> {
		return await this.files.getNovelContent(novelId, chapterId);
	}

	async setNovelContent(
		novelId: string,
		chapterId: string,
		content: string,
	): Promise<void> {
		await this.files.setNovelContent(novelId, chapterId, content);
	}

	async getCoverData(url: string): Promise<Buffer | undefined> {
		return await this.files.getCoverData(url);
	}

	async setCoverData(
		url: string,
		data: Buffer,
		contentType: string,
	): Promise<void> {
		await this.files.setCoverData(url, data, contentType);
	}

	async addSearchResult(
		keyword: string,
		results: NovelSearchResult[],
	): Promise<void> {
		await this.db.addSearchResult(keyword, results);
	}

	async searchNovels(keyword: string): Promise<NovelSearchResult[] | undefined> {
		const data = await this.db.searchNovels(keyword);
		return data ? data.data : undefined;
	}

	async getNovelCache(platform: string, platformId: string) {
		const data = await this.db.getNovelCache(platform, platformId);
		return data ? data.data : undefined;
	}

	async addNovelCache(novel: Novel) {
		await this.db.addNovelCache(novel);
	}

	async getChapterFromTitle(
		title: string,
	): Promise<Partial<Chapter> | undefined> {
		return await this.db.getChapterFromTitle(title);
	}

	async getChapterFromId(
		platform: string,
		platformId: string,
	): Promise<ChapterWithNovelId | undefined> {
		return await this.db.getChapterFromId(platform, platformId);
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
}
