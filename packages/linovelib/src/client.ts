import {
	type BinaryResponse,
	BrowserFetchClient,
	type BrowserFetchClientOptions,
	type BrowserProfileName,
	type FlareSolverrOptions,
} from "@acanthis-dec/browser-fetch";
import type {
	DescrambleCoefficients,
	ExploreHomeData,
	ExplorePage,
	ExploreSchema,
	Novel,
	NovelSearchResult,
} from "@acanthis-dec/core";
import type { StorageService } from "@acanthis-dec/storage";
import { deepmerge } from "deepmerge-ts";
import type { Logger } from "winston";
import z from "zod";
import { getChapter } from "./chapter";
import { descrambleCoefficientsSchema } from "./coefficients";
import { getVolumeCoverUrl, novelIdToCoverUrl } from "./cover";
import {
	getCatalog,
	getExploreHome,
	getRankings,
	LINOVELIB_EXPLORE_SCHEMA,
	type LinovelibCatalogOptions,
	type LinovelibRankingOptions,
} from "./explore";
import type { NovelUpdateInfo } from "./novel";
import {
	NovelChapterQueue,
	NovelExploreQueue,
	NovelInfoQueue,
	NovelMediaQueue,
} from "./queue";
import { SearchSession, searchNovels } from "./search";
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
	private novelMediaQueue: NovelMediaQueue;
	private novelExploreQueue: NovelExploreQueue;
	private searchSession: SearchSession;
	private options?: LinovelibClientOptions;
	private logger?: Logger | undefined;
	private isSessionValid?: boolean = undefined;
	private sessionCheckPromise: Promise<boolean> | null = null;

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
				profile: "chrome-latest-linux",
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
		if (this.logger) {
			browserFetchOptions.logger = this.logger;
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
		this.novelMediaQueue = new NovelMediaQueue(this.fetchClient, this.logger);
		this.novelExploreQueue = new NovelExploreQueue(
			this.fetchClient,
			this.logger,
		);
		this.searchSession = new SearchSession(this.fetchClient, this.logger);
	}

	private async ensureSession(): Promise<void> {
		if (!this.options?.session.enabled || this.isSessionValid) {
			return;
		}
		if (!this.sessionCheckPromise) {
			const { username, password } = this.options.session;
			this.sessionCheckPromise = ensureValidSession(
				this.fetchClient,
				{
					username,
					password,
				},
				this.logger,
			)
				.then((valid) => {
					this.isSessionValid = valid;
					return valid;
				})
				.finally(() => {
					this.sessionCheckPromise = null;
				});
		}
		await this.sessionCheckPromise;
	}

	async getNovelInfo(id: string): Promise<Novel | undefined> {
		await this.ensureSession();
		return await this.novelInfoQueue.fetchNovelInfo(id);
	}

	async getNovelUpdateInfo(id: string): Promise<NovelUpdateInfo | null> {
		await this.ensureSession();
		return await this.novelInfoQueue.fetchNovelUpdateInfo(id);
	}

	async searchNovels(keyword: string): Promise<NovelSearchResult[]> {
		await this.ensureSession();
		return await searchNovels(keyword, this.fetchClient, this.searchSession);
	}

	async getNovelCover(
		id: string,
	): Promise<{ data: BinaryResponse; url: string }> {
		await this.ensureSession();
		const coverUrl = await novelIdToCoverUrl(id);
		const coverData = await this.getCover(
			coverUrl,
			`https://www.linovelib.com/novel/${id}.html`,
		);
		return { data: coverData, url: coverUrl };
	}

	async getVolumeCover(
		novelId: string,
		volumeId: string,
	): Promise<{ data: BinaryResponse; url: string }> {
		await this.ensureSession();
		const coverUrl = await getVolumeCoverUrl(
			volumeId,
			novelId,
			this.fetchClient,
		);
		const coverData = await this.getCover(
			coverUrl,
			`https://www.linovelib.com/novel/${novelId}/catalog`,
		);
		return { data: coverData, url: coverUrl };
	}

	async getCover(url: string, referer?: string): Promise<BinaryResponse> {
		return await this.novelMediaQueue.fetchImage(
			url,
			referer || "https://www.linovelib.com/",
		);
	}

	async getIllustration(
		url: string,
		referer?: string,
	): Promise<BinaryResponse> {
		await this.ensureSession();
		return await this.getCover(url, referer || "https://www.linovelib.com/");
	}

	async getChapter(
		novelId: string,
		chapterId: string,
	): Promise<string | undefined> {
		await this.ensureSession();
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
			this.logger,
		);
		if (this.storage && result) {
			await this.storage.setCache("chapterlog_js_version", result.version);
			await this.storage.setCache("coefficients", result.coefficients);
		}
		return result?.content;
	}

	getExploreSchema(): ExploreSchema {
		return LINOVELIB_EXPLORE_SCHEMA;
	}

	async getExploreHome(channel?: string): Promise<ExploreHomeData> {
		return await getExploreHome(channel, this.novelExploreQueue);
	}

	async getRankings(options: LinovelibRankingOptions): Promise<ExplorePage> {
		return await getRankings(options, this.novelExploreQueue);
	}

	async getCatalog(options?: LinovelibCatalogOptions): Promise<ExplorePage> {
		return await getCatalog(options, this.novelExploreQueue);
	}
}
