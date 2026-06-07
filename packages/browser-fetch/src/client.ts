import type { AutoSolvePolicy, ChallengeOptions } from "./challenge.js";
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
import type { ContentTypeInfo } from "./utils.js";

export type RequestDefaults = {
	headers?: Record<string, string>;
	timeout?: number;
	connectionTimeout?: number;
	retries?: number;
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
		this.transport = options.transport ?? new ImpersTransport({
			http2Multiplexing: true,
			maxConnections: 100,
			maxHostConnections: 10,
		})
	}

	async request(init: BrowserFetchRequest): Promise<BrowserFetchResponse> {
		const storedCookies = await this.cookieStore.getCookies(new URL(init.url).origin);
		const cookies = { ...storedCookies, ...init.cookies };
		const headers = { ...this.profile.headers, ...this.requestDefaults.headers, ...init.headers };

		const transportRequest: TransportRequest = {
			url: init.url,
			method: init.method ?? "GET",
			headers,
			cookies,
			body: init.body,
			profile: this.profile,
			proxy: this.proxy ?? undefined,
			timeout: init.timeout ?? this.requestDefaults.timeout ?? 0,
			connectionTimeout: init.connectionTimeout ?? this.requestDefaults.connectionTimeout ?? undefined,
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
			await this.cookieStore.setCookies(new URL(init.url).origin, response.cookies);
		}

		return {
			url: response.url,
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
			cookies: response.cookies,
			body: response.body,
			contentType: response.contentType,
			elapsedTime: response.elapsedTime,
		}
	}
}
