import type { BrowserProfile } from "@/profile";
import type { HttpMethod, ProxyOptions } from "@/types";
import type { ContentTypeInfo } from "@/utils";

export type TransportSessionKey = {
	origin: string;
	profile: string;
	proxy: string | null;
};

export type TransportSessionPolicy = {
	mode: "reuse" | "fresh" | "reset";
	isolation?: "per-origin" | "shared";
};

export interface ExtraFingerprint {
	tlsExtensionOrder?: number[];
	tlsSigAlgs?: string[];
	tlsSupportedGroups?: string[];
	http2Settings?: Record<string, number>;
	http2WindowUpdate?: number;
	http2PseudoHeaderOrder?: string[];
	http2ConnectionFlow?: number;
}

export type TransportTLSOptions = {
	impersonate?: string;
	ja3?: string;
	akamai?: string;
	extraFp?: ExtraFingerprint;

	verify?: boolean;
	caCert?: string;

	pskPolicy?: "browser-like" | "disable-reuse" | "force-new-context";
};

export type TransportHttpOptions = {
	version?: "1.1" | "2" | "3" | "auto";
	defaultHeaders?: boolean;
};

export type TransportRequest = {
	url: string;
	method: HttpMethod;
	headers?: Record<string, string> | undefined;
	cookies?: Record<string, string> | undefined;
	body?:
		| string
		| Buffer
		| URLSearchParams
		| FormData
		| Record<string, string>
		| unknown;
	signal?: AbortSignal | undefined;
	profile?: BrowserProfile | undefined;
	proxy?: ProxyOptions | undefined;
	timeout?: number;
	connectionTimeout?: number | undefined;
	followRedirects?: boolean | undefined;
	maxRedirects?: number | undefined;
	session?: TransportSessionPolicy | undefined;
	tls?: TransportTLSOptions | undefined;
	http?: TransportHttpOptions | undefined;
};

export type TransportResponse = {
	url: string;
	finalUrl: string;

	status: number;
	statusText: string;

	headers: Map<string, string>;
	cookies: Map<string, string>;

	contentType?: ContentTypeInfo;
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
