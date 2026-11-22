<script setup lang="ts">
import {
	CheckCircle2,
	Database,
	Eye,
	EyeOff,
	Monitor,
	RefreshCw,
	Server,
	Smartphone,
	Trash2,
	XCircle,
} from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { ApiError, fetchSources } from "@/api/client";
import { detectDeviceKind } from "@/config/runtime";
import { type ChapterCacheStats, webDb } from "@/db/indexedDb";
import { useLibraryStore } from "@/stores/library";
import {
	type ReaderMode,
	type ReaderTheme,
	useSettingsStore,
} from "@/stores/settings";
import { useSourcesStore } from "@/stores/sources";

const settingsStore = useSettingsStore();
const sourcesStore = useSourcesStore();
const libraryStore = useLibraryStore();

const apiBaseUrlInput = ref<string>(settingsStore.apiBaseUrl);
const authTokenInput = ref<string>(settingsStore.authToken);
const deviceLabelInput = ref<string>(settingsStore.deviceLabel);
const showToken = ref<boolean>(false);

const testingConnection = ref<boolean>(false);
const connectionResult = ref<{
	ok: boolean;
	message: string;
} | null>(null);

const cacheStats = ref<ChapterCacheStats>({ count: 0, totalBytes: 0 });
const clearingCache = ref<boolean>(false);
const savedNotice = ref<string | null>(null);

const themeOptions: { value: ReaderTheme; label: string }[] = [
	{ value: "light", label: "默认亮色" },
	{ value: "sepia", label: "羊皮纸" },
	{ value: "oled", label: "OLED 纯黑" },
];

const modeOptions: { value: ReaderMode; label: string }[] = [
	{ value: "scroll", label: "上下滚动" },
	{ value: "paginated", label: "左右翻页" },
];

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function refreshCacheStats(): Promise<void> {
	try {
		cacheStats.value = await webDb.getChapterCacheStats();
	} catch {
		cacheStats.value = { count: 0, totalBytes: 0 };
	}
}

async function handleSaveConnection(): Promise<void> {
	const urlChanged = settingsStore.setApiBaseUrl(apiBaseUrlInput.value);
	settingsStore.setAuthToken(authTokenInput.value);
	settingsStore.setDeviceLabel(deviceLabelInput.value);

	apiBaseUrlInput.value = settingsStore.apiBaseUrl;
	deviceLabelInput.value = settingsStore.deviceLabel;
	savedNotice.value = urlChanged
		? "连接设置已保存，已重置同步游标准备全量拉取"
		: "连接与设备设置已保存";

	const ok = await sourcesStore.refreshSources();
	if (ok) {
		await libraryStore.syncNow();
	}
}

async function handleTestConnection(): Promise<void> {
	settingsStore.setApiBaseUrl(apiBaseUrlInput.value);
	settingsStore.setAuthToken(authTokenInput.value);
	apiBaseUrlInput.value = settingsStore.apiBaseUrl;

	testingConnection.value = true;
	connectionResult.value = null;
	const startedAt = performance.now();

	try {
		const list = await fetchSources();
		const latencyMs = Math.round(performance.now() - startedAt);
		sourcesStore.sources = list;
		sourcesStore.needsSetup = false;
		sourcesStore.error = null;
		const names = list.map((s) => s.name).join("、") || "无";
		connectionResult.value = {
			ok: true,
			message: `连接成功（${latencyMs} ms）· 可用书源 ${list.length} 个：${names}`,
		};
	} catch (err) {
		const latencyMs = Math.round(performance.now() - startedAt);
		const msg =
			err instanceof ApiError
				? err.status === 401 || err.code === 40100
					? "鉴权失败（401），请检查 Access Token"
					: `${err.message} (HTTP ${err.status})`
				: err instanceof Error
					? err.message
					: "连接失败";
		connectionResult.value = {
			ok: false,
			message: `连接失败（${latencyMs} ms）：${msg}`,
		};
	} finally {
		testingConnection.value = false;
	}
}

async function handleManualSync(): Promise<void> {
	await libraryStore.syncNow();
}

async function handleClearCache(): Promise<void> {
	clearingCache.value = true;
	try {
		await webDb.clearChapterCache();
		await refreshCacheStats();
	} finally {
		clearingCache.value = false;
	}
}

onMounted(() => {
	void refreshCacheStats();
});
</script>

<template>
	<div class="mx-auto max-w-2xl space-y-6">
		<header>
			<h1 class="text-xl sm:text-2xl font-bold tracking-tight">设置</h1>
			<p class="mt-0.5 text-xs sm:text-sm text-[var(--text-secondary)]">
				配置自托管后端地址、跨设备同步与阅读器全局默认值
			</p>
		</header>

		<!-- Backend Connection Form -->
		<section
			class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 space-y-4"
		>
			<div class="flex items-center gap-2">
				<Server class="h-4 w-4 text-[var(--accent)]" />
				<h2 class="text-base font-semibold">后端服务与鉴权</h2>
			</div>

			<div class="space-y-3">
				<div>
					<label
						for="api-base-url"
						class="block text-xs font-medium text-[var(--text-secondary)] mb-1"
					>
						API Base URL
					</label>
					<input
						id="api-base-url"
						v-model="apiBaseUrlInput"
						type="url"
						placeholder="http://localhost:5301"
						class="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
					/>
				</div>

				<div>
					<label
						for="auth-token"
						class="block text-xs font-medium text-[var(--text-secondary)] mb-1"
					>
						Access Token（若后端未开启 AUTH_TOKEN 可留空）
					</label>
					<div class="relative">
						<input
							id="auth-token"
							v-model="authTokenInput"
							:type="showToken ? 'text' : 'password'"
							placeholder="可选 Bearer Token"
							class="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-2.5 pr-10 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
						/>
						<button
							type="button"
							aria-label="切换 Token 可见性"
							class="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
							@click="showToken = !showToken"
						>
							<EyeOff v-if="showToken" class="h-4 w-4" />
							<Eye v-else class="h-4 w-4" />
						</button>
					</div>
				</div>

				<div>
					<label
						for="device-label"
						class="block text-xs font-medium text-[var(--text-secondary)] mb-1"
					>
						设备标识（跨设备同步时展示）
					</label>
					<div class="relative">
						<Monitor
							v-if="detectDeviceKind() === 'desktop'"
							class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
						/>
						<Smartphone
							v-else
							class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
						/>
						<input
							id="device-label"
							v-model="deviceLabelInput"
							type="text"
							placeholder="Desktop Web"
							class="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] pl-9 pr-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
						/>
					</div>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2.5 pt-1">
				<button
					type="button"
					class="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs sm:text-sm font-medium text-white hover:opacity-90"
					@click="handleSaveConnection"
				>
					保存设置
				</button>
				<button
					type="button"
					:disabled="testingConnection"
					class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-2 text-xs sm:text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
					@click="handleTestConnection"
				>
					<RefreshCw
						class="h-3.5 w-3.5"
						:class="{ 'animate-spin': testingConnection }"
					/>
					测试连接
				</button>
			</div>

			<p v-if="savedNotice" class="text-xs text-[var(--accent)]">
				{{ savedNotice }}
			</p>

			<div
				v-if="connectionResult"
				class="flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs sm:text-sm"
				:class="
					connectionResult.ok
						? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
						: 'border-red-500/30 bg-red-500/10 text-red-600'
				"
			>
				<CheckCircle2
					v-if="connectionResult.ok"
					class="h-4 w-4 shrink-0 mt-0.5"
				/>
				<XCircle v-else class="h-4 w-4 shrink-0 mt-0.5" />
				<span>{{ connectionResult.message }}</span>
			</div>
		</section>

		<!-- Cross-Device Sync Section -->
		<section
			class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 space-y-3"
		>
			<div class="flex items-center justify-between gap-3">
				<div>
					<h2 class="text-base font-semibold">跨设备同步</h2>
					<p class="mt-0.5 text-xs text-[var(--text-secondary)]">
						当前游标：{{ settingsStore.lastSyncServerTime }}
						<template v-if="libraryStore.lastSyncedAt">
							· 最近同步：{{
								new Date(libraryStore.lastSyncedAt).toLocaleTimeString("zh-CN")
							}}
						</template>
					</p>
				</div>

				<button
					type="button"
					:disabled="libraryStore.syncStatus === 'syncing'"
					class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
					@click="handleManualSync"
				>
					<RefreshCw
						class="h-3.5 w-3.5"
						:class="{ 'animate-spin text-[var(--accent)]': libraryStore.syncStatus === 'syncing' }"
					/>
					立即同步
				</button>
			</div>

			<p
				v-if="libraryStore.syncStatus === 'error' && libraryStore.lastSyncError"
				class="text-xs text-red-600"
			>
				上次同步失败：{{ libraryStore.lastSyncError }}
			</p>
		</section>

		<!-- Global Reader Defaults -->
		<section
			class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 space-y-4"
		>
			<div class="flex items-center justify-between">
				<h2 class="text-base font-semibold">阅读器默认外观</h2>
				<button
					type="button"
					class="text-xs text-[var(--accent)] hover:underline"
					@click="settingsStore.resetReaderSettings()"
				>
					恢复默认
				</button>
			</div>

			<div class="space-y-3">
				<div class="flex items-center justify-between gap-4">
					<span class="text-xs sm:text-sm text-[var(--text-secondary)]">
						默认翻页模式
					</span>
					<div class="flex gap-1.5">
						<button
							v-for="opt in modeOptions"
							:key="opt.value"
							type="button"
							class="rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors"
							:class="
								settingsStore.readerSettings.mode === opt.value
									? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
									: 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
							"
							@click="settingsStore.updateReaderSettings({ mode: opt.value })"
						>
							{{ opt.label }}
						</button>
					</div>
				</div>

				<div class="flex items-center justify-between gap-4">
					<span class="text-xs sm:text-sm text-[var(--text-secondary)]">
						主题配色
					</span>
					<div class="flex gap-1.5">
						<button
							v-for="opt in themeOptions"
							:key="opt.value"
							type="button"
							class="rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors"
							:class="
								settingsStore.readerSettings.theme === opt.value
									? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
									: 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
							"
							@click="settingsStore.updateReaderSettings({ theme: opt.value })"
						>
							{{ opt.label }}
						</button>
					</div>
				</div>

				<div class="space-y-1">
					<div class="flex justify-between text-xs text-[var(--text-secondary)]">
						<span>字体大小</span>
						<span>{{ settingsStore.readerSettings.fontSize }} px</span>
					</div>
					<input
						type="range"
						min="14"
						max="28"
						step="1"
						:value="settingsStore.readerSettings.fontSize"
						class="w-full accent-[var(--accent)]"
						@input="
							settingsStore.updateReaderSettings({
								fontSize: Number(($event.target as HTMLInputElement).value),
							})
						"
					/>
				</div>

				<div class="space-y-1">
					<div class="flex justify-between text-xs text-[var(--text-secondary)]">
						<span>行高</span>
						<span>{{ settingsStore.readerSettings.lineHeight.toFixed(1) }}</span>
					</div>
					<input
						type="range"
						min="1.4"
						max="2.4"
						step="0.1"
						:value="settingsStore.readerSettings.lineHeight"
						class="w-full accent-[var(--accent)]"
						@input="
							settingsStore.updateReaderSettings({
								lineHeight: Number(($event.target as HTMLInputElement).value),
							})
						"
					/>
				</div>

				<div class="space-y-1">
					<div class="flex justify-between text-xs text-[var(--text-secondary)]">
						<span>页面内边距</span>
						<span>{{ settingsStore.readerSettings.pagePadding }} px</span>
					</div>
					<input
						type="range"
						min="12"
						max="40"
						step="2"
						:value="settingsStore.readerSettings.pagePadding"
						class="w-full accent-[var(--accent)]"
						@input="
							settingsStore.updateReaderSettings({
								pagePadding: Number(($event.target as HTMLInputElement).value),
							})
						"
					/>
				</div>
			</div>
		</section>

		<!-- Offline Chapter Cache -->
		<section
			class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 flex items-center justify-between gap-4"
		>
			<div class="flex items-start gap-3">
				<Database class="h-5 w-5 text-[var(--accent)] mt-0.5 shrink-0" />
				<div>
					<h2 class="text-base font-semibold">离线章节缓存</h2>
					<p class="mt-0.5 text-xs text-[var(--text-secondary)]">
						已缓存 {{ cacheStats.count }} / 200 章 · 占用约
						{{ formatBytes(cacheStats.totalBytes) }}
					</p>
				</div>
			</div>

			<button
				type="button"
				:disabled="clearingCache || cacheStats.count === 0"
				class="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-40 shrink-0"
				@click="handleClearCache"
			>
				<Trash2 class="h-3.5 w-3.5" />
				清空缓存
			</button>
		</section>
	</div>
</template>
