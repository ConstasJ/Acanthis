<script setup lang="ts">
import type { ExploreNovelItem } from "@acanthis-dec/core";
import { BookOpen } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { rebaseMediaUrl } from "@/api/client";
import { formatNovelStatusLabel } from "@/components/explore/exploreUtils";
import { useSettingsStore } from "@/stores/settings";

const props = withDefaults(
	defineProps<{
		item: ExploreNovelItem;
		fallbackPlatform: string;
		variant?: "grid" | "detailed" | "compact" | undefined;
		rankFallback?: number | undefined;
	}>(),
	{
		variant: "grid",
	},
);

const settingsStore = useSettingsStore();
const coverFailed = ref<boolean>(false);

watch(
	[() => props.item.id, () => props.item.coverUrl],
	() => {
		coverFailed.value = false;
	},
);

const resolvedPlatform = computed<string>(
	() => props.item.platform || props.fallbackPlatform,
);

const detailRoute = computed<string>(
	() =>
		`/novel/${encodeURIComponent(resolvedPlatform.value)}/${encodeURIComponent(props.item.id)}`,
);

const rebasedCover = computed<string>(() =>
	rebaseMediaUrl(props.item.coverUrl, settingsStore.apiBaseUrl),
);

const showCoverImage = computed<boolean>(
	() => Boolean(rebasedCover.value) && !coverFailed.value,
);

const displayRank = computed<number | undefined>(
	() => props.item.rank ?? props.rankFallback,
);

const statusLabel = computed<string | null>(() =>
	formatNovelStatusLabel(props.item.status),
);

const displayGenres = computed<string[]>(() =>
	(props.item.genres ?? []).slice(0, 3),
);

function rankBadgeClass(rank: number): string {
	if (rank <= 3) {
		return "bg-[var(--accent)] text-white";
	}
	return "bg-black/65 text-white backdrop-blur-xs";
}
</script>

<template>
	<!-- Compact Row Variant (for rank / updates lists) -->
	<RouterLink
		v-if="variant === 'compact'"
		:to="detailRoute"
		class="group flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 transition-shadow hover:shadow-sm"
	>
		<span
			v-if="displayRank !== undefined"
			class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
			:class="
				displayRank <= 3
					? 'bg-[var(--accent)] text-white'
					: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
			"
		>
			{{ displayRank }}
		</span>

		<div
			class="relative aspect-[3/4] w-11 shrink-0 overflow-hidden rounded-lg bg-[var(--bg-secondary)]"
		>
			<img
				v-if="showCoverImage"
				:src="rebasedCover"
				:alt="item.title"
				loading="lazy"
				class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
				@error="coverFailed = true"
			/>
			<div
				v-else
				class="flex h-full w-full items-center justify-center text-[var(--text-muted)]"
			>
				<BookOpen class="h-4 w-4" />
			</div>
		</div>

		<div class="min-w-0 flex-1 space-y-1">
			<div class="flex items-center justify-between gap-2">
				<h3
					class="truncate text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors"
				>
					{{ item.title }}
				</h3>
				<span
					v-if="statusLabel"
					class="shrink-0 rounded-md bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]"
				>
					{{ statusLabel }}
				</span>
			</div>

			<div
				v-if="item.author || item.category || item.wordCount"
				class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-muted)]"
			>
				<span v-if="item.author" class="truncate max-w-[10rem]">
					{{ item.author }}
				</span>
				<span
					v-if="item.category"
					class="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
				>
					{{ item.category }}
				</span>
				<span v-if="item.wordCount" class="text-[11px]">
					{{ item.wordCount }}
				</span>
			</div>

			<div
				v-if="item.latestChapter || item.updatedAt"
				class="flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]"
			>
				<span v-if="item.latestChapter" class="truncate">
					{{ item.latestChapter }}
				</span>
				<span v-if="item.updatedAt" class="shrink-0 text-[var(--text-muted)]">
					{{ item.updatedAt }}
				</span>
			</div>
		</div>
	</RouterLink>

	<!-- Detailed Horizontal Variant (for featured / rankings / catalog) -->
	<RouterLink
		v-else-if="variant === 'detailed'"
		:to="detailRoute"
		class="group flex gap-3.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 transition-shadow hover:shadow-sm"
	>
		<div
			class="relative aspect-[3/4] w-20 sm:w-24 shrink-0 overflow-hidden rounded-xl bg-[var(--bg-secondary)]"
		>
			<img
				v-if="showCoverImage"
				:src="rebasedCover"
				:alt="item.title"
				loading="lazy"
				class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
				@error="coverFailed = true"
			/>
			<div
				v-else
				class="flex h-full w-full items-center justify-center text-[var(--text-muted)]"
			>
				<BookOpen class="h-7 w-7" />
			</div>

			<span
				v-if="displayRank !== undefined"
				class="absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
				:class="rankBadgeClass(displayRank)"
			>
				#{{ displayRank }}
			</span>
		</div>

		<div class="min-w-0 flex-1 flex flex-col justify-between gap-1.5">
			<div class="space-y-1">
				<div class="flex items-start justify-between gap-2">
					<h3
						class="line-clamp-2 text-sm sm:text-base font-semibold text-[var(--text-primary)] leading-snug group-hover:text-[var(--accent)] transition-colors"
					>
						{{ item.title }}
					</h3>
					<span
						v-if="statusLabel"
						class="shrink-0 rounded-md bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]"
					>
						{{ statusLabel }}
					</span>
				</div>

				<div
					v-if="item.author || item.category || item.wordCount"
					class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]"
				>
					<span v-if="item.author" class="truncate max-w-[12rem]">
						{{ item.author }}
					</span>
					<span
						v-if="item.category"
						class="rounded-md bg-[var(--accent-soft)]/70 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]"
					>
						{{ item.category }}
					</span>
					<span v-if="item.wordCount" class="text-[11px]">
						{{ item.wordCount }}
					</span>
				</div>

				<div
					v-if="displayGenres.length > 0"
					class="flex flex-wrap gap-1 pt-0.5"
				>
					<span
						v-for="genre in displayGenres"
						:key="genre"
						class="rounded-md bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
					>
						{{ genre }}
					</span>
				</div>

				<p
					v-if="item.summary"
					class="line-clamp-2 text-xs text-[var(--text-secondary)] leading-relaxed pt-0.5"
				>
					{{ item.summary }}
				</p>
			</div>

			<div
				v-if="item.latestChapter || item.updatedAt"
				class="flex items-center justify-between gap-2 pt-1 text-[11px] text-[var(--text-muted)] border-t border-[var(--border-subtle)]/60"
			>
				<span
					v-if="item.latestChapter"
					class="truncate text-[var(--text-secondary)]"
				>
					最新：{{ item.latestChapter }}
				</span>
				<span v-else />
				<span v-if="item.updatedAt" class="shrink-0">
					{{ item.updatedAt }}
				</span>
			</div>
		</div>
	</RouterLink>

	<!-- Default Grid Poster Variant -->
	<RouterLink
		v-else
		:to="detailRoute"
		class="group flex flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] transition-shadow hover:shadow-sm"
	>
		<div
			class="relative aspect-[3/4] w-full overflow-hidden bg-[var(--bg-secondary)]"
		>
			<img
				v-if="showCoverImage"
				:src="rebasedCover"
				:alt="item.title"
				loading="lazy"
				class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
				@error="coverFailed = true"
			/>
			<div
				v-else
				class="flex h-full w-full items-center justify-center text-[var(--text-muted)]"
			>
				<BookOpen class="h-8 w-8" />
			</div>

			<span
				v-if="displayRank !== undefined"
				class="absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
				:class="rankBadgeClass(displayRank)"
			>
				#{{ displayRank }}
			</span>

			<span
				v-if="statusLabel"
				class="absolute right-2 top-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs"
			>
				{{ statusLabel }}
			</span>
		</div>

		<div class="flex flex-1 flex-col justify-between gap-1.5 p-3">
			<div class="space-y-1">
				<h3
					class="line-clamp-2 text-sm font-semibold text-[var(--text-primary)] leading-snug group-hover:text-[var(--accent)] transition-colors"
				>
					{{ item.title }}
				</h3>

				<div
					v-if="item.author || item.category"
					class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--text-muted)]"
				>
					<span v-if="item.author" class="truncate">
						{{ item.author }}
					</span>
					<span
						v-if="item.category"
						class="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
					>
						{{ item.category }}
					</span>
				</div>

				<p
					v-if="item.summary"
					class="line-clamp-2 text-xs text-[var(--text-secondary)] leading-snug"
				>
					{{ item.summary }}
				</p>
			</div>

			<div
				v-if="item.latestChapter || item.updatedAt"
				class="flex items-center justify-between gap-1.5 pt-1 text-[11px] text-[var(--text-muted)]"
			>
				<span v-if="item.latestChapter" class="truncate">
					{{ item.latestChapter }}
				</span>
				<span v-else />
				<span v-if="item.updatedAt" class="shrink-0">
					{{ item.updatedAt }}
				</span>
			</div>
		</div>
	</RouterLink>
</template>
