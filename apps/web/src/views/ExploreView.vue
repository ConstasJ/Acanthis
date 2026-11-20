<script setup lang="ts">
import type {
	ExploreSchema,
	ExploreSectionMoreTarget,
	NovelInfo,
	NovelSearchResult,
} from "@acanthis-dec/core";
import {
	ChevronLeft,
	ChevronRight,
	Clock,
	RotateCw,
	Search,
	X,
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { type LocationQuery, useRoute, useRouter } from "vue-router";
import {
	fetchExploreSchema,
	fetchNovels,
	isAbortError,
	searchNovels,
} from "@/api/client";
import ExploreCatalogPanel from "@/components/explore/ExploreCatalogPanel.vue";
import ExploreHomePanel from "@/components/explore/ExploreHomePanel.vue";
import ExploreNovelCard from "@/components/explore/ExploreNovelCard.vue";
import ExploreRankingsPanel from "@/components/explore/ExploreRankingsPanel.vue";
import {
	type ExploreTab,
	formatApiErrorMessage,
	parsePositivePage,
	resolveDefaultHomeChannel,
	resolveRankingSelection,
} from "@/components/explore/exploreUtils";
import SetupBanner from "@/components/SetupBanner.vue";
import { useSettingsStore } from "@/stores/settings";
import { useSourcesStore } from "@/stores/sources";

const PAGE_SIZE = 20;
const RESERVED_QUERY_KEYS = new Set([
	"platform",
	"tab",
	"channel",
	"rank",
	"full",
	"page",
	"q",
]);

const schemaMemoryCache = new Map<string, ExploreSchema>();

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const sourcesStore = useSourcesStore();

const searchInput = ref<string>("");
const activeQuery = ref<string>("");

const activeTab = ref<ExploreTab>("home");
const hasExplicitTabInUrl = ref<boolean>(false);

const homeChannel = ref<string>("home");
const rankingRank = ref<string>("");
const rankingFull = ref<boolean>(false);
const rankingPage = ref<number>(1);
const catalogFilters = ref<Record<string, string>>({});
const catalogPage = ref<number>(1);
const cachedPage = ref<number>(1);

const exploreSchema = ref<ExploreSchema | null>(null);
const loadingSchema = ref<boolean>(false);
const schemaError = ref<string | null>(null);

const novels = ref<NovelInfo[]>([]);
const totalNovels = ref<number>(0);
const loadingList = ref<boolean>(false);
const listErrorMessage = ref<string | null>(null);

const searchResults = ref<NovelSearchResult[]>([]);
const loadingSearch = ref<boolean>(false);
const showSlowHint = ref<boolean>(false);
const searchErrorMessage = ref<string | null>(null);

let schemaAbortController: AbortController | null = null;
let searchAbortController: AbortController | null = null;
let slowHintTimer: ReturnType<typeof setTimeout> | null = null;
let lastWrittenQueryKey: string | null = null;
let loadedCachedSignature: string | null = null;
let hasAppliedInitialPlatformFromRoute = false;

const activePlatform = computed<string>(() => {
	if (settingsStore.selectedExplorePlatform) {
		return settingsStore.selectedExplorePlatform;
	}
	return sourcesStore.sources[0]?.id ?? "linovelib";
});

const activeSource = computed(
	() =>
		sourcesStore.sources.find((s) => s.id === activePlatform.value) ?? null,
);

const sourcesResolved = computed<boolean>(
	() => sourcesStore.sources.length > 0 || !sourcesStore.loading,
);

const supportsExplore = computed<boolean>(
	() => activeSource.value?.capabilities.includes("explore") ?? false,
);

const availableTabs = computed<Array<{ id: ExploreTab; label: string }>>(() => {
	if (!supportsExplore.value) {
		return [{ id: "cached", label: "本地已缓存" }];
	}
	const schema = exploreSchema.value;
	if (!schema) {
		return [
			{ id: "home", label: "首页推荐" },
			{ id: "rankings", label: "排行榜" },
			{ id: "catalog", label: "书库筛选" },
			{ id: "cached", label: "本地已缓存" },
		];
	}
	const tabs: Array<{ id: ExploreTab; label: string }> = [];
	if (schema.supportsHome) {
		tabs.push({ id: "home", label: "首页推荐" });
	}
	if (schema.rankings.length > 0) {
		tabs.push({ id: "rankings", label: "排行榜" });
	}
	if (schema.catalogFilters.length > 0) {
		tabs.push({ id: "catalog", label: "书库筛选" });
	}
	tabs.push({ id: "cached", label: "本地已缓存" });
	return tabs;
});

const effectiveTab = computed<ExploreTab>(() => {
	if (!supportsExplore.value) {
		return "cached";
	}
	if (availableTabs.value.some((t) => t.id === activeTab.value)) {
		return activeTab.value;
	}
	return availableTabs.value[0]?.id ?? "cached";
});

const isSearchMode = computed<boolean>(() => activeQuery.value.length > 0);

const totalCachedPages = computed<number>(() =>
	Math.max(1, Math.ceil(totalNovels.value / PAGE_SIZE)),
);

function firstQueryValue(raw: LocationQuery[string] | undefined): string {
	if (typeof raw === "string") {
		return raw;
	}
	if (Array.isArray(raw)) {
		for (const item of raw) {
			if (typeof item === "string") {
				return item;
			}
		}
	}
	return "";
}

function isValidExploreTab(value: string): value is ExploreTab {
	return (
		value === "home" ||
		value === "rankings" ||
		value === "catalog" ||
		value === "cached"
	);
}

function canonicalizeRecord(record: Record<string, string>): string {
	return Object.keys(record)
		.sort()
		.map((k) => `${k}=${record[k] ?? ""}`)
		.join("&");
}

function canonicalizeLocationQuery(query: LocationQuery): string {
	const record: Record<string, string> = {};
	for (const [key, value] of Object.entries(query)) {
		const single = firstQueryValue(value);
		if (single !== "") {
			record[key] = single;
		}
	}
	return canonicalizeRecord(record);
}

function applyRouteQuery(query: LocationQuery): void {
	const queryPlatform = firstQueryValue(query.platform).trim();
	if (sourcesStore.sources.length > 0) {
		hasAppliedInitialPlatformFromRoute = true;
		if (
			queryPlatform &&
			sourcesStore.sources.some((s) => s.id === queryPlatform) &&
			queryPlatform !== settingsStore.selectedExplorePlatform
		) {
			settingsStore.setSelectedExplorePlatform(queryPlatform);
		}
	}

	const rawTab = firstQueryValue(query.tab).trim();
	if (isValidExploreTab(rawTab)) {
		hasExplicitTabInUrl.value = true;
		activeTab.value = rawTab;
	} else {
		hasExplicitTabInUrl.value = false;
		activeTab.value = supportsExplore.value || sourcesStore.loading ? "home" : "cached";
	}

	const rawChannel = firstQueryValue(query.channel).trim();
	homeChannel.value = rawChannel || "home";

	rankingRank.value = firstQueryValue(query.rank).trim();
	const rawFull = firstQueryValue(query.full).trim();
	rankingFull.value = rawFull === "true" || rawFull === "1";

	const pageVal = parsePositivePage(firstQueryValue(query.page));
	if (activeTab.value === "rankings") {
		rankingPage.value = pageVal;
	} else if (activeTab.value === "catalog") {
		catalogPage.value = pageVal;
	} else if (activeTab.value === "cached") {
		cachedPage.value = pageVal;
	} else {
		rankingPage.value = 1;
		catalogPage.value = 1;
		cachedPage.value = 1;
	}

	const nextCatalogFilters: Record<string, string> = {};
	for (const [key, val] of Object.entries(query)) {
		if (RESERVED_QUERY_KEYS.has(key)) {
			continue;
		}
		const single = firstQueryValue(val).trim();
		if (single) {
			nextCatalogFilters[key] = single;
		}
	}
	catalogFilters.value = nextCatalogFilters;

	const rawSearch = firstQueryValue(query.q).trim();
	searchInput.value = rawSearch;
	activeQuery.value = rawSearch;
}

function buildUrlQuery(): Record<string, string> {
	const next: Record<string, string> = {};
	if (activePlatform.value) {
		next.platform = activePlatform.value;
	}

	const tab = effectiveTab.value;
	next.tab = tab;

	if (activeQuery.value) {
		next.q = activeQuery.value;
	}

	if (tab === "home") {
		if (homeChannel.value) {
			next.channel = homeChannel.value;
		}
	} else if (tab === "rankings") {
		const schema = exploreSchema.value;
		const resolved = schema
			? resolveRankingSelection(schema, rankingRank.value, rankingFull.value)
			: { rank: rankingRank.value, full: rankingFull.value };
		if (resolved.rank) {
			next.rank = resolved.rank;
		}
		next.full = String(resolved.full);
		next.page = String(rankingPage.value);
	} else if (tab === "catalog") {
		const schema = exploreSchema.value;
		if (schema) {
			for (const group of schema.catalogFilters) {
				const raw = catalogFilters.value[group.key];
				const valid =
					raw !== undefined &&
					group.options.some((opt) => opt.value === raw);
				const val = valid ? raw : group.defaultValue;
				if (val !== group.defaultValue) {
					next[group.key] = val;
				}
			}
		} else {
			for (const [key, val] of Object.entries(catalogFilters.value)) {
				if (val) {
					next[key] = val;
				}
			}
		}
		next.page = String(catalogPage.value);
	} else if (tab === "cached") {
		if (cachedPage.value > 1) {
			next.page = String(cachedPage.value);
		}
	}

	return next;
}

function syncUrlQuery(): void {
	if (!sourcesResolved.value) {
		return;
	}
	if (supportsExplore.value && loadingSchema.value) {
		return;
	}
	const nextQuery = buildUrlQuery();
	const nextKey = canonicalizeRecord(nextQuery);
	const currentKey = canonicalizeLocationQuery(route.query);
	if (nextKey === currentKey) {
		return;
	}
	lastWrittenQueryKey = nextKey;
	void router.replace({ query: nextQuery });
}

function normalizeStateWithSchema(schema: ExploreSchema): void {
	if (!hasExplicitTabInUrl.value) {
		activeTab.value = schema.supportsHome
			? "home"
			: schema.rankings.length > 0
				? "rankings"
				: schema.catalogFilters.length > 0
					? "catalog"
					: "cached";
	} else if (!availableTabs.value.some((t) => t.id === activeTab.value)) {
		activeTab.value = availableTabs.value[0]?.id ?? "cached";
	}

	if (
		schema.channels.length > 0 &&
		!schema.channels.some((c) => c.id === homeChannel.value)
	) {
		homeChannel.value = resolveDefaultHomeChannel(schema);
	}

	const resolvedRanking = resolveRankingSelection(
		schema,
		rankingRank.value,
		rankingFull.value,
	);
	rankingRank.value = resolvedRanking.rank;
	rankingFull.value = resolvedRanking.full;

	const normalizedCatalog: Record<string, string> = {};
	for (const group of schema.catalogFilters) {
		const raw = catalogFilters.value[group.key];
		if (raw !== undefined && group.options.some((o) => o.value === raw)) {
			normalizedCatalog[group.key] = raw;
		} else {
			normalizedCatalog[group.key] = group.defaultValue;
		}
	}
	catalogFilters.value = normalizedCatalog;
}

function abortSchemaRequest(): void {
	if (schemaAbortController !== null) {
		schemaAbortController.abort();
		schemaAbortController = null;
	}
}

async function loadExploreSchemaForPlatform(
	platform: string,
	forceRefresh = false,
): Promise<void> {
	if (!supportsExplore.value || !platform) {
		abortSchemaRequest();
		loadingSchema.value = false;
		schemaError.value = null;
		exploreSchema.value = null;
		return;
	}

	const cached = !forceRefresh ? schemaMemoryCache.get(platform) : undefined;
	if (cached) {
		abortSchemaRequest();
		loadingSchema.value = false;
		schemaError.value = null;
		exploreSchema.value = cached;
		normalizeStateWithSchema(cached);
		syncUrlQuery();
		return;
	}

	abortSchemaRequest();
	const controller = new AbortController();
	schemaAbortController = controller;
	loadingSchema.value = true;
	schemaError.value = null;

	try {
		const schema = await fetchExploreSchema(platform, controller.signal);
		if (controller.signal.aborted || activePlatform.value !== platform) {
			return;
		}
		schemaMemoryCache.set(platform, schema);
		exploreSchema.value = schema;
		normalizeStateWithSchema(schema);
		syncUrlQuery();
	} catch (err) {
		if (controller.signal.aborted || isAbortError(err)) {
			return;
		}
		schemaError.value = formatApiErrorMessage(err, "加载书源发现配置失败");
		exploreSchema.value = null;
	} finally {
		if (schemaAbortController === controller) {
			schemaAbortController = null;
			loadingSchema.value = false;
		}
	}
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

async function loadNovelsPage(page: number, force = false): Promise<void> {
	const platform = activePlatform.value;
	if (!platform || !sourcesResolved.value) {
		return;
	}
	const sig = `${platform}:${page}`;
	if (!force && sig === loadedCachedSignature && novels.value.length > 0) {
		return;
	}

	loadingList.value = true;
	listErrorMessage.value = null;

	try {
		const res = await fetchNovels(platform, page, PAGE_SIZE);
		if (activePlatform.value !== platform) {
			return;
		}
		novels.value = res.items;
		cachedPage.value = res.page;
		totalNovels.value = res.total;
		loadedCachedSignature = `${platform}:${res.page}`;
	} catch (err) {
		listErrorMessage.value = formatApiErrorMessage(err, "加载书库列表失败");
	} finally {
		loadingList.value = false;
	}
}

async function executeSearch(
	keyword: string,
	options: { syncUrl?: boolean } = {},
): Promise<void> {
	const trimmed = keyword.trim();
	activeQuery.value = trimmed;
	abortInFlightSearch();

	if (options.syncUrl !== false) {
		syncUrlQuery();
	}

	if (!trimmed) {
		loadingSearch.value = false;
		searchResults.value = [];
		searchErrorMessage.value = null;
		if (effectiveTab.value === "cached") {
			void loadNovelsPage(cachedPage.value);
		}
		return;
	}

	const controller = new AbortController();
	searchAbortController = controller;
	loadingSearch.value = true;
	searchErrorMessage.value = null;

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
		if (controller.signal.aborted || isAbortError(err)) {
			return;
		}
		searchErrorMessage.value = formatApiErrorMessage(
			err,
			"搜索失败，请稍后重试",
		);
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
	searchErrorMessage.value = null;
	syncUrlQuery();
	if (effectiveTab.value === "cached") {
		void loadNovelsPage(cachedPage.value);
	}
}

function handleSearchInputChange(): void {
	if (!searchInput.value.trim() && activeQuery.value) {
		handleClearSearch();
	}
}

function handleSelectPlatform(platformId: string): void {
	if (platformId === activePlatform.value) {
		return;
	}
	const previousExploreSupported = supportsExplore.value;
	settingsStore.setSelectedExplorePlatform(platformId);

	abortSchemaRequest();
	exploreSchema.value = null;
	schemaError.value = null;
	homeChannel.value = "home";
	rankingRank.value = "";
	rankingFull.value = false;
	rankingPage.value = 1;
	catalogFilters.value = {};
	catalogPage.value = 1;
	cachedPage.value = 1;
	novels.value = [];
	totalNovels.value = 0;
	loadedCachedSignature = null;
	listErrorMessage.value = null;

	const nextSource = sourcesStore.sources.find((s) => s.id === platformId);
	const nextSupportsExplore =
		nextSource?.capabilities.includes("explore") ?? false;

	if (!nextSupportsExplore) {
		activeTab.value = "cached";
		hasExplicitTabInUrl.value = false;
	} else if (!previousExploreSupported) {
		activeTab.value = "home";
		hasExplicitTabInUrl.value = false;
	}

	syncUrlQuery();

	if (activeQuery.value) {
		void executeSearch(activeQuery.value, { syncUrl: false });
	}
}

function handleSelectTab(tab: ExploreTab): void {
	if (tab === effectiveTab.value && !isSearchMode.value) {
		return;
	}
	activeTab.value = tab;
	hasExplicitTabInUrl.value = true;
	if (isSearchMode.value) {
		searchInput.value = "";
		activeQuery.value = "";
		abortInFlightSearch();
		loadingSearch.value = false;
		searchResults.value = [];
		searchErrorMessage.value = null;
	}
	syncUrlQuery();
}

function handleUpdateHomeChannel(channel: string): void {
	homeChannel.value = channel;
	syncUrlQuery();
}

function handleUpdateRankingSelection(payload: {
	rank: string;
	full: boolean;
	page: number;
}): void {
	rankingRank.value = payload.rank;
	rankingFull.value = payload.full;
	rankingPage.value = payload.page;
	syncUrlQuery();
}

function handleUpdateCatalogQuery(payload: {
	filters: Record<string, string>;
	page: number;
}): void {
	catalogFilters.value = payload.filters;
	catalogPage.value = payload.page;
	syncUrlQuery();
}

function handleNavigateMore(target: ExploreSectionMoreTarget): void {
	const schema = exploreSchema.value;
	if (target.type === "channel") {
		activeTab.value = "home";
		hasExplicitTabInUrl.value = true;
		const nextChannel = target.params.channel?.trim();
		if (
			nextChannel &&
			(!schema || schema.channels.some((c) => c.id === nextChannel))
		) {
			homeChannel.value = nextChannel;
		} else if (schema) {
			homeChannel.value = resolveDefaultHomeChannel(schema);
		}
	} else if (target.type === "ranking") {
		activeTab.value = "rankings";
		hasExplicitTabInUrl.value = true;
		const targetFull =
			target.params.full === "true" || target.params.full === "1";
		const targetRank = target.params.rank?.trim() ?? "";
		if (schema) {
			const resolved = resolveRankingSelection(
				schema,
				targetRank,
				targetFull,
			);
			rankingRank.value = resolved.rank;
			rankingFull.value = resolved.full;
		} else {
			rankingRank.value = targetRank;
			rankingFull.value = targetFull;
		}
		rankingPage.value = parsePositivePage(target.params.page);
	} else if (target.type === "catalog") {
		activeTab.value = "catalog";
		hasExplicitTabInUrl.value = true;
		const nextFilters: Record<string, string> = {};
		if (schema) {
			for (const group of schema.catalogFilters) {
				const raw = target.params[group.key]?.trim();
				if (raw && group.options.some((o) => o.value === raw)) {
					nextFilters[group.key] = raw;
				} else {
					nextFilters[group.key] = group.defaultValue;
				}
			}
		} else {
			for (const [k, v] of Object.entries(target.params)) {
				if (k !== "page" && v.trim()) {
					nextFilters[k] = v.trim();
				}
			}
		}
		catalogFilters.value = nextFilters;
		catalogPage.value = parsePositivePage(target.params.page);
	}

	syncUrlQuery();
	if (typeof window !== "undefined") {
		window.scrollTo({ top: 0, behavior: "smooth" });
	}
}

function goToCachedPage(page: number): void {
	const target = Math.min(totalCachedPages.value, Math.max(1, page));
	if (target === cachedPage.value && novels.value.length > 0) {
		return;
	}
	cachedPage.value = target;
	syncUrlQuery();
	void loadNovelsPage(target, true);
}

// Hydrate reactive state synchronously from route.query before immediate watchers run,
// so back-navigation does not get overwritten by default state.
applyRouteQuery(route.query);

watch(
	() => route.query,
	(newQuery) => {
		const incomingKey = canonicalizeLocationQuery(newQuery);
		if (
			lastWrittenQueryKey !== null &&
			incomingKey === lastWrittenQueryKey
		) {
			lastWrittenQueryKey = null;
			return;
		}
		const prevSearch = activeQuery.value;
		applyRouteQuery(newQuery);
		if (exploreSchema.value && supportsExplore.value) {
			normalizeStateWithSchema(exploreSchema.value);
		}
		if (activeQuery.value !== prevSearch) {
			if (activeQuery.value) {
				void executeSearch(activeQuery.value, { syncUrl: false });
			} else {
				abortInFlightSearch();
				loadingSearch.value = false;
				searchResults.value = [];
				searchErrorMessage.value = null;
			}
		}
	},
);

watch(
	[sourcesResolved, supportsExplore, activePlatform],
	([resolved, canExplore, platform]) => {
		if (!resolved) {
			return;
		}
		if (!hasAppliedInitialPlatformFromRoute) {
			hasAppliedInitialPlatformFromRoute = true;
			const queryPlatform = firstQueryValue(route.query.platform).trim();
			if (
				queryPlatform &&
				sourcesStore.sources.some((s) => s.id === queryPlatform) &&
				queryPlatform !== platform
			) {
				settingsStore.setSelectedExplorePlatform(queryPlatform);
				return;
			}
		}

		if (canExplore) {
			void loadExploreSchemaForPlatform(platform);
		} else {
			abortSchemaRequest();
			loadingSchema.value = false;
			schemaError.value = null;
			exploreSchema.value = null;
			if (!hasExplicitTabInUrl.value) {
				const rawPage = firstQueryValue(route.query.page).trim();
				if (rawPage) {
					cachedPage.value = parsePositivePage(rawPage);
				}
			}
			activeTab.value = "cached";
			syncUrlQuery();
		}
	},
	{ immediate: true },
);

watch(
	[
		sourcesResolved,
		isSearchMode,
		effectiveTab,
		activePlatform,
		cachedPage,
	],
	([resolved, searching, tab, _platform, page]) => {
		if (!resolved || searching || tab !== "cached") {
			return;
		}
		void loadNovelsPage(page);
	},
	{ immediate: true },
);

onMounted(() => {
	if (activeQuery.value) {
		void executeSearch(activeQuery.value, { syncUrl: false });
	}
});

onBeforeUnmount(() => {
	abortSchemaRequest();
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
					{{
						supportsExplore
							? "浏览首页专题、排行榜、多维书库或实时搜索"
							: "切换服务端书源浏览已缓存书库或实时搜索"
					}}
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

			<!-- Global Search Form -->
			<form class="flex gap-2" @submit.prevent="handleSearchSubmit">
				<div class="relative flex-1">
					<Search
						class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
					/>
					<input
						v-model="searchInput"
						type="search"
						aria-label="搜索书名或作者"
						placeholder="搜索书名或作者…"
						class="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-2.5 pl-10 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
						@input="handleSearchInputChange"
						@search="handleSearchInputChange"
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

			<!-- Explore Mode Tabs (shown only when source supports "explore" and not searching) -->
			<div
				v-if="supportsExplore && !isSearchMode"
				class="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--border-subtle)] pb-2"
				role="tablist"
				aria-label="发现视图"
			>
				<button
					v-for="tab in availableTabs"
					:key="tab.id"
					type="button"
					role="tab"
					:aria-selected="effectiveTab === tab.id"
					class="shrink-0 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors"
					:class="
						effectiveTab === tab.id
							? 'bg-[var(--accent-soft)] text-[var(--accent)]'
							: 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
					"
					@click="handleSelectTab(tab.id)"
				>
					{{ tab.label }}
				</button>
			</div>
		</header>

		<!-- Slow Search Hint (>1500ms) -->
		<div
			v-if="loadingSearch && showSlowHint"
			class="flex items-center gap-2 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/60 px-4 py-3 text-xs sm:text-sm text-[var(--text-secondary)]"
		>
			<Clock class="h-4 w-4 shrink-0 text-[var(--accent)] animate-pulse" />
			<span>正在等待源站响应，若触发源站人机校验可能需要数秒，请耐心等待…</span>
		</div>

		<!-- Search Results Mode -->
		<section v-if="isSearchMode" class="space-y-3">
			<div
				v-if="searchErrorMessage"
				role="alert"
				class="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs sm:text-sm text-red-500 flex items-center justify-between gap-3"
			>
				<span>{{ searchErrorMessage }}</span>
				<button
					type="button"
					class="shrink-0 rounded-lg border border-red-500/30 px-2.5 py-1 text-xs font-medium hover:bg-red-500/10"
					@click="handleSearchSubmit"
				>
					重试
				</button>
			</div>

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
					返回当前视图
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
				v-else-if="searchResults.length === 0 && !searchErrorMessage"
				class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center text-sm text-[var(--text-muted)]"
			>
				未找到匹配「{{ activeQuery }}」的作品
			</div>

			<div
				v-else
				class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
			>
				<ExploreNovelCard
					v-for="item in searchResults"
					:key="`${item.platform}:${item.id}`"
					:item="item"
					:fallback-platform="activePlatform"
					variant="grid"
				/>
			</div>
		</section>

		<!-- Initial Sources Loading Skeleton -->
		<section v-else-if="!sourcesResolved" class="space-y-4">
			<div class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
				<div
					v-for="idx in 5"
					:key="idx"
					class="aspect-[3/4] rounded-2xl bg-[var(--bg-secondary)] animate-pulse"
				/>
			</div>
		</section>

		<!-- Explore Panels (Home / Rankings / Catalog) -->
		<template v-else-if="supportsExplore && effectiveTab !== 'cached'">
			<div
				v-if="loadingSchema && !exploreSchema"
				class="space-y-4"
			>
				<div class="h-9 w-72 rounded-xl bg-[var(--bg-secondary)] animate-pulse" />
				<div class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
					<div
						v-for="idx in 5"
						:key="idx"
						class="aspect-[3/4] rounded-2xl bg-[var(--bg-secondary)] animate-pulse"
					/>
				</div>
			</div>

			<div
				v-else-if="schemaError && !exploreSchema"
				role="alert"
				class="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 space-y-3"
			>
				<p class="text-xs sm:text-sm text-red-500">
					{{ schemaError }}
				</p>
				<div class="flex flex-wrap items-center gap-2">
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
						@click="loadExploreSchemaForPlatform(activePlatform, true)"
					>
						<RotateCw class="h-3.5 w-3.5" />
						重新加载配置
					</button>
					<button
						type="button"
						class="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
						@click="handleSelectTab('cached')"
					>
						浏览本地已缓存
					</button>
				</div>
			</div>

			<ExploreHomePanel
				v-else-if="exploreSchema && effectiveTab === 'home'"
				:platform="activePlatform"
				:schema="exploreSchema"
				:channel="homeChannel"
				@update:channel="handleUpdateHomeChannel"
				@navigate-more="handleNavigateMore"
				@switch-tab="handleSelectTab"
			/>

			<ExploreRankingsPanel
				v-else-if="exploreSchema && effectiveTab === 'rankings'"
				:platform="activePlatform"
				:schema="exploreSchema"
				:rank="rankingRank"
				:full="rankingFull"
				:page="rankingPage"
				@update:selection="handleUpdateRankingSelection"
			/>

			<ExploreCatalogPanel
				v-else-if="exploreSchema && effectiveTab === 'catalog'"
				:platform="activePlatform"
				:schema="exploreSchema"
				:filters="catalogFilters"
				:page="catalogPage"
				@update:query="handleUpdateCatalogQuery"
				@switch-tab="handleSelectTab"
			/>
		</template>

		<!-- Cached Novels Mode (4th Tab or Fallback for non-explore sources) -->
		<section v-else class="space-y-4">
			<div
				v-if="listErrorMessage"
				role="alert"
				class="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs sm:text-sm text-red-500 flex items-center justify-between gap-3"
			>
				<span>{{ listErrorMessage }}</span>
				<button
					type="button"
					class="shrink-0 rounded-lg border border-red-500/30 px-2.5 py-1 text-xs font-medium hover:bg-red-500/10"
					@click="loadNovelsPage(cachedPage, true)"
				>
					重试
				</button>
			</div>

			<div class="flex items-center justify-between text-xs text-[var(--text-secondary)]">
				<span>已缓存书库 · 共 {{ totalNovels }} 部</span>
				<span>第 {{ cachedPage }} / {{ totalCachedPages }} 页</span>
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
				v-else-if="novels.length === 0 && !listErrorMessage"
				class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center text-sm text-[var(--text-muted)]"
			>
				当前书源暂无已缓存作品，试试上方搜索框直接检索作品。
			</div>

			<div
				v-else
				class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
			>
				<ExploreNovelCard
					v-for="item in novels"
					:key="`${item.platform}:${item.id}`"
					:item="item"
					:fallback-platform="activePlatform"
					variant="grid"
				/>
			</div>

			<!-- Cached Pagination Controls -->
			<div
				v-if="totalCachedPages > 1"
				class="flex items-center justify-center gap-3 pt-2"
			>
				<button
					type="button"
					:disabled="cachedPage <= 1 || loadingList"
					aria-label="上一页"
					class="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-40"
					@click="goToCachedPage(cachedPage - 1)"
				>
					<ChevronLeft class="h-4 w-4" />
					上一页
				</button>
				<span class="text-xs text-[var(--text-secondary)]">
					{{ cachedPage }} / {{ totalCachedPages }}
				</span>
				<button
					type="button"
					:disabled="cachedPage >= totalCachedPages || loadingList"
					aria-label="下一页"
					class="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-40"
					@click="goToCachedPage(cachedPage + 1)"
				>
					下一页
					<ChevronRight class="h-4 w-4" />
				</button>
			</div>
		</section>
	</div>
</template>
