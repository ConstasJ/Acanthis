import type { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
import { type NovelSearchResult, runTimeout } from "@acanthis-dec/core";
import { Mutex } from "async-mutex";
import { load } from "cheerio";
import { parseBookHtml, parseSearchHtml } from "./common";

export async function refreshSearchTicket(
	fetchClient: BrowserFetchClient,
): Promise<void> {
	await fetchClient.text("https://www.linovelib.com/S6/?search_guard=css", {
		headers: {
			origin: "https://www.linovelib.com",
			referer: "https://www.linovelib.com/",
			"Sec-Fetch-Site": "same-origin",
		},
	});
	const guardJsResp = await fetchClient.text(
		"https://www.linovelib.com/S6/?search_guard=js",
		{
			headers: {
				origin: "https://www.linovelib.com",
				referer: "https://www.linovelib.com/",
				"Sec-Fetch-Site": "same-origin",
			},
		},
	);
	if (guardJsResp.mimeType !== "text/javascript") {
		throw new Error(`Unexpected response type: ${guardJsResp.mimeType}`);
	}
	const guardJsToken = guardJsResp.data.match(/jieqiSearchJs=([^;"]+)/)?.[1];
	if (!guardJsToken) {
		throw new Error(
			"Failed to extract jieqiSearchJs token from guard JS response",
		);
	}
	await fetchClient.cookieStore.set("jieqiSearchJs", guardJsToken, {
		domain: "www.linovelib.com",
		path: "/",
		maxAge: 3600,
		sameSite: "Lax",
		secure: true,
		httpOnly: true,
	});
	const request = async () =>
		fetchClient.text(
			`https://www.linovelib.com/S6/?search_guard=redeem&r=${Date.now()}`,
			{
				headers: {
					origin: "https://www.linovelib.com",
					referer: "https://www.linovelib.com/",
					"Sec-Fetch-Site": "same-origin",
				},
			},
		);
	await runTimeout(request, 120);
	await runTimeout(request, 800);
	await runTimeout(request, 2000);
}

export class SearchTicketManager {
	private mutex = new Mutex();
	private readonly ticketCookieKey = "jieqiSearchTicket";
	private readonly domain = "www.linovelib.com";
	private prefetching = false;

	constructor(private fetchClient: BrowserFetchClient) {}

	private async hasValidTicket(): Promise<boolean> {
		const cookies = await this.fetchClient.cookieStore.getForUrl(
			`https://${this.domain}/`,
		);
		return cookies.some((c) => c.name === this.ticketCookieKey);
	}

	private async consumeTicket(): Promise<void> {
		await this.fetchClient.cookieStore.delete(
			this.ticketCookieKey,
			this.domain,
		);
	}

	/**
	 * 唯一入口:确保 ticket 存在 -> 执行业务请求 -> 消费(清空) ticket。
	 * 整个过程串行、互斥,同一时刻只允许一个调用在跑。
	 */
	async runExclusive<T>(task: () => Promise<T>): Promise<T> {
		return this.mutex.runExclusive(async () => {
			if (!(await this.hasValidTicket())) {
				await refreshSearchTicket(this.fetchClient);
			}

			const result = await task();

			// 请求成功后:旧票作废,同时不阻塞地预取下一张票
			await this.consumeTicket();
			this.schedulePrefetch(); // 不 await!

			return result;
		});
	}
	/**
	 * 后台预取:模拟源站"成功页面里嵌入 refresh 逻辑"的行为。
	 * 不在调用方持有的锁内执行,而是自己重新抢锁,
	 * 这样不会拖慢刚刚那次请求的 return。
	 */
	private schedulePrefetch(): void {
		if (this.prefetching) return; // 已经有一个在跑,不重复触发
		this.prefetching = true;

		this.mutex
			.runExclusive(async () => {
				// 双重检查:等到真正拿到锁时,可能已经被别的调用刷新过了
				if (await this.hasValidTicket()) return;
				await refreshSearchTicket(this.fetchClient);
			})
			.catch((err) => {
				// prefetch 失败不影响主流程,只记录,不往外抛
				// 下次真正需要 ticket 时 ensureToken 会自然重试
				console.error("[SearchTicketManager] prefetch failed:", err);
			})
			.finally(() => {
				this.prefetching = false;
			});
	}
}

async function obtainFromNextPage(
	path: string,
	fetchClient: BrowserFetchClient,
	ticketManager: SearchTicketManager,
): Promise<NovelSearchResult[]> {
	const html = await ticketManager.runExclusive(async () => {
		const response = await fetchClient.text(
			`https://www.linovelib.com${path}`,
			{
				headers: {
					origin: "https://www.linovelib.com",
					referer: "https://www.linovelib.com/S6/",
				},
			},
		);
		if (response.mimeType !== "text/html") {
			throw new Error(`Unexpected response type: ${response.mimeType}`);
		}
		return response.data;
	});
	const $ = load(html);
	const results: NovelSearchResult[] = [];
	results.push(...parseSearchHtml($));
	results.push(
		...(await obtainFromNextPage(
			$("a.next").attr("href") || "",
			fetchClient,
			ticketManager,
		)),
	);
	return results;
}

export async function searchNovelsV2(
	keyword: string,
	fetchClient: BrowserFetchClient,
	ticketManager: SearchTicketManager,
): Promise<NovelSearchResult[]> {
	const searchHtml = await ticketManager.runExclusive(async () => {
		const tr = await fetchClient.text("https://www.linovelib.com/S6/", {
			method: "POST",
			body: new URLSearchParams({
				searchkey: keyword,
			}),
			headers: {
				origin: "https://www.linovelib.com",
				referer: "https://www.linovelib.com/",
			},
		});
		if (tr?.mimeType !== "text/html") {
			throw new Error(`Unexpected response type: ${tr?.mimeType}`);
		}
		return tr.data;
	});
	const results: NovelSearchResult[] = [];
	const $ = load(searchHtml);
	if ($("div.book-html-box").length > 0) {
		return [parseBookHtml($)];
	}
	results.push(...parseSearchHtml($));
	const pages =
		$("em#pagestats")
			.text()
			.match(/1\/(\d+)/)?.[1] || "1";
	if (Number(pages) > 1) {
		results.push(
			...(await obtainFromNextPage(
				$("a.next").attr("href") || "",
				fetchClient,
				ticketManager,
			)),
		);
	}
	return results;
}
