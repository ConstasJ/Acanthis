<script setup lang="ts">
import type {
	ExploreHomeData,
	ExploreNovelItem,
	ExploreSchema,
	ExploreSection,
	ExploreSectionMoreTarget,
} from "@acanthis-dec/core";
import {
	ChevronRight,
	Clock,
	RotateCw,
	ShieldAlert,
} from "lucide-vue-next";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { fetchExploreHome, isAbortError } from "@/api/client";
import ExploreNovelCard from "@/components/explore/ExploreNovelCard.vue";
import {
	type ExploreTab,
	formatApiErrorMessage,
	isChallengeBlockedError,
	resolveDefaultHomeChannel,
} from "@/components/explore/exploreUtils";
import { makeCompositeKey } from "@/db/indexedDb";

const props = withDefaults(
	defineProps<{
		platform: string;
		schema: ExploreSchema;
		channel: string;
		selectionMode?: boolean | undefined;
		selectedKeys?: ReadonlySet<string> | undefined;
	}>(),
	{
		selectionMode: false,
	},
);

const emit = defineEmits<{
	"update:channel": [channel: string];
	navigateMore: [target: ExploreSectionMoreTarget];
	switchTab: [tab: ExploreTab];
	toggleSelect: [item: ExploreNovelItem];
	visibleItems: [items: ExploreNovelItem[]];
}>();

const homeData = ref<ExploreHomeData | null>(null);
const loading = ref<boolean>(false);
const showSlowHint = ref<boolean>(false);
const errorState = ref<unknown>(null);

let abortController: AbortController | null = null;
let slowHintTimer: ReturnType<typeof setTimeout> | null = null;

const defaultChannel = computed<string>(() =>
	resolveDefaultHomeChannel(props.schema),
);

const effectiveChannel = computed<string>(() => {
	if (props.schema.channels.length === 0) {
		return props.channel || "home";
	}
	const found = props.schema.channels.find((c) => c.id === props.channel);
	return found ? found.id : defaultChannel.value;
});

const activeChannelMeta = computed(() =>
	props.schema.channels.find((c) => c.id === effectiveChannel.value),
);

const isChallengeError = computed<boolean>(() =>
	isChallengeBlockedError(errorState.value),
);

const errorMessage = computed<string | null>(() => {
	if (!errorState.value) {
		return null;
	}
	return formatApiErrorMessage(errorState.value, "加载首页推荐失败");
});

const visibleSections = computed<ExploreSection[]>(() =>
	(homeData.value?.sections ?? []).filter((sec) => sec.items.length > 0),
);

function isItemSelected(item: ExploreNovelItem): boolean {
	if (!props.selectedKeys) {
		return false;
	}
	return props.selectedKeys.has(
		makeCompositeKey(item.platform || props.platform, item.id),
	);
}

watch(
	[visibleSections, loading, errorMessage],
	([sections, isLoading, err]) => {
		if (isLoading || err) {
			emit("visibleItems", []);
			return;
		}
		emit(
			"visibleItems",
			sections.flatMap((section) => section.items),
		);
	},
	{ immediate: true },
);

function clearSlowHintTimer(): void {
	if (slowHintTimer !== null) {
		clearTimeout(slowHintTimer);
		slowHintTimer = null;
	}
	showSlowHint.value = false;
}

function abortInFlight(): void {
	if (abortController !== null) {
		abortController.abort();
		abortController = null;
	}
	clearSlowHintTimer();
}

async function loadHome(): Promise<void> {
	if (!props.platform || !props.schema.supportsHome) {
		return;
	}

	const targetChannel = effectiveChannel.value;
	if (props.schema.channels.length > 0 && targetChannel !== props.channel) {
		emit("update:channel", targetChannel);
		return;
	}

	abortInFlight();
	const controller = new AbortController();
	abortController = controller;
	loading.value = true;
	errorState.value = null;

	if (activeChannelMeta.value?.requiresChallenge) {
		slowHintTimer = setTimeout(() => {
			if (abortController === controller && !controller.signal.aborted) {
				showSlowHint.value = true;
			}
		}, 1500);
	}

	try {
		const data = await fetchExploreHome(
			props.platform,
			targetChannel,
			controller.signal,
		);
		if (controller.signal.aborted) {
			return;
		}
		homeData.value = data;
	} catch (err) {
		if (controller.signal.aborted || isAbortError(err)) {
			return;
		}
		errorState.value = err;
	} finally {
		if (abortController === controller) {
			abortController = null;
			loading.value = false;
			clearSlowHintTimer();
		}
	}
}

function handleSelectChannel(channelId: string): void {
	if (channelId === effectiveChannel.value) {
		return;
	}
	emit("update:channel", channelId);
}

function sectionGridClass(layout: ExploreSection["layout"]): string {
	if (layout === "featured") {
		return "grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3";
	}
	if (layout === "rank" || layout === "updates") {
		return "grid grid-cols-1 gap-2.5 md:grid-cols-2";
	}
	return "grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";
}

function cardVariant(
	layout: ExploreSection["layout"],
): "grid" | "detailed" | "compact" {
	if (layout === "featured") {
		return "detailed";
	}
	if (layout === "rank" || layout === "updates") {
		return "compact";
	}
	return "grid";
}

watch(
	[() => props.platform, () => props.schema, () => props.channel],
	() => {
		void loadHome();
	},
	{ immediate: true },
);

onBeforeUnmount(() => {
	abortInFlight();
});
</script>

<template>
	<div class="space-y-5">
		<!-- Channel Pills -->
		<div
			v-if="schema.channels.length > 0"
			class="flex items-center gap-2 overflow-x-auto pb-1.5"
			role="tablist"
			aria-label="首页频道"
		>
			<button
				v-for="ch in schema.channels"
				:key="ch.id"
				type="button"
				role="tab"
				:aria-selected="effectiveChannel === ch.id"
				:title="
					ch.requiresChallenge
						? `${ch.label}（受 Cloudflare 保护，需服务端开启 FlareSolverr）`
						: ch.label
				"
				class="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors"
				:class="
					effectiveChannel === ch.id
						? 'border-[var(--accent)] bg-[var(--accent)] text-white'
						: 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
				"
				@click="handleSelectChannel(ch.id)"
			>
				<span>{{ ch.label }}</span>
				<ShieldAlert
					v-if="ch.requiresChallenge"
					class="h-3.5 w-3.5 shrink-0"
					:class="
						effectiveChannel === ch.id
							? 'text-white/90'
							: 'text-[var(--text-muted)]'
					"
					aria-hidden="true"
				/>
			</button>
		</div>

		<!-- Unsupported Home -->
		<div
			v-if="!schema.supportsHome"
			class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center text-sm text-[var(--text-muted)]"
		>
			当前书源暂不支持首页推荐视图
		</div>

		<template v-else>
			<!-- Slow Loading Hint for Challenge Channels -->
			<div
				v-if="loading && showSlowHint"
				class="flex items-center gap-2 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/60 px-4 py-3 text-xs sm:text-sm text-[var(--text-secondary)]"
			>
				<Clock class="h-4 w-4 shrink-0 text-[var(--accent)] animate-pulse" />
				<span>
					正在通过服务端请求该文库频道，若触发 Cloudflare 验证可能需要数秒，请耐心等待…
				</span>
			</div>

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
							该文库频道受 Cloudflare 保护，暂无法访问
						</h3>
						<p class="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
							此出版社专题页面需要服务端开启并正确配置 FlareSolverr 后才能抓取。全站首页与排行榜无需验证，可继续正常浏览。
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
						@click="loadHome()"
					>
						<RotateCw class="h-3.5 w-3.5" />
						重试当前频道
					</button>
					<button
						v-if="effectiveChannel !== defaultChannel"
						type="button"
						class="rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
						@click="emit('update:channel', defaultChannel)"
					>
						切回全站首页
					</button>
					<button
						v-if="schema.rankings.length > 0"
						type="button"
						class="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
						@click="emit('switchTab', 'rankings')"
					>
						浏览排行榜
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
					@click="loadHome()"
				>
					重试
				</button>
			</div>

			<!-- Loading Skeleton -->
			<div v-if="loading" class="space-y-6">
				<div v-for="secIdx in 2" :key="secIdx" class="space-y-3">
					<div class="h-5 w-32 rounded bg-[var(--bg-secondary)] animate-pulse" />
					<div
						class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
					>
						<div
							v-for="cardIdx in 5"
							:key="cardIdx"
							class="aspect-[3/4] rounded-2xl bg-[var(--bg-secondary)] animate-pulse"
						/>
					</div>
				</div>
			</div>

			<!-- Sections Content -->
			<template v-else-if="homeData && !errorMessage">
				<div
					v-if="visibleSections.length === 0"
					class="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center text-sm text-[var(--text-muted)]"
				>
					当前频道暂无推荐板块
				</div>

				<div v-else class="space-y-7">
					<div
						v-if="homeData.title && effectiveChannel !== defaultChannel"
						class="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2"
					>
						<h2 class="text-base sm:text-lg font-bold text-[var(--text-primary)]">
							{{ homeData.title }}
						</h2>
						<span class="text-xs text-[var(--text-muted)]">
							{{ visibleSections.length }} 个板块
						</span>
					</div>

					<section
						v-for="section in visibleSections"
						:key="section.id"
						class="space-y-3"
					>
						<div class="flex items-center justify-between gap-3">
							<h2
								class="text-base sm:text-lg font-bold tracking-tight text-[var(--text-primary)]"
							>
								{{ section.title }}
							</h2>
							<button
								v-if="section.more"
								type="button"
								class="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]/60 transition-colors"
								@click="emit('navigateMore', section.more)"
							>
								<span>更多</span>
								<ChevronRight class="h-3.5 w-3.5" />
							</button>
						</div>

						<div :class="sectionGridClass(section.layout)">
							<ExploreNovelCard
								v-for="(item, idx) in section.items"
								:key="`${section.id}:${item.id}:${idx}`"
								:item="item"
								:fallback-platform="platform"
								:variant="cardVariant(section.layout)"
								:rank-fallback="section.layout === 'rank' ? idx + 1 : undefined"
								:selection-mode="selectionMode"
								:selected="isItemSelected(item)"
								@toggle-select="emit('toggleSelect', $event)"
							/>
						</div>
					</section>
				</div>
			</template>
		</template>
	</div>
</template>
