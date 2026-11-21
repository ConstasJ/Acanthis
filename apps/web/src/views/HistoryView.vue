<script setup lang="ts">
import type { ReadingProgress } from "@acanthis-dec/core";
import {
	BookOpen,
	Clock,
	Compass,
	History,
	Play,
	Search,
	Smartphone,
	Trash2,
	X,
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { rebaseMediaUrl } from "@/api/client";
import SetupBanner from "@/components/SetupBanner.vue";
import { makeCompositeKey } from "@/db/indexedDb";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { useSourcesStore } from "@/stores/sources";

interface HistoryDateGroup {
	key: string;
	label: string;
	items: ReadingProgress[];
}

const libraryStore = useLibraryStore();
const settingsStore = useSettingsStore();
const sourcesStore = useSourcesStore();

const searchQuery = ref<string>("");
const showClearConfirm = ref<boolean>(false);
const clearing = ref<boolean>(false);
const toastMessage = ref<string | null>(null);
const failedCovers = ref<Set<string>>(new Set());

let toastTimer: ReturnType<typeof setTimeout> | null = null;

const sourceNameMap = computed(() => {
	const map = new Map<string, string>();
	for (const source of sourcesStore.sources) {
		map.set(source.id, source.name);
	}
	return map;
});

function getSourceName(platform: string): string {
	return sourceNameMap.value.get(platform) ?? platform;
}

function getRebasedCover(rawUrl: string): string {
	return rebaseMediaUrl(rawUrl, settingsStore.apiBaseUrl);
}

function markCoverFailed(key: string): void {
	const next = new Set(failedCovers.value);
	next.add(key);
	failedCovers.value = next;
}

function showToast(message: string): void {
	toastMessage.value = message;
	if (toastTimer !== null) {
		clearTimeout(toastTimer);
	}
	toastTimer = setTimeout(() => {
		toastMessage.value = null;
		toastTimer = null;
	}, 2200);
}

function pad2(num: number): string {
	return String(num).padStart(2, "0");
}

function getLocalDayKey(date: Date): string {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatDayGroupLabel(date: Date, todayKey: string, yesterdayKey: string): string {
	const key = getLocalDayKey(date);
	if (key === todayKey) {
		return "今天";
	}
	if (key === yesterdayKey) {
		return "昨天";
	}
	return `${date.getFullYear()}年${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日`;
}

function formatTimeHHmm(timestamp: number): string {
	const date = new Date(timestamp);
	return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function novelDetailRoute(platform: string, novelId: string): string {
	return `/novel/${encodeURIComponent(platform)}/${encodeURIComponent(novelId)}`;
}

function readerRoute(progress: ReadingProgress): string {
	return `/read/${encodeURIComponent(progress.platform)}/${encodeURIComponent(progress.novelId)}/${encodeURIComponent(progress.chapterId)}`;
}

const filteredHistory = computed<ReadingProgress[]>(() => {
	const keyword = searchQuery.value.trim().toLowerCase();
	if (!keyword) {
		return libraryStore.historyList;
	}
	return libraryStore.historyList.filter((item) => {
		const novelTitle = item.novelTitle.toLowerCase();
		const chapterTitle = item.chapterTitle.toLowerCase();
		const volumeTitle = item.volumeTitle.toLowerCase();
		return (
			novelTitle.includes(keyword) ||
			chapterTitle.includes(keyword) ||
			volumeTitle.includes(keyword)
		);
	});
});

const groupedHistory = computed<HistoryDateGroup[]>(() => {
	const now = new Date();
	const todayKey = getLocalDayKey(now);
	const yesterdayDate = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() - 1,
	);
	const yesterdayKey = getLocalDayKey(yesterdayDate);

	const groups: HistoryDateGroup[] = [];
	const groupMap = new Map<string, HistoryDateGroup>();

	for (const item of filteredHistory.value) {
		const date = new Date(item.updatedAt);
		const dayKey = getLocalDayKey(date);
		let group = groupMap.get(dayKey);
		if (!group) {
			group = {
				key: dayKey,
				label: formatDayGroupLabel(date, todayKey, yesterdayKey),
				items: [],
			};
			groupMap.set(dayKey, group);
			groups.push(group);
		}
		group.items.push(item);
	}

	return groups;
});

async function handleRemoveItem(item: ReadingProgress): Promise<void> {
	await libraryStore.removeHistoryItem(item.platform, item.novelId);
	showToast("已从历史记录移除");
}

async function handleConfirmClearAll(): Promise<void> {
	if (clearing.value) {
		return;
	}
	clearing.value = true;
	try {
		const count = await libraryStore.clearAllHistory();
		showClearConfirm.value = false;
		if (count > 0) {
			showToast(`已清空 ${count} 条阅读历史`);
		}
	} finally {
		clearing.value = false;
	}
}

function handleDocumentKeyDown(event: KeyboardEvent): void {
	if (event.key === "Escape" && showClearConfirm.value) {
		showClearConfirm.value = false;
	}
}

onMounted(() => {
	document.addEventListener("keydown", handleDocumentKeyDown);
});

onBeforeUnmount(() => {
	document.removeEventListener("keydown", handleDocumentKeyDown);
	if (toastTimer !== null) {
		clearTimeout(toastTimer);
		toastTimer = null;
	}
});
</script>

<template>
	<div class="space-y-5">
		<SetupBanner />

		<header class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h1 class="text-xl sm:text-2xl font-bold tracking-tight">历史</h1>
				<p class="mt-0.5 text-xs sm:text-sm text-[var(--text-secondary)]">
					每部作品保留最近阅读进度 · 共 {{ libraryStore.historyList.length }} 条记录
				</p>
			</div>

			<button
				type="button"
				:disabled="libraryStore.historyList.length === 0"
				class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
				@click="showClearConfirm = true"
			>
				<Trash2 class="h-3.5 w-3.5" />
				清空历史
			</button>
		</header>

		<!-- Search Bar -->
		<div class="relative">
			<Search
				class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
			/>
			<input
				v-model="searchQuery"
				type="search"
				placeholder="按书名或章节名搜索阅读历史…"
				aria-label="搜索阅读历史"
				class="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-2.5 pl-10 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
			/>
			<button
				v-if="searchQuery"
				type="button"
				aria-label="清除搜索"
				class="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
				@click="searchQuery = ''"
			>
				<X class="h-4 w-4" />
			</button>
		</div>

		<!-- Empty State: No history at all -->
		<div
			v-if="libraryStore.historyList.length === 0"
			class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center space-y-3"
		>
			<History class="mx-auto h-10 w-10 text-[var(--text-muted)]" />
			<div class="space-y-1">
				<p class="text-sm font-medium text-[var(--text-primary)]">
					还没有阅读历史
				</p>
				<p class="text-xs text-[var(--text-secondary)]">
					打开任意轻小说开始阅读后，这里会自动按日期记录你的最近进度并跨设备同步。
				</p>
			</div>
			<RouterLink
				to="/explore"
				class="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:opacity-90"
			>
				<Compass class="h-4 w-4" />
				去发现好书
			</RouterLink>
		</div>

		<!-- Empty State: Search has no match -->
		<div
			v-else-if="groupedHistory.length === 0"
			class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center space-y-3"
		>
			<Search class="mx-auto h-9 w-9 text-[var(--text-muted)]" />
			<div class="space-y-1">
				<p class="text-sm font-medium text-[var(--text-primary)]">
					未找到匹配「{{ searchQuery.trim() }}」的记录
				</p>
				<p class="text-xs text-[var(--text-secondary)]">
					试试更换书名或章节关键词，或清空搜索条件。
				</p>
			</div>
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
				@click="searchQuery = ''"
			>
				清空搜索
			</button>
		</div>

		<!-- Grouped History List -->
		<div v-else class="space-y-6">
			<section
				v-for="group in groupedHistory"
				:key="group.key"
				class="space-y-2.5"
			>
				<div class="flex items-center gap-2 px-1">
					<h2 class="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
						{{ group.label }}
					</h2>
					<span class="text-[11px] text-[var(--text-muted)]">
						{{ group.items.length }}
					</span>
				</div>

				<div class="space-y-2">
					<article
						v-for="item in group.items"
						:key="makeCompositeKey(item.platform, item.novelId)"
						class="flex items-center gap-3.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 transition-colors hover:border-[var(--accent)]/40"
					>
						<!-- Cover Thumbnail -> Detail -->
						<RouterLink
							:to="novelDetailRoute(item.platform, item.novelId)"
							class="relative h-20 w-14 shrink-0 overflow-hidden rounded-xl bg-[var(--bg-secondary)]"
						>
							<img
								v-if="
									getRebasedCover(item.coverUrl) &&
									!failedCovers.has(makeCompositeKey(item.platform, item.novelId))
								"
								:src="getRebasedCover(item.coverUrl)"
								:alt="item.novelTitle"
								loading="lazy"
								class="h-full w-full object-cover"
								@error="
									markCoverFailed(makeCompositeKey(item.platform, item.novelId))
								"
							/>
							<div
								v-else
								class="flex h-full w-full items-center justify-center text-[var(--text-muted)]"
							>
								<BookOpen class="h-5 w-5" />
							</div>
						</RouterLink>

						<!-- Title & Progress Info -->
						<div class="min-w-0 flex-1 space-y-1">
							<RouterLink
								:to="novelDetailRoute(item.platform, item.novelId)"
								class="block truncate text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent)]"
							>
								{{ item.novelTitle }}
							</RouterLink>

							<p class="truncate text-xs text-[var(--text-secondary)]">
								<template v-if="item.volumeTitle">
									{{ item.volumeTitle }} ·
								</template>
								{{ item.chapterTitle }}
							</p>

							<div
								class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--text-muted)]"
							>
								<span class="inline-flex items-center gap-1">
									<Clock class="h-3 w-3" />
									{{ formatTimeHHmm(item.updatedAt) }}
								</span>
								<span class="inline-flex items-center gap-1 truncate">
									<Smartphone class="h-3 w-3 shrink-0" />
									<span class="truncate">{{ item.deviceLabel }}</span>
								</span>
								<span
									class="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
								>
									{{ getSourceName(item.platform) }}
								</span>
							</div>
						</div>

						<!-- Actions -->
						<div class="flex shrink-0 items-center gap-1.5">
							<RouterLink
								:to="readerRoute(item)"
								class="inline-flex items-center gap-1 rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white hover:opacity-90"
							>
								<Play class="h-3.5 w-3.5 fill-current" />
								<span class="hidden sm:inline">继续</span>
							</RouterLink>

							<button
								type="button"
								aria-label="删除此条历史记录"
								title="删除历史记录"
								class="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600"
								@click="handleRemoveItem(item)"
							>
								<Trash2 class="h-3.5 w-3.5" />
							</button>
						</div>
					</article>
				</div>
			</section>
		</div>

		<!-- Clear All Confirmation Dialog -->
		<div
			v-if="showClearConfirm"
			role="dialog"
			aria-modal="true"
			aria-labelledby="clear-history-dialog-title"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
			@click.self="showClearConfirm = false"
			@keydown.esc="showClearConfirm = false"
		>
			<div
				class="w-full max-w-sm rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 shadow-xl space-y-4"
			>
				<div class="space-y-1.5">
					<h2
						id="clear-history-dialog-title"
						class="text-base font-semibold text-[var(--text-primary)]"
					>
						清空全部阅读历史？
					</h2>
					<p class="text-xs leading-relaxed text-[var(--text-secondary)]">
						将清除当前所有 {{ libraryStore.historyList.length }} 条阅读历史记录并同步到其他设备，不会移除书架中的作品。
					</p>
				</div>

				<div class="flex items-center justify-end gap-2">
					<button
						type="button"
						:disabled="clearing"
						class="rounded-xl border border-[var(--border-subtle)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
						@click="showClearConfirm = false"
					>
						取消
					</button>
					<button
						type="button"
						:disabled="clearing"
						class="rounded-xl bg-red-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
						@click="handleConfirmClearAll"
					>
						{{ clearing ? "清空中…" : "确认清空" }}
					</button>
				</div>
			</div>
		</div>

		<!-- Toast Notification (no Undo) -->
		<div
			v-if="toastMessage"
			role="status"
			aria-live="polite"
			class="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-xl bg-[var(--text-primary)] px-4 py-2 text-xs font-medium text-[var(--bg-primary)] shadow-lg md:bottom-8"
		>
			{{ toastMessage }}
		</div>
	</div>
</template>
