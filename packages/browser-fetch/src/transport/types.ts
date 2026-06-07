import type { BrowserProfile } from "@/profile.js";
import type { HttpMethod, ProxyOptions } from "@/types.js";

export type TransportSessionKey = {
	origin: string;
	profile: string;
	proxy: string | null;
	tlsFingerprint: string;
};

export type TransportSessionPolicy = {
	mode: "reuse" | "fresh" | "reset";
	isolation?: "per-origin" | "shared";
};

export type TransportTLSOptions = {
	impersonate?: string;
	ja3?: string;
	akamai?: string;
	extraFp?: unknown;

	verify?: boolean;
	caCert?: string;

	pskPolicy?: "browser-like" | "disable-reuse" | "force-new-context";
};

export type TransportHttpOptions = {
	version?: "1.1" | "2" | "3" | "auto";
	http2Multiplexing?: boolean;
};

export type TransportRequest = {
	url: string;
	method: HttpMethod;
	headers?: Record<string, string>;
	cookies?: Record<string, string>;
	body?: string | Buffer | URLSearchParams;
	profile?: BrowserProfile;
	proxy?: ProxyOptions;
	timeout?: number;
	connectionTimeout?: number;
	followRedirects?: boolean;
	maxRedirects?: number;
	session?: TransportSessionPolicy;
	tls?: TransportTLSOptions;
	http?: TransportHttpOptions;
};

export type TransportResponse = {
	url: string;
	finalUrl: string;

	status: number;
	statusText: string;

	headers: Record<string, string>;
	cookies: Record<string, string>;

	body: Buffer;

	elapsedTime: number;
	reusedSession: boolean;
	sessionKey?: string;
};

export interface Transport {
	request(options: TransportRequest): Promise<TransportResponse>;

	close(): Promise<void>;

	closeContext?(key: string): Promise<void>;
}
