import { deepmerge } from "deepmerge-ts";
import pRetry from "p-retry";
import type z from "zod";
import {
	type ChallengeOptions,
	type CloudflareChallengeResult,
	detectCloudflareBlock,
	detectCloudflareChallenge,
	getDetector,
	solveCloudflareChallenge,
} from "./challenge";
import {
	type Cookie,
	type CookiesStore,
	FileCookiesStore,
	InMemoryCookiesStore,
} from "./cookies";
import {
	CloudflareBlockError,
	HttpStatusError,
	JSONParseError,
	SchemaValidationError,
	TypeNotMatchError,
} from "./errors";
import { FlareSolverrClient } from "./flaresolverr";
import { type BrowserProfile, parseBrowserProfile } from "./profile";
import { ImpersTransport } from "./transport/impers";
import type { Transport, TransportRequest } from "./transport/types";
import type {
	BinaryResponse,
	BrowserFetchClientOptions,
	BrowserFetchLogger,
	BrowserFetchRequest,
	BrowserFetchResponse,
	RequestDefaults,
	TextResponse,
} from "./types";
import {
	defaultRetryPolicy,
	extractContentType,
	iswwwFormUrlEncoded,
	wwwFormUrlEncodedToRecordStringString,
} from "./utils";

const defaultOptions: BrowserFetchClientOptions = {
	profile: "chrome-latest-linux",
	cookieStore: {
		type: "memory",
	},
	requestDefaults: {
		timeout: 30000,
		connectionTimeout: 15000,
		retry: {
			retries: 0,
			minRetryDelayMs: 1000,
			maxRetryDelayMs: 10000,
			randomize: true,
			factor: 2,
		},
		followRedirects: true,
		maxRedirects: 10,
	},
	challengeSolver: {
		autoSolve: "auto",
		detector: "cloudflare",
	},
	transport: new ImpersTransport({
		http2Multiplexing: true,
		maxConnections: 100,
		maxHostConnections: 10,
	}),
	flareSolverr: {
		enabled: false,
	},
};

export class BrowserFetchClient {
	private profile: BrowserProfile;
	cookieStore: CookiesStore;
	private flareSolverrClient: FlareSolverrClient | null = null;
	private proxy: string | undefined = undefined;
	private challengeSolver: ChallengeOptions | null = null;
	private requestDefaults: RequestDefaults;
	private transport: Transport;
	private logger?: BrowserFetchLogger | undefined;

	constructor(options?: Partial<BrowserFetchClientOptions>) {
		const { logger, ...mergeableOptions } = options ?? {};
		this.logger = logger;
		const mergedOptions = deepmerge(
			defaultOptions,
			mergeableOptions,
		) as BrowserFetchClientOptions;
		options = mergedOptions;
		if (options.profile) {
			this.profile =
				typeof options.profile === "string"
					? parseBrowserProfile(options.profile)
					: options.profile;
		} else {
			this.profile = parseBrowserProfile("chrome-latest-linux");
		}
		// Initialize cookie store based on options
		switch (options.cookieStore?.type) {
			case "memory":
				this.cookieStore = new InMemoryCookiesStore();
				break;
			case "file":
				if (!options.cookieStore?.path) {
					throw new Error("File cookie store requires a path");
				}
				this.cookieStore = new FileCookiesStore(options.cookieStore.path);
				break;
			case "custom":
				if (!options.cookieStore?.store) {
					throw new Error("Custom cookie store requires a store instance");
				}
				this.cookieStore = options.cookieStore.store;
				break;
			default:
				this.cookieStore = new InMemoryCookiesStore();
		}
		if (options.flareSolverr?.enabled) {
			this.flareSolverrClient = new FlareSolverrClient(options.flareSolverr);
		}
		if (options.proxy) {
			this.proxy = options.proxy;
		}
		if (options.challengeSolver) {
			this.challengeSolver = options.challengeSolver;
		}
		this.requestDefaults = options.requestDefaults || {};
		this.transport =
			options.transport ??
			new ImpersTransport({
				http2Multiplexing: true,
				maxConnections: 100,
				maxHostConnections: 10,
			});
	}

	private async _solveChallenge(
		url: string,
		method: "GET" | "POST",
		body?: unknown,
	): Promise<CloudflareChallengeResult> {
		if (!this.flareSolverrClient) {
			throw new Error(
				"Challenge solver is enabled, but FlareSolverr client is not configured.",
			);
		}
		if (method === "POST" && body && !iswwwFormUrlEncoded(body)) {
			throw new Error(
				"Require a www-form-urlencoded body to be present when solving POST challenges.",
			);
		}
		const bodyRecord = iswwwFormUrlEncoded(body)
			? wwwFormUrlEncodedToRecordStringString(body)
			: undefined;
		const startAt = Date.now();
		this.logger?.debug(
			`[BrowserFetch] 调用 FlareSolverr 求解验证: ${method} ${url}`,
		);
		const result = await solveCloudflareChallenge(
			url,
			method,
			this.flareSolverrClient,
			bodyRecord,
		);
		this.logger?.debug(
			`[BrowserFetch] FlareSolverr 求解完成: ${method} ${url} status=${result.status} cookies=${result.cookies.length} duration=${Date.now() - startAt}ms`,
		);
		return result;
	}

	private _buildResponseFromFlareSolverr(
		init: BrowserFetchRequest,
		result: CloudflareChallengeResult,
	): BrowserFetchResponse | null {
		if (init.responseType === "buffer") {
			return null;
		}
		if (result.status < 200 || result.status >= 300) {
			return null;
		}
		const rawBody = result.solution.response;
		if (
			typeof rawBody !== "string" ||
			rawBody.length === 0 ||
			detectCloudflareChallenge(result.status, rawBody) ||
			detectCloudflareBlock(result.status, rawBody)
		) {
			return null;
		}

		const headers = new Map<string, string>();
		let rawContentType: string | undefined;
		for (const [key, value] of Object.entries(result.solution.headers ?? {})) {
			headers.set(key, value);
			if (key.toLowerCase() === "content-type") {
				rawContentType = value;
			}
		}

		const fallbackContentType =
			init.responseType === "json"
				? "application/json; charset=utf-8"
				: "text/html; charset=utf-8";
		const contentType = extractContentType(
			rawContentType ?? fallbackContentType,
		);

		let body: string | unknown = rawBody;
		if (init.responseType === "json") {
			const preMatch = rawBody.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
			const candidate = (preMatch?.[1] ?? rawBody).trim();
			try {
				body = JSON.parse(candidate);
			} catch {
				return null;
			}
		} else if (init.responseType === "text" && !contentType.isText) {
			return null;
		}

		return {
			url: result.solution.url || init.url,
			status: result.status,
			headers,
			cookies: result.cookies,
			body,
			contentType,
			elapsedTime: result.elapsedTime,
		};
	}

	private async _request(
		init: BrowserFetchRequest,
		challengeRetried = false,
	): Promise<BrowserFetchResponse> {
		const storedCookies = await this.cookieStore.getForUrl(init.url);
		const cookies: Record<string, string> = {};
		storedCookies.forEach((cookie) => {
			cookies[cookie.name] = cookie.value;
		});
		if (init.cookies) {
			Object.assign(cookies, init.cookies);
		}
		const headers = {
			...this.profile.headers,
			...this.requestDefaults.headers,
			...init.headers,
			host: new URL(init.url).host,
		};

		if (
			this.challengeSolver &&
			this.challengeSolver.autoSolve === "force-refresh"
		) {
			const method = init.method === "POST" ? "POST" : "GET";
			const challengeResult = await this._solveChallenge(
				init.url,
				method,
				init.body,
			);
			const clearance = challengeResult.clearance;
			await this.cookieStore.set("cf_clearance", clearance.value, clearance);
			cookies.cf_clearance = clearance.value;
		}

		const transportRequest: TransportRequest = {
			url: init.url,
			method: init.method ?? "GET",
			headers,
			cookies,
			body: init.body,
			profile: this.profile,
			proxy: this.proxy ?? undefined,
			timeout: init.timeout ?? this.requestDefaults.timeout ?? 30000,
			connectionTimeout:
				init.connectionTimeout ??
				this.requestDefaults.connectionTimeout ??
				15000,
			followRedirects: init.followRedirects ?? true,
			maxRedirects: init.maxRedirects ?? 10,
			session: {
				isolation: "per-origin",
				mode: "reuse",
			},
			http: {
				version: "auto",
				defaultHeaders: false,
			},
		};

		const requestStartAt = Date.now();
		try {
			const response = await this.transport.request(transportRequest);
			const duration = response.elapsedTime ?? Date.now() - requestStartAt;
			this.logger?.debug(
				`[BrowserFetch] ${transportRequest.method} ${init.url} -> status=${response.status} type=${response.contentType?.mimeType ?? "unknown"} cookies=${response.cookies?.length ?? 0} duration=${duration}ms`,
			);

			// Update cookie store with any new cookies from the response
			if (response.cookies) {
				for (const cookie of response.cookies) {
					if (cookie.maxAge) {
						if (cookie.maxAge <= 0) {
							if (cookie.maxAge === 0) {
								await this.cookieStore.delete(
									cookie.name,
									cookie.domain,
									cookie.path,
								);
							}
							continue;
						}
					}
					await this.cookieStore.set(cookie.name, cookie.value, {
						domain: cookie.domain,
						path: cookie.path,
						expires: cookie.expires,
						maxAge: cookie.maxAge,
						secure: cookie.secure,
						httpOnly: cookie.httpOnly,
						sameSite: cookie.sameSite ?? "Lax",
					});
				}
			}

			let parsedBody:
				| string
				| Buffer
				| Array<unknown>
				| Record<string, unknown>;

			if (response.contentType?.isText) {
				parsedBody = response.body.toString(response.contentType.charset);
			} else {
				parsedBody = response.body;
			}

			const browserFetchResponse: BrowserFetchResponse = {
				url: response.url,
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
				cookies: response.cookies,
				body: "",
				contentType: response.contentType,
				elapsedTime: response.elapsedTime,
			};

			switch (init.responseType) {
				case "json": {
					if (
						response.contentType?.isText &&
						response.contentType.mimeType.includes("json")
					) {
						try {
							const jsonText = response.body.toString(
								response.contentType.charset,
							);
							browserFetchResponse.body = JSON.parse(jsonText);
						} catch (error) {
							throw new JSONParseError(
								init.url,
								response.body.toString(),
								error instanceof Error ? error : undefined,
							);
						}
					} else {
						throw new TypeNotMatchError(
							init.url,
							"application/json",
							response.contentType?.mimeType ?? "unknown",
						);
					}
					break;
				}
				case "text": {
					if (response.contentType?.isText) {
						browserFetchResponse.body = response.body.toString(
							response.contentType.charset,
						);
					} else {
						throw new TypeNotMatchError(
							init.url,
							"text/*",
							response.contentType?.mimeType ?? "unknown",
						);
					}
					break;
				}
				case "buffer": {
					if (!response.contentType?.isText) {
						browserFetchResponse.body = response.body;
					} else {
						throw new TypeNotMatchError(
							init.url,
							"non-text content",
							response.contentType.mimeType,
						);
					}
					break;
				}
				default:
					browserFetchResponse.body = parsedBody;
			}

			return browserFetchResponse;
		} catch (error) {
			if (error instanceof HttpStatusError) {
				if (
					this.flareSolverrClient &&
					!challengeRetried &&
					this.challengeSolver &&
					this.challengeSolver.autoSolve === "auto"
				) {
					const detector = getDetector(this.challengeSolver);
					if (detector(error.status, error.responseText)) {
						const method = init.method === "POST" ? "POST" : "GET";
						this.logger?.debug(
							`[BrowserFetch] 检测到 Cloudflare 验证页: ${method} ${init.url} status=${error.status} duration=${Date.now() - requestStartAt}ms`,
						);
						const challengeResult = await this._solveChallenge(
							init.url,
							method,
							init.body,
						);
						const clearance = challengeResult.clearance;
						await this.cookieStore.set(
							"cf_clearance",
							clearance.value,
							clearance,
						);
						const directResponse = this._buildResponseFromFlareSolverr(
							init,
							challengeResult,
						);
						if (directResponse !== null) {
							this.logger?.debug(
								`[BrowserFetch] 直接复用 FlareSolverr 返回的响应体: ${method} ${init.url} status=${directResponse.status}`,
							);
							return directResponse;
						}
						this.logger?.debug(
							`[BrowserFetch] 携带新 cf_clearance 回放原请求: ${method} ${init.url}`,
						);
						// Fall back to replaying the original request (e.g. binary response or non-2xx solution)
						return await this._request(init, true);
					}
				}
				if (
					detectCloudflareBlock(error.status, error.responseText) ||
					detectCloudflareChallenge(error.status, error.responseText)
				) {
					this.logger?.debug(
						`[BrowserFetch] 请求被 Cloudflare 拦截: ${init.method ?? "GET"} ${init.url} status=${error.status} challengeRetried=${challengeRetried}`,
					);
					throw new CloudflareBlockError(init.url);
				}
				throw error;
			}
			throw error;
		}
	}

	async request(init: BrowserFetchRequest): Promise<BrowserFetchResponse> {
		const retries = {
			...this.requestDefaults.retry,
			...init.retry,
		};
		if (
			!retries ||
			Object.keys(retries).length === 0 ||
			retries.retries === 0
		) {
			return await this._request(init);
		}
		return await pRetry(() => this._request(init), {
			retries: retries.retries ?? 0,
			minTimeout: retries.minRetryDelayMs ?? 1000,
			maxTimeout: retries.maxRetryDelayMs ?? 10000,
			randomize: retries.randomize ?? true,
			factor: retries.factor ?? 2,
			onFailedAttempt: async (ctx) => {
				this.logger?.debug(
					`[BrowserFetch] 请求失败准备重试: ${init.method ?? "GET"} ${init.url} attempt=${ctx.attemptNumber} retriesLeft=${ctx.retriesLeft} error=${ctx.error.message}`,
				);
				if (retries.onFailedAttempt) {
					await retries.onFailedAttempt(ctx);
				}
			},
			shouldConsumeRetry: async (ctx) => {
				if (retries.shouldConsumeRetry) {
					return await retries.shouldConsumeRetry(ctx);
				} else return true;
			},
			shouldRetry: async (ctx) => {
				if (retries.shouldRetry) {
					return await retries.shouldRetry(ctx);
				} else {
					return defaultRetryPolicy(ctx);
				}
			},
		});
	}

	async text(
		url: string,
		options?: Omit<BrowserFetchRequest, "url" | "responseType">,
	): Promise<TextResponse> {
		const response = await this.request({
			url,
			...options,
			responseType: "text",
		});
		return {
			data: response.body as string,
			mimeType: response.contentType?.mimeType || "text/plain",
		};
	}

	async json<T>(
		url: string,
		options?: Omit<BrowserFetchRequest, "url" | "responseType">,
		schema?: z.ZodType<T>,
	): Promise<T> {
		const response = await this.request({
			url,
			...options,
			responseType: "json",
		});
		if (schema) {
			const parseResult = schema.safeParse(response.body);
			if (parseResult.success) {
				return parseResult.data;
			} else {
				throw new SchemaValidationError(
					url,
					typeof response.body === "string"
						? response.body
						: JSON.stringify(response.body),
					parseResult.error.issues,
				);
			}
		}
		return response.body as T;
	}

	async binary(
		url: string,
		options?: Omit<BrowserFetchRequest, "url" | "responseType">,
	): Promise<BinaryResponse> {
		const response = await this.request({
			url,
			...options,
			responseType: "buffer",
		});
		return {
			data: response.body as Buffer,
			mimeType: response.contentType?.mimeType || "application/octet-stream",
		};
	}

	async ensureClearance(
		url: string,
		method: "GET" | "POST",
		body?: unknown,
	): Promise<void> {
		const cookies = await this.cookieStore.getForUrl(url);
		if (cookies.findIndex((cookie) => cookie.name === "cf_clearance") !== -1) {
			return;
		}
		const { clearance } = await this._solveChallenge(url, method, body);
		await this.cookieStore.set("cf_clearance", clearance.value, clearance);
	}

	async refreshClearance(
		url: string,
		method: "GET" | "POST",
		body?: unknown,
	): Promise<void> {
		const { clearance } = await this._solveChallenge(url, method, body);
		await this.cookieStore.set("cf_clearance", clearance.value, clearance);
	}

	async getCookies(url: string): Promise<Cookie[]> {
		return await this.cookieStore.getForUrl(url);
	}

	async setCookies(cookies: Cookie[]): Promise<void> {
		for (const cookie of cookies) {
			await this.cookieStore.set(cookie.name, cookie.value, {
				domain: cookie.domain,
				path: cookie.path,
				expires: cookie.expires,
				httpOnly: cookie.httpOnly,
				secure: cookie.secure,
				sameSite: cookie.sameSite ?? "Lax",
			});
		}
	}

	async clearCookies(url: string | URL): Promise<void> {
		const parsedUrl = typeof url === "string" ? new URL(url) : url;
		const hostname = parsedUrl.hostname;
		const path = parsedUrl.pathname;
		await this.cookieStore.clear(hostname, path);
	}

	async close(): Promise<void> {
		await this.transport.close();
	}
}
