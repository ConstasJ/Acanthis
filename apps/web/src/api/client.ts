import type {
	BookshelfItem,
	ExploreHomeData,
	ExplorePage,
	ExploreSchema,
	Novel,
	NovelInfo,
	NovelSearchResult,
	NovelSourceDescriptor,
	ReadingProgress,
} from "@acanthis-dec/core";
import {
	readStoredAuthToken,
	resolveApiBaseUrl,
	stripTrailingV1Prefix,
} from "@/config/runtime";
import { rebaseMediaUrlWithBase } from "@/utils/mediaUrl";

export interface PaginatedNovelsResponse {
	items: NovelInfo[];
	total: number;
	page: number;
	pageSize: number;
}

export interface SyncStatePullResponse {
	bookshelf: BookshelfItem[];
	progress: ReadingProgress[];
	cursor: number;
}

export interface SyncStatePushPayload {
	bookshelf?: BookshelfItem[];
	progress?: ReadingProgress[];
}

export interface SyncStatePushResponse {
	bookshelf: BookshelfItem[];
	progress: ReadingProgress[];
	serverTime: number;
}

interface ApiEnvelope<T> {
	code: number;
	message: string;
	data?: T;
}

export class ApiError extends Error {
	readonly status: number;
	readonly code: number;

	constructor(status: number, code: number, message: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
	}
}

export function rebaseMediaUrl(
	rawUrl: string | null | undefined,
	apiBaseUrl?: string,
): string {
	const resolvedBase = apiBaseUrl?.trim() ? apiBaseUrl : resolveApiBaseUrl();
	return rebaseMediaUrlWithBase(rawUrl, resolvedBase);
}

function parseErrorPayload(
	bodyText: string,
	status: number,
	statusText: string,
): { code: number; message: string } {
	const trimmed = bodyText.trim();
	if (trimmed) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (typeof parsed === "object" && parsed !== null) {
				const record = parsed as Record<string, unknown>;
				const code = typeof record.code === "number" ? record.code : 0;
				if (typeof record.message === "string" && record.message.trim()) {
					return { code, message: record.message };
				}
				if (typeof record.error === "string" && record.error.trim()) {
					return { code, message: record.error };
				}
			}
		} catch {
			// Fall back to plain text body below.
		}
		return { code: 0, message: trimmed };
	}

	return {
		code: 0,
		message: statusText ? `HTTP ${status} ${statusText}` : `HTTP ${status}`,
	};
}

export function isAbortError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		(error as { name: unknown }).name === "AbortError"
	);
}

function buildSignalOptions(signal?: AbortSignal): { signal?: AbortSignal } {
	const requestOptions: { signal?: AbortSignal } = {};
	if (signal !== undefined) {
		requestOptions.signal = signal;
	}
	return requestOptions;
}

async function requestJson<T>(
	endpointPath: string,
	options?: {
		method?: "GET" | "POST";
		body?: unknown;
		signal?: AbortSignal;
		keepalive?: boolean;
	},
): Promise<T> {
	const base = stripTrailingV1Prefix(resolveApiBaseUrl());
	const targetUrl = `${base}${endpointPath}`;
	const headers: Record<string, string> = {
		Accept: "application/json",
	};

	const token = readStoredAuthToken();
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	if (options?.body !== undefined) {
		headers["Content-Type"] = "application/json";
	}

	const init: RequestInit = {
		method: options?.method ?? "GET",
		headers,
	};
	if (options?.body !== undefined) {
		init.body = JSON.stringify(options.body);
	}
	if (options?.signal !== undefined) {
		init.signal = options.signal;
	}
	if (options?.keepalive !== undefined) {
		init.keepalive = options.keepalive;
	}

	let response: Response;
	try {
		response = await fetch(targetUrl, init);
	} catch (error) {
		if (isAbortError(error)) {
			throw error;
		}
		throw new ApiError(
			0,
			0,
			error instanceof Error ? error.message : String(error),
		);
	}

	const bodyText = await response.text();
	if (!response.ok) {
		const { code, message } = parseErrorPayload(
			bodyText,
			response.status,
			response.statusText,
		);
		throw new ApiError(response.status, code, message);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(bodyText);
	} catch {
		throw new ApiError(
			response.status,
			0,
			`Invalid JSON response from ${targetUrl}`,
		);
	}

	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!("code" in parsed) ||
		typeof (parsed as { code: unknown }).code !== "number"
	) {
		throw new ApiError(
			response.status,
			0,
			`Unexpected API response envelope from ${targetUrl}`,
		);
	}

	const envelope = parsed as ApiEnvelope<T>;
	if (envelope.code !== 0) {
		throw new ApiError(
			response.status,
			envelope.code,
			typeof envelope.message === "string" && envelope.message.trim()
				? envelope.message
				: `API returned error code ${envelope.code}`,
		);
	}

	if (envelope.data === undefined) {
		throw new ApiError(
			response.status,
			envelope.code,
			`Missing data payload in API response from ${targetUrl}`,
		);
	}

	return envelope.data;
}

export async function fetchSources(): Promise<NovelSourceDescriptor[]> {
	return await requestJson<NovelSourceDescriptor[]>("/v1/sources");
}

export async function fetchNovels(
	platform: string,
	page: number,
	pageSize?: number,
): Promise<PaginatedNovelsResponse> {
	const params = new URLSearchParams();
	params.set("page", String(page));
	if (pageSize !== undefined) {
		params.set("pageSize", String(pageSize));
	}
	const encodedPlatform = encodeURIComponent(platform);
	return await requestJson<PaginatedNovelsResponse>(
		`/v1/${encodedPlatform}/novels?${params.toString()}`,
	);
}

export async function searchNovels(
	platform: string,
	keyword: string,
	signal?: AbortSignal,
): Promise<NovelSearchResult[]> {
	const params = new URLSearchParams({ keyword });
	const encodedPlatform = encodeURIComponent(platform);
	return await requestJson<NovelSearchResult[]>(
		`/v1/${encodedPlatform}/search?${params.toString()}`,
		buildSignalOptions(signal),
	);
}

export async function fetchExploreSchema(
	platform: string,
	signal?: AbortSignal,
): Promise<ExploreSchema> {
	const encodedPlatform = encodeURIComponent(platform);
	return await requestJson<ExploreSchema>(
		`/v1/${encodedPlatform}/explore/schema`,
		buildSignalOptions(signal),
	);
}

export async function fetchExploreHome(
	platform: string,
	channel?: string,
	signal?: AbortSignal,
): Promise<ExploreHomeData> {
	const encodedPlatform = encodeURIComponent(platform);
	const params = new URLSearchParams();
	const trimmedChannel = channel?.trim();
	if (trimmedChannel) {
		params.set("channel", trimmedChannel);
	}
	const query = params.toString();
	return await requestJson<ExploreHomeData>(
		`/v1/${encodedPlatform}/home${query ? `?${query}` : ""}`,
		buildSignalOptions(signal),
	);
}

export async function fetchExploreRankings(
	platform: string,
	params: { rank: string; full: boolean; page: number },
	signal?: AbortSignal,
): Promise<ExplorePage> {
	const encodedPlatform = encodeURIComponent(platform);
	const searchParams = new URLSearchParams({
		rank: params.rank,
		full: String(params.full),
		page: String(params.page),
	});
	return await requestJson<ExplorePage>(
		`/v1/${encodedPlatform}/rankings?${searchParams.toString()}`,
		buildSignalOptions(signal),
	);
}

export async function fetchExploreCatalog(
	platform: string,
	params: Record<string, string | number>,
	signal?: AbortSignal,
): Promise<ExplorePage> {
	const encodedPlatform = encodeURIComponent(platform);
	const searchParams = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		const normalized = String(value).trim();
		if (normalized) {
			searchParams.set(key, normalized);
		}
	}
	const query = searchParams.toString();
	return await requestJson<ExplorePage>(
		`/v1/${encodedPlatform}/catalog${query ? `?${query}` : ""}`,
		buildSignalOptions(signal),
	);
}

export async function fetchNovelDetail(
	platform: string,
	novelId: string,
): Promise<Novel> {
	const encodedPlatform = encodeURIComponent(platform);
	const encodedNovelId = encodeURIComponent(novelId);
	return await requestJson<Novel>(
		`/v1/${encodedPlatform}/novel/${encodedNovelId}`,
	);
}

export async function fetchChapterContent(
	platform: string,
	chapterId: string,
	novelId: string,
): Promise<{ content: string }> {
	const encodedPlatform = encodeURIComponent(platform);
	const encodedChapterId = encodeURIComponent(chapterId);
	const params = new URLSearchParams({ novelId });
	return await requestJson<{ content: string }>(
		`/v1/${encodedPlatform}/chapter/${encodedChapterId}?${params.toString()}`,
	);
}

export async function fetchSyncState(
	since?: number,
): Promise<SyncStatePullResponse> {
	const params = new URLSearchParams();
	if (since !== undefined) {
		params.set("since", String(since));
	}
	const query = params.toString();
	return await requestJson<SyncStatePullResponse>(
		`/v1/sync/state${query ? `?${query}` : ""}`,
	);
}

export async function postSyncState(
	payload: SyncStatePushPayload,
	options?: { keepalive?: boolean },
): Promise<SyncStatePushResponse> {
	const requestOptions: {
		method: "POST";
		body: SyncStatePushPayload;
		keepalive?: boolean;
	} = {
		method: "POST",
		body: payload,
	};
	if (options?.keepalive !== undefined) {
		requestOptions.keepalive = options.keepalive;
	}
	return await requestJson<SyncStatePushResponse>(
		"/v1/sync/state",
		requestOptions,
	);
}
