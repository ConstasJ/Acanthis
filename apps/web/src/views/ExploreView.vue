<script setup lang="ts">
import type { NovelInfo, NovelSearchResult } from "@acanthis-dec/core";
import {
	BookOpen,
	ChevronLeft,
	ChevronRight,
	Clock,
	Search,
	X,
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
	ApiError,
	fetchNovels,
	rebaseMediaUrl,
	searchNovels,
} from "@/api/client";
import SetupBanner from "@/components/SetupBanner.vue";
import { useSettingsStore } from "@/stores/settings";
import { useSourcesStore } from "@/stores/sources";

const PAGE_SIZE = 20;

const settingsStore = useSettingsStore();
const sourcesStore = useSourcesStore();

const searchInput = ref<string>("");
const activeQuery = ref<string>("");

const novels = ref<NovelInfo[]>([]);
const searchResults = ref<NovelSearchResult[]>([]);
const currentPage = ref<number>(1);
const totalNovels = ref<number>(0);

const loadingList = ref<boolean>(false);
const loadingSearch = ref<boolean>(false);
const showSlowHint = ref<boolean>(false);
const errorMessage = ref<string | null>(null);
const failedCovers = ref<Set<string>>(new Set());

let searchAbortController: AbortController | null = null;
let slowHintTimer: ReturnType<typeof setTimeout> | null = null;

const activePlatform = computed<string>(() => {
	if (settingsStore.selectedExplorePlatform) {
		return settingsStore.selectedExplorePlatform;
	}
	return sourcesStore.sources[0]?.id ?? "linovelib";
});

const totalPages = computed<number>(() =>
	Math.max(1, Math.ceil(totalNovels.value / PAGE_SIZE)),
);

const isSearchMode = computed<boolean>(() => activeQuery.value.length > 0);

function getRebasedCover(rawUrl: string | undefined): string {
	return rebaseMediaUrl(rawUrl, settingsStore.apiBaseUrl);
}

function markCoverFailed(id: string): void {
	const next = new Set(failedCovers.value);
	next.add(id);
	failedCovers.value = next;
}

function clearSlowHintTimer(): void {
	if (slowHintTimer !== null) {
		clearTimeout(slowHintTimer);
		slowHintTimer = null;
	}
	showSlowHint.value = false;
}

function abortInFlightSearch(): void {
	if (searchAbortController !== null) {
		searchAbortController.abort();
		searchAbortController = null;
	}
	clearSlowHintTimer();
}

async function loadNovelsPage(page: number): Promise<void> {
	const platform = activePlatform.value;
	if (!platform) {
		return;
	}
	loadingList.value = true;
	errorMessage.value = null;

	try {
		const res = await fetchNovels(platform, page, PAGE_SIZE);
		novels.value = res.items;
		currentPage.value = res.page;
		totalNovels.value = res.total;
	} catch (err) {
		errorMessage.value =
			err instanceof ApiError
				? err.message
				: err instanceof Error
					? err.message
					: "加载书库列表失败";
	} finally {
		loadingList.value = false;
	}
}

async function executeSearch(keyword: string): Promise<void> {
	const trimmed = keyword.trim();
	activeQuery.value = trimmed;
	abortInFlightSearch();

	if (!trimmed) {
		loadingSearch.value = false;
		searchResults.value = [];
		await loadNovelsPage(currentPage.value);
		return;
	}

	const controller = new AbortController();
	searchAbortController = controller;
	loadingSearch.value = true;
	errorMessage.value = null;

	slowHintTimer = setTimeout(() => {
		if (searchAbortController === controller && !controller.signal.aborted) {
			showSlowHint.value = true;
		}
	}, 1500);

	try {
		const results = await searchNovels(
			activePlatform.value,
			trimmed,
			controller.signal,
		);
		if (controller.signal.aborted) {
			return;
		}
		searchResults.value = results;
	} catch (err) {
		if (
			controller.signal.aborted ||
			(typeof err === "object" &&
				err !== null &&
				"name" in err &&
				(err as { name: unknown }).name === "AbortError")
		) {
			return;
		}
		errorMessage.value =
			err instanceof ApiError
				? err.message
				: err instanceof Error
					? err.message
					: "搜索失败，请稍后重试";
	} finally {
		if (searchAbortController === controller) {
			searchAbortController = null;
			loadingSearch.value = false;
			clearSlowHintTimer();
		}
	}
}

function handleSearchSubmit(): void {
	void executeSearch(searchInput.value);
}

function handleClearSearch(): void {
	searchInput.value = "";
	activeQuery.value = "";
	abortInFlightSearch();
	loadingSearch.value = false;
	searchResults.value = [];
	void loadNovelsPage(1);
}

function handleSelectPlatform(platformId: string): void {
	if (platformId === activePlatform.value) {
		return;
	}
	settingsStore.setSelectedExplorePlatform(platformId);
	currentPage.value = 1;
	failedCovers.value = new Set();
	if (searchInput.value.trim()) {
		void executeSearch(searchInput.value);
	} else {
		void loadNovelsPage(1);
	}
}

function goToPage(page: number): void {
	const target = Math.min(totalPages.value, Math.max(1, page));
	if (target === currentPage.value && novels.value.length > 0) {
		return;
	}
	void loadNovelsPage(target);
}

function novelDetailRoute(platform: string, novelId: string): string {
	return `/novel/${encodeURIComponent(platform || activePlatform.value)}/${encodeURIComponent(novelId)}`;
}

watch(
	() => sourcesStore.sources,
	(list) => {
		if (
			list.length > 0 &&
			!isSearchMode.value &&
			novels.value.length === 0 &&
			!loadingList.value
		) {
			void loadNovelsPage(1);
		}
	},
);

onMounted(() => {
	if (!isSearchMode.value) {
		void loadNovelsPage(1);
	}
});

onBeforeUnmount(() => {
	abortInFlightSearch();
});
</script>

<template>
	<div class="space-y-5">
		<SetupBanner />

		<header class="space-y-3">
			<div>
				<h1 class="text-xl sm:text-2xl font-bold tracking-tight">书源 · 发现</h1>
				<p class="mt-0.5 text-xs sm:text-sm text-[var(--text-secondary)]">
					切换服务端书源浏览已缓存书库或实时搜索
				</p>
			</div>

			<!-- Source Pills -->
			<div class="flex flex-wrap items-center gap-2" role="tablist" aria-label="书源列表">
				<button
					v-for="source in sourcesStore.sources"
					:key="source.id"
					type="button"
					role="tab"
					:aria-selected="activePlatform === source.id"
					class="rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors border"
					:class="
						activePlatform === source.id
							? 'border-[var(--accent)] bg-[var(--accent)] text-white'
							: 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
					"
					@click="handleSelectPlatform(source.id)"
				>
					{{ source.name }}
				</button>

				<span
					v-if="sourcesStore.sources.length === 0 && !sourcesStore.loading"
					class="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-1.5 text-xs text-[var(--text-muted)]"
				>
					默认书源：{{ activePlatform }}
				</span>
			</div>

			<!-- Search Form -->
			<form class="flex gap-2" @submit.prevent="handleSearchSubmit">
				<div class="relative flex-1">
					<Search
						class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
					/>
					<input
						v-model="searchInput"
						type="search"
						placeholder="搜索书名或作者…"
						class="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-2.5 pl-10 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
					/>
					<button
						v-if="searchInput"
						type="button"
						aria-label="清空搜索"
						class="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
						@click="handleClearSearch"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
				<button
					type="submit"
					class="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 shrink-0"
				>
					搜索
				</button>
			</form>
		</header>

		<!-- Slow Search Hint (>1500ms) -->
		<div
			v-if="loadingSearch && showSlowHint"
			class="flex items-center gap-2 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/60 px-4 py-3 text-xs sm:text-sm text-[var(--text-secondary)]"
		>
			<Clock class="h-4 w-4 shrink-0 text-[var(--accent)] animate-pulse" />
			<span>正在等待源站响应，若触发源站人机校验可能需要数秒，请耐心等待…</span>
		</div>

		<!-- Error State -->
		<div
			v-if="errorMessage"
			class="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs sm:text-sm text-red-600 flex items-center justify-between gap-3"
		>
			<span>{{ errorMessage }}</span>
			<button
				type="button"
				class="shrink-0 rounded-lg border border-red-500/30 px-2.5 py-1 text-xs font-medium hover:bg-red-500/10"
				@click="isSearchMode ? handleSearchSubmit() : loadNovelsPage(currentPage)"
			>
				重试
			</button>
		</div>

		<!-- Search Results Mode -->
		<section v-if="isSearchMode" class="space-y-3">
			<div class="flex items-center justify-between text-xs text-[var(--text-secondary)]">
				<span>
					关键词「{{ activeQuery }}」{{
						loadingSearch ? "搜索中…" : `共找到 ${searchResults.length} 条结果`
					}}
				</span>
				<button
					type="button"
					class="text-[var(--accent)] hover:underline"
					@click="handleClearSearch"
				>
					返回书库列表
				</button>
			</div>

			<div
				v-if="loadingSearch"
				class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
			>
				<div
					v-for="idx in 5"
					:key="idx"
					class="aspect-[3/4] rounded-2xl bg-[var(--bg-secondary)] animate-pulse"
				/>
			</div>

			<div
				v-else-if="searchResults.length === 0 && !errorMessage"
				class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center text-sm text-[var(--text-muted)]"
			>
				未找到匹配「{{ activeQuery }}」的作品
			</div>

			<div
				v-else
				class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
			>
				<RouterLink
					v-for="item in searchResults"
					:key="`${item.platform}:${item.id}`"
					:to="novelDetailRoute(item.platform, item.id)"
					class="group flex flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] transition-shadow hover:shadow-sm"
				>
					<div class="relative aspect-[3/4] w-full bg-[var(--bg-secondary)] overflow-hidden">
						<img
							v-if="getRebasedCover(item.coverUrl) && !failedCovers.has(`s:${item.id}`)"
							:src="getRebasedCover(item.coverUrl)"
							:alt="item.title"
							loading="lazy"
							class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
							@error="markCoverFailed(`s:${item.id}`)"
						/>
						<div
							v-else
							class="flex h-full w-full items-center justify-center text-[var(--text-muted)]"
						>
							<BookOpen class="h-8 w-8" />
						</div>
					</div>
					<div class="p-3">
						<h3
							class="line-clamp-2 text-sm font-semibold text-[var(--text-primary)] leading-snug"
						>
							{{ item.title }}
						</h3>
					</div>
				</RouterLink>
			</div>
		</section>

		<!-- Paginated Novels Mode -->
		<section v-else class="space-y-4">
			<div class="flex items-center justify-between text-xs text-[var(--text-secondary)]">
				<span>已缓存书库 · 共 {{ totalNovels }} 部</span>
				<span>第 {{ currentPage }} / {{ totalPages }} 页</span>
			</div>

			<div
				v-if="loadingList"
				class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
			>
				<div
					v-for="idx in 10"
					:key="idx"
					class="aspect-[3/4] rounded-2xl bg-[var(--bg-secondary)] animate-pulse"
				/>
			</div>

			<div
				v-else-if="novels.length === 0 && !errorMessage"
				class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center text-sm text-[var(--text-muted)]"
			>
				当前书源暂无已缓存作品，试试上方搜索框直接检索作品。
			</div>

			<div
				v-else
				class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
			>
				<RouterLink
					v-for="item in novels"
					:key="`${item.platform}:${item.id}`"
					:to="novelDetailRoute(item.platform, item.id)"
					class="group flex flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] transition-shadow hover:shadow-sm"
				>
					<div class="relative aspect-[3/4] w-full bg-[var(--bg-secondary)] overflow-hidden">
						<img
							v-if="getRebasedCover(item.coverUrl) && !failedCovers.has(`n:${item.id}`)"
							:src="getRebasedCover(item.coverUrl)"
							:alt="item.title"
							loading="lazy"
							class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
							@error="markCoverFailed(`n:${item.id}`)"
						/>
						<div
							v-else
							class="flex h-full w-full items-center justify-center text-[var(--text-muted)]"
						>
							<BookOpen class="h-8 w-8" />
						</div>
						<span
							class="absolute right-2 top-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs"
						>
							{{
								item.status === "completed"
									? "已完结"
									: item.status === "ongoing"
										? "连载中"
										: "未知"
							}}
						</span>
					</div>
					<div class="flex flex-1 flex-col justify-between p-3">
						<div>
							<h3
								class="line-clamp-2 text-sm font-semibold text-[var(--text-primary)] leading-snug"
							>
								{{ item.title }}
							</h3>
							<p class="mt-1 truncate text-xs text-[var(--text-muted)]">
								{{ item.author || "未知作者" }}
							</p>
						</div>
					</div>
				</RouterLink>
			</div>

			<!-- Pagination Controls -->
			<div
				v-if="totalPages > 1"
				class="flex items-center justify-center gap-3 pt-2"
			>
				<button
					type="button"
					:disabled="currentPage <= 1 || loadingList"
					class="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-40"
					@click="goToPage(currentPage - 1)"
				>
					<ChevronLeft class="h-4 w-4" />
					上一页
				</button>
				<span class="text-xs text-[var(--text-secondary)]">
					{{ currentPage }} / {{ totalPages }}
				</span>
				<button
					type="button"
					:disabled="currentPage >= totalPages || loadingList"
					class="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-40"
					@click="goToPage(currentPage + 1)"
				>
					下一页
					<ChevronRight class="h-4 w-4" />
				</button>
			</div>
		</section>
	</div>
</template>
