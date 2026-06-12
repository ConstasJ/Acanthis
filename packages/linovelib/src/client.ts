import { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
import type { Novel, NovelSearchResult } from "@acanthis-dec/core";
import type { StorageService } from "@acanthis-dec/storage";
import { getChapter } from "./chapter";
import { getCover } from "./cover";
import { NovelChapterQueue, NovelInfoQueue, SearchQueue } from "./queue";
import { ensureValidSession } from "./session";

export type SessionOptions =
	| {
			enabled: false;
	  }
	| {
			enabled: true;
			username: string;
			password: string;
	  };

export type LinovelibClientOptions = {
	session: SessionOptions;
};

export class LinovelibClient {
	private storage?: StorageService | undefined;
	private fetchClient: BrowserFetchClient;
	private novelChapterQueue: NovelChapterQueue;
	private novelInfoQueue: NovelInfoQueue;
	private searchQueue: SearchQueue;
	private options?: LinovelibClientOptions;

	constructor(options?: LinovelibClientOptions, storage?: StorageService) {
		this.options = options ?? {
			session: {
				enabled: false,
			},
		};
		this.storage = storage;
		this.fetchClient = new BrowserFetchClient();
		this.novelChapterQueue = new NovelChapterQueue(this.fetchClient);
		this.novelInfoQueue = new NovelInfoQueue(
			this.fetchClient,
			this.novelChapterQueue,
			this.storage,
		);
		this.searchQueue = new SearchQueue(this.fetchClient, this.storage);
	}

	async getNovelInfo(id: string): Promise<Novel | undefined> {
		if (this.options?.session.enabled && this.storage) {
			await ensureValidSession(this.storage, this.fetchClient, {
				username: this.options.session.username,
				password: this.options.session.password,
			});
		}
		return await this.novelInfoQueue.fetchNovelInfo(id);
	}

	async searchNovels(
		keyword: string,
		haha?: string,
	): Promise<NovelSearchResult[]> {
		if (this.options?.session.enabled && this.storage) {
			await ensureValidSession(this.storage, this.fetchClient, {
				username: this.options.session.username,
				password: this.options.session.password,
			});
		}
		return await this.searchQueue.searchNovels(keyword, haha);
	}

	async getNovelCover(novelId: string) {
		return await getCover(novelId, this.fetchClient, this.storage);
	}

	async getChapter(
		novelId: string,
		chapterId: string,
	): Promise<string | undefined> {
		if (this.options?.session.enabled && this.storage) {
			await ensureValidSession(this.storage, this.fetchClient, {
				username: this.options.session.username,
				password: this.options.session.password,
			});
		}
		return await getChapter(
			chapterId,
			this.novelChapterQueue,
			this.fetchClient,
			this.storage,
			novelId,
		);
	}
}
