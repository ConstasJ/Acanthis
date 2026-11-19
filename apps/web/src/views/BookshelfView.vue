<script setup lang="ts">
import type { BookshelfItem, ReadingProgress } from "@acanthis-dec/core";
import {
	ArrowUpDown,
	BookOpen,
	Compass,
	MoreVertical,
	Play,
	RefreshCw,
	Smartphone,
	Trash2,
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { rebaseMediaUrl } from "@/api/client";
import SetupBanner from "@/components/SetupBanner.vue";
import { makeCompositeKey } from "@/db/indexedDb";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { useSourcesStore } from "@/stores/sources";

type SortMode = "recentRead" | "recentAdded";

const libraryStore = useLibraryStore();
const settingsStore = useSettingsStore();
const sourcesStore = useSourcesStore();

const sortMode = ref<SortMode>("recentRead");
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

const continueReading = computed(() => libraryStore.continueReadingItem);

const sortedBookshelf = computed<BookshelfItem[]>(() => {
	const list = [...libraryStore.activeBookshelf];
	if (sortMode.value === "recentAdded") {
		return list.sort((a, b) => b.addedAt - a.addedAt);
	}
	return list.sort((a, b) => {
		const progA = libraryStore.getProgress(a.platform, a.novelId);
		const progB = libraryStore.getProgress(b.platform, b.novelId);
		const timeA = Math.max(progA?.updatedAt ?? 0, a.addedAt);
		const timeB = Math.max(progB?.updatedAt ?? 0, b.addedAt);
		return timeB - timeA;
	});
});

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
	if (openMenuKey.value === null) {
		return;
	}
	const target = event.target as HTMLElement | null;
	if (!target?.closest("[data-bookshelf-menu]")) {
		openMenuKey.value = null;
	}
}

function handleDocumentKeyDown(event: KeyboardEvent): void {
	if (event.key === "Escape" && openMenuKey.value !== null) {
		openMenuKey.value = null;
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
	<div class="space-y-6">
		<SetupBanner />

		<header class="flex items-center justify-between gap-3">
			<div>
				<h1 class="text-xl sm:text-2xl font-bold tracking-tight">我的书架</h1>
				<p class="mt-0.5 text-xs sm:text-sm text-[var(--text-secondary)]">
					本地优先存储 · 已收藏 {{ sortedBookshelf.length }} 部作品
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

		<!-- Bookshelf Grid Header -->
		<section class="space-y-4">
			<div class="flex items-center justify-between gap-2">
				<h2 class="text-sm font-semibold text-[var(--text-secondary)]">
					收藏列表
				</h2>
				<div
					class="inline-flex items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5 text-xs"
				>
					<button
						type="button"
						class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium transition-colors"
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
						class="rounded-lg px-2.5 py-1.5 font-medium transition-colors"
						:class="
							sortMode === 'recentAdded'
								? 'bg-[var(--accent-soft)] text-[var(--accent)]'
								: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
						"
						@click="sortMode = 'recentAdded'"
					>
						最近添加
					</button>
				</div>
			</div>

			<!-- Empty State -->
			<div
				v-if="sortedBookshelf.length === 0"
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
				<RouterLink
					to="/explore"
					class="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:opacity-90"
				>
					<Compass class="h-4 w-4" />
					去发现好书
				</RouterLink>
			</div>

			<!-- Grid -->
			<div
				v-else
				class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
			>
				<div
					v-for="item in sortedBookshelf"
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
							class="absolute bottom-8 right-0 z-20 w-32 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-lg"
						>
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
	</div>
</template>
