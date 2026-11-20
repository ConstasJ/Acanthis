import { FlareSolverrError } from "./errors";

export type FlareSolverrOptions =
	| {
			enabled: true;
			host: string;
			sessionId?: string;
			timeoutMs?: number;
	  }
	| {
			enabled: false;
	  };

export type FlareSolverrCookie = {
	name: string;
	value: string;
	domain: string;
	path: string;
	expiry: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "Strict" | "Lax" | "None";
};

export type FlareSolverrSolution = {
	url: string;
	status: string;
	userAgent: string;
	response: string;
	cookies: FlareSolverrCookie[];
	turnstile_token?: string;
	headers: Record<string, string>;
};

export type FlareSolverrReqResponse = {
	status: string;
	message: string;
	solution: FlareSolverrSolution;
	startTimestamp: number;
	endTimestamp: number;
	version: string;
};

const SESSION_COMMAND_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_BUFFER_MS = 10_000;

export class FlareSolverrClient {
	host: string;
	private sessionId: string | undefined;
	private timeoutMs: number;

	constructor(options: FlareSolverrOptions) {
		if (!options.enabled) {
			throw new Error("FlareSolverr is disabled in the options.");
		}
		this.host = options.host;
		this.sessionId = options.sessionId;
		this.timeoutMs = options.timeoutMs ?? 60000;
	}

	private async postCommand<T>(
		payload: Record<string, unknown>,
		fetchTimeoutMs: number,
	): Promise<T> {
		let response: Response;
		try {
			response = await fetch(`${this.host}/v1`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(fetchTimeoutMs),
			});
		} catch (error) {
			throw new FlareSolverrError(
				this.host,
				error instanceof Error ? error.message : String(error),
			);
		}

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new FlareSolverrError(
				this.host,
				`HTTP ${response.status}: ${text || response.statusText}`,
			);
		}

		try {
			return (await response.json()) as T;
		} catch (error) {
			throw new FlareSolverrError(
				this.host,
				`Invalid JSON response: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async listSession(): Promise<string[]> {
		const data = await this.postCommand<{ sessions: string[] }>(
			{
				cmd: "sessions.list",
			},
			SESSION_COMMAND_TIMEOUT_MS,
		);
		return data.sessions;
	}

	async createSession(sessionId: string): Promise<void> {
		await this.postCommand(
			{
				cmd: "sessions.create",
				session: sessionId,
			},
			SESSION_COMMAND_TIMEOUT_MS,
		);
	}

	async createSessionIfNotExists(sessionId: string): Promise<void> {
		const sessions = await this.listSession();
		if (!sessions.includes(sessionId)) {
			await this.createSession(sessionId);
		}
	}

	async destroySession(sessionId: string): Promise<void> {
		await this.postCommand(
			{
				cmd: "sessions.destroy",
				session: sessionId,
			},
			SESSION_COMMAND_TIMEOUT_MS,
		);
	}

	async get(url: string) {
		return await this.postCommand<FlareSolverrReqResponse>(
			{
				cmd: "request.get",
				session: this.sessionId,
				url,
				maxTimeout: this.timeoutMs,
			},
			this.timeoutMs + REQUEST_TIMEOUT_BUFFER_MS,
		);
	}

	async post(url: string, urlencodedData: Record<string, string>) {
		return await this.postCommand<FlareSolverrReqResponse>(
			{
				cmd: "request.post",
				session: this.sessionId,
				url,
				postData: new URLSearchParams(urlencodedData).toString(),
				maxTimeout: this.timeoutMs,
			},
			this.timeoutMs + REQUEST_TIMEOUT_BUFFER_MS,
		);
	}
}
