import type { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
import type { NovelSearchResult } from "@acanthis-dec/core";
import { Mutex } from "async-mutex";
import { load } from "cheerio";
import type { Logger } from "winston";
import { solveCaptcha } from "./captcha";
import { parseBookHtml, parseSearchHtml } from "./common";

const SEARCH_URL = "https://www.linovelib.com/S6/";
const ORIGIN = "https://www.linovelib.com";

/** 站点要求两次搜索 POST 之间至少间隔 5 秒，这里留一点余量。 */
const MIN_SEARCH_INTERVAL_MS = 5200;
const MAX_VERIFICATION_ATTEMPTS = 3;
const MAX_RATE_LIMIT_ATTEMPTS = 3;
const NEXT_PAGE_DELAY_MIN_MS = 300;
const NEXT_PAGE_DELAY_MAX_MS = 800;

const searchRequestHeaders = {
	origin: ORIGIN,
	referer: `${ORIGIN}/`,
};

const searchRefererHeaders = {
	origin: ORIGIN,
	referer: SEARCH_URL,
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isVerificationPage(html: string): boolean {
	return (
		html.includes('name="search_challenge"') ||
		html.includes("<title>搜索验证</title>")
	);
}

function isRateLimitedPage(html: string): boolean {
	return html.includes("两次搜索的间隔时间不得少于");
}

function isBookPage(html: string): boolean {
	return html.includes("book-html-box");
}

/** 搜索验证流程无法自动完成时抛出，便于上层区分站点验证码问题。 */
export class SearchVerificationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SearchVerificationError";
	}
}

export class SearchRateLimitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SearchRateLimitError";
	}
}

/**
 * 新版搜索会话。
 *
 * 站点现状（2026-11）：
 * - 未验证客户端 POST/GET 搜索页会返回「搜索验证」图片验证码页；
 * - 提交正确验证码后服务端会下发约 30 分钟有效的验证 cookie，期间搜索免验证；
 * - 两次搜索间隔不得少于 5 秒，否则返回错误页；
 * - 验证过期后任意搜索/翻页请求都会重新出现验证码页。
 *
 * 该类负责串行化搜索请求、维护最小搜索间隔、自动识别并提交验证码，并复用验证态。
 */
export class SearchSession {
	private readonly mutex = new Mutex();
	private lastSearchAt = 0;

	constructor(
		private readonly fetchClient: BrowserFetchClient,
		private readonly logger?: Logger | undefined,
	) {}

	async search(keyword: string): Promise<NovelSearchResult[]> {
		const queuedAt = Date.now();
		if (this.mutex.isLocked()) {
			this.logger?.debug(
				`[SearchSession] 已有搜索任务进行中，排队等待锁: keyword=${JSON.stringify(keyword)}`,
			);
		}
		return await this.mutex.runExclusive(async () => {
			const startAt = Date.now();
			const lockWaitMs = startAt - queuedAt;
			this.logger?.debug(
				`[SearchSession] 开始搜索: keyword=${JSON.stringify(keyword)} lockWait=${lockWaitMs}ms`,
			);
			const html = await this.requestSearch(keyword);
			const results = await this.parseResults(keyword, html);
			this.logger?.debug(
				`[SearchSession] 搜索完成: keyword=${JSON.stringify(keyword)} count=${results.length} duration=${Date.now() - startAt}ms`,
			);
			return results;
		});
	}

	private async parseResults(
		keyword: string,
		html: string,
	): Promise<NovelSearchResult[]> {
		const $ = load(html);
		if (isBookPage(html) && $("div.book-html-box").length > 0) {
			const book = parseBookHtml($);
			this.logger?.debug(
				`[SearchSession] 搜索直达书籍详情页: keyword=${JSON.stringify(keyword)} id=${book.id} title=${JSON.stringify(book.title)}`,
			);
			return [book];
		}

		const results = parseSearchHtml($);
		const totalPages = Number(
			$("em#pagestats")
				.text()
				.match(/1\/(\d+)/)?.[1] ?? "1",
		);
		const nextHref = $("a.next").attr("href");
		const hasNext = Boolean(totalPages > 1 && nextHref);
		this.logger?.debug(
			`[SearchSession] 搜索首页解析完成: keyword=${JSON.stringify(keyword)} page=1/${totalPages} count=${results.length} hasNext=${hasNext}`,
		);
		if (totalPages > 1 && nextHref) {
			results.push(...(await this.collectNextPages(keyword, nextHref)));
		}
		return results;
	}

	private async collectNextPages(
		keyword: string,
		startHref: string,
	): Promise<NovelSearchResult[]> {
		const results: NovelSearchResult[] = [];
		let href: string | undefined = startHref;
		let pageNumber = 2;

		while (href) {
			const delay =
				NEXT_PAGE_DELAY_MIN_MS +
				Math.random() * (NEXT_PAGE_DELAY_MAX_MS - NEXT_PAGE_DELAY_MIN_MS);
			const url = new URL(href, SEARCH_URL).toString();
			this.logger?.debug(
				`[SearchSession] 准备抓取搜索翻页: keyword=${JSON.stringify(keyword)} page=${pageNumber} delay=${Math.round(delay)}ms url=${url}`,
			);
			await sleep(delay);

			const html = await this.fetchPage(url);
			const $ = load(html);
			const pageResults = parseSearchHtml($);
			results.push(...pageResults);
			href = $("a.next").attr("href") || undefined;
			this.logger?.debug(
				`[SearchSession] 搜索翻页解析完成: keyword=${JSON.stringify(keyword)} page=${pageNumber} count=${pageResults.length} hasNext=${Boolean(href)}`,
			);
			pageNumber += 1;
		}

		return results;
	}

	private async fetchPage(url: string): Promise<string> {
		let response = await this.fetchClient.text(url, {
			headers: searchRefererHeaders,
		});
		if (response.mimeType !== "text/html") {
			throw new Error(`Unexpected response type: ${response.mimeType}`);
		}
		if (isVerificationPage(response.data)) {
			this.logger?.debug(
				`[SearchSession] 搜索翻页时验证态过期，重新执行搜索验证: url=${url}`,
			);
			// 验证态过期：先完成验证，再重新获取目标页（验证响应固定是关键词第一页）。
			await this.verifySearch(response.data);
			this.logger?.debug(
				`[SearchSession] 验证态已恢复，重新请求搜索翻页: url=${url}`,
			);
			response = await this.fetchClient.text(url, {
				headers: searchRefererHeaders,
			});
			if (response.mimeType !== "text/html") {
				throw new Error(`Unexpected response type: ${response.mimeType}`);
			}
			if (isVerificationPage(response.data)) {
				throw new SearchVerificationError("搜索验证后翻页仍被要求验证");
			}
		}
		if (response.data === "") {
			throw new Error("Empty response body when fetching search page");
		}
		return response.data;
	}

	private async requestSearch(keyword: string): Promise<string> {
		for (let attempt = 0; attempt < MAX_RATE_LIMIT_ATTEMPTS; attempt++) {
			await this.waitForSearchSlot();
			const requestStartAt = Date.now();
			this.logger?.debug(
				`[SearchSession] 发起搜索 POST 请求: keyword=${JSON.stringify(keyword)} attempt=${attempt + 1}/${MAX_RATE_LIMIT_ATTEMPTS}`,
			);
			const response = await this.fetchClient.text(SEARCH_URL, {
				method: "POST",
				body: new URLSearchParams({
					searchkey: keyword,
				}),
				headers: searchRequestHeaders,
			});
			this.lastSearchAt = Date.now();

			if (response.mimeType !== "text/html") {
				throw new Error(`Unexpected response type: ${response.mimeType}`);
			}
			if (response.data === "") {
				throw new Error("Empty response body when fetching search results");
			}
			if (isRateLimitedPage(response.data)) {
				this.logger?.debug(
					`[SearchSession] 触发站点搜索限流，准备重试: keyword=${JSON.stringify(keyword)} attempt=${attempt + 1}/${MAX_RATE_LIMIT_ATTEMPTS} duration=${this.lastSearchAt - requestStartAt}ms`,
				);
				continue;
			}
			if (isVerificationPage(response.data)) {
				this.logger?.debug(
					`[SearchSession] 触发搜索验证页，开始自动识别验证码: keyword=${JSON.stringify(keyword)} duration=${this.lastSearchAt - requestStartAt}ms`,
				);
				return await this.verifySearch(response.data);
			}
			this.logger?.debug(
				`[SearchSession] 搜索请求成功（免验证态）: keyword=${JSON.stringify(keyword)} htmlLength=${response.data.length} duration=${this.lastSearchAt - requestStartAt}ms`,
			);
			return response.data;
		}

		throw new SearchRateLimitError(
			`搜索请求被站点限流，已重试 ${MAX_RATE_LIMIT_ATTEMPTS} 次`,
		);
	}

	private async verifySearch(verificationHtml: string): Promise<string> {
		let currentHtml = verificationHtml;

		for (let attempt = 0; attempt < MAX_VERIFICATION_ATTEMPTS; attempt++) {
			const $ = load(currentHtml);
			const challenge = $("input[name=search_challenge]").attr("value");
			const searchkey = $("input[name=searchkey]").attr("value");
			const searchtype = $("input[name=searchtype]").attr("value") ?? "all";
			const imageSrc = $("#search-captcha").attr("src");

			if (!challenge || !imageSrc || !searchkey) {
				throw new SearchVerificationError("无法解析搜索验证码页面");
			}

			const imageUrl = new URL(imageSrc, SEARCH_URL).toString();
			this.logger?.debug(
				`[SearchSession] 开始获取搜索验证码图片: attempt=${attempt + 1}/${MAX_VERIFICATION_ATTEMPTS} url=${imageUrl}`,
			);
			const image = await this.fetchClient.binary(imageUrl, {
				headers: searchRefererHeaders,
			});
			if (!image.mimeType.startsWith("image/")) {
				throw new SearchVerificationError(
					`验证码图片响应类型异常: ${image.mimeType}`,
				);
			}
			this.logger?.debug(
				`[SearchSession] 验证码图片已获取: attempt=${attempt + 1}/${MAX_VERIFICATION_ATTEMPTS} mimeType=${image.mimeType} bytes=${image.data.length}`,
			);

			let code: string;
			try {
				code = await solveCaptcha(image.data, this.logger);
			} catch (error) {
				throw new SearchVerificationError(
					`验证码识别失败: ${error instanceof Error ? error.message : String(error)}`,
				);
			}

			await this.waitForSearchSlot();
			const submitStartAt = Date.now();
			this.logger?.debug(
				`[SearchSession] 提交搜索验证码: attempt=${attempt + 1}/${MAX_VERIFICATION_ATTEMPTS} code=${JSON.stringify(code)}`,
			);
			const response = await this.fetchClient.text(SEARCH_URL, {
				method: "POST",
				body: new URLSearchParams({
					searchkey,
					searchtype,
					search_challenge: challenge,
					search_code: code,
				}),
				headers: searchRefererHeaders,
			});
			this.lastSearchAt = Date.now();

			if (response.mimeType !== "text/html") {
				throw new Error(`Unexpected response type: ${response.mimeType}`);
			}

			if (!isVerificationPage(response.data)) {
				this.logger?.debug(
					`[SearchSession] 搜索验证通过: attempt=${attempt + 1}/${MAX_VERIFICATION_ATTEMPTS} htmlLength=${response.data.length} duration=${this.lastSearchAt - submitStartAt}ms`,
				);
				return response.data;
			}
			this.logger?.debug(
				`[SearchSession] 搜索验证未通过（验证码错误或过期），准备重试: attempt=${attempt + 1}/${MAX_VERIFICATION_ATTEMPTS} code=${JSON.stringify(code)} duration=${this.lastSearchAt - submitStartAt}ms`,
			);
			// 验证码错误或过期，页面会带上一张新的验证码，换一张重试。
			currentHtml = response.data;
		}

		throw new SearchVerificationError(
			`搜索验证码连续识别失败（已尝试 ${MAX_VERIFICATION_ATTEMPTS} 次）`,
		);
	}

	private async waitForSearchSlot(): Promise<void> {
		const elapsed = Date.now() - this.lastSearchAt;
		if (elapsed < MIN_SEARCH_INTERVAL_MS) {
			const waitMs = MIN_SEARCH_INTERVAL_MS - elapsed;
			this.logger?.debug(
				`[SearchSession] 距离上次搜索间隔 ${elapsed}ms (< ${MIN_SEARCH_INTERVAL_MS}ms)，等待 ${waitMs}ms`,
			);
			await sleep(waitMs);
		}
	}
}

export async function searchNovelsV3(
	keyword: string,
	_fetchClient: BrowserFetchClient,
	session: SearchSession,
): Promise<NovelSearchResult[]> {
	return await session.search(keyword);
}
