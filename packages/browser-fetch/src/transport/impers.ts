import * as impers from "@constasj/impers";
import { HttpStatusError, NetworkError } from "../errors";
import {
	extractContentType,
	isFormUrlEncoded,
	isJSON,
	isRecordStringString,
} from "../utils";
import type {
	Transport,
	TransportRequest,
	TransportResponse,
	TransportSessionKey,
	TransportSessionPolicy,
} from "./types";

export type SessionOptions = {
	maxConnections?: number;
	maxHostConnections?: number;
	http2Multiplexing?: boolean;
};

function getKeyFromSessionKey(sessionKey: TransportSessionKey): string {
	return `${sessionKey.origin}|${sessionKey.profile}|${sessionKey.proxy ?? "null"}`;
}

function buildSessionOption(options: SessionOptions): impers.SessionOptions {
	const sessionOptions: impers.SessionOptions = {};
	if (options.maxConnections !== undefined) {
		sessionOptions.maxConnections = options.maxConnections;
	}
	if (options.maxHostConnections !== undefined) {
		sessionOptions.maxHostConnections = options.maxHostConnections;
	}
	if (options.http2Multiplexing !== undefined) {
		sessionOptions.http2Multiplexing = options.http2Multiplexing;
	}
	return sessionOptions;
}

class SessionManager {
	private sessions: Map<string, impers.Session> = new Map();
	private sharedSession: impers.Session;
	private sessionOptions: impers.SessionOptions;

	constructor(sessionOptions: SessionOptions) {
		this.sessionOptions = buildSessionOption(sessionOptions);
		this.sharedSession = new impers.Session(this.sessionOptions);
	}

	getSession(
		key: TransportSessionKey,
		policy: TransportSessionPolicy,
	): impers.Session {
		switch (policy.mode) {
			case "reuse": {
				if (policy.isolation === "per-origin") {
					const existingSession = this.sessions.get(getKeyFromSessionKey(key));
					if (existingSession) {
						return existingSession;
					} else {
						const newSession = new impers.Session(this.sessionOptions);
						this.sessions.set(getKeyFromSessionKey(key), newSession);
						return newSession;
					}
				} else {
					return this.sharedSession;
				}
			}
			case "fresh": {
				return new impers.Session(this.sessionOptions);
			}
			case "reset": {
				const newSession = new impers.Session(this.sessionOptions);
				this.sessions.set(getKeyFromSessionKey(key), newSession);
				return newSession;
			}
		}
	}

	async closeContext(key: string): Promise<void> {
		const session = this.sessions.get(key);
		if (session) {
			await session.close();
			this.sessions.delete(key);
		}
	}

	async close(): Promise<void> {
		await this.sharedSession.close();
		for (const session of this.sessions.values()) {
			await session.close();
		}
		this.sessions.clear();
	}
}

export class ImpersTransport implements Transport {
	private sessionManager: SessionManager;

	constructor(sessionOptions: SessionOptions = {}) {
		this.sessionManager = new SessionManager(sessionOptions);
	}

	async request(request: TransportRequest): Promise<TransportResponse> {
		const sessionKey: TransportSessionKey = {
			origin: new URL(request.url).origin,
			profile: request.profile ? request.profile.name : "default",
			proxy: request.proxy?.http ?? null,
		};
		const session = this.sessionManager.getSession(
			sessionKey,
			request.session ?? { mode: "reuse", isolation: "per-origin" },
		);

		const impersRequest: impers.RequestOptions = {
			headers: request.headers ?? {},
			cookies: request.cookies ?? {},
			timeout: request.timeout ?? 60000,
			connectTimeout: request.connectionTimeout ?? 60000,
			allowRedirects: request.followRedirects ?? true,
			maxRedirects: request.maxRedirects ?? 10,
			impersonate: request.tls?.impersonate
				? request.tls.impersonate
				: request.profile?.impersonate
					? request.profile.impersonate
					: "chrome",
		};
		if (request.signal) {
			impersRequest.signal = request.signal;
		}
		if (request.tls) {
			if (request.tls.ja3) {
				impersRequest.ja3 = request.tls.ja3;
			}
			if (request.tls.akamai) {
				impersRequest.akamai = request.tls.akamai;
			}
			if (request.tls.extraFp) {
				impersRequest.extraFp = request.tls.extraFp;
			}
			if (request.tls.verify === false) {
				impersRequest.verify = false;
			}
			if (request.tls.caCert) {
				impersRequest.caCert = request.tls.caCert;
			}
		}
		if (request.http) {
			if (request.http.version && request.http.version !== "auto") {
				impersRequest.httpVersion = request.http.version;
			}
			if (request.http.defaultHeaders === false) {
				impersRequest.defaultHeaders = false;
			}
		}
		switch (typeof request.body) {
			case "string":
				if (isJSON(request.body)) {
					impersRequest.json = JSON.parse(request.body);
				} else if (isFormUrlEncoded(request.body)) {
					impersRequest.data = new URLSearchParams(request.body);
				} else {
					impersRequest.content = request.body;
				}
				break;
			case "object":
				if (request.body instanceof URLSearchParams) {
					impersRequest.data = request.body;
				} else if (request.body instanceof FormData) {
					impersRequest.data = new URLSearchParams(
						request.body as unknown as Record<string, string>,
					);
				} else if (Buffer.isBuffer(request.body)) {
					impersRequest.content = request.body;
				} else if (isRecordStringString(request.body)) {
					impersRequest.data = new URLSearchParams(
						request.body as Record<string, string>,
					);
				} else {
					impersRequest.json = request.body;
				}
				break;
		}

		try {
			const impersResponse = await session.request(
				request.method,
				request.url,
				impersRequest,
			);
			impersResponse.raiseForStatus();
			if (request.session?.mode === "fresh") {
				await session.close();
			}
			return {
				url: request.url,
				finalUrl: impersResponse.url,
				status: impersResponse.status,
				statusText: impersResponse.statusText,
				headers: (() => {
					const headers: Map<string, string> = new Map();
					for (const [key, value] of impersResponse.headers.entries()) {
						headers.set(key, value);
					}
					return headers;
				})(),
				cookies: (() => {
					const cookies: Map<string, string> = new Map();
					for (const [key, value] of impersResponse.cookies.entries()) {
						cookies.set(key, value);
					}
					return cookies;
				})(),
				contentType: extractContentType(
					impersResponse.contentType ?? "application/octet-stream",
				),
				body: impersResponse.content,
				elapsedTime: impersResponse.elapsed,
				reusedSession: request.session?.mode === "reuse",
				sessionKey: getKeyFromSessionKey(sessionKey),
			};
		} catch (error) {
			if (error instanceof impers.RequestException) {
				if (
					error instanceof impers.ConnectionError ||
					error instanceof impers.Timeout ||
					error instanceof impers.SSLError
				) {
					throw new NetworkError(request.url, error.message);
				}
			}
			if (error instanceof impers.HTTPError) {
				const responseText = error.response
					? ((error.response as impers.Response).text ?? "")
					: "";
				throw new HttpStatusError(error.statusCode, request.url, responseText);
			}
			throw error;
		}
	}

	async close(): Promise<void> {
		await this.sessionManager.close();
	}
}
