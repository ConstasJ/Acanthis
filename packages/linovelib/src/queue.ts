import {
	type BrowserFetchClient,
	CloudflareBlockError,
	defaultRetryPolicy,
	type RetryOptions,
} from "@acanthis-dec/browser-fetch";
import PQueue from "p-queue";

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

export class NovelChapterQueue {
	private queue: PQueue;
	private client: BrowserFetchClient;
	private backoff: SimpleBackoff;

	constructor(client: BrowserFetchClient) {
		this.queue = new PQueue({ concurrency: 1 });
		this.client = client;
		this.backoff = new SimpleBackoff();
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
			// const novelId = match[1];
			// const chapterId = match[2];
			// const partId = match[3] || "1";

			const retry: RetryOptions = {
				retries: 10,
				factor: 2,
				minRetryDelayMs: 0,
				maxRetryDelayMs: 0,
				randomize: false,
				onFailedAttempt: async (ctx) => {
					if (ctx.error instanceof CloudflareBlockError) {
						await this._sleep(this.backoff.FAILURE_DELAY);
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
				await this._sleep(this.backoff.getDelayForSuccess(true));
				return content;
			}
			await this._sleep(this.backoff.getDelayForSuccess());
			return content;
		});
	}
}
