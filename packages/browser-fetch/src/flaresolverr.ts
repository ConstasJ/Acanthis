export type FlareSolverrOptions = {
	enabled: boolean;
	host: string;
	sessionId?: string;
	timeoutMs?: number;
};

export type FlareSolverrCookie = {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	size: number;
	httpOnly: boolean;
	secure: boolean;
	session: boolean;
	sameSite: "Strict" | "Lax" | "None";
};

export type FlareSolverrSolution = {
	url: string;
	status: string;
	userAgent: string;
	response: string;
	cookies: FlareSolverrCookie[];
	turnstile_token?: string;
};

export type FlareSolverrReqResponse = {
	status: string;
	message: string;
	solution: FlareSolverrSolution;
	startTimestamp: number;
	endTimestamp: number;
	version: string;
};

export class FlareSolverrClient {
	host: string;
	private sessionId: string | undefined;
	private timeoutMs: number;

	constructor(options: FlareSolverrOptions) {
		this.host = options.host;
		this.sessionId = options.sessionId;
		this.timeoutMs = options.timeoutMs || 30000; // Default to 30 seconds
	}

	async listSession(): Promise<string[]> {
		const response = await fetch(`${this.host}/v1`, {
			method: "POST",
			body: JSON.stringify({
				cmd: "sessions.list",
			}),
		});
		const data = await response.json();
		return data.sessions as string[];
	}

	async createSession(sessionId: string): Promise<void> {
		await fetch(`${this.host}/v1`, {
			method: "POST",
			body: JSON.stringify({
				cmd: "sessions.create",
				session: sessionId,
			}),
		});
	}

	async createSessionIfNotExists(sessionId: string): Promise<void> {
		const sessions = await this.listSession();
		if (!sessions.includes(sessionId)) {
			await this.createSession(sessionId);
		}
	}

	async destroySession(sessionId: string): Promise<void> {
		await fetch(`${this.host}/v1`, {
			method: "POST",
			body: JSON.stringify({
				cmd: "sessions.destroy",
				session: sessionId,
			}),
		});
	}

	async get(url: string) {
		const response = await fetch(`${this.host}/v1`, {
			method: "POST",
			body: JSON.stringify({
				cmd: "request.get",
				session: this.sessionId,
				url,
				maxTimeout: this.timeoutMs,
			}),
		});
		const data = (await response.json()) as FlareSolverrReqResponse;
		return data;
	}

	async post(url: string, urlencodedData: Record<string, string>) {
		const response = await fetch(`${this.host}/v1`, {
			method: "POST",
			body: JSON.stringify({
				cmd: "request.post",
				session: this.sessionId,
				url,
				postData: new URLSearchParams(urlencodedData).toString(),
				maxTimeout: this.timeoutMs,
			}),
		});
		const data = (await response.json()) as FlareSolverrReqResponse;
		return data;
	}
}
