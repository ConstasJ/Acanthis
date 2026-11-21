<script setup lang="ts">
import type {
	ExploreNovelItem,
	ExplorePage,
	ExploreSchema,
} from "@acanthis-dec/core";
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { fetchExploreRankings, isAbortError } from "@/api/client";
import ExploreNovelCard from "@/components/explore/ExploreNovelCard.vue";
import {
	formatApiErrorMessage,
	resolveRankingSelection,
} from "@/components/explore/exploreUtils";
import { makeCompositeKey } from "@/db/indexedDb";

const props = withDefaults(
	defineProps<{
		platform: string;
		schema: ExploreSchema;
		rank: string;
		full: boolean;
		page: number;
		selectionMode?: boolean | undefined;
		selectedKeys?: ReadonlySet<string> | undefined;
	}>(),
	{
		selectionMode: false,
	},
);

const emit = defineEmits<{
	"update:selection": [payload: { rank: string; full: boolean; page: number }];
	toggleSelect: [item: ExploreNovelItem];
	visibleItems: [items: ExploreNovelItem[]];
}>();

const pageData = ref<ExplorePage | null>(null);
const loading = ref<boolean>(false);
const errorMessage = ref<string | null>(null);

let abortController: AbortController | null = null;

const resolvedSelection = computed(() =>
	resolveRankingSelection(props.schema, props.rank, props.full),
);

const availableRankings = computed(() =>
	props.schema.rankings.filter((r) =>
		resolvedSelection.value.full ? r.supportsFull : r.supportsAll,
	),
);

const hasAllSupport = computed<boolean>(() =>
	props.schema.rankings.some((r) => r.supportsAll),
);

const hasFullSupport = computed<boolean>(() =>
	props.schema.rankings.some((r) => r.supportsFull),
);

const activeRankingLabel = computed<string>(() => {
	const found = props.schema.rankings.find(
		(r) => r.id === resolvedSelection.value.rank,
	);
	return found?.label ?? resolvedSelection.value.rank;
});

function abortInFlight(): void {
	if (abortController !== null) {
		abortController.abort();
		abortController = null;
	}
}

async function loadRankings(): Promise<void> {
	if (!props.platform || props.schema.rankings.length === 0) {
		pageData.value = null;
		return;
	}

	const normalized = resolvedSelection.value;
	if (normalized.rank !== props.rank || normalized.full !== props.full) {
		emit("update:selection", {
			rank: normalized.rank,
			full: normalized.full,
			page: 1,
		});
		return;
	}

	abortInFlight();
	const controller = new AbortController();
	abortController = controller;
	loading.value = true;
	errorMessage.value = null;

	try {
		const res = await fetchExploreRankings(
			props.platform,
			{
				rank: normalized.rank,
				full: normalized.full,
				page: props.page,
			},
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
		errorMessage.value = formatApiErrorMessage(err, "加载排行榜失败");
	} finally {
		if (abortController === controller) {
			abortController = null;
			loading.value = false;
		}
	}
}

function handleToggleFull(nextFull: boolean): void {
	if (nextFull === resolvedSelection.value.full) {
		return;
	}
	const next = resolveRankingSelection(
		props.schema,
		resolvedSelection.value.rank,
		nextFull,
	);
	emit("update:selection", {
		rank: next.rank,
		full: next.full,
		page: 1,
	});
}

function handleSelectRank(rankId: string): void {
	if (rankId === resolvedSelection.value.rank) {
		return;
	}
	emit("update:selection", {
		rank: rankId,
		full: resolvedSelection.value.full,
		page: 1,
	});
}

function goToPage(targetPage: number): void {
	if (targetPage < 1 || targetPage === props.page || loading.value) {
		return;
	}
	emit("update:selection", {
		rank: resolvedSelection.value.rank,
		full: resolvedSelection.value.full,
		page: targetPage,
	});
}

function isItemSelected(item: ExploreNovelItem): boolean {
	if (!props.selectedKeys) {
		return false;
	}
	return props.selectedKeys.has(
		makeCompositeKey(item.platform || props.platform, item.id),
	);
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
	[
		() => props.platform,
		() => props.schema,
		() => props.rank,
		() => props.full,
		() => props.page,
	],
	() => {
		void loadRankings();
	},
	{ immediate: true },
);

onBeforeUnmount(() => {
	abortInFlight();
});
</script>

<template>
	<div class="space-y-4">
		<!-- Empty Rankings Support -->
		<div
			v-if="schema.rankings.length === 0"
			class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center text-sm text-[var(--text-muted)]"
		>
			当前书源暂无排行榜配置
		</div>

		<template v-else>
			<!-- Controls: Full Toggle + Ranking Pills -->
			<div
				class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 space-y-3"
			>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div
						class="inline-flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-0.5"
						role="tablist"
						aria-label="榜单范围"
					>
						<button
							type="button"
							role="tab"
							:aria-selected="!resolvedSelection.full"
							:disabled="!hasAllSupport"
							class="rounded-lg px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40"
							:class="
								!resolvedSelection.full
									? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
									: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
							"
							@click="handleToggleFull(false)"
						>
							全部
						</button>
						<button
							type="button"
							role="tab"
							:aria-selected="resolvedSelection.full"
							:disabled="!hasFullSupport"
							class="rounded-lg px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40"
							:class="
								resolvedSelection.full
									? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
									: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
							"
							@click="handleToggleFull(true)"
						>
							完本
						</button>
					</div>

					<span class="text-xs text-[var(--text-muted)]">
						{{ activeRankingLabel }} · {{ resolvedSelection.full ? "完本榜" : "全站榜" }}
					</span>
				</div>

				<div
					class="flex flex-wrap items-center gap-1.5"
					role="tablist"
					aria-label="排行榜单选择"
				>
					<button
						v-for="item in availableRankings"
						:key="item.id"
						type="button"
						role="tab"
						:aria-selected="resolvedSelection.rank === item.id"
						class="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
						:class="
							resolvedSelection.rank === item.id
								? 'border-[var(--accent)] bg-[var(--accent)] text-white'
								: 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
						"
						@click="handleSelectRank(item.id)"
					>
						{{ item.label }}
					</button>
				</div>
			</div>

			<!-- Error -->
			<div
				v-if="errorMessage"
				role="alert"
				class="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs sm:text-sm text-red-500"
			>
				<span>{{ errorMessage }}</span>
				<button
					type="button"
					class="shrink-0 rounded-lg border border-red-500/30 px-2.5 py-1 text-xs font-medium hover:bg-red-500/10"
					@click="loadRankings()"
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
					class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center text-sm text-[var(--text-muted)]"
				>
					当前排行榜暂无更多数据
				</div>

				<template v-else>
					<div class="flex items-center justify-between text-xs text-[var(--text-secondary)]">
						<span>本页共 {{ pageData.items.length }} 部作品</span>
						<span>
							{{
								pageData.totalPages !== undefined
									? `第 ${page} / ${pageData.totalPages} 页`
									: `第 ${page} 页`
							}}
						</span>
					</div>

					<div class="grid grid-cols-1 gap-3.5 md:grid-cols-2">
						<ExploreNovelCard
							v-for="(item, idx) in pageData.items"
							:key="`${item.platform}:${item.id}:${idx}`"
							:item="item"
							:fallback-platform="platform"
							variant="detailed"
							:rank-fallback="(page - 1) * 30 + idx + 1"
							:selection-mode="selectionMode"
							:selected="isItemSelected(item)"
							@toggle-select="emit('toggleSelect', $event)"
						/>
					</div>
				</template>

				<!-- Pagination -->
				<div
					v-if="page > 1 || pageData.hasNextPage"
					class="flex items-center justify-center gap-3 pt-2"
				>
					<button
						type="button"
						:disabled="page <= 1 || loading"
						aria-label="上一页"
						class="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-40"
						@click="goToPage(page - 1)"
					>
						<ChevronLeft class="h-4 w-4" />
						上一页
					</button>
					<span class="text-xs text-[var(--text-secondary)]">
						{{
							pageData.totalPages !== undefined
								? `${page} / ${pageData.totalPages}`
								: `第 ${page} 页`
						}}
					</span>
					<button
						type="button"
						:disabled="!pageData.hasNextPage || loading"
						aria-label="下一页"
						class="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-40"
						@click="goToPage(page + 1)"
					>
						下一页
						<ChevronRight class="h-4 w-4" />
					</button>
				</div>
			</template>
		</template>
	</div>
</template>
