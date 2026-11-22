import type { DeviceKind } from "@acanthis-dec/core";
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

interface NavigatorWithUAData extends Navigator {
	userAgentData?: {
		mobile?: boolean;
		platform?: string;
	};
}

export function normalizeDeviceKind(value: unknown): DeviceKind {
	if (value === "desktop" || value === "mobile") {
		return value;
	}
	return "unknown";
}

export function detectDeviceKind(): DeviceKind {
	if (typeof navigator === "undefined") {
		return "unknown";
	}
	const nav = navigator as NavigatorWithUAData;
	const uaDataPlatform = nav.userAgentData?.platform ?? "";
	if (
		nav.userAgentData?.mobile === true ||
		/^(Android|iOS|iPadOS)$/i.test(uaDataPlatform)
	) {
		return "mobile";
	}
	if (/^(Windows|macOS|Linux|Chrome OS|CrOS)$/i.test(uaDataPlatform)) {
		return "desktop";
	}
	const ua = navigator.userAgent || "";
	if (
		/Android|iPhone|iPad|iPod|HarmonyOS|Mobile/i.test(ua) ||
		(/Macintosh|Mac/i.test(ua) && navigator.maxTouchPoints > 1)
	) {
		return "mobile";
	}
	if (/Windows|Macintosh|Mac OS X|Linux|X11|CrOS/i.test(ua)) {
		return "desktop";
	}
	return "unknown";
}

const DESKTOP_LABEL_PATTERN =
	/\b(desktop|windows|win32|win64|macos|mac os|macbook|imac|linux|ubuntu|fedora|arch|pc)\b/i;
const MOBILE_LABEL_PATTERN =
	/\b(android|ios|iphone|ipad|ipod|mobile|phone|pixel|xiaomi|redmi|huawei|honor|oppo|vivo|oneplus|samsung|galaxy|meizu|realme|xperia)\b/i;

export function resolveDisplayDeviceKind(
	deviceKind?: DeviceKind | null,
	deviceLabel?: string | null,
): "desktop" | "mobile" {
	if (deviceKind === "desktop" || deviceKind === "mobile") {
		return deviceKind;
	}
	const label = deviceLabel?.trim() ?? "";
	if (label) {
		if (DESKTOP_LABEL_PATTERN.test(label)) {
			return "desktop";
		}
		if (MOBILE_LABEL_PATTERN.test(label)) {
			return "mobile";
		}
	}
	return "mobile";
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
