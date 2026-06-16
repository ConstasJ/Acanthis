import {
	type BinaryResponse,
	BrowserFetchClient,
	type BrowserFetchClientOptions,
	type BrowserProfileName,
	type FlareSolverrOptions,
} from "@acanthis-dec/browser-fetch";
import type {
	DescrambleCoefficients,
	Novel,
	NovelSearchResult,
} from "@acanthis-dec/core";
import type { StorageService } from "@acanthis-dec/storage";
import { deepmerge } from "deepmerge-ts";
import type { Logger } from "winston";
import z from "zod";
import { getChapter } from "./chapter";
import { descrambleCoefficientsSchema } from "./coefficients";
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

export type ImpersonateOptions =
	| {
			enabled: true;
			profile: BrowserProfileName;
	  }
	| {
			enabled: false;
	  };

export type CookieStoreOptions =
	| {
			type: "memory" | "database";
	  }
	| {
			type: "file";
			path: string;
	  };

export type LinovelibClientOptions = {
	session: SessionOptions;
	flareSolverr: FlareSolverrOptions;
	impersonate: ImpersonateOptions;
	cookies: CookieStoreOptions;
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
	private isSessionValid?: boolean = undefined;

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
			cookies: {
				type: "memory",
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
		switch (this.options?.cookies.type) {
			case "memory":
				browserFetchOptions.cookieStore = {
					type: "memory",
				};
				break;
			case "file":
				browserFetchOptions.cookieStore = {
					type: "file",
					path: this.options.cookies.path,
				};
				break;
			case "database":
				if (!this.storage) {
					throw new Error(
						"StorageService is required for database cookie store",
					);
				}
				browserFetchOptions.cookieStore = {
					type: "custom",
					store: this.storage.getCookieStore(),
				};
				break;
			default:
				browserFetchOptions.cookieStore = {
					type: "memory",
				};
		}
		this.fetchClient = new BrowserFetchClient(browserFetchOptions);
		this.novelChapterQueue = new NovelChapterQueue(
			this.fetchClient,
			this.logger,
		);
		this.novelInfoQueue = new NovelInfoQueue(
			this.fetchClient,
			this.novelChapterQueue,
			this.logger,
		);
		this.searchQueue = new SearchQueue(this.fetchClient, this.logger);
	}

	async getNovelInfo(id: string): Promise<Novel | undefined> {
		if (this.options?.session.enabled && !this.isSessionValid) {
			this.isSessionValid = await ensureValidSession(this.fetchClient, {
				username: this.options.session.username,
				password: this.options.session.password,
			});
		}
		return await this.novelInfoQueue.fetchNovelInfo(id);
	}

	async searchNovels(keyword: string): Promise<NovelSearchResult[]> {
		if (this.options?.session.enabled && !this.isSessionValid) {
			this.isSessionValid = await ensureValidSession(this.fetchClient, {
				username: this.options.session.username,
				password: this.options.session.password,
			});
		}
		return await this.searchQueue.searchNovels(keyword);
	}

	async getNovelCover(novelId: string) {
		return await getCover(novelId, this.fetchClient);
	}

	async getCover(url: string): Promise<BinaryResponse> {
		return await this.fetchClient.binary(url);
	}

	async getChapter(
		novelId: string,
		chapterId: string,
	): Promise<string | undefined> {
		if (this.options?.session.enabled && !this.isSessionValid) {
			this.isSessionValid = await ensureValidSession(this.fetchClient, {
				username: this.options.session.username,
				password: this.options.session.password,
			});
		}
		const cachedJsVersion = this.storage
			? ((await this.storage.getCache("chapterlog_js_version", z.string())) ??
				undefined)
			: undefined;
		const cachedCoefficients = this.storage
			? ((await this.storage.getCache<DescrambleCoefficients>(
					"coefficients",
					descrambleCoefficientsSchema,
				)) ?? undefined)
			: undefined;
		const result = await getChapter(
			chapterId,
			novelId,
			this.novelChapterQueue,
			this.fetchClient,
			cachedJsVersion,
			cachedCoefficients,
		);
		if (this.storage && result) {
			await this.storage.setCache("chapterlog_js_version", result.version);
			await this.storage.setCache("coefficients", result.coefficients);
		}
		return result?.content;
	}
}
