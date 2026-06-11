import type { AutoSolvePolicy, ChallengeOptions } from "./challenge";
import type { CookieStoreOptions } from "./cookies";
import type { FlareSolverrOptions } from "./flaresolverr";
import type { BrowserProfile, BrowserProfileName } from "./profile";
import type { Transport } from "./transport/types";
import type { ContentTypeInfo } from "./utils";

export type ProxyOptions = {
	http?: string;
	https?: string;
};
export type HttpMethod =
	| "GET"
	| "POST"
	| "PUT"
	| "DELETE"
	| "PATCH"
	| "HEAD"
	| "OPTIONS";

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
	headers: Map<string, string>;
	cookies: Map<string, string>;
	body: string | Buffer;
	contentType?: ContentTypeInfo | undefined;
	elapsedTime?: number | undefined;
}

export type TextResponse = {
	data: string;
	mimeType: string;
};

export type BinaryResponse = {
	mimeType: string;
	data: Buffer;
};
