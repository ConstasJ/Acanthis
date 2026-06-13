import {
	type BrowserFetchClient,
	CloudflareBlockError,
	defaultRetryPolicy,
	type RetryOptions,
} from "@acanthis-dec/browser-fetch";
import type { Novel, NovelSearchResult } from "@acanthis-dec/core";
import type { StorageService } from "@acanthis-dec/storage";
import PQueue from "p-queue";
import type { Logger } from "winston";
import { getNovelInfo } from "./novel";
import { searchNovels } from "./search";

/**
 * Simple backoff strategy for request rate limiting
 * - Normal desktop delay: 500-1000ms random
 * - Normal mobile delay: 2000-5000ms random
 * - Failure delay: 8000ms (8 seconds)
 */
class SimpleBackoff {
	readonly NORMAL_DELAY_MIN = 500;
	readonly NORMAL_DELAY_MAX = 1000;
	readonly NORMAL_MOBILE_DELAY_MIN = 2000;
	readonly NORMAL_MOBILE_DELAY_MAX = 5000;
	readonly FAILURE_DELAY = 15000;

	/**
	 * Get delay for normal (successful) operation
	 * @returns Random delay in range [500, 1000]ms. If isMobile is true, returns random delay in range [2000, 5000]ms
	 */
	getDelayForSuccess(isMobile: boolean = false): number {
		if (isMobile) {
			return (
				this.NORMAL_MOBILE_DELAY_MIN +
				Math.random() *
					(this.NORMAL_MOBILE_DELAY_MAX - this.NORMAL_MOBILE_DELAY_MIN)
			);
		}
		return (
			this.NORMAL_DELAY_MIN +
			Math.random() * (this.NORMAL_DELAY_MAX - this.NORMAL_DELAY_MIN)
		);
	}
}

export class SearchQueue {
	private queue: PQueue;
	private client: BrowserFetchClient;
	private storage?: StorageService | undefined;
	private logger?: Logger | undefined;
	private readonly COOLDOWN_MS = 5000;
	private lastSearchTime = 0;

	constructor(
		client: BrowserFetchClient,
		storage?: StorageService,
		logger?: Logger,
	) {
		this.queue = new PQueue({ concurrency: 1 });
		this.client = client;
		this.storage = storage;
		this.logger = logger;
		this.queue.on("add", () => {
			this.logger?.debug(
				`[SearchQueue] 任务已添加，当前排队数: ${this.queue.size} (等待中任务数: ${this.queue.pending})`,
			);
		});
		this.queue.on("next", () => {
			this.logger?.debug(
				`[SearchQueue] 任务完成或超时，开始下一个任务。剩余：${this.queue.size} `,
			);
		});
	}

	async searchNovels(
		keyword: string,
		haha?: string,
	): Promise<NovelSearchResult[]> {
		return await this.queue.add(async () => {
			if (Date.now() - this.lastSearchTime < this.COOLDOWN_MS) {
				const waitTime = this.COOLDOWN_MS - (Date.now() - this.lastSearchTime);
				this.logger?.debug(
					`[SearchQueue] 搜索请求过快，等待 ${waitTime}ms 后重试`,
				);
				await new Promise((resolve) => setTimeout(resolve, waitTime));
			}
			this.logger?.debug(`[SearchQueue] 开始搜索关键词 "${keyword}"`);
			const results = await searchNovels(
				keyword,
				this.client,
				this.storage,
				haha,
			);
			this.logger?.debug(
				`[SearchQueue] 搜索完成，关键词 "${keyword}" 共找到 ${results.length} 条结果`,
			);
			this.lastSearchTime = Date.now();
			return results;
		});
	}
}

export class NovelChapterQueue {
	private queue: PQueue;
	private client: BrowserFetchClient;
	private backoff: SimpleBackoff;
	private logger?: Logger | undefined;

	constructor(client: BrowserFetchClient, logger?: Logger) {
		this.queue = new PQueue({ concurrency: 1 });
		this.client = client;
		this.backoff = new SimpleBackoff();
		this.logger = logger;
		this.queue.on("add", () => {
			this.logger?.debug(
				`[NovelChapterQueue] 任务已添加，当前排队数: ${this.queue.size} (等待中任务数: ${this.queue.pending})`,
			);
		});
		this.queue.on("next", () => {
			this.logger?.debug(
				`[NovelChapterQueue] 任务完成或超时，开始下一个任务。剩余：${this.queue.size} `,
			);
		});
	}

	private async _sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async fetchChapterPart(url: string): Promise<string> {
		return await this.queue.add(async () => {
			const match = url.match(/\/novel\/(\d+)\/(\d+)(?:_(\d+))?\.html/);
			if (!match) {
				throw new Error(`Invalid chapter URL: ${url}`);
			}
			const novelId = match[1];
			const chapterId = match[2];
			const partId = match[3] || "1";
			this.logger?.debug(
				`[NovelChapterQueue] 开始获取小说${novelId}章节${chapterId}的第${partId}部分内容`,
			);

			const retry: RetryOptions = {
				retries: 10,
				factor: 2,
				minRetryDelayMs: 0,
				maxRetryDelayMs: 0,
				randomize: false,
				onFailedAttempt: async (ctx) => {
					if (ctx.error instanceof CloudflareBlockError) {
						this.logger?.warn(
							`[NovelChapterQueue] 请求被 Cloudflare 阻挡，错误信息: ${ctx.error.message}。正在等待 ${this.backoff.FAILURE_DELAY / 1000}s 后重试...`,
						);
						await this._sleep(this.backoff.FAILURE_DELAY);
					}
					if (ctx.attemptNumber >= (retry.retries ?? 3)) {
						this.logger?.error(
							`[NovelChapterQueue] 请求重试次数已达上限 (${ctx.attemptNumber} 次)，错误信息: ${ctx.error.message}`,
						);
					}
				},
				shouldRetry: async (ctx) => {
					return (
						defaultRetryPolicy(ctx) || ctx.error instanceof CloudflareBlockError
					);
				},
			};

			let content = (await this.client.text(url, { retry })).data ?? "";
			if (content.match(/沒有可閱讀的章節|没有可阅读的章节/i)) {
				content = (
					await this.client.text(url, {
						profile: "chrome149-android",
						retry: {
							...retry,
							minRetryDelayMs: this.backoff.NORMAL_MOBILE_DELAY_MIN,
							maxRetryDelayMs: this.backoff.NORMAL_MOBILE_DELAY_MAX,
						},
					})
				).data;
				const delay = this.backoff.getDelayForSuccess(true);
				this.logger?.debug(
					`[NovelChapterQueue] 小说${novelId}-章节${chapterId}_${partId} 获取成功。下一次请求将在 ${delay.toFixed(0)}ms 后进行`,
				);
				await this._sleep(delay);
				return content;
			}
			const delay = this.backoff.getDelayForSuccess();
			this.logger?.debug(
				`[NovelChapterQueue] 小说${novelId}-章节${chapterId}_${partId} 获取成功。下一次请求将在 ${delay.toFixed(0)}ms 后进行`,
			);
			await this._sleep(delay);
			return content;
		});
	}
}

export class NovelInfoQueue {
	private queue: PQueue;
	private client: BrowserFetchClient;
	private backoff: SimpleBackoff;
	private chapterQueue: NovelChapterQueue;
	private storage?: StorageService | undefined;
	private logger?: Logger | undefined;

	constructor(
		client: BrowserFetchClient,
		chapterQueue: NovelChapterQueue,
		storage?: StorageService,
		logger?: Logger,
	) {
		this.queue = new PQueue({ concurrency: 1 });
		this.client = client;
		this.backoff = new SimpleBackoff();
		this.chapterQueue = chapterQueue;
		this.storage = storage;
		this.logger = logger;
		this.queue.on("add", () => {
			this.logger?.debug(
				`[NovelInfoQueue] 任务已添加，当前排队数: ${this.queue.size} (等待中任务数: ${this.queue.pending})`,
			);
		});
		this.queue.on("next", () => {
			this.logger?.debug(
				`[NovelInfoQueue] 任务完成或超时，开始下一个任务。剩余：${this.queue.size} `,
			);
		});
	}

	private async _sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async fetchNovelInfo(id: string): Promise<Novel> {
		return await this.queue.add(async () => {
			this.logger?.debug(`[NovelInfoQueue] 开始获取小说${id}的信息`);
			const retry: RetryOptions = {
				retries: 10,
				factor: 2,
				minRetryDelayMs: 0,
				maxRetryDelayMs: 0,
				randomize: false,
				onFailedAttempt: async (ctx) => {
					if (ctx.error instanceof CloudflareBlockError) {
						this.logger?.warn(
							`[NovelInfoQueue] 请求被 Cloudflare 阻挡，错误信息: ${ctx.error.message}。正在等待 ${this.backoff.FAILURE_DELAY / 1000}s 后重试...`,
						);
						await this._sleep(this.backoff.FAILURE_DELAY);
					}
					if (ctx.attemptNumber >= (retry.retries ?? 3)) {
						this.logger?.error(
							`[NovelInfoQueue] 请求重试次数已达上限 (${ctx.attemptNumber} 次)，错误信息: ${ctx.error.message}`,
						);
					}
				},
				shouldRetry: async (ctx) => {
					return (
						defaultRetryPolicy(ctx) || ctx.error instanceof CloudflareBlockError
					);
				},
			};

			const novel = await getNovelInfo(
				id,
				this.client,
				retry,
				this.chapterQueue,
				this.storage,
			);
			if (!novel) {
				throw new Error(`无法获取小说信息: ${id}`);
			}
			const delay = this.backoff.getDelayForSuccess();
			this.logger?.debug(
				`[NovelInfoQueue] 小说${id} 信息获取成功。下一次请求将在 ${delay.toFixed(0)}ms 后进行`,
			);
			await this._sleep(delay);
			return novel;
		});
	}
}
