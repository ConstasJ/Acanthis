import { normalizeBaseUrl, stripTrailingV1Prefix } from "@/utils/mediaUrl";

export { normalizeBaseUrl, stripTrailingV1Prefix };

export const DEFAULT_API_BASE_URL = "http://localhost:5301";

export const STORAGE_KEYS = {
	apiBaseUrl: "acanthis.apiBaseUrl",
	authToken: "acanthis.authToken",
	deviceLabel: "acanthis.deviceLabel",
	readerSettings: "acanthis.readerSettings",
	selectedPlatform: "acanthis.selectedPlatform",
	lastSyncServerTime: "acanthis.lastSyncServerTime",
} as const;

function readLocalStorageItem(key: string): string | null {
	if (typeof localStorage === "undefined") {
		return null;
	}
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function resolveApiBaseUrl(): string {
	const storedUrl = readLocalStorageItem(STORAGE_KEYS.apiBaseUrl);
	if (storedUrl !== null) {
		const normalized = normalizeBaseUrl(storedUrl);
		if (normalized) {
			return normalized;
		}
	}

	if (typeof window !== "undefined") {
		const runtimeConfigUrl = window.__ACANTHIS_CONFIG__?.defaultApiBaseUrl;
		if (typeof runtimeConfigUrl === "string") {
			const normalized = normalizeBaseUrl(runtimeConfigUrl);
			if (normalized) {
				return normalized;
			}
		}
	}

	const envUrl =
		typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined"
			? import.meta.env.VITE_DEFAULT_API_BASE_URL
			: undefined;
	if (typeof envUrl === "string") {
		const normalized = normalizeBaseUrl(envUrl);
		if (normalized) {
			return normalized;
		}
	}

	return DEFAULT_API_BASE_URL;
}

export function readStoredAuthToken(): string {
	const token = readLocalStorageItem(STORAGE_KEYS.authToken);
	return token ? token.trim() : "";
}

export function detectDefaultDeviceLabel(): string {
	if (typeof navigator === "undefined") {
		return "Desktop Web";
	}
	const ua = navigator.userAgent || "";
	if (/iPhone|iPad|iPod/i.test(ua)) {
		return "iOS Web";
	}
	if (/Android/i.test(ua)) {
		return "Android Web";
	}
	if (/Mac/i.test(ua) && navigator.maxTouchPoints > 1) {
		return "iOS Web";
	}
	return "Desktop Web";
}
