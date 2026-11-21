<script setup lang="ts">
import type {
	BookshelfItem,
	NovelStatus,
	ReadingProgress,
} from "@acanthis-dec/core";
import {
	ArrowUpDown,
	BookOpen,
	Compass,
	FolderKanban,
	MoreVertical,
	Play,
	RefreshCw,
	Search,
	SlidersHorizontal,
	Smartphone,
	Tag,
	Trash2,
	X,
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { rebaseMediaUrl } from "@/api/client";
import SearchableTagPicker, {
	type TagPickerOption,
} from "@/components/SearchableTagPicker.vue";
import SetupBanner from "@/components/SetupBanner.vue";
import ShelfAssignModal from "@/components/ShelfAssignModal.vue";
import ShelfManagerModal from "@/components/ShelfManagerModal.vue";
import { makeCompositeKey } from "@/db/indexedDb";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { useSourcesStore } from "@/stores/sources";

type SortMode = "recentRead" | "recentAdded" | "title";
type StatusFilter = "all" | "ongoing" | "completed";
type ShelfSelection = "all" | "default" | string;

interface GenreOption {
	name: string;
	count: number;
}

const route = useRoute();
const router = useRouter();
const libraryStore = useLibraryStore();
const settingsStore = useSettingsStore();
const sourcesStore = useSourcesStore();

const selectedShelf = ref<ShelfSelection>("all");
const searchQuery = ref<string>("");
const selectedGenres = ref<string[]>([]);
const statusFilter = ref<StatusFilter>("all");
const sortMode = ref<SortMode>("recentRead");

const shelfManagerOpen = ref<boolean>(false);
const assignTarget = ref<BookshelfItem | null>(null);

const openMenuKey = ref<string | null>(null);
const failedCovers = ref<Set<string>>(new Set());

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

function formatRelativeTime(timestamp: number): string {
	const diffMs = Math.max(0, Date.now() - timestamp);
	const mins = Math.floor(diffMs / 60_000);
	if (mins < 1) {
		return "刚刚";
	}
	if (mins < 60) {
		return `${mins} 分钟前`;
	}
	const hours = Math.floor(mins / 60);
	if (hours < 24) {
		return `${hours} 小时前`;
	}
	const days = Math.floor(hours / 24);
	if (days < 30) {
		return `${days} 天前`;
	}
	return new Date(timestamp).toLocaleDateString("zh-CN");
}

function calcProgressPercent(progress: ReadingProgress): number {
	if (progress.totalParagraphs <= 0) {
		return 0;
	}
	const ratio = (progress.paragraphIndex + 1) / progress.totalParagraphs;
	return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

function applyGenreFromRouteQuery(): void {
	const raw = route.query.genre;
	const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
	const parsed = Array.from(
		new Set(
			list
				.flatMap((entry) => (typeof entry === "string" ? entry.split(",") : []))
				.map((entry) => entry.trim())
				.filter(Boolean),
		),
	);
	if (parsed.length > 0) {
		selectedShelf.value = "all";
		selectedGenres.value = parsed;
	}
}

watch(
	() => route.query.genre,
	() => {
		applyGenreFromRouteQuery();
	},
	{ immediate: true },
);

watch(
	() => libraryStore.activeCategories,
	(categories) => {
		if (
			selectedShelf.value !== "all" &&
			selectedShelf.value !== "default" &&
			!categories.some((category) => category.id === selectedShelf.value)
		) {
			selectedShelf.value = "all";
		}
	},
);

const continueReading = computed(() => libraryStore.continueReadingItem);

const shelfCounts = computed(() => {
	let defaultCount = 0;
	const byCategory = new Map<string, number>();

	for (const item of libraryStore.activeBookshelf) {
		const effectiveIds = libraryStore.getEffectiveCategoryIds(item);
		if (effectiveIds.length === 0) {
			defaultCount += 1;
		} else {
			for (const id of effectiveIds) {
				byCategory.set(id, (byCategory.get(id) ?? 0) + 1);
			}
		}
	}

	return {
		all: libraryStore.activeBookshelf.length,
		default: defaultCount,
		byCategory,
	};
});

const itemsInSelectedShelf = computed<BookshelfItem[]>(() => {
	const shelf = selectedShelf.value;
	if (shelf === "all") {
		return libraryStore.activeBookshelf;
	}
	if (shelf === "default") {
		return libraryStore.activeBookshelf.filter(
			(item) => libraryStore.getEffectiveCategoryIds(item).length === 0,
		);
	}
	return libraryStore.activeBookshelf.filter((item) =>
		libraryStore.getEffectiveCategoryIds(item).includes(shelf),
	);
});

const availableGenres = computed<GenreOption[]>(() => {
	const counts = new Map<string, number>();
	for (const item of itemsInSelectedShelf.value) {
		for (const genre of item.genres ?? []) {
			const trimmed = genre.trim();
			if (trimmed) {
				counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
			}
		}
	}
	const list: GenreOption[] = [];
	for (const [name, count] of counts.entries()) {
		list.push({ name, count });
	}
	list.sort((a, b) => {
		if (b.count !== a.count) {
			return b.count - a.count;
		}
		return a.name.localeCompare(b.name, "zh-CN");
	});
	return list;
});

const genrePickerOptions = computed<TagPickerOption[]>(() =>
	availableGenres.value.map((genre) => ({
		value: genre.name,
		label: genre.name,
		count: genre.count,
	})),
);

const hasActiveFilters = computed<boolean>(
	() =>
		searchQuery.value.trim().length > 0 ||
		selectedGenres.value.length > 0 ||
		statusFilter.value !== "all",
);

const filteredBookshelf = computed<BookshelfItem[]>(() => {
	const keyword = searchQuery.value.trim().toLowerCase();
	const requiredGenres = selectedGenres.value;
	const targetStatus: NovelStatus | null =
		statusFilter.value === "all" ? null : statusFilter.value;

	const matched = itemsInSelectedShelf.value.filter((item) => {
		if (keyword) {
			const titleMatch = item.title.toLowerCase().includes(keyword);
			const authorMatch = item.author.toLowerCase().includes(keyword);
			if (!titleMatch && !authorMatch) {
				return false;
			}
		}
		if (targetStatus !== null && (item.status ?? "unknown") !== targetStatus) {
			return false;
		}
		if (requiredGenres.length > 0) {
			const itemGenreSet = new Set(item.genres ?? []);
			for (const genre of requiredGenres) {
				if (!itemGenreSet.has(genre)) {
					return false;
				}
			}
		}
		return true;
	});

	if (sortMode.value === "recentAdded") {
		return [...matched].sort((a, b) => b.addedAt - a.addedAt);
	}
	if (sortMode.value === "title") {
		return [...matched].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
	}
	return [...matched].sort((a, b) => {
		const progA = libraryStore.getProgress(a.platform, a.novelId);
		const progB = libraryStore.getProgress(b.platform, b.novelId);
		const timeA = Math.max(progA?.updatedAt ?? 0, a.addedAt);
		const timeB = Math.max(progB?.updatedAt ?? 0, b.addedAt);
		return timeB - timeA;
	});
});

function toggleGenreFilter(genre: string): void {
	if (selectedGenres.value.includes(genre)) {
		selectedGenres.value = selectedGenres.value.filter((item) => item !== genre);
	} else {
		selectedGenres.value = [...selectedGenres.value, genre];
	}
}

function handleSelectedGenresUpdate(value: string | string[]): void {
	selectedGenres.value = Array.isArray(value) ? value : value ? [value] : [];
}

function resetFilters(): void {
	searchQuery.value = "";
	selectedGenres.value = [];
	statusFilter.value = "all";
	if (route.query.genre !== undefined) {
		const nextQuery = { ...route.query };
		delete nextQuery.genre;
		void router.replace({ query: nextQuery });
	}
}

function openAssignModal(item: BookshelfItem): void {
	openMenuKey.value = null;
	assignTarget.value = item;
}

function toggleMenu(key: string): void {
	openMenuKey.value = openMenuKey.value === key ? null : key;
}

async function handleRemoveFromBookshelf(item: BookshelfItem): Promise<void> {
	openMenuKey.value = null;
	await libraryStore.toggleBookshelf({
		platform: item.platform,
		novelId: item.novelId,
		title: item.title,
		author: item.author,
		coverUrl: item.coverUrl,
	});
}

function readerRouteForProgress(progress: ReadingProgress): string {
	return `/read/${encodeURIComponent(progress.platform)}/${encodeURIComponent(progress.novelId)}/${encodeURIComponent(progress.chapterId)}`;
}

function novelDetailRoute(platform: string, novelId: string): string {
	return `/novel/${encodeURIComponent(platform)}/${encodeURIComponent(novelId)}`;
}

function handleDocumentClick(event: MouseEvent): void {
	const target = event.target as HTMLElement | null;
	if (openMenuKey.value !== null && !target?.closest("[data-bookshelf-menu]")) {
		openMenuKey.value = null;
	}
}

function handleDocumentKeyDown(event: KeyboardEvent): void {
	if (event.key === "Escape") {
		if (openMenuKey.value !== null) {
			openMenuKey.value = null;
		}
	}
}

onMounted(() => {
	document.addEventListener("click", handleDocumentClick);
	document.addEventListener("keydown", handleDocumentKeyDown);
});

onBeforeUnmount(() => {
	document.removeEventListener("click", handleDocumentClick);
	document.removeEventListener("keydown", handleDocumentKeyDown);
});
</script>

<template>
	<div class="space-y-5">
		<SetupBanner />

		<header class="flex items-center justify-between gap-3">
			<div>
				<h1 class="text-xl sm:text-2xl font-bold tracking-tight">我的书架</h1>
				<p class="mt-0.5 text-xs sm:text-sm text-[var(--text-secondary)]">
					本地优先存储 · 共收藏 {{ shelfCounts.all }} 部作品
				</p>
			</div>

			<button
				type="button"
				:disabled="libraryStore.syncStatus === 'syncing'"
				class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
				@click="libraryStore.syncNow()"
			>
				<RefreshCw
					class="h-3.5 w-3.5"
					:class="{ 'animate-spin text-[var(--accent)]': libraryStore.syncStatus === 'syncing' }"
				/>
				{{ libraryStore.syncStatus === "syncing" ? "同步中…" : "同步" }}
			</button>
		</header>

		<!-- Continue Reading Hero Card -->
		<section v-if="continueReading" aria-label="继续阅读">
			<RouterLink
				:to="readerRouteForProgress(continueReading)"
				class="group block rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 sm:p-5 shadow-xs transition-all hover:border-[var(--accent)]/50"
			>
				<div class="flex gap-4">
					<div
						class="relative h-28 w-20 sm:h-32 sm:w-24 shrink-0 overflow-hidden rounded-xl bg-[var(--bg-secondary)]"
					>
						<img
							v-if="
								getRebasedCover(continueReading.coverUrl) &&
								!failedCovers.has(`hero:${continueReading.platform}:${continueReading.novelId}`)
							"
							:src="getRebasedCover(continueReading.coverUrl)"
							:alt="continueReading.novelTitle"
							class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
							@error="
								markCoverFailed(`hero:${continueReading.platform}:${continueReading.novelId}`)
							"
						/>
						<div
							v-else
							class="flex h-full w-full items-center justify-center text-[var(--text-muted)]"
						>
							<BookOpen class="h-7 w-7" />
						</div>
					</div>

					<div class="flex min-w-0 flex-1 flex-col justify-between">
						<div>
							<div class="flex flex-wrap items-center gap-2">
								<span
									class="inline-flex items-center rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]"
								>
									继续阅读 · {{ getSourceName(continueReading.platform) }}
								</span>
								<span
									class="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]"
								>
									<Smartphone class="h-3 w-3" />
									{{ continueReading.deviceLabel }} ·
									{{ formatRelativeTime(continueReading.updatedAt) }}
								</span>
							</div>

							<h2
								class="mt-1.5 text-base sm:text-lg font-semibold text-[var(--text-primary)] truncate"
							>
								{{ continueReading.novelTitle }}
							</h2>
							<p class="mt-0.5 text-xs sm:text-sm text-[var(--text-secondary)] truncate">
								{{ continueReading.volumeTitle }} · {{ continueReading.chapterTitle }}
							</p>
						</div>

						<div class="mt-3 space-y-1.5">
							<div class="flex items-center justify-between text-xs">
								<span class="text-[var(--text-muted)]">
									第 {{ continueReading.paragraphIndex + 1 }} /
									{{ Math.max(1, continueReading.totalParagraphs) }} 段
								</span>
								<span class="font-semibold text-[var(--accent)]">
									{{ calcProgressPercent(continueReading) }}%
								</span>
							</div>
							<div
								class="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-secondary)]"
							>
								<div
									class="h-full rounded-full bg-[var(--accent)] transition-all"
									:style="{ width: `${calcProgressPercent(continueReading)}%` }"
								/>
							</div>
						</div>
					</div>

					<div class="hidden sm:flex items-center">
						<span
							class="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white group-hover:opacity-90"
						>
							<Play class="h-4 w-4 fill-current" />
							继续阅读
						</span>
					</div>
				</div>
			</RouterLink>
		</section>

		<!-- Shelf Tabs Bar -->
		<section class="space-y-3">
			<div class="flex items-center gap-2">
				<div
					class="flex flex-1 items-center gap-1.5 overflow-x-auto pb-1"
					role="tablist"
					aria-label="书架分组"
				>
					<button
						type="button"
						role="tab"
						:aria-selected="selectedShelf === 'all'"
						class="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors"
						:class="
							selectedShelf === 'all'
								? 'bg-[var(--accent)] text-white'
								: 'border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
						"
						@click="selectedShelf = 'all'"
					>
						<span>全部</span>
						<span class="opacity-75">{{ shelfCounts.all }}</span>
					</button>

					<button
						type="button"
						role="tab"
						:aria-selected="selectedShelf === 'default'"
						class="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors"
						:class="
							selectedShelf === 'default'
								? 'bg-[var(--accent)] text-white'
								: 'border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
						"
						@click="selectedShelf = 'default'"
					>
						<span>默认</span>
						<span class="opacity-75">{{ shelfCounts.default }}</span>
					</button>

					<button
						v-for="category in libraryStore.activeCategories"
						:key="category.id"
						type="button"
						role="tab"
						:aria-selected="selectedShelf === category.id"
						class="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors"
						:class="
							selectedShelf === category.id
								? 'bg-[var(--accent)] text-white'
								: 'border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
						"
						@click="selectedShelf = category.id"
					>
						<span class="max-w-32 truncate">{{ category.name }}</span>
						<span class="opacity-75">
							{{ shelfCounts.byCategory.get(category.id) ?? 0 }}
						</span>
					</button>
				</div>

				<button
					type="button"
					class="inline-flex shrink-0 items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
					@click="shelfManagerOpen = true"
				>
					<SlidersHorizontal class="h-3.5 w-3.5" />
					管理
				</button>
			</div>

			<!-- Search, Filter & Sort Toolbar -->
			<div class="flex flex-wrap items-center gap-2">
				<!-- Search Input -->
				<div class="relative min-w-48 flex-1">
					<Search
						class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"
					/>
					<input
						v-model="searchQuery"
						type="search"
						placeholder="搜索书名或作者…"
						aria-label="搜索书架作品"
						class="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1.5 pl-8 pr-8 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
					/>
					<button
						v-if="searchQuery"
						type="button"
						aria-label="清除搜索"
						class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
						@click="searchQuery = ''"
					>
						<X class="h-3.5 w-3.5" />
					</button>
				</div>

				<!-- Genre Multi-Select Dropdown -->
				<SearchableTagPicker
					:options="genrePickerOptions"
					:model-value="selectedGenres"
					:multiple="true"
					label="标签"
					panel-title="题材标签（多选交集）"
					placeholder="搜索题材标签…"
					empty-text="当前书架内暂无题材标签数据"
					align="right"
					@update:model-value="handleSelectedGenresUpdate"
				/>

				<!-- Status Filter -->
				<fieldset
					class="inline-flex items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5 text-xs"
					aria-label="连载状态筛选"
				>
					<button
						type="button"
						class="rounded-lg px-2 py-1 font-medium transition-colors"
						:class="
							statusFilter === 'all'
								? 'bg-[var(--accent-soft)] text-[var(--accent)]'
								: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
						"
						@click="statusFilter = 'all'"
					>
						全部状态
					</button>
					<button
						type="button"
						class="rounded-lg px-2 py-1 font-medium transition-colors"
						:class="
							statusFilter === 'ongoing'
								? 'bg-[var(--accent-soft)] text-[var(--accent)]'
								: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
						"
						@click="statusFilter = 'ongoing'"
					>
						连载中
					</button>
					<button
						type="button"
						class="rounded-lg px-2 py-1 font-medium transition-colors"
						:class="
							statusFilter === 'completed'
								? 'bg-[var(--accent-soft)] text-[var(--accent)]'
								: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
						"
						@click="statusFilter = 'completed'"
					>
						已完结
					</button>
				</fieldset>

				<!-- Sort Switch -->
				<fieldset
					class="inline-flex items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5 text-xs"
					aria-label="排序方式"
				>
					<button
						type="button"
						class="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium transition-colors"
						:class="
							sortMode === 'recentRead'
								? 'bg-[var(--accent-soft)] text-[var(--accent)]'
								: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
						"
						@click="sortMode = 'recentRead'"
					>
						<ArrowUpDown class="h-3 w-3" />
						最近阅读
					</button>
					<button
						type="button"
						class="rounded-lg px-2 py-1 font-medium transition-colors"
						:class="
							sortMode === 'recentAdded'
								? 'bg-[var(--accent-soft)] text-[var(--accent)]'
								: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
						"
						@click="sortMode = 'recentAdded'"
					>
						最近添加
					</button>
					<button
						type="button"
						class="rounded-lg px-2 py-1 font-medium transition-colors"
						:class="
							sortMode === 'title'
								? 'bg-[var(--accent-soft)] text-[var(--accent)]'
								: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
						"
						@click="sortMode = 'title'"
					>
						书名
					</button>
				</fieldset>
			</div>

			<!-- Active Filters Bar -->
			<div v-if="hasActiveFilters" class="flex flex-wrap items-center gap-1.5">
				<span
					v-for="genre in selectedGenres"
					:key="genre"
					class="inline-flex items-center gap-1 rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent)]"
				>
					<Tag class="h-3 w-3" />
					{{ genre }}
					<button
						type="button"
						:aria-label="`移除标签 ${genre}`"
						class="rounded hover:bg-[var(--accent)]/20"
						@click="toggleGenreFilter(genre)"
					>
						<X class="h-3 w-3" />
					</button>
				</span>

				<span
					v-if="statusFilter !== 'all'"
					class="inline-flex items-center gap-1 rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent)]"
				>
					{{ statusFilter === "ongoing" ? "连载中" : "已完结" }}
					<button
						type="button"
						aria-label="清除状态筛选"
						class="rounded hover:bg-[var(--accent)]/20"
						@click="statusFilter = 'all'"
					>
						<X class="h-3 w-3" />
					</button>
				</span>

				<span
					v-if="searchQuery.trim()"
					class="inline-flex items-center gap-1 rounded-lg bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-secondary)]"
				>
					关键词：{{ searchQuery.trim() }}
					<button
						type="button"
						aria-label="清除关键词"
						class="rounded hover:bg-[var(--bg-primary)]"
						@click="searchQuery = ''"
					>
						<X class="h-3 w-3" />
					</button>
				</span>

				<button
					type="button"
					class="ml-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline"
					@click="resetFilters"
				>
					重置筛选
				</button>
			</div>

			<!-- Empty State: Entire bookshelf empty -->
			<div
				v-if="shelfCounts.all === 0"
				class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center space-y-3"
			>
				<BookOpen class="mx-auto h-10 w-10 text-[var(--text-muted)]" />
				<div class="space-y-1">
					<p class="text-sm font-medium text-[var(--text-primary)]">
						书架还是空的
					</p>
					<p class="text-xs text-[var(--text-secondary)]">
						前往「发现」页浏览或搜索轻小说，将其加入书架后即可跨设备同步阅读进度。
					</p>
				</div>
				<div class="flex flex-wrap items-center justify-center gap-2">
					<RouterLink
						v-if="selectedGenres.length > 0"
						:to="{
							name: 'explore',
							query: { tab: 'cached', genre: selectedGenres.join(',') },
						}"
						class="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:opacity-90"
					>
						<Compass class="h-4 w-4" />
						去服务器缓存中查看「{{ selectedGenres.join(" · ") }}」
					</RouterLink>
					<RouterLink
						to="/explore"
						class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
					>
						<Compass class="h-4 w-4" />
						去发现好书
					</RouterLink>
				</div>
			</div>

			<!-- Empty State: Current shelf or filter has no matches -->
			<div
				v-else-if="filteredBookshelf.length === 0"
				class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center space-y-3"
			>
				<BookOpen class="mx-auto h-9 w-9 text-[var(--text-muted)]" />
				<div class="space-y-1">
					<p class="text-sm font-medium text-[var(--text-primary)]">
						{{ hasActiveFilters ? "没有符合当前筛选条件的作品" : "当前书架暂无作品" }}
					</p>
					<p class="text-xs text-[var(--text-secondary)]">
						{{
							hasActiveFilters
								? "可以调整标签/状态筛选，或去服务器缓存中按题材查找更多作品。"
								: "可在任意作品卡片菜单中选择「管理所属书架」将作品加入此分组。"
						}}
					</p>
				</div>
				<div class="flex flex-wrap items-center justify-center gap-2">
					<RouterLink
						v-if="selectedGenres.length > 0"
						:to="{
							name: 'explore',
							query: { tab: 'cached', genre: selectedGenres.join(',') },
						}"
						class="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:opacity-90"
					>
						<Compass class="h-4 w-4" />
						去服务器缓存中查看「{{ selectedGenres.join(" · ") }}」
					</RouterLink>
					<button
						v-if="hasActiveFilters"
						type="button"
						class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
						@click="resetFilters"
					>
						重置筛选
					</button>
					<button
						v-else-if="selectedShelf !== 'all'"
						type="button"
						class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
						@click="selectedShelf = 'all'"
					>
						查看全部藏书
					</button>
				</div>
			</div>

			<!-- Grid -->
			<div
				v-else
				class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
			>
				<div
					v-for="item in filteredBookshelf"
					:key="makeCompositeKey(item.platform, item.novelId)"
					class="group relative flex flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-visible transition-shadow hover:shadow-sm"
				>
					<RouterLink
						:to="novelDetailRoute(item.platform, item.novelId)"
						class="flex flex-1 flex-col"
					>
						<div
							class="relative aspect-[3/4] w-full overflow-hidden rounded-t-2xl bg-[var(--bg-secondary)]"
						>
							<img
								v-if="
									getRebasedCover(item.coverUrl) &&
									!failedCovers.has(makeCompositeKey(item.platform, item.novelId))
								"
								:src="getRebasedCover(item.coverUrl)"
								:alt="item.title"
								loading="lazy"
								class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
								@error="
									markCoverFailed(makeCompositeKey(item.platform, item.novelId))
								"
							/>
							<div
								v-else
								class="flex h-full w-full items-center justify-center text-[var(--text-muted)]"
							>
								<BookOpen class="h-8 w-8" />
							</div>

							<span
								class="absolute left-2 top-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs"
							>
								{{ getSourceName(item.platform) }}
							</span>
						</div>

						<div class="flex flex-1 flex-col justify-between p-3 pr-8">
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
							<p
								v-if="libraryStore.getProgress(item.platform, item.novelId)"
								class="mt-2 truncate text-[11px] text-[var(--accent)]"
							>
								{{
									libraryStore.getProgress(item.platform, item.novelId)
										?.chapterTitle
								}}
							</p>
						</div>
					</RouterLink>

					<!-- Card Menu Trigger -->
					<div class="absolute bottom-2.5 right-1.5" data-bookshelf-menu>
						<button
							type="button"
							aria-label="书架操作菜单"
							aria-haspopup="menu"
							:aria-expanded="
								openMenuKey === makeCompositeKey(item.platform, item.novelId)
							"
							class="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
							@click="
								toggleMenu(makeCompositeKey(item.platform, item.novelId))
							"
						>
							<MoreVertical class="h-4 w-4" />
						</button>

						<div
							v-if="
								openMenuKey === makeCompositeKey(item.platform, item.novelId)
							"
							role="menu"
							class="absolute bottom-8 right-0 z-20 w-36 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-lg space-y-0.5"
						>
							<button
								type="button"
								role="menuitem"
								class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
								@click="openAssignModal(item)"
							>
								<FolderKanban class="h-3.5 w-3.5 text-[var(--text-secondary)]" />
								管理所属书架
							</button>
							<button
								type="button"
								role="menuitem"
								class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-red-600 hover:bg-red-500/10"
								@click="handleRemoveFromBookshelf(item)"
							>
								<Trash2 class="h-3.5 w-3.5" />
								移出书架
							</button>
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- Modals -->
		<ShelfManagerModal
			:open="shelfManagerOpen"
			@close="shelfManagerOpen = false"
		/>

		<ShelfAssignModal
			:open="assignTarget !== null"
			:platform="assignTarget?.platform ?? ''"
			:novel-id="assignTarget?.novelId ?? ''"
			:title="assignTarget?.title ?? ''"
			:initial-category-ids="
				assignTarget ? libraryStore.getEffectiveCategoryIds(assignTarget) : []
			"
			@close="assignTarget = null"
		/>
	</div>
</template>
