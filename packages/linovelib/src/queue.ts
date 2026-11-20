import {
	type BinaryResponse,
	type BrowserFetchClient,
	CloudflareBlockError,
	defaultRetryPolicy,
	type RetryOptions,
} from "@acanthis-dec/browser-fetch";
import type { Novel } from "@acanthis-dec/core";
import PQueue from "p-queue";
import type { Logger } from "winston";
import { getNovelInfo, getUpdateInfo, type NovelUpdateInfo } from "./novel";

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
		this.queue.addEventListener("add", () => {
			this.logger?.debug(
				`[NovelChapterQueue] 任务已添加，当前排队数: ${this.queue.size} (等待中任务数: ${this.queue.pending})`,
			);
		});
		this.queue.addEventListener("next", () => {
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
		this.queue.addEventListener("add", () => {
			this.logger?.debug(
				`[NovelInfoQueue] 任务已添加，当前排队数: ${this.queue.size} (等待中任务数: ${this.queue.pending})`,
			);
		});
		this.queue.addEventListener("next", () => {
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

export interface NovelMediaQueueOptions {
	normalDelayMinMs?: number | undefined;
	normalDelayMaxMs?: number | undefined;
	cloudflareBackoffMs?: readonly number[] | undefined;
	retries?: number | undefined;
	timeoutMs?: number | undefined;
	connectionTimeoutMs?: number | undefined;
	networkRetries?: number | undefined;
}

type MediaRetryContext = Parameters<
	NonNullable<RetryOptions["shouldRetry"]>
>[0];

const DEFAULT_MEDIA_NORMAL_DELAY_MIN_MS = 300;
const DEFAULT_MEDIA_NORMAL_DELAY_MAX_MS = 600;
const DEFAULT_MEDIA_CLOUDFLARE_BACKOFF_MS: readonly number[] = [
	3000, 8000, 15000, 15000,
];
const DEFAULT_MEDIA_RETRIES = 4;
const DEFAULT_MEDIA_TIMEOUT_MS = 25_000;
const DEFAULT_MEDIA_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_MEDIA_NETWORK_RETRIES = 2;

function computeSecFetchSite(
	targetUrl: string,
	referer: string,
): "same-origin" | "same-site" | "cross-site" {
	try {
		const target = new URL(targetUrl);
		const ref = new URL(referer);
		if (target.origin === ref.origin) {
			return "same-origin";
		}
		if (target.protocol !== ref.protocol) {
			return "cross-site";
		}
		const targetParts = target.hostname.toLowerCase().split(".");
		const refParts = ref.hostname.toLowerCase().split(".");
		if (
			targetParts.length >= 2 &&
			refParts.length >= 2 &&
			targetParts.slice(-2).join(".") === refParts.slice(-2).join(".")
		) {
			return "same-site";
		}
		return "cross-site";
	} catch {
		return "cross-site";
	}
}

export class NovelMediaQueue {
	private queue: PQueue;
	private client: BrowserFetchClient;
	private logger?: Logger | undefined;
	private inFlight = new Map<string, Promise<BinaryResponse>>();
	private lastFetchTime = 0;
	private cooldownUntil = 0;
	private readonly normalDelayMinMs: number;
	private readonly normalDelayMaxMs: number;
	private readonly cloudflareBackoffMs: readonly number[];
	private readonly retries: number;
	private readonly timeoutMs: number;
	private readonly connectionTimeoutMs: number;
	private readonly networkRetries: number;

	constructor(
		client: BrowserFetchClient,
		logger?: Logger,
		options?: NovelMediaQueueOptions,
	) {
		this.queue = new PQueue({ concurrency: 1 });
		this.client = client;
		this.logger = logger;
		this.normalDelayMinMs =
			options?.normalDelayMinMs ?? DEFAULT_MEDIA_NORMAL_DELAY_MIN_MS;
		this.normalDelayMaxMs = Math.max(
			this.normalDelayMinMs,
			options?.normalDelayMaxMs ?? DEFAULT_MEDIA_NORMAL_DELAY_MAX_MS,
		);
		this.cloudflareBackoffMs =
			options?.cloudflareBackoffMs && options.cloudflareBackoffMs.length > 0
				? options.cloudflareBackoffMs
				: DEFAULT_MEDIA_CLOUDFLARE_BACKOFF_MS;
		this.retries = options?.retries ?? DEFAULT_MEDIA_RETRIES;
		this.timeoutMs = options?.timeoutMs ?? DEFAULT_MEDIA_TIMEOUT_MS;
		this.connectionTimeoutMs =
			options?.connectionTimeoutMs ?? DEFAULT_MEDIA_CONNECT_TIMEOUT_MS;
		this.networkRetries =
			options?.networkRetries ?? DEFAULT_MEDIA_NETWORK_RETRIES;
		this.queue.addEventListener("add", () => {
			this.logger?.debug(
				`[NovelMediaQueue] 任务已添加，当前排队数: ${this.queue.size} (执行中: ${this.queue.pending})`,
			);
		});
		this.queue.addEventListener("next", () => {
			this.logger?.debug(
				`[NovelMediaQueue] 任务已结束，剩余排队数: ${this.queue.size} (执行中: ${this.queue.pending})`,
			);
		});
	}

	private async _sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private getNormalDelay(): number {
		return (
			this.normalDelayMinMs +
			Math.random() * (this.normalDelayMaxMs - this.normalDelayMinMs)
		);
	}

	async fetchImage(
		url: string,
		referer = "https://www.linovelib.com/",
	): Promise<BinaryResponse> {
		const existing = this.inFlight.get(url);
		if (existing) {
			this.logger?.debug(`[NovelMediaQueue] 复用在途图片请求: ${url}`);
			return await existing;
		}

		const taskPromise = (async () => {
			return await this.queue.add(async () => {
				const startedAt = Date.now();
				const cooldownWait = this.cooldownUntil - Date.now();
				if (cooldownWait > 0) {
					this.logger?.debug(
						`[NovelMediaQueue] 等待 Cloudflare 冷却 ${Math.floor(cooldownWait)}ms`,
					);
					await this._sleep(cooldownWait);
				}

				const delay = this.getNormalDelay();
				const elapsed = Date.now() - this.lastFetchTime;
				if (elapsed < delay) {
					const waitTime = delay - elapsed;
					this.logger?.debug(
						`[NovelMediaQueue] 请求过快，等待 ${Math.floor(waitTime)}ms`,
					);
					await this._sleep(waitTime);
				}

				this.logger?.debug(
					`[NovelMediaQueue] 开始获取图片: ${url} (排队数: ${this.queue.size})`,
				);

				const headers = {
					Referer: referer,
					Accept:
						"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
					"Sec-Fetch-Dest": "image",
					"Sec-Fetch-Mode": "no-cors",
					"Sec-Fetch-Site": computeSecFetchSite(url, referer),
				};

				const canRetryNetwork = (ctx: MediaRetryContext) =>
					defaultRetryPolicy(ctx) &&
					ctx.attemptNumber <= this.networkRetries &&
					ctx.retriesLeft > 0;

				const retry: RetryOptions = {
					retries: this.retries,
					factor: 2,
					minRetryDelayMs: 0,
					maxRetryDelayMs: 0,
					randomize: false,
					onFailedAttempt: async (ctx) => {
						if (ctx.error instanceof CloudflareBlockError) {
							const backoffIndex = Math.min(
								Math.max(ctx.attemptNumber - 1, 0),
								this.cloudflareBackoffMs.length - 1,
							);
							const backoffMs = this.cloudflareBackoffMs[backoffIndex] ?? 15000;
							this.cooldownUntil = Math.max(
								this.cooldownUntil,
								Date.now() + backoffMs,
							);
							if (ctx.retriesLeft > 0) {
								this.logger?.warn(
									`[NovelMediaQueue] 图片请求被 Cloudflare 阻挡 (${url})，第 ${ctx.attemptNumber} 次失败，等待 ${backoffMs}ms 后重试...`,
								);
								await this._sleep(backoffMs);
							} else {
								this.logger?.error(
									`[NovelMediaQueue] 图片请求被 Cloudflare 阻挡且重试耗尽 (${url}, 尝试 ${ctx.attemptNumber} 次): ${ctx.error.message}`,
								);
							}
							return;
						}

						if (defaultRetryPolicy(ctx)) {
							if (canRetryNetwork(ctx)) {
								const delayMs = Math.min(
									1000 * 2 ** Math.max(ctx.attemptNumber - 1, 0),
									8000,
								);
								this.logger?.warn(
									`[NovelMediaQueue] 图片请求异常 (${url})，第 ${ctx.attemptNumber} 次失败，等待 ${delayMs}ms 后重试: ${ctx.error.message}`,
								);
								await this._sleep(delayMs);
							} else {
								this.logger?.error(
									`[NovelMediaQueue] 图片请求重试次数已达上限 (${ctx.attemptNumber} 次, ${url}): ${ctx.error.message}`,
								);
							}
						}
					},
					shouldRetry: async (ctx) => {
						return (
							ctx.error instanceof CloudflareBlockError ||
							(defaultRetryPolicy(ctx) &&
								ctx.attemptNumber <= this.networkRetries)
						);
					},
				};

				try {
					const response = await this.client.binary(url, {
						headers,
						retry,
						timeout: this.timeoutMs,
						connectionTimeout: this.connectionTimeoutMs,
					});
					this.lastFetchTime = Date.now();
					this.logger?.debug(
						`[NovelMediaQueue] 图片获取成功 (${Date.now() - startedAt}ms, ${response.data.length}B, ${response.mimeType}): ${url}`,
					);
					return response;
				} catch (error) {
					this.logger?.warn(
						`[NovelMediaQueue] 图片获取最终失败 (${Date.now() - startedAt}ms, ${url}): ${error instanceof Error ? error.message : String(error)}`,
					);
					throw error;
				}
			});
		})().finally(() => {
			this.inFlight.delete(url);
		});

		this.inFlight.set(url, taskPromise);
		return await taskPromise;
	}
}

const DEFAULT_EXPLORE_DELAY_MIN_MS = 300;
const DEFAULT_EXPLORE_DELAY_MAX_MS = 600;
const DEFAULT_EXPLORE_RETRIES = 2;

export class NovelExploreQueue {
	private queue: PQueue;
	private client: BrowserFetchClient;
	private logger?: Logger | undefined;
	private nextAvailableTime = 0;

	constructor(client: BrowserFetchClient, logger?: Logger) {
		this.queue = new PQueue({ concurrency: 2 });
		this.client = client;
		this.logger = logger;
		this.queue.addEventListener("add", () => {
			this.logger?.debug(
				`[NovelExploreQueue] 任务已添加，当前排队数: ${this.queue.size} (执行中: ${this.queue.pending})`,
			);
		});
		this.queue.addEventListener("next", () => {
			this.logger?.debug(
				`[NovelExploreQueue] 任务已结束，剩余排队数: ${this.queue.size} (执行中: ${this.queue.pending})`,
			);
		});
	}

	private async _sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private getThrottleDelay(): number {
		return (
			DEFAULT_EXPLORE_DELAY_MIN_MS +
			Math.random() *
				(DEFAULT_EXPLORE_DELAY_MAX_MS - DEFAULT_EXPLORE_DELAY_MIN_MS)
		);
	}

	async fetchPage(url: string): Promise<string> {
		return await this.queue.add(async () => {
			const delay = this.getThrottleDelay();
			const now = Date.now();
			const scheduledAt = Math.max(now, this.nextAvailableTime);
			this.nextAvailableTime = scheduledAt + delay;
			const waitTime = scheduledAt - now;
			if (waitTime > 0) {
				this.logger?.debug(
					`[NovelExploreQueue] 请求过快，等待 ${Math.floor(waitTime)}ms`,
				);
				await this._sleep(waitTime);
			}

			this.logger?.debug(`[NovelExploreQueue] 开始抓取页面: ${url}`);

			const retry: RetryOptions = {
				retries: DEFAULT_EXPLORE_RETRIES,
				factor: 2,
				minRetryDelayMs: 500,
				maxRetryDelayMs: 3000,
				randomize: true,
				onFailedAttempt: async (ctx) => {
					if (ctx.error instanceof CloudflareBlockError) {
						this.logger?.warn(
							`[NovelExploreQueue] 页面触发 Cloudflare 拦截 (${url}): ${ctx.error.message}`,
						);
						return;
					}
					if (defaultRetryPolicy(ctx)) {
						if (ctx.retriesLeft > 0) {
							this.logger?.warn(
								`[NovelExploreQueue] 页面请求异常 (${url})，第 ${ctx.attemptNumber} 次失败，即将重试: ${ctx.error.message}`,
							);
						} else {
							this.logger?.error(
								`[NovelExploreQueue] 页面请求重试次数已达上限 (${ctx.attemptNumber} 次, ${url}): ${ctx.error.message}`,
							);
						}
					}
				},
				shouldRetry: async (ctx) => {
					if (ctx.error instanceof CloudflareBlockError) {
						return false;
					}
					return defaultRetryPolicy(ctx);
				},
			};

			const response = await this.client.text(url, { retry });
			this.logger?.debug(`[NovelExploreQueue] 页面获取成功: ${url}`);
			return response.data ?? "";
		});
	}
}
