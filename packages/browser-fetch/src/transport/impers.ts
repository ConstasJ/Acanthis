import * as impers from "impers";
import type { Cookie } from "../cookies";
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

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_LOW_SPEED_LIMIT_BYTES_PER_SEC = 1024;
const DEFAULT_LOW_SPEED_TIME_SEC = 15;
const WATCHDOG_GRACE_MS = 5_000;

const RETRYABLE_CURL_ERROR_CODES = new Set<number>([
	impers.CurlCode.CURLE_WEIRD_SERVER_REPLY,
	impers.CurlCode.CURLE_HTTP2,
	impers.CurlCode.CURLE_PARTIAL_FILE,
	impers.CurlCode.CURLE_NO_CONNECTION_AVAILABLE,
	impers.CurlCode.CURLE_HTTP2_STREAM,
	impers.CurlCode.CURLE_HTTP3,
	impers.CurlCode.CURLE_QUIC_CONNECT_ERROR,
	impers.CurlCode.CURLE_UNRECOVERABLE_POLL,
]);

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
	private activeCounts = new Map<impers.Session, number>();
	private retiredSessions = new Set<impers.Session>();

	constructor(sessionOptions: SessionOptions) {
		this.sessionOptions = buildSessionOption(sessionOptions);
		this.sharedSession = new impers.Session(this.sessionOptions);
	}

	acquire(session: impers.Session): void {
		this.activeCounts.set(session, (this.activeCounts.get(session) ?? 0) + 1);
	}

	release(session: impers.Session): void {
		const current = this.activeCounts.get(session) ?? 0;
		if (current <= 1) {
			this.activeCounts.delete(session);
			if (this.retiredSessions.delete(session)) {
				void session.close().catch(() => {});
			}
		} else {
			this.activeCounts.set(session, current - 1);
		}
	}

	retireSession(key: TransportSessionKey, session: impers.Session): void {
		if (session === this.sharedSession) {
			return;
		}
		const keyStr = getKeyFromSessionKey(key);
		if (this.sessions.get(keyStr) === session) {
			this.sessions.delete(keyStr);
		}
		if ((this.activeCounts.get(session) ?? 0) === 0) {
			this.retiredSessions.delete(session);
			void session.close().catch(() => {});
		} else {
			this.retiredSessions.add(session);
		}
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
				const keyStr = getKeyFromSessionKey(key);
				const existingSession = this.sessions.get(keyStr);
				if (existingSession) {
					this.retireSession(key, existingSession);
				}
				const newSession = new impers.Session(this.sessionOptions);
				this.sessions.set(keyStr, newSession);
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
		for (const session of this.retiredSessions) {
			await session.close().catch(() => {});
		}
		this.retiredSessions.clear();
		this.activeCounts.clear();
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
			proxy: request.proxy ?? null,
		};
		const sessionPolicy = request.session ?? {
			mode: "reuse",
			isolation: "per-origin",
		};
		const session = this.sessionManager.getSession(sessionKey, sessionPolicy);

		const timeoutMs = request.timeout ?? DEFAULT_TIMEOUT_MS;
		const rawConnectTimeoutMs =
			request.connectionTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS;
		const connectTimeoutMs =
			timeoutMs > 0 && rawConnectTimeoutMs > 0
				? Math.min(rawConnectTimeoutMs, timeoutMs)
				: rawConnectTimeoutMs;

		const curlOptions: Record<number, unknown> = {
			[impers.CurlOpt.NOSIGNAL]: 1,
			[impers.CurlOpt.TCP_KEEPALIVE]: 1,
			[impers.CurlOpt.TCP_KEEPIDLE]: 30,
			[impers.CurlOpt.TCP_KEEPINTVL]: 15,
		};
		if (timeoutMs >= 5_000) {
			curlOptions[impers.CurlOpt.LOW_SPEED_LIMIT] =
				DEFAULT_LOW_SPEED_LIMIT_BYTES_PER_SEC;
			curlOptions[impers.CurlOpt.LOW_SPEED_TIME] = Math.min(
				DEFAULT_LOW_SPEED_TIME_SEC,
				Math.floor(timeoutMs / 1000),
			);
		}

		const impersRequest: impers.RequestOptions = {
			headers: request.headers ?? {},
			cookies: request.cookies ?? {},
			allowRedirects: request.followRedirects ?? true,
			maxRedirects: request.maxRedirects ?? 10,
			impersonate: request.tls?.impersonate
				? request.tls.impersonate
				: request.profile?.impersonate
					? request.profile.impersonate
					: "chrome",
			curlOptions,
		};
		if (timeoutMs > 0) {
			impersRequest.timeout = timeoutMs / 1000;
		}
		if (connectTimeoutMs > 0) {
			impersRequest.connectTimeout = connectTimeoutMs / 1000;
		}
		if (request.proxy) {
			impersRequest.proxy = request.proxy;
		}

		const watchdogController =
			timeoutMs > 0 ? new AbortController() : undefined;
		let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
		if (watchdogController) {
			watchdogTimer = setTimeout(() => {
				watchdogController.abort(
					new Error(`Request timed out after ${timeoutMs}ms`),
				);
			}, timeoutMs + WATCHDOG_GRACE_MS);
		}
		if (request.signal && watchdogController) {
			impersRequest.signal = AbortSignal.any([
				request.signal,
				watchdogController.signal,
			]);
		} else if (request.signal) {
			impersRequest.signal = request.signal;
		} else if (watchdogController) {
			impersRequest.signal = watchdogController.signal;
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

		const retireIfReusable = () => {
			if (
				sessionPolicy.mode === "reuse" &&
				(sessionPolicy.isolation ?? "per-origin") === "per-origin"
			) {
				this.sessionManager.retireSession(sessionKey, session);
			}
		};

		this.sessionManager.acquire(session);
		try {
			const impersResponse = await session.request(
				request.method,
				request.url,
				impersRequest,
			);
			impersResponse.raiseForStatus();
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
					const cookies: Cookie[] = [];
					const url = new URL(request.url);
					const hostname = url.hostname;
					const path = url.pathname || "/";
					for (const cookie of impersResponse.cookies) {
						cookies.push({
							name: cookie.name,
							value: cookie.value,
							domain: cookie.domain ?? hostname,
							path: cookie.path ?? path,
							expires: cookie.expires ? new Date(cookie.expires) : undefined,
							maxAge: cookie.maxAge ?? undefined,
							secure: cookie.secure,
							httpOnly: cookie.httpOnly,
							sameSite: cookie.sameSite ?? "Lax",
						});
					}
					return cookies;
				})(),
				contentType: extractContentType(
					impersResponse.contentType ?? "application/octet-stream",
				),
				body: impersResponse.content,
				elapsedTime: impersResponse.elapsed,
				reusedSession: sessionPolicy.mode === "reuse",
				sessionKey: getKeyFromSessionKey(sessionKey),
			};
		} catch (error) {
			if (watchdogController?.signal.aborted && !request.signal?.aborted) {
				retireIfReusable();
				throw new NetworkError(
					request.url,
					`Request timed out after ${timeoutMs}ms`,
				);
			}
			if (error instanceof impers.RequestException) {
				if (
					error instanceof impers.ConnectionError ||
					error instanceof impers.Timeout ||
					error instanceof impers.SSLError ||
					error instanceof impers.IncompleteRead ||
					(error instanceof impers.CurlError &&
						RETRYABLE_CURL_ERROR_CODES.has(error.code))
				) {
					retireIfReusable();
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
		} finally {
			if (watchdogTimer !== undefined) {
				clearTimeout(watchdogTimer);
			}
			this.sessionManager.release(session);
			if (sessionPolicy.mode === "fresh") {
				await session.close().catch(() => {});
			}
		}
	}

	async close(): Promise<void> {
		await this.sessionManager.close();
	}
}
