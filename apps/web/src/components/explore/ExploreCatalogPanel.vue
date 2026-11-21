<script setup lang="ts">
import type {
	ExploreFilterGroup,
	ExploreNovelItem,
	ExplorePage,
	ExploreSchema,
} from "@acanthis-dec/core";
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	Filter,
	RotateCcw,
	RotateCw,
	ShieldAlert,
	X,
} from "lucide-vue-next";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { fetchExploreCatalog, isAbortError } from "@/api/client";
import ExploreNovelCard from "@/components/explore/ExploreNovelCard.vue";
import {
	type ExploreTab,
	formatApiErrorMessage,
	isChallengeBlockedError,
} from "@/components/explore/exploreUtils";
import SearchableTagPicker, {
	type TagPickerOption,
} from "@/components/SearchableTagPicker.vue";
import { makeCompositeKey } from "@/db/indexedDb";

const SEARCHABLE_PICKER_THRESHOLD = 8;

const props = withDefaults(
	defineProps<{
		platform: string;
		schema: ExploreSchema;
		filters: Record<string, string>;
		page: number;
		selectionMode?: boolean | undefined;
		selectedKeys?: ReadonlySet<string> | undefined;
	}>(),
	{
		selectionMode: false,
	},
);

const emit = defineEmits<{
	"update:query": [payload: { filters: Record<string, string>; page: number }];
	switchTab: [tab: ExploreTab];
	toggleSelect: [item: ExploreNovelItem];
	visibleItems: [items: ExploreNovelItem[]];
}>();

const pageData = ref<ExplorePage | null>(null);
const loading = ref<boolean>(false);
const errorState = ref<unknown>(null);

const panelExpanded = ref<boolean>(
	typeof window === "undefined" ? true : window.innerWidth >= 768,
);

let abortController: AbortController | null = null;

function resolveGroupValue(group: ExploreFilterGroup): string {
	const raw = props.filters[group.key];
	if (raw !== undefined && group.options.some((opt) => opt.value === raw)) {
		return raw;
	}
	return group.defaultValue;
}

const resolvedFilters = computed<Record<string, string>>(() => {
	const result: Record<string, string> = {};
	for (const group of props.schema.catalogFilters) {
		result[group.key] = resolveGroupValue(group);
	}
	return result;
});

const activeFilterChips = computed<
	Array<{ key: string; groupLabel: string; optionLabel: string }>
>(() => {
	const chips: Array<{
		key: string;
		groupLabel: string;
		optionLabel: string;
	}> = [];
	for (const group of props.schema.catalogFilters) {
		const val = resolvedFilters.value[group.key] ?? group.defaultValue;
		if (val !== group.defaultValue) {
			const matched = group.options.find((opt) => opt.value === val);
			chips.push({
				key: group.key,
				groupLabel: group.label,
				optionLabel: matched?.label ?? val,
			});
		}
	}
	return chips;
});

const activeFilterCount = computed<number>(
	() => activeFilterChips.value.length,
);

const canReset = computed<boolean>(
	() => activeFilterCount.value > 0 || props.page > 1,
);

const requestSignature = computed<string>(() => {
	const pairs = props.schema.catalogFilters.map(
		(group) =>
			`${group.key}=${resolvedFilters.value[group.key] ?? group.defaultValue}`,
	);
	return `${props.platform}|${props.page}|${pairs.join("&")}`;
});

const isChallengeError = computed<boolean>(() =>
	isChallengeBlockedError(errorState.value),
);

const errorMessage = computed<string | null>(() => {
	if (!errorState.value) {
		return null;
	}
	return formatApiErrorMessage(errorState.value, "加载书库筛选失败");
});

const currentPage = computed<number>(() => pageData.value?.page ?? props.page);
const totalPages = computed<number>(() =>
	Math.max(1, pageData.value?.totalPages ?? 1),
);

function useSearchablePicker(group: ExploreFilterGroup): boolean {
	return group.options.length > SEARCHABLE_PICKER_THRESHOLD;
}

function toPickerOptions(group: ExploreFilterGroup): TagPickerOption[] {
	return group.options.map((opt) => ({
		value: opt.value,
		label: opt.label,
	}));
}

function handlePickerSelect(
	group: ExploreFilterGroup,
	value: string | string[],
): void {
	const nextValue =
		typeof value === "string" ? value : (value[0] ?? group.defaultValue);
	selectOption(group.key, nextValue);
}

function isItemSelected(item: ExploreNovelItem): boolean {
	if (!props.selectedKeys) {
		return false;
	}
	return props.selectedKeys.has(
		makeCompositeKey(item.platform || props.platform, item.id),
	);
}

function selectOption(groupKey: string, value: string): void {
	if (resolvedFilters.value[groupKey] === value) {
		return;
	}
	emit("update:query", {
		filters: {
			...resolvedFilters.value,
			[groupKey]: value,
		},
		page: 1,
	});
}

function clearSingleFilter(groupKey: string): void {
	const group = props.schema.catalogFilters.find((g) => g.key === groupKey);
	if (!group) {
		return;
	}
	selectOption(groupKey, group.defaultValue);
}

function resetAllFilters(): void {
	if (!canReset.value) {
		return;
	}
	const defaults: Record<string, string> = {};
	for (const group of props.schema.catalogFilters) {
		defaults[group.key] = group.defaultValue;
	}
	emit("update:query", {
		filters: defaults,
		page: 1,
	});
}

function goToPage(targetPage: number): void {
	if (targetPage < 1 || targetPage === props.page || loading.value) {
		return;
	}
	emit("update:query", {
		filters: { ...resolvedFilters.value },
		page: targetPage,
	});
}

function abortInFlight(): void {
	if (abortController !== null) {
		abortController.abort();
		abortController = null;
	}
}

async function loadCatalog(): Promise<void> {
	if (!props.platform || props.schema.catalogFilters.length === 0) {
		pageData.value = null;
		return;
	}

	abortInFlight();
	const controller = new AbortController();
	abortController = controller;
	loading.value = true;
	errorState.value = null;

	const params: Record<string, string | number> = {
		...resolvedFilters.value,
		page: props.page,
	};

	try {
		const res = await fetchExploreCatalog(
			props.platform,
			params,
			controller.signal,
		);
		if (controller.signal.aborted) {
			return;
		}
		pageData.value = res;
	} catch (err) {
		if (controller.signal.aborted || isAbortError(err)) {
			return;
		}
		errorState.value = err;
	} finally {
		if (abortController === controller) {
			abortController = null;
			loading.value = false;
		}
	}
}

watch(
	[pageData, loading, errorMessage],
	([data, isLoading, err]) => {
		if (isLoading || err || !data) {
			emit("visibleItems", []);
			return;
		}
		emit("visibleItems", data.items);
	},
	{ immediate: true },
);

watch(
	requestSignature,
	() => {
		void loadCatalog();
	},
	{ immediate: true },
);

onBeforeUnmount(() => {
	abortInFlight();
});
</script>

<template>
	<div class="space-y-4">
		<!-- Empty Catalog Filters -->
		<div
			v-if="schema.catalogFilters.length === 0"
			class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center text-sm text-[var(--text-muted)]"
		>
			当前书源暂未提供书库筛选条件
		</div>

		<template v-else>
			<!-- Dynamic Schema-Driven Filter Panel -->
			<section
				aria-label="书库多维筛选"
				class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 sm:p-4 space-y-3"
			>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div class="flex flex-wrap items-center gap-2">
						<span
							class="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[var(--text-primary)]"
						>
							<Filter class="h-4 w-4 text-[var(--accent)]" />
							书库筛选
						</span>
						<span
							v-if="activeFilterCount > 0"
							class="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]"
						>
							已选 {{ activeFilterCount }} 项
						</span>
						<span
							v-if="schema.catalogRequiresChallenge"
							title="书库筛选受 Cloudflare 保护，需服务端启用 FlareSolverr"
							class="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]"
						>
							<ShieldAlert class="h-3 w-3" />
							需 FlareSolverr
						</span>
					</div>

					<div class="flex items-center gap-2">
						<button
							type="button"
							:disabled="!canReset"
							class="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
							@click="resetAllFilters"
						>
							<RotateCcw class="h-3 w-3" />
							一键重置
						</button>
						<button
							type="button"
							:aria-expanded="panelExpanded"
							class="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							@click="panelExpanded = !panelExpanded"
						>
							<span>{{ panelExpanded ? "收起筛选" : "展开筛选" }}</span>
							<ChevronUp v-if="panelExpanded" class="h-3.5 w-3.5" />
							<ChevronDown v-else class="h-3.5 w-3.5" />
						</button>
					</div>
				</div>

				<!-- Active Filter Chips (always visible when active, handy when panel collapsed) -->
				<div
					v-if="!panelExpanded && activeFilterChips.length > 0"
					class="flex flex-wrap items-center gap-1.5 pt-1"
				>
					<button
						v-for="chip in activeFilterChips"
						:key="chip.key"
						type="button"
						:aria-label="`清除 ${chip.groupLabel}: ${chip.optionLabel}`"
						class="inline-flex items-center gap-1 rounded-full border border-[var(--accent)]/40 bg-[var(--accent-soft)]/70 px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent)] hover:opacity-85"
						@click="clearSingleFilter(chip.key)"
					>
						<span>{{ chip.groupLabel }}: {{ chip.optionLabel }}</span>
						<X class="h-3 w-3" />
					</button>
				</div>

				<!-- Filter Groups -->
				<div v-if="panelExpanded" class="space-y-3 pt-1 border-t border-[var(--border-subtle)]/70">
					<div
						v-for="group in schema.catalogFilters"
						:key="group.key"
						class="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3 pt-2 first:pt-1"
					>
						<span
							class="shrink-0 text-xs font-medium text-[var(--text-muted)] sm:w-20 sm:pt-1"
						>
							{{ group.label }}
						</span>

						<div v-if="useSearchablePicker(group)" class="min-w-0 flex-1">
							<SearchableTagPicker
								:options="toPickerOptions(group)"
								:model-value="resolvedFilters[group.key] ?? group.defaultValue"
								:multiple="false"
								:label="group.label"
								:panel-title="`选择${group.label}`"
								:placeholder="`搜索${group.label}…`"
								:default-value="group.defaultValue"
								@update:model-value="handlePickerSelect(group, $event)"
							/>
						</div>

						<fieldset
							v-else
							class="min-w-0 flex-1 flex flex-wrap items-center gap-1.5 border-0 p-0 m-0"
							:aria-label="group.label"
						>
							<button
								v-for="opt in group.options"
								:key="opt.value"
								type="button"
								:aria-pressed="resolvedFilters[group.key] === opt.value"
								class="rounded-lg border px-2.5 py-1 text-xs transition-colors"
								:class="
									resolvedFilters[group.key] === opt.value
										? 'border-[var(--accent)] bg-[var(--accent)] font-medium text-white'
										: 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
								"
								@click="selectOption(group.key, opt.value)"
							>
								{{ opt.label }}
							</button>
						</fieldset>
					</div>
				</div>
			</section>

			<!-- Cloudflare 503 / 20001 / 20002 Friendly Prompt -->
			<div
				v-if="isChallengeError"
				role="alert"
				class="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-5 space-y-3"
			>
				<div class="flex items-start gap-3">
					<ShieldAlert class="h-5 w-5 shrink-0 text-amber-500 mt-0.5" />
					<div class="space-y-1">
						<h3 class="text-sm font-semibold text-[var(--text-primary)]">
							书库多维筛选受 Cloudflare 保护，暂无法加载
						</h3>
						<p class="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
							源站书库检索接口需要服务端开启并配置 FlareSolverr 才能通过人机校验。无需验证的首页推荐与排行榜可立即使用。
							<span v-if="errorMessage" class="block mt-1 text-xs text-[var(--text-muted)]">
								详情：{{ errorMessage }}
							</span>
						</p>
					</div>
				</div>

				<div class="flex flex-wrap items-center gap-2 pl-8">
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
						@click="loadCatalog()"
					>
						<RotateCw class="h-3.5 w-3.5" />
						重试
					</button>
					<button
						v-if="schema.supportsHome"
						type="button"
						class="rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
						@click="emit('switchTab', 'home')"
					>
						切回首页推荐
					</button>
					<button
						v-if="schema.rankings.length > 0"
						type="button"
						class="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
						@click="emit('switchTab', 'rankings')"
					>
						切回排行榜
					</button>
				</div>
			</div>

			<!-- Generic Error -->
			<div
				v-else-if="errorMessage"
				role="alert"
				class="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs sm:text-sm text-red-500"
			>
				<span>{{ errorMessage }}</span>
				<button
					type="button"
					class="shrink-0 rounded-lg border border-red-500/30 px-2.5 py-1 text-xs font-medium hover:bg-red-500/10"
					@click="loadCatalog()"
				>
					重试
				</button>
			</div>

			<!-- Loading Skeleton -->
			<div v-if="loading" class="grid grid-cols-1 gap-3.5 md:grid-cols-2">
				<div
					v-for="idx in 6"
					:key="idx"
					class="h-36 rounded-2xl bg-[var(--bg-secondary)] animate-pulse"
				/>
			</div>

			<!-- Results -->
			<template v-else-if="pageData && !errorMessage">
				<div
					v-if="pageData.items.length === 0"
					class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center space-y-3"
				>
					<p class="text-sm text-[var(--text-muted)]">
						当前筛选条件下暂无匹配作品
					</p>
					<button
						v-if="activeFilterCount > 0"
						type="button"
						class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
						@click="resetAllFilters"
					>
						<RotateCcw class="h-3.5 w-3.5" />
						重置筛选条件
					</button>
				</div>

				<template v-else>
					<div class="flex items-center justify-between text-xs text-[var(--text-secondary)]">
						<span>本页共 {{ pageData.items.length }} 部作品</span>
						<span>第 {{ currentPage }} / {{ totalPages }} 页</span>
					</div>

					<div class="grid grid-cols-1 gap-3.5 md:grid-cols-2">
						<ExploreNovelCard
							v-for="(item, idx) in pageData.items"
							:key="`${item.platform}:${item.id}:${idx}`"
							:item="item"
							:fallback-platform="platform"
							variant="detailed"
							:selection-mode="selectionMode"
							:selected="isItemSelected(item)"
							@toggle-select="emit('toggleSelect', $event)"
						/>
					</div>
				</template>

				<!-- Exact Pagination -->
				<div
					v-if="totalPages > 1 || currentPage > 1 || pageData.hasNextPage"
					class="flex items-center justify-center gap-3 pt-2"
				>
					<button
						type="button"
						:disabled="currentPage <= 1 || loading"
						aria-label="上一页"
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
						:disabled="!pageData.hasNextPage || loading"
						aria-label="下一页"
						class="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-40"
						@click="goToPage(currentPage + 1)"
					>
						下一页
						<ChevronRight class="h-4 w-4" />
					</button>
				</div>
			</template>
		</template>
	</div>
</template>
