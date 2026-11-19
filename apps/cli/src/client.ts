import type {
	Novel,
	NovelInfo,
	NovelSearchResult,
	NovelSourceDescriptor,
} from "@acanthis-dec/core";

export interface PaginatedNovelsResponse {
	items: NovelInfo[];
	total: number;
	page: number;
	pageSize: number;
}

interface ApiEnvelope<T> {
	code: number;
	message: string;
	data?: T;
}

export class ApiClientError extends Error {
	readonly status: number | undefined;
	readonly code: number | undefined;
	readonly exitCode: number;

	constructor(
		message: string,
		options?: {
			status?: number | undefined;
			code?: number | undefined;
			exitCode?: number | undefined;
			cause?: unknown;
		},
	) {
		super(
			message,
			options?.cause !== undefined ? { cause: options.cause } : undefined,
		);
		this.name = "ApiClientError";
		this.status = options?.status;
		this.code = options?.code;
		this.exitCode = options?.exitCode ?? 1;
	}
}

export function normalizeServerUrl(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) {
		throw new ApiClientError("Server URL cannot be empty", { exitCode: 2 });
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch (error) {
		throw new ApiClientError(`Invalid server URL: ${trimmed}`, {
			exitCode: 2,
			cause: error,
		});
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new ApiClientError(
			`Unsupported server URL protocol "${parsed.protocol}". Expected http: or https:`,
			{ exitCode: 2 },
		);
	}
	if (parsed.origin === "null") {
		throw new ApiClientError(`Invalid server URL origin: ${trimmed}`, {
			exitCode: 2,
		});
	}
	const pathname = parsed.pathname.replace(/\/+$/, "");
	return `${parsed.origin}${pathname}`;
}

function stripTrailingV1Prefix(baseUrl: string): string {
	return baseUrl.endsWith("/v1") ? baseUrl.slice(0, -3) : baseUrl;
}

export function rebaseMediaUrl(rawUrl: string, serverUrl: string): string {
	const base = stripTrailingV1Prefix(normalizeServerUrl(serverUrl));
	if (rawUrl.startsWith("/v1/")) {
		return `${base}${rawUrl}`;
	}

	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		return rawUrl;
	}

	const v1Index = parsed.pathname.indexOf("/v1/");
	if (v1Index === -1) {
		return rawUrl;
	}

	const v1PathAndQuery = `${parsed.pathname.slice(v1Index)}${parsed.search}`;
	return `${base}${v1PathAndQuery}`;
}

function parseErrorPayload(
	bodyText: string,
	status: number,
	statusText: string,
): { message: string; code: number | undefined } {
	const trimmed = bodyText.trim();
	if (trimmed) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (typeof parsed === "object" && parsed !== null) {
				const record = parsed as Record<string, unknown>;
				if (typeof record.message === "string" && record.message.trim()) {
					return {
						message: record.message,
						code: typeof record.code === "number" ? record.code : undefined,
					};
				}
				if (typeof record.error === "string" && record.error.trim()) {
					return {
						message: record.error,
						code: typeof record.code === "number" ? record.code : undefined,
					};
				}
			}
		} catch {
			// Fall back to plain text body below.
		}
		return { message: trimmed, code: undefined };
	}
	return {
		message: statusText ? `HTTP ${status} ${statusText}` : `HTTP ${status}`,
		code: undefined,
	};
}

export class AcanthisApiClient {
	private readonly serverUrl: string;
	private readonly serverOrigin: string;
	private readonly token: string | undefined;

	constructor(serverUrl: string, token?: string) {
		this.serverUrl = normalizeServerUrl(serverUrl);
		this.serverOrigin = new URL(this.serverUrl).origin;
		const trimmedToken = token?.trim();
		this.token = trimmedToken ? trimmedToken : undefined;
	}

	private buildApiUrl(endpointPath: string): string {
		return `${stripTrailingV1Prefix(this.serverUrl)}${endpointPath}`;
	}

	private isSameOrigin(targetUrl: string): boolean {
		try {
			return new URL(targetUrl).origin === this.serverOrigin;
		} catch {
			return false;
		}
	}

	private async requestJson<T>(endpointPath: string): Promise<T> {
		const targetUrl = this.buildApiUrl(endpointPath);
		const headers: Record<string, string> = {
			Accept: "application/json",
		};
		if (this.token) {
			headers.Authorization = `Bearer ${this.token}`;
		}

		let response: Response;
		try {
			response = await fetch(targetUrl, {
				method: "GET",
				headers,
			});
		} catch (error) {
			throw new ApiClientError(
				`Request failed (${targetUrl}): ${error instanceof Error ? error.message : String(error)}`,
				{ exitCode: 1, cause: error },
			);
		}

		const bodyText = await response.text();
		if (!response.ok) {
			const { message, code } = parseErrorPayload(
				bodyText,
				response.status,
				response.statusText,
			);
			throw new ApiClientError(message, {
				status: response.status,
				code,
				exitCode: 1,
			});
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(bodyText);
		} catch (error) {
			throw new ApiClientError(
				`Invalid JSON response from ${targetUrl}: ${error instanceof Error ? error.message : String(error)}`,
				{ status: response.status, exitCode: 1, cause: error },
			);
		}

		if (
			typeof parsed !== "object" ||
			parsed === null ||
			!("code" in parsed) ||
			typeof (parsed as { code: unknown }).code !== "number"
		) {
			throw new ApiClientError(
				`Unexpected API response envelope from ${targetUrl}`,
				{ status: response.status, exitCode: 1 },
			);
		}

		const envelope = parsed as ApiEnvelope<T>;
		if (envelope.code !== 0) {
			throw new ApiClientError(
				typeof envelope.message === "string" && envelope.message.trim()
					? envelope.message
					: `API returned error code ${envelope.code}`,
				{
					status: response.status,
					code: envelope.code,
					exitCode: 1,
				},
			);
		}

		if (envelope.data === undefined) {
			throw new ApiClientError(
				`Missing data payload in API response from ${targetUrl}`,
				{ status: response.status, code: envelope.code, exitCode: 1 },
			);
		}

		return envelope.data;
	}

	async getSources(): Promise<NovelSourceDescriptor[]> {
		return await this.requestJson<NovelSourceDescriptor[]>("/v1/sources");
	}

	async listNovels(
		source: string,
		page?: number,
		pageSize?: number,
	): Promise<PaginatedNovelsResponse> {
		const params = new URLSearchParams();
		if (page !== undefined) {
			params.set("page", String(page));
		}
		if (pageSize !== undefined) {
			params.set("pageSize", String(pageSize));
		}
		const query = params.toString();
		const encodedSource = encodeURIComponent(source);
		return await this.requestJson<PaginatedNovelsResponse>(
			`/v1/${encodedSource}/novels${query ? `?${query}` : ""}`,
		);
	}

	async searchNovels(
		source: string,
		keyword: string,
	): Promise<NovelSearchResult[]> {
		const params = new URLSearchParams({ keyword });
		const encodedSource = encodeURIComponent(source);
		return await this.requestJson<NovelSearchResult[]>(
			`/v1/${encodedSource}/search?${params.toString()}`,
		);
	}

	async getNovel(source: string, novelId: string): Promise<Novel> {
		const encodedSource = encodeURIComponent(source);
		const encodedNovelId = encodeURIComponent(novelId);
		return await this.requestJson<Novel>(
			`/v1/${encodedSource}/novel/${encodedNovelId}`,
		);
	}

	async getChapterContent(
		source: string,
		chapterId: string,
		novelId: string,
	): Promise<{ content: string }> {
		const encodedSource = encodeURIComponent(source);
		const encodedChapterId = encodeURIComponent(chapterId);
		const params = new URLSearchParams({ novelId });
		return await this.requestJson<{ content: string }>(
			`/v1/${encodedSource}/chapter/${encodedChapterId}?${params.toString()}`,
		);
	}

	async fetchBinary(
		rawUrl: string,
	): Promise<{ data: Uint8Array; mimeType: string }> {
		const targetUrl = rebaseMediaUrl(rawUrl, this.serverUrl);
		const headers: Record<string, string> = {};
		if (this.token && this.isSameOrigin(targetUrl)) {
			headers.Authorization = `Bearer ${this.token}`;
		}

		let response: Response;
		try {
			response = await fetch(targetUrl, {
				method: "GET",
				headers,
			});
		} catch (error) {
			throw new ApiClientError(
				`Binary fetch failed (${targetUrl}): ${error instanceof Error ? error.message : String(error)}`,
				{ exitCode: 1, cause: error },
			);
		}

		if (!response.ok) {
			const bodyText = await response.text().catch(() => "");
			const { message, code } = parseErrorPayload(
				bodyText,
				response.status,
				response.statusText,
			);
			throw new ApiClientError(message, {
				status: response.status,
				code,
				exitCode: 1,
			});
		}

		const data = new Uint8Array(await response.arrayBuffer());
		const mimeType =
			response.headers.get("content-type") ?? "application/octet-stream";

		return {
			data,
			mimeType,
		};
	}
}
