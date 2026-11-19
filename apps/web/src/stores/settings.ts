import { defineStore } from "pinia";
import { ref } from "vue";
import {
	detectDefaultDeviceLabel,
	normalizeBaseUrl,
	readStoredAuthToken,
	resolveApiBaseUrl,
	STORAGE_KEYS,
} from "@/config/runtime";

export type ReaderMode = "scroll" | "paginated";
export type ReaderTheme = "light" | "sepia" | "oled";

export interface ReaderSettings {
	mode: ReaderMode;
	theme: ReaderTheme;
	fontSize: number;
	lineHeight: number;
	pagePadding: number;
}

const DEFAULT_READER_SETTINGS: ReaderSettings = {
	mode: "scroll",
	theme: "light",
	fontSize: 18,
	lineHeight: 1.8,
	pagePadding: 20,
};

function readStorage(key: string): string | null {
	if (typeof localStorage === "undefined") {
		return null;
	}
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string): void {
	if (typeof localStorage === "undefined") {
		return;
	}
	try {
		localStorage.setItem(key, value);
	} catch {
		// Ignore storage quota or private mode errors.
	}
}

function removeStorage(key: string): void {
	if (typeof localStorage === "undefined") {
		return;
	}
	try {
		localStorage.removeItem(key);
	} catch {
		// Ignore storage errors.
	}
}

function parseReaderSettings(): ReaderSettings {
	const raw = readStorage(STORAGE_KEYS.readerSettings);
	if (!raw) {
		return { ...DEFAULT_READER_SETTINGS };
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) {
			return { ...DEFAULT_READER_SETTINGS };
		}
		const rec = parsed as Record<string, unknown>;
		const mode: ReaderMode =
			rec.mode === "scroll" || rec.mode === "paginated"
				? rec.mode
				: DEFAULT_READER_SETTINGS.mode;
		const theme: ReaderTheme =
			rec.theme === "light" || rec.theme === "sepia" || rec.theme === "oled"
				? rec.theme
				: DEFAULT_READER_SETTINGS.theme;
		const fontSize =
			typeof rec.fontSize === "number" &&
			Number.isFinite(rec.fontSize) &&
			rec.fontSize >= 12 &&
			rec.fontSize <= 36
				? rec.fontSize
				: DEFAULT_READER_SETTINGS.fontSize;
		const lineHeight =
			typeof rec.lineHeight === "number" &&
			Number.isFinite(rec.lineHeight) &&
			rec.lineHeight >= 1.2 &&
			rec.lineHeight <= 2.8
				? rec.lineHeight
				: DEFAULT_READER_SETTINGS.lineHeight;
		const pagePadding =
			typeof rec.pagePadding === "number" &&
			Number.isFinite(rec.pagePadding) &&
			rec.pagePadding >= 8 &&
			rec.pagePadding <= 64
				? rec.pagePadding
				: DEFAULT_READER_SETTINGS.pagePadding;

		return { mode, theme, fontSize, lineHeight, pagePadding };
	} catch {
		return { ...DEFAULT_READER_SETTINGS };
	}
}

function parseLastSyncServerTime(): number {
	const raw = readStorage(STORAGE_KEYS.lastSyncServerTime);
	if (!raw) {
		return 0;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function applyThemeAttribute(theme: ReaderTheme): void {
	if (typeof document === "undefined") {
		return;
	}
	document.documentElement.setAttribute("data-theme", theme);
}

export const useSettingsStore = defineStore("settings", () => {
	const apiBaseUrl = ref<string>(resolveApiBaseUrl());
	const authToken = ref<string>(readStoredAuthToken());
	const deviceLabel = ref<string>(
		readStorage(STORAGE_KEYS.deviceLabel)?.trim() || detectDefaultDeviceLabel(),
	);
	const selectedExplorePlatform = ref<string>(
		readStorage(STORAGE_KEYS.selectedPlatform)?.trim() || "",
	);
	const lastSyncServerTime = ref<number>(parseLastSyncServerTime());
	const readerSettings = ref<ReaderSettings>(parseReaderSettings());

	applyThemeAttribute(readerSettings.value.theme);

	function setLastSyncServerTime(cursor: number): void {
		const normalized =
			Number.isFinite(cursor) && cursor >= 0 ? Math.floor(cursor) : 0;
		lastSyncServerTime.value = normalized;
		writeStorage(STORAGE_KEYS.lastSyncServerTime, String(normalized));
	}

	function setApiBaseUrl(url: string): boolean {
		const previousUrl = apiBaseUrl.value;
		const trimmed = normalizeBaseUrl(url);
		if (trimmed) {
			writeStorage(STORAGE_KEYS.apiBaseUrl, trimmed);
			apiBaseUrl.value = trimmed;
		} else {
			removeStorage(STORAGE_KEYS.apiBaseUrl);
			apiBaseUrl.value = resolveApiBaseUrl();
		}

		const changed = apiBaseUrl.value !== previousUrl;
		if (changed) {
			setLastSyncServerTime(0);
		}
		return changed;
	}

	function setAuthToken(token: string): void {
		const trimmed = token.trim();
		authToken.value = trimmed;
		if (trimmed) {
			writeStorage(STORAGE_KEYS.authToken, trimmed);
		} else {
			removeStorage(STORAGE_KEYS.authToken);
		}
	}

	function setDeviceLabel(label: string): void {
		const trimmed = label.trim() || detectDefaultDeviceLabel();
		deviceLabel.value = trimmed;
		writeStorage(STORAGE_KEYS.deviceLabel, trimmed);
	}

	function setSelectedExplorePlatform(platform: string): void {
		const trimmed = platform.trim();
		selectedExplorePlatform.value = trimmed;
		if (trimmed) {
			writeStorage(STORAGE_KEYS.selectedPlatform, trimmed);
		} else {
			removeStorage(STORAGE_KEYS.selectedPlatform);
		}
	}

	function updateReaderSettings(patch: Partial<ReaderSettings>): void {
		const next: ReaderSettings = {
			...readerSettings.value,
			...patch,
		};
		readerSettings.value = next;
		writeStorage(STORAGE_KEYS.readerSettings, JSON.stringify(next));
		applyThemeAttribute(next.theme);
	}

	function resetReaderSettings(): void {
		updateReaderSettings({ ...DEFAULT_READER_SETTINGS });
	}

	return {
		apiBaseUrl,
		authToken,
		deviceLabel,
		selectedExplorePlatform,
		lastSyncServerTime,
		readerSettings,
		setApiBaseUrl,
		setAuthToken,
		setDeviceLabel,
		setSelectedExplorePlatform,
		setLastSyncServerTime,
		updateReaderSettings,
		resetReaderSettings,
	};
});
