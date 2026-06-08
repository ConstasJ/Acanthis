import {
	type AutoSolvePolicy,
	type ChallengeOptions,
	getDetector,
	solveCloudflareChallenge,
} from "./challenge.js";
import {
	type CookieStore,
	type CookieStoreOptions,
	FileCookieStore,
	InMemoryCookieStore,
} from "./cookies.js";
import {
	FlareSolverrClient,
	type FlareSolverrOptions,
} from "./flaresolverr.js";
import {
	type BrowserProfile,
	type BrowserProfileName,
	parseBrowserProfile,
} from "./profile.js";
import { ImpersTransport } from "./transport/impers.js";
import type { Transport, TransportRequest } from "./transport/types.js";
import type { HttpMethod, ProxyOptions } from "./types.js";
import {
	type ContentTypeInfo,
	iswwwFormUrlEncoded,
	type WWWFormUrlEncodedBody,
	wwwFormUrlEncodedToRecordStringString,
} from "./utils.js";

export type RequestDefaults = {
	headers?: Record<string, string>;
	timeout?: number;
	connectionTimeout?: number;
	retries?: number;
	retryDelayMs?: number;
	followRedirects?: boolean;
	maxRedirects?: number;
};

export type BrowserFetchClientOptions = {
	profile?: BrowserProfileName | BrowserProfile;
	cookieStore?: CookieStoreOptions;
	flareSolverr?: FlareSolverrOptions;
	proxy?: ProxyOptions;
	challengeSolver?: ChallengeOptions;
	requestDefaults?: RequestDefaults;
	transport?: Transport;
};

export type BrowserFetchRequest = {
	url: string;
	method?: HttpMethod;
	headers?: Record<string, string>;
	body?:
		| string
		| Buffer
		| URLSearchParams
		| FormData
		| Record<string, string>
		| unknown;
	cookies?: Record<string, string>;
	profile?: BrowserProfileName | BrowserProfile;
	responseType?: "text" | "json" | "buffer";
	timeout?: number;
	connectionTimeout?: number;
	retries?: number;
	retryDelayMs?: number;
	followRedirects?: boolean;
	maxRedirects?: number;
	challengePolicy?: AutoSolvePolicy;
};

export interface BrowserFetchResponse {
	url: string;
	status: number;
	statusText?: string;
	headers: Record<string, string>;
	cookies: Record<string, string>;
	body: string | Buffer;
	contentType?: ContentTypeInfo | undefined;
	elapsedTime?: number | undefined;
}

export type BinaryResponse = {
	mimeType: string;
	data: Buffer;
}

export class BrowserFetchClient {
	private profile: BrowserProfile;
	private cookieStore: CookieStore;
	private flareSolverrClient: FlareSolverrClient | null = null;
	private proxy: ProxyOptions | null = null;
	private challengeSolver: ChallengeOptions | null = null;
	private requestDefaults: RequestDefaults;
	private transport: Transport;

	constructor(options: BrowserFetchClientOptions) {
		if (options.profile) {
			this.profile =
				typeof options.profile === "string"
					? parseBrowserProfile(options.profile)
					: options.profile;
		} else {
			this.profile = parseBrowserProfile("chrome146-linux");
		}
		// Initialize cookie store based on options
		switch (options.cookieStore?.type) {
			case "memory":
				this.cookieStore = new InMemoryCookieStore();
				break;
			case "file":
				if (!options.cookieStore?.path) {
					throw new Error("File cookie store requires a path");
				}
				this.cookieStore = new FileCookieStore(options.cookieStore.path);
				break;
			default:
				throw new Error(
					`Unsupported cookie store type: ${options.cookieStore?.type}`,
				);
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

	private async _getClearanceToken(url: string, method: "GET" | "POST", body?: unknown): Promise<string> {
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
		return await solveCloudflareChallenge(url, method, this.flareSolverrClient, bodyRecord);
	}

	private async _request(init: BrowserFetchRequest): Promise<BrowserFetchResponse> {
		const storedCookies = await this.cookieStore.getCookies(
			new URL(init.url).origin,
		);
		const cookies = { ...storedCookies, ...init.cookies };
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
			const clearance = await this._getClearanceToken(init.url, method, init.body);
			if (!clearance) {
				throw new Error(
					"Failed to obtain clearance token with 'force-refresh' policy.",
				);
			}
			cookies.cf_clearance = clearance;
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

		const response = await this.transport.request(transportRequest);

		// Update cookie store with any new cookies from the response
		if (response.cookies) {
			await this.cookieStore.setCookies(
				new URL(init.url).origin,
				response.cookies,
			);
		}

		let body: string | Buffer;

		if (response.contentType?.isText) {
			body = response.body.toString(response.contentType.charset);
		} else {
			body = response.body;
		}

		if (this.challengeSolver && this.challengeSolver.autoSolve === "auto") {
			const detector = getDetector(this.challengeSolver);
			if (
				typeof body === "string" &&
				response.contentType?.mimeType.includes("text/html") &&
				detector(response.status, body)
			) {
				const method = init.method === "POST" ? "POST" : "GET";
				// Retry the original request after solving the challenge
				const clearance = await this._getClearanceToken(init.url, method, init.body);
				if (clearance) {
					const newInit = init;
					newInit.cookies = {
						...newInit.cookies,
						cf_clearance: clearance,
					};
					return await this._request(newInit);
				} else {
					throw new Error(
						"Failed to obtain clearance token after solving challenge.",
					);
				}
			}
		}

		return {
			url: response.url,
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
			cookies: response.cookies,
			body: body,
			contentType: response.contentType,
			elapsedTime: response.elapsedTime,
		};
	}

	async request(init: BrowserFetchRequest): Promise<BrowserFetchResponse> {
		let attempts = 0;
		const maxRetries = init.retries ?? this.requestDefaults.retries ?? 0;
		const retryDelayMs =
			init.retryDelayMs ?? this.requestDefaults.retryDelayMs ?? 1000;
			
		while (true) {
			try {
				return await this._request(init);
			} catch (error) {
				if (attempts < maxRetries) {
					attempts++;
					await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
				} else {
					throw error;
				}
			}
		}
	}

	async text(url: string, options?: Omit<BrowserFetchRequest, "url" | "responseType">): Promise<string> {
		const response = await this.request({ url, ...options, responseType: "text" });
		if (typeof response.body === "string") {
			return response.body;
		} else {
			throw new Error("Response body is not a string");
		}
	}

	async json(url: string, options?: Omit<BrowserFetchRequest, "url" | "responseType">): Promise<unknown> {
		const response = await this.request({ url, ...options, responseType: "text" });
		if (typeof response.body === "string") {
			try {
				return JSON.parse(response.body);
			} catch (error) {
				throw new Error(`Failed to parse JSON response: ${error}`);
			}
		} else {
			throw new Error("Response body is not a string");
		}
	}

	async binary(url: string, options?: Omit<BrowserFetchRequest, "url" | "responseType">): Promise<BinaryResponse> {
		const response = await this.request({ url, ...options, responseType: "buffer" });
		if (Buffer.isBuffer(response.body)) {
			return {
				mimeType: response.contentType?.mimeType || "application/octet-stream",
				data: response.body
			};
		} else {
			throw new Error("Response body is not a buffer");
		}
	}
}
