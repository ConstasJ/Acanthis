import type { ChallengeOptions } from "./challenge.js";
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

export type ProxyOptions = {
	http?: string;
	https?: string;
};

export type RequestDefaults = {
	headers?: Record<string, string>;
	timeout?: number;
	retries?: number;
}

export type BrowserFetchClientOptions = {
	profile?: BrowserProfileName | BrowserProfile;
	cookieStore?: CookieStoreOptions;
	flareSolverr?: FlareSolverrOptions;
	proxy?: ProxyOptions;
	challengeSolver?: ChallengeOptions;
	requestDefaults?: RequestDefaults;
};

export class BrowserFetchClient {
	private profile: BrowserProfile;
	private cookieStore: CookieStore;
	private flareSolverrClient: FlareSolverrClient | null = null;
	private proxy: ProxyOptions | null = null;
	private challengeSolver: ChallengeOptions | null = null;
	private requestDefaults: RequestDefaults;

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
	}
}
