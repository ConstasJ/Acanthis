import {
	BrowserFetchClient,
	type BrowserFetchClientOptions,
	type BrowserProfileName,
	type FlareSolverrOptions,
} from "@acanthis-dec/browser-fetch";
import type { Novel, NovelSearchResult } from "@acanthis-dec/core";
import type { StorageService } from "@acanthis-dec/storage";
import { deepmerge } from "deepmerge-ts";
import type { Logger } from "winston";
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

export type ImpersonateOptions = {
	enabled: true;
	profile: BrowserProfileName;
} | {
	enabled: false;
};

export type LinovelibClientOptions = {
	session: SessionOptions;
	flareSolverr: FlareSolverrOptions;
	impersonate: ImpersonateOptions;
	proxy?: string | undefined;
};

export class LinovelibClient {
	private storage?: StorageService | undefined;
	private fetchClient: BrowserFetchClient;
	private novelChapterQueue: NovelChapterQueue;
	private novelInfoQueue: NovelInfoQueue;
	private searchQueue: SearchQueue;
	private options?: LinovelibClientOptions;
	private logger?: Logger | undefined;

	constructor(
		options?: LinovelibClientOptions,
		storage?: StorageService,
		logger?: Logger,
	) {
		const defaultOptions: LinovelibClientOptions = {
			session: {
				enabled: false,
			},
			flareSolverr: {
				enabled: true,
				host: "http://localhost:8191",
				timeoutMs: 60000,
				sessionId: "acanthis-linovelib-client",
			},
			impersonate: {
				enabled: true,
				profile: "chrome149-linux",
			},
		};
		this.options = deepmerge(
			defaultOptions,
			options ?? {},
		) as LinovelibClientOptions;
		this.storage = storage;
		this.logger = logger;
		const browserFetchOptions: BrowserFetchClientOptions = {};
		if (this.options?.flareSolverr.enabled) {
			browserFetchOptions.flareSolverr = {
				enabled: true,
				host: this.options.flareSolverr.host,
				timeoutMs: this.options.flareSolverr.timeoutMs ?? 60000,
				sessionId:
					this.options.flareSolverr.sessionId ?? "acanthis-linovelib-client",
			};
		} else {
			browserFetchOptions.flareSolverr = {
				enabled: false,
			};
		}
		if (this.options?.proxy) {
			browserFetchOptions.proxy = this.options.proxy;
		}
		if (this.options?.impersonate.enabled) {
			browserFetchOptions.profile = this.options.impersonate.profile;
		}
		this.fetchClient = new BrowserFetchClient(browserFetchOptions);
		this.novelChapterQueue = new NovelChapterQueue(
			this.fetchClient,
			this.logger,
		);
		this.novelInfoQueue = new NovelInfoQueue(
			this.fetchClient,
			this.novelChapterQueue,
			this.storage,
			this.logger,
		);
		this.searchQueue = new SearchQueue(
			this.fetchClient,
			this.storage,
			this.logger,
		);
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
