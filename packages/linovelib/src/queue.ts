import {
	type BrowserFetchClient,
	CloudflareBlockError,
	defaultRetryPolicy,
	type RetryOptions,
} from "@acanthis-dec/browser-fetch";
import type { Novel, NovelSearchResult } from "@acanthis-dec/core";
import PQueue from "p-queue";
import type { Logger } from "winston";
import { getNovelInfo, getUpdateInfo, type NovelUpdateInfo } from "./novel";
import { searchNovels } from "./search";

/**
 * Simple backoff strategy for request rate limiting
 * - Normal delay: 500-1000ms random
 * - Failure delay: 8000ms (8 seconds)
 */
class SimpleBackoff {
	readonly NORMAL_DELAY_MIN = 500;
	readonly NORMAL_DELAY_MAX = 1000;
	readonly FAILURE_DELAY = 15000;

	/**
	 * Get delay for normal (successful) operation
	 * @returns Random delay in range [500, 1000]ms. If isMobile is true, returns random delay in range [2000, 5000]ms
	 */
	getDelayForSuccess(): number {
		return (
			this.NORMAL_DELAY_MIN +
			Math.random() * (this.NORMAL_DELAY_MAX - this.NORMAL_DELAY_MIN)
		);
	}
}

export class SearchQueue {
	private queue: PQueue;
	private client: BrowserFetchClient;
	private logger?: Logger | undefined;
	private readonly COOLDOWN_MS = 5000;
	private lastSearchTime = 0;

	constructor(client: BrowserFetchClient, logger?: Logger) {
		this.queue = new PQueue({ concurrency: 1 });
		this.client = client;
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

	private async _sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async searchNovels(keyword: string): Promise<NovelSearchResult[]> {
		return await this.queue.add(async () => {
			if (Date.now() - this.lastSearchTime < this.COOLDOWN_MS) {
				const waitTime = this.COOLDOWN_MS - (Date.now() - this.lastSearchTime);
				this.logger?.debug(
					`[SearchQueue] 搜索请求过快，等待 ${Math.floor(waitTime)}ms 后重试`,
				);
				await this._sleep(waitTime);
			}
			this.logger?.debug(`[SearchQueue] 开始搜索关键词 "${keyword}"`);
			const results = await searchNovels(keyword, this.client);
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
	private lastFetchTime = 0;

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
			const delay = this.backoff.getDelayForSuccess();
			if (Date.now() - this.lastFetchTime < delay) {
				const waitTime = delay - (Date.now() - this.lastFetchTime);
				this.logger?.debug(
					`[NovelChapterQueue] 请求过快，等待 ${Math.floor(waitTime)}ms`,
				);
				await this._sleep(waitTime);
			}
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
							`[NovelChapterQueue] 请求被 Cloudflare 阻挡，错误信息: ${ctx.error.message}。正在等待 ${Math.floor(this.backoff.FAILURE_DELAY / 1000)}s 后重试...`,
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

			const content = (await this.client.text(url, { retry })).data ?? "";
			this.lastFetchTime = Date.now();
			this.logger?.debug(
				`[NovelChapterQueue] 小说${novelId}-章节${chapterId}_${partId} 获取成功。`,
			);
			return content;
		});
	}
}

export class NovelInfoQueue {
	private queue: PQueue;
	private client: BrowserFetchClient;
	private backoff: SimpleBackoff;
	private chapterQueue: NovelChapterQueue;
	private logger?: Logger | undefined;
	private lastFetchTime = 0;

	constructor(
		client: BrowserFetchClient,
		chapterQueue: NovelChapterQueue,
		logger?: Logger,
	) {
		this.queue = new PQueue({ concurrency: 1 });
		this.client = client;
		this.backoff = new SimpleBackoff();
		this.chapterQueue = chapterQueue;
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
			const delay = this.backoff.getDelayForSuccess();
			if (Date.now() - this.lastFetchTime < delay) {
				const waitTime = delay - (Date.now() - this.lastFetchTime);
				this.logger?.debug(
					`[NovelInfoQueue] 请求过快，等待 ${Math.floor(waitTime)}ms`,
				);
				await this._sleep(waitTime);
			}
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
							`[NovelInfoQueue] 请求被 Cloudflare 阻挡，错误信息: ${ctx.error.message}。正在等待 ${Math.floor(this.backoff.FAILURE_DELAY / 1000)}s 后重试...`,
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
			);
			if (!novel) {
				throw new Error(`无法获取小说信息: ${id}`);
			}
			this.logger?.debug(`[NovelInfoQueue] 小说${id} 信息获取成功。`);
			this.lastFetchTime = Date.now();
			return novel;
		});
	}

	async fetchNovelUpdateInfo(id: string): Promise<NovelUpdateInfo | null> {
		return await this.queue.add(async () => {
			const delay = this.backoff.getDelayForSuccess();
			if (Date.now() - this.lastFetchTime < delay) {
				const waitTime = delay - (Date.now() - this.lastFetchTime);
				this.logger?.debug(
					`[NovelInfoQueue] 请求过快，等待 ${Math.floor(waitTime)}ms`,
				);
				await this._sleep(waitTime);
			}
			this.logger?.debug(
				`[NovelInfoQueue] 开始获取小说${id}的更新信息（封面和章节数）`,
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
							`[NovelInfoQueue] 请求被 Cloudflare 阻挡，错误信息: ${ctx.error.message}。正在等待 ${Math.floor(this.backoff.FAILURE_DELAY / 1000)}s 后重试...`,
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

			const updateInfo = await getUpdateInfo(id, this.client, retry);
			if (!updateInfo) {
				this.logger?.warn(
					`[NovelInfoQueue] 无法获取小说${id}的更新信息，可能是因为小说不存在或已被删除`,
				);
			} else {
				this.logger?.debug(
					`[NovelInfoQueue] 小说${id} 更新信息获取成功。 封面: ${updateInfo.coverUrl}, 章节数: ${updateInfo.chapterCount}`,
				);
			}
			this.lastFetchTime = Date.now();
			return updateInfo;
		});
	}
}
