<script setup lang="ts">
import type { Chapter, Novel, Volume } from "@acanthis-dec/core";
import {
	ArrowLeft,
	Bookmark,
	BookmarkCheck,
	BookOpen,
	CheckSquare,
	ChevronDown,
	ChevronRight,
	Download,
	Lock,
	Play,
	RefreshCw,
	Square,
} from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { ApiError, fetchNovelDetail, rebaseMediaUrl } from "@/api/client";
import { webDb } from "@/db/indexedDb";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { useSourcesStore } from "@/stores/sources";

const route = useRoute();
const libraryStore = useLibraryStore();
const settingsStore = useSettingsStore();
const sourcesStore = useSourcesStore();

const platform = computed<string>(() => String(route.params.platform ?? ""));
const novelId = computed<string>(() => String(route.params.novelId ?? ""));

const novel = ref<Novel | null>(null);
const loading = ref<boolean>(true);
const refreshing = ref<boolean>(false);
const errorMessage = ref<string | null>(null);

const coverFailed = ref<boolean>(false);
const failedVolumeCovers = ref<Set<string>>(new Set());
const expandedVolumes = ref<Set<string>>(new Set());
const batchExportMode = ref<boolean>(false);
const selectedVolumeIds = ref<Set<string>>(new Set());
const exportNotice = ref<string | null>(null);

const resolvedPlatform = computed<string>(
	() => platform.value || novel.value?.platform || "",
);

const sourceName = computed<string>(() => {
	const found = sourcesStore.sources.find(
		(s) => s.id === resolvedPlatform.value,
	);
	return found?.name ?? resolvedPlatform.value;
});

const inBookshelf = computed<boolean>(() =>
	libraryStore.isInBookshelf(resolvedPlatform.value, novelId.value),
);

const existingProgress = computed(() =>
	libraryStore.getProgress(resolvedPlatform.value, novelId.value),
);

function isUnresolvedChapterId(chapterId: string): boolean {
	return chapterId.startsWith("TOBEDETERMINED");
}

function firstReadableChapter(target: Novel): Chapter | null {
	for (const vol of target.volumes) {
		for (const ch of vol.chapters) {
			if (!isUnresolvedChapterId(ch.id)) {
				return ch;
			}
		}
	}
	return null;
}

const primaryReadTarget = computed<{
	chapterId: string;
	label: string;
} | null>(() => {
	const current = novel.value;
	if (!current) {
		return null;
	}
	const progress = existingProgress.value;
	if (progress && !isUnresolvedChapterId(progress.chapterId)) {
		const exists = current.volumes.some((v) =>
			v.chapters.some(
				(c) => c.id === progress.chapterId && !isUnresolvedChapterId(c.id),
			),
		);
		if (exists) {
			return {
				chapterId: progress.chapterId,
				label: `续读 · ${progress.chapterTitle}`,
			};
		}
	}

	const first = firstReadableChapter(current);
	if (!first) {
		return null;
	}
	return {
		chapterId: first.id,
		label: "开始阅读",
	};
});

function getRebasedCover(rawUrl: string | null | undefined): string {
	return rebaseMediaUrl(rawUrl, settingsStore.apiBaseUrl);
}

function markVolumeCoverFailed(volumeId: string): void {
	const next = new Set(failedVolumeCovers.value);
	next.add(volumeId);
	failedVolumeCovers.value = next;
}

function toggleVolumeExpand(volumeId: string): void {
	const next = new Set(expandedVolumes.value);
	if (next.has(volumeId)) {
		next.delete(volumeId);
	} else {
		next.add(volumeId);
	}
	expandedVolumes.value = next;
}

function initDefaultExpandedVolumes(target: Novel): void {
	if (expandedVolumes.value.size > 0) {
		return;
	}
	const next = new Set<string>();
	if (target.volumes.length <= 3) {
		for (const v of target.volumes) {
			next.add(v.id);
		}
	} else {
		const progressVolId = existingProgress.value?.volumeId;
		if (progressVolId) {
			next.add(progressVolId);
		} else if (target.volumes[0]) {
			next.add(target.volumes[0].id);
		}
	}
	expandedVolumes.value = next;
}

function chapterRoute(chapterId: string): string {
	return `/read/${encodeURIComponent(resolvedPlatform.value)}/${encodeURIComponent(novelId.value)}/${encodeURIComponent(chapterId)}`;
}

async function loadNovelDetail(): Promise<void> {
	const currentPlatform = platform.value;
	const currentNovelId = novelId.value;
	if (!currentPlatform || !currentNovelId) {
		return;
	}

	coverFailed.value = false;
	failedVolumeCovers.value = new Set();
	errorMessage.value = null;

	const cached = await webDb
		.getNovelCache(currentPlatform, currentNovelId)
		.catch(() => null);
	if (cached) {
		novel.value = cached;
		loading.value = false;
		initDefaultExpandedVolumes(cached);
	} else {
		loading.value = true;
	}

	refreshing.value = true;
	try {
		const fresh = await fetchNovelDetail(currentPlatform, currentNovelId);
		novel.value = fresh;
		initDefaultExpandedVolumes(fresh);
		await webDb.putNovelCache(fresh).catch(() => {});
	} catch (err) {
		if (!novel.value) {
			errorMessage.value =
				err instanceof ApiError
					? err.message
					: err instanceof Error
						? err.message
						: "加载作品详情失败";
		}
	} finally {
		loading.value = false;
		refreshing.value = false;
	}
}

async function handleToggleBookshelf(): Promise<void> {
	const current = novel.value;
	if (!current) {
		return;
	}
	await libraryStore.toggleBookshelf({
		platform: resolvedPlatform.value,
		novelId: current.id,
		title: current.title,
		author: current.author,
		coverUrl: current.coverUrl ?? "",
	});
}

function toggleBatchExportMode(): void {
	batchExportMode.value = !batchExportMode.value;
	if (!batchExportMode.value) {
		selectedVolumeIds.value = new Set();
	} else if (novel.value) {
		selectedVolumeIds.value = new Set(novel.value.volumes.map((v) => v.id));
	}
}

function toggleVolumeSelection(volumeId: string): void {
	const next = new Set(selectedVolumeIds.value);
	if (next.has(volumeId)) {
		next.delete(volumeId);
	} else {
		next.add(volumeId);
	}
	selectedVolumeIds.value = next;
}

function handleExportVolumeSlot(volume: Volume): void {
	exportNotice.value = `已预留单卷 EPUB 导出入口：「${volume.title}」（将于 Task 8 接入 Web Worker 打包下载）`;
}

function handleExportSelectedSlot(): void {
	const count = selectedVolumeIds.value.size;
	exportNotice.value =
		count > 0
			? `已预留批量 EPUB 导出入口：已选 ${count} 卷（将于 Task 8 接入 Web Worker 打包下载）`
			: "请先选择至少一卷再导出";
}

function handleExportAllSlot(): void {
	const total = novel.value?.volumes.length ?? 0;
	exportNotice.value = `已预留整书 EPUB 导出入口：共 ${total} 卷（将于 Task 8 接入 Web Worker 打包下载）`;
}

watch([platform, novelId], () => {
	expandedVolumes.value = new Set();
	selectedVolumeIds.value = new Set();
	batchExportMode.value = false;
	exportNotice.value = null;
	void loadNovelDetail();
});

onMounted(() => {
	void loadNovelDetail();
});
</script>

<template>
	<div class="space-y-6">
		<div class="flex items-center justify-between gap-2">
			<RouterLink
				to="/explore"
				class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
			>
				<ArrowLeft class="h-4 w-4" />
				返回发现
			</RouterLink>

			<div
				v-if="refreshing"
				class="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]"
			>
				<RefreshCw class="h-3.5 w-3.5 animate-spin" />
				后台更新目录中…
			</div>
		</div>

		<!-- Loading Skeleton -->
		<div
			v-if="loading && !novel"
			class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 space-y-4 animate-pulse"
		>
			<div class="flex gap-5">
				<div class="h-44 w-32 rounded-xl bg-[var(--bg-secondary)]" />
				<div class="flex-1 space-y-3">
					<div class="h-6 w-2/3 rounded bg-[var(--bg-secondary)]" />
					<div class="h-4 w-1/3 rounded bg-[var(--bg-secondary)]" />
					<div class="h-20 w-full rounded bg-[var(--bg-secondary)]" />
				</div>
			</div>
		</div>

		<!-- Error State -->
		<div
			v-else-if="errorMessage && !novel"
			class="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center space-y-3"
		>
			<p class="text-sm text-red-600">{{ errorMessage }}</p>
			<button
				type="button"
				class="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white"
				@click="loadNovelDetail()"
			>
				重新加载
			</button>
		</div>

		<!-- Novel Content -->
		<template v-else-if="novel">
			<!-- Metadata Hero -->
			<section
				class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 sm:p-6 space-y-5"
			>
				<div class="flex flex-col sm:flex-row gap-5">
					<div
						class="mx-auto sm:mx-0 h-48 w-36 shrink-0 overflow-hidden rounded-xl bg-[var(--bg-secondary)] shadow-xs"
					>
						<img
							v-if="getRebasedCover(novel.coverUrl) && !coverFailed"
							:src="getRebasedCover(novel.coverUrl)"
							:alt="novel.title"
							class="h-full w-full object-cover"
							@error="coverFailed = true"
						/>
						<div
							v-else
							class="flex h-full w-full items-center justify-center text-[var(--text-muted)]"
						>
							<BookOpen class="h-10 w-10" />
						</div>
					</div>

					<div class="flex-1 min-w-0 space-y-3">
						<div class="flex flex-wrap items-center gap-2">
							<span
								class="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]"
							>
								{{ sourceName }}
							</span>
							<span
								class="rounded-md bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
							>
								{{
									novel.status === "completed"
										? "已完结"
										: novel.status === "ongoing"
											? "连载中"
											: "状态未知"
								}}
							</span>
						</div>

						<div>
							<h1 class="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
								{{ novel.title }}
							</h1>
							<p class="mt-1 text-sm text-[var(--text-secondary)]">
								作者：{{ novel.author || "未知" }}
							</p>
						</div>

						<div v-if="novel.genres.length > 0" class="flex flex-wrap gap-1.5">
							<span
								v-for="genre in novel.genres"
								:key="genre"
								class="rounded-full border border-[var(--border-subtle)] px-2.5 py-0.5 text-[11px] text-[var(--text-secondary)]"
							>
								{{ genre }}
							</span>
						</div>

						<p
							v-if="novel.summary"
							class="text-xs sm:text-sm leading-relaxed text-[var(--text-secondary)] whitespace-pre-line"
						>
							{{ novel.summary }}
						</p>
					</div>
				</div>

				<!-- Primary Action Buttons + EPUB Export Slots -->
				<div class="flex flex-wrap items-center gap-2.5 pt-2 border-t border-[var(--border-subtle)]">
					<RouterLink
						v-if="primaryReadTarget"
						:to="chapterRoute(primaryReadTarget.chapterId)"
						class="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
					>
						<Play class="h-4 w-4 fill-current" />
						{{ primaryReadTarget.label }}
					</RouterLink>
					<span
						v-else
						class="inline-flex items-center gap-1.5 rounded-xl bg-[var(--bg-secondary)] px-4 py-2.5 text-sm font-medium text-[var(--text-muted)]"
					>
						暂无可读章节
					</span>

					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors"
						:class="
							inBookshelf
								? 'border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]'
								: 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
						"
						@click="handleToggleBookshelf"
					>
						<BookmarkCheck v-if="inBookshelf" class="h-4 w-4" />
						<Bookmark v-else class="h-4 w-4" />
						{{ inBookshelf ? "已在书架" : "加入书架" }}
					</button>

					<!-- EPUB Export Slots (wired in Task 8) -->
					<div class="flex flex-wrap items-center gap-2 sm:ml-auto">
						<button
							type="button"
							class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
							@click="handleExportAllSlot"
						>
							<Download class="h-3.5 w-3.5" />
							整书导出 EPUB
						</button>
						<button
							type="button"
							class="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors"
							:class="
								batchExportMode
									? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
									: 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
							"
							@click="toggleBatchExportMode"
						>
							{{ batchExportMode ? "取消选卷" : "批量选卷导出" }}
						</button>
					</div>
				</div>

				<!-- Batch Selection Action Bar -->
				<div
					v-if="batchExportMode"
					class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/50 px-3.5 py-2.5 text-xs"
				>
					<span class="text-[var(--text-primary)]">
						已选择 {{ selectedVolumeIds.size }} / {{ novel.volumes.length }} 卷
					</span>
					<button
						type="button"
						:disabled="selectedVolumeIds.size === 0"
						class="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 font-medium text-white disabled:opacity-40"
						@click="handleExportSelectedSlot"
					>
						<Download class="h-3.5 w-3.5" />
						导出所选分卷 EPUB
					</button>
				</div>

				<p
					v-if="exportNotice"
					class="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-2.5 text-xs text-[var(--text-secondary)]"
				>
					{{ exportNotice }}
				</p>
			</section>

			<!-- Volumes & Chapters -->
			<section class="space-y-3" aria-label="分卷目录">
				<h2 class="text-base font-semibold text-[var(--text-primary)]">
					目录 · 共 {{ novel.volumes.length }} 卷
				</h2>

				<div
					v-for="volume in novel.volumes"
					:key="volume.id"
					class="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
				>
					<div
						class="flex items-center gap-3 p-3.5 sm:p-4 hover:bg-[var(--bg-secondary)]/50 transition-colors"
					>
						<button
							v-if="batchExportMode"
							type="button"
							aria-label="选择分卷"
							class="shrink-0 text-[var(--accent)]"
							@click="toggleVolumeSelection(volume.id)"
						>
							<CheckSquare
								v-if="selectedVolumeIds.has(volume.id)"
								class="h-5 w-5"
							/>
							<Square v-else class="h-5 w-5 text-[var(--text-muted)]" />
						</button>

						<button
							type="button"
							class="flex min-w-0 flex-1 items-center gap-3 text-left"
							@click="toggleVolumeExpand(volume.id)"
						>
							<img
								v-if="
									getRebasedCover(volume.coverUrl) &&
									!failedVolumeCovers.has(volume.id)
								"
								:src="getRebasedCover(volume.coverUrl)"
								:alt="volume.title"
								loading="lazy"
								class="h-14 w-10 shrink-0 rounded-lg object-cover bg-[var(--bg-secondary)]"
								@error="markVolumeCoverFailed(volume.id)"
							/>

							<div class="min-w-0 flex-1">
								<h3 class="truncate text-sm sm:text-base font-semibold text-[var(--text-primary)]">
									{{ volume.title }}
								</h3>
								<p class="text-xs text-[var(--text-muted)]">
									{{ volume.chapters.length }} 章
								</p>
							</div>

							<ChevronDown
								v-if="expandedVolumes.has(volume.id)"
								class="h-4 w-4 shrink-0 text-[var(--text-muted)]"
							/>
							<ChevronRight
								v-else
								class="h-4 w-4 shrink-0 text-[var(--text-muted)]"
							/>
						</button>

						<button
							type="button"
							class="shrink-0 inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							@click.stop="handleExportVolumeSlot(volume)"
						>
							<Download class="h-3.5 w-3.5" />
							<span class="hidden sm:inline">导出本卷 EPUB</span>
							<span class="sm:hidden">EPUB</span>
						</button>
					</div>

					<div
						v-if="expandedVolumes.has(volume.id)"
						class="border-t border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]"
					>
						<template v-for="chapter in volume.chapters" :key="chapter.id">
							<div
								v-if="isUnresolvedChapterId(chapter.id)"
								aria-disabled="true"
								class="flex items-center justify-between gap-2 px-4 py-3 text-xs sm:text-sm text-[var(--text-muted)] bg-[var(--bg-secondary)]/30 cursor-not-allowed select-none"
							>
								<span class="truncate">{{ chapter.title }}</span>
								<span
									class="inline-flex items-center gap-1 shrink-0 rounded-md border border-[var(--border-subtle)] px-2 py-0.5 text-[11px]"
								>
									<Lock class="h-3 w-3" />
									源站暂未公开链接
								</span>
							</div>

							<RouterLink
								v-else
								:to="chapterRoute(chapter.id)"
								class="flex items-center justify-between gap-2 px-4 py-3 text-xs sm:text-sm transition-colors hover:bg-[var(--bg-secondary)]/60"
								:class="
									existingProgress?.chapterId === chapter.id
										? 'bg-[var(--accent-soft)]/50 font-semibold text-[var(--accent)]'
										: 'text-[var(--text-primary)]'
								"
							>
								<span class="truncate">{{ chapter.title }}</span>
								<span
									v-if="existingProgress?.chapterId === chapter.id"
									class="shrink-0 text-[11px] font-medium text-[var(--accent)]"
								>
									上次读到
								</span>
							</RouterLink>
						</template>
					</div>
				</div>
			</section>
		</template>
	</div>
</template>
