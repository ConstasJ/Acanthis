import { deepmerge } from "deepmerge-ts";
import pRetry from "p-retry";
import type z from "zod";
import {
	type ChallengeOptions,
	detectCloudflareBlock,
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
	FlareSolverrError,
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
	BrowserFetchRequest,
	BrowserFetchResponse,
	RequestDefaults,
	TextResponse,
} from "./types";
import {
	defaultRetryPolicy,
	iswwwFormUrlEncoded,
	wwwFormUrlEncodedToRecordStringString,
} from "./utils";

const defaultOptions: BrowserFetchClientOptions = {
	profile: "chrome149-linux",
	cookieStore: {
		type: "memory",
	},
	requestDefaults: {
		timeout: 30000,
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
	private cookieStore: CookiesStore;
	private flareSolverrClient: FlareSolverrClient | null = null;
	private proxy: string | undefined = undefined;
	private challengeSolver: ChallengeOptions | null = null;
	private requestDefaults: RequestDefaults;
	private transport: Transport;

	constructor(options?: Partial<BrowserFetchClientOptions>) {
		options = deepmerge(
			defaultOptions,
			options ?? {},
		) as BrowserFetchClientOptions;
		if (options.profile) {
			this.profile =
				typeof options.profile === "string"
					? parseBrowserProfile(options.profile)
					: options.profile;
		} else {
			this.profile = parseBrowserProfile("chrome149-linux");
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

	private async _getClearanceToken(
		url: string,
		method: "GET" | "POST",
		body?: unknown,
	): Promise<Cookie | null> {
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
		return await solveCloudflareChallenge(
			url,
			method,
			this.flareSolverrClient,
			bodyRecord,
		);
	}

	private async _request(
		init: BrowserFetchRequest,
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
		};

		if (
			this.challengeSolver &&
			this.challengeSolver.autoSolve === "force-refresh"
		) {
			const method = init.method === "POST" ? "POST" : "GET";
			const clearance = await this._getClearanceToken(
				init.url,
				method,
				init.body,
			);
			if (!clearance) {
				throw new Error(
					"Failed to obtain clearance token with 'force-refresh' policy.",
				);
			}
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
			timeout: init.timeout ?? this.requestDefaults.timeout ?? 0,
			connectionTimeout:
				init.connectionTimeout ??
				this.requestDefaults.connectionTimeout ??
				undefined,
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

		try {
			const response = await this.transport.request(transportRequest);

			// Update cookie store with any new cookies from the response
			if (response.cookies) {
				for (const cookie of response.cookies) {
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
				if (this.challengeSolver && this.challengeSolver.autoSolve === "auto") {
					const detector = getDetector(this.challengeSolver);
					if (detector(error.status, error.responseText)) {
						const method = init.method === "POST" ? "POST" : "GET";
						// Retry the original request after solving the challenge
						const clearance = await this._getClearanceToken(
							init.url,
							method,
							init.body,
						);
						if (clearance) {
							await this.cookieStore.set(
								"cf_clearance",
								clearance.value,
								clearance,
							);
							return await this._request(init);
						} else {
							throw new FlareSolverrError(
								this.flareSolverrClient?.host ?? "",
								"Failed to obtain clearance token during auto-solve.",
							);
						}
					}
				}
				if (detectCloudflareBlock(error.status, error.responseText)) {
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
			onFailedAttempt: (ctx) => {
				if (retries.onFailedAttempt) {
					retries.onFailedAttempt(ctx);
				}
			},
			shouldConsumeRetry: (ctx) => {
				if (retries.shouldConsumeRetry) {
					return retries.shouldConsumeRetry(ctx);
				} else return true;
			},
			shouldRetry: (ctx) => {
				if (retries.shouldRetry) {
					return retries.shouldRetry(ctx);
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
		const clearance = await this._getClearanceToken(url, method, body);
		if (clearance) {
			await this.cookieStore.set("cf_clearance", clearance.value, clearance);
		} else {
			throw new Error("Failed to obtain clearance token.");
		}
	}

	async refreshClearance(
		url: string,
		method: "GET" | "POST",
		body?: unknown,
	): Promise<void> {
		const clearance = await this._getClearanceToken(url, method, body);
		if (clearance) {
			await this.cookieStore.set("cf_clearance", clearance.value, clearance);
		} else {
			throw new Error("Failed to obtain clearance token.");
		}
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
