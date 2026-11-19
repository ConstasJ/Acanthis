<script setup lang="ts">
import type { Chapter, Novel, ReadingProgress } from "@acanthis-dec/core";
import {
	ArrowLeft,
	BookOpen,
	ChevronLeft,
	ChevronRight,
	Download,
	List,
	Lock,
	Settings2,
	Smartphone,
	X,
} from "lucide-vue-next";
import {
	computed,
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
	watch,
} from "vue";
import { onBeforeRouteLeave, RouterLink, useRoute, useRouter } from "vue-router";
import {
	ApiError,
	fetchChapterContent,
	fetchNovelDetail,
} from "@/api/client";
import { useNextChapterPrefetch } from "@/composables/useNextChapterPrefetch";
import { makeChapterCacheKey, webDb } from "@/db/indexedDb";
import { useLibraryStore } from "@/stores/library";
import {
	type ReaderMode,
	type ReaderTheme,
	useSettingsStore,
} from "@/stores/settings";
import { parseChapterBlocks, type ReaderBlock } from "@/utils/chapterParser";

interface FlatChapterEntry {
	volumeId: string;
	volumeTitle: string;
	chapter: Chapter;
}

const COLUMN_GAP_PX = 32;
const SWIPE_THRESHOLD_PX = 40;

const route = useRoute();
const router = useRouter();
const libraryStore = useLibraryStore();
const settingsStore = useSettingsStore();

const platform = computed<string>(() => String(route.params.platform ?? ""));
const novelId = computed<string>(() => String(route.params.novelId ?? ""));
const chapterId = computed<string>(() => String(route.params.chapterId ?? ""));

const queryParagraph = computed<number | null>(() => {
	const raw = route.query.paragraph;
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (typeof value !== "string" || !value.trim()) {
		return null;
	}
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
});

const novel = ref<Novel | null>(null);
const rawHtml = ref<string>("");
const cachedChapterTitle = ref<string>("");
const loading = ref<boolean>(true);
const errorMessage = ref<string | null>(null);

const currentParagraphIndex = ref<number>(0);
const showHud = ref<boolean>(false);
const showAppearance = ref<boolean>(false);
const showToc = ref<boolean>(false);

const toastMessage = ref<string | null>(null);
const remoteChapterPrompt = ref<ReadingProgress | null>(null);

const scrollContainerRef = ref<HTMLElement | null>(null);
const paginatedContainerRef = ref<HTMLElement | null>(null);
const paginatedViewportRef = ref<HTMLElement | null>(null);
const paginatedColumnsRef = ref<HTMLElement | null>(null);

const pageWidth = ref<number>(360);
const currentPage = ref<number>(0);
const totalPages = ref<number>(1);
const disablePageTransition = ref<boolean>(false);

let loadSequence = 0;
let isRestoringAnchor = false;
let restoreReleaseTimer: ReturnType<typeof setTimeout> | null = null;
let scrollRafId: number | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let resizeObserver: ResizeObserver | null = null;
let hasUserInteracted = false;

let touchStartX = 0;
let touchStartY = 0;
let justSwiped = false;
let swipeResetTimer: ReturnType<typeof setTimeout> | null = null;

useNextChapterPrefetch({
	platform,
	novelId,
	chapterId,
	novel,
});

const mode = computed<ReaderMode>(() => settingsStore.readerSettings.mode);

const blocks = computed<ReaderBlock[]>(() =>
	parseChapterBlocks(rawHtml.value, settingsStore.apiBaseUrl),
);

const flatChapters = computed<FlatChapterEntry[]>(() => {
	if (!novel.value) {
		return [];
	}
	const list: FlatChapterEntry[] = [];
	for (const volume of novel.value.volumes) {
		for (const chapter of volume.chapters) {
			list.push({
				volumeId: volume.id,
				volumeTitle: volume.title,
				chapter,
			});
		}
	}
	return list;
});

function isUnresolvedChapterId(id: string): boolean {
	return id.startsWith("TOBEDETERMINED");
}

const currentChapterIndex = computed<number>(() =>
	flatChapters.value.findIndex((item) => item.chapter.id === chapterId.value),
);

const currentChapterEntry = computed<FlatChapterEntry | null>(() => {
	const idx = currentChapterIndex.value;
	return idx >= 0 ? (flatChapters.value[idx] ?? null) : null;
});

const prevChapter = computed<FlatChapterEntry | null>(() => {
	const idx = currentChapterIndex.value;
	if (idx <= 0) {
		return null;
	}
	for (let i = idx - 1; i >= 0; i -= 1) {
		const candidate = flatChapters.value[i];
		if (candidate && !isUnresolvedChapterId(candidate.chapter.id)) {
			return candidate;
		}
	}
	return null;
});

const nextChapter = computed<FlatChapterEntry | null>(() => {
	const idx = currentChapterIndex.value;
	if (idx < 0) {
		return null;
	}
	for (let i = idx + 1; i < flatChapters.value.length; i += 1) {
		const candidate = flatChapters.value[i];
		if (candidate && !isUnresolvedChapterId(candidate.chapter.id)) {
			return candidate;
		}
	}
	return null;
});

const existingProgress = computed<ReadingProgress | undefined>(() =>
	libraryStore.getProgress(platform.value, novelId.value),
);

const currentNovelTitle = computed<string>(
	() => novel.value?.title || existingProgress.value?.novelTitle || novelId.value,
);

const currentChapterTitle = computed<string>(
	() =>
		currentChapterEntry.value?.chapter.title ||
		cachedChapterTitle.value ||
		(existingProgress.value?.chapterId === chapterId.value
			? existingProgress.value.chapterTitle
			: "") ||
		chapterId.value,
);

const currentVolumeId = computed<string>(
	() =>
		currentChapterEntry.value?.volumeId || existingProgress.value?.volumeId || "",
);

const currentVolumeTitle = computed<string>(
	() =>
		currentChapterEntry.value?.volumeTitle ||
		existingProgress.value?.volumeTitle ||
		"",
);

const currentCoverUrl = computed<string>(
	() => novel.value?.coverUrl || existingProgress.value?.coverUrl || "",
);

const pageStride = computed<number>(() => pageWidth.value + COLUMN_GAP_PX);

const paginatedColumnsStyle = computed(() => ({
	width: `${pageWidth.value}px`,
	height: "100%",
	columnWidth: `${pageWidth.value}px`,
	columnGap: `${COLUMN_GAP_PX}px`,
	columnFill: "auto" as const,
	fontSize: `${settingsStore.readerSettings.fontSize}px`,
	lineHeight: String(settingsStore.readerSettings.lineHeight),
	transform: `translateX(-${currentPage.value * pageStride.value}px)`,
	transition: disablePageTransition.value
		? "none"
		: "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
}));

const scrollContentStyle = computed(() => ({
	fontSize: `${settingsStore.readerSettings.fontSize}px`,
	lineHeight: String(settingsStore.readerSettings.lineHeight),
	paddingLeft: `${settingsStore.readerSettings.pagePadding}px`,
	paddingRight: `${settingsStore.readerSettings.pagePadding}px`,
}));

const progressPercent = computed<number>(() => {
	if (mode.value === "paginated") {
		if (totalPages.value <= 1) {
			return 100;
		}
		return Math.round(((currentPage.value + 1) / totalPages.value) * 100);
	}
	const total = blocks.value.length;
	if (total <= 1) {
		return 100;
	}
	return Math.min(
		100,
		Math.max(
			0,
			Math.round(((currentParagraphIndex.value + 1) / total) * 100),
		),
	);
});

const themeOptions: { value: ReaderTheme; label: string; swatch: string }[] = [
	{ value: "light", label: "亮色", swatch: "#faf9f6" },
	{ value: "sepia", label: "羊皮纸", swatch: "#f4ecd8" },
	{ value: "oled", label: "OLED 纯黑", swatch: "#000000" },
];

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function showToast(message: string, durationMs = 2800): void {
	toastMessage.value = message;
	if (toastTimer !== null) {
		clearTimeout(toastTimer);
	}
	toastTimer = setTimeout(() => {
		toastTimer = null;
		toastMessage.value = null;
	}, durationMs);
}

function waitAnimationFrame(): Promise<void> {
	return new Promise((resolve) => {
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(() => resolve());
		} else {
			setTimeout(resolve, 16);
		}
	});
}

function releaseAnchorRestorationLater(): void {
	if (restoreReleaseTimer !== null) {
		clearTimeout(restoreReleaseTimer);
	}
	restoreReleaseTimer = setTimeout(() => {
		restoreReleaseTimer = null;
		isRestoringAnchor = false;
	}, 120);
}

function buildChapterRoute(
	targetChapterId: string,
	paragraph?: number,
): string {
	const base = `/read/${encodeURIComponent(platform.value)}/${encodeURIComponent(novelId.value)}/${encodeURIComponent(targetChapterId)}`;
	if (paragraph !== undefined && paragraph > 0) {
		return `${base}?paragraph=${paragraph}`;
	}
	return base;
}

function novelDetailRoute(): string {
	return `/novel/${encodeURIComponent(platform.value)}/${encodeURIComponent(novelId.value)}`;
}

async function persistProgress(paragraphIndex: number): Promise<void> {
	if (!platform.value || !novelId.value || !chapterId.value) {
		return;
	}
	const totalParagraphs = Math.max(1, blocks.value.length);
	const clampedIndex = clamp(paragraphIndex, 0, totalParagraphs - 1);
	await libraryStore.updateReadingProgress({
		platform: platform.value,
		novelId: novelId.value,
		novelTitle: currentNovelTitle.value,
		coverUrl: currentCoverUrl.value,
		volumeId: currentVolumeId.value,
		volumeTitle: currentVolumeTitle.value,
		chapterId: chapterId.value,
		chapterTitle: currentChapterTitle.value,
		paragraphIndex: clampedIndex,
		totalParagraphs,
		deviceLabel: settingsStore.deviceLabel,
		updatedAt: Date.now(),
	});
}

function findFirstVisibleBlockIndexOnPage(page: number): number {
	const colsEl = paginatedColumnsRef.value;
	if (!colsEl || blocks.value.length === 0) {
		return 0;
	}
	const stride = pageStride.value;
	if (stride <= 0) {
		return 0;
	}
	const pageStart = page * stride;
	const blockEls = colsEl.querySelectorAll<HTMLElement>("[data-block-index]");
	let lastBeforePage = 0;

	for (const el of blockEls) {
		const rawIdx = el.dataset.blockIndex;
		if (rawIdx === undefined) {
			continue;
		}
		const idx = Number(rawIdx);
		if (!Number.isFinite(idx)) {
			continue;
		}
		const left = el.offsetLeft;
		if (left >= pageStart - 4 && left < pageStart + pageWidth.value - 4) {
			return idx;
		}
		if (left < pageStart - 4) {
			lastBeforePage = idx;
		} else if (left >= pageStart + pageWidth.value - 4) {
			break;
		}
	}

	return lastBeforePage;
}

async function syncPaginatedLayout(anchorParagraph: number): Promise<void> {
	const viewportEl = paginatedViewportRef.value;
	const colsEl = paginatedColumnsRef.value;
	if (!viewportEl || !colsEl) {
		return;
	}

	disablePageTransition.value = true;
	const measuredWidth = Math.max(240, viewportEl.clientWidth);
	pageWidth.value = measuredWidth;
	await nextTick();
	await waitAnimationFrame();

	const stride = pageWidth.value + COLUMN_GAP_PX;
	const pages = Math.max(1, Math.ceil(colsEl.scrollWidth / stride));
	totalPages.value = pages;

	const anchorEl = colsEl.querySelector<HTMLElement>(
		`[data-block-index="${anchorParagraph}"]`,
	);
	if (anchorEl) {
		const targetPage = clamp(
			Math.floor((anchorEl.offsetLeft + 4) / stride),
			0,
			pages - 1,
		);
		currentPage.value = targetPage;
	} else {
		currentPage.value = clamp(currentPage.value, 0, pages - 1);
	}

	await nextTick();
	await waitAnimationFrame();
	disablePageTransition.value = false;
}

async function scrollToParagraph(
	paragraph: number,
	smooth = false,
): Promise<void> {
	isRestoringAnchor = true;
	if (mode.value === "paginated") {
		await syncPaginatedLayout(paragraph);
		currentParagraphIndex.value = paragraph;
		releaseAnchorRestorationLater();
		return;
	}

	await nextTick();
	if (paragraph <= 0) {
		window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
		currentParagraphIndex.value = 0;
		releaseAnchorRestorationLater();
		return;
	}

	const el = scrollContainerRef.value?.querySelector<HTMLElement>(
		`[data-block-index="${paragraph}"]`,
	);
	if (el) {
		el.scrollIntoView({
			block: "start",
			behavior: smooth ? "smooth" : "auto",
		});
		currentParagraphIndex.value = paragraph;
	}
	releaseAnchorRestorationLater();
}

async function switchReaderMode(targetMode: ReaderMode): Promise<void> {
	if (mode.value === targetMode) {
		return;
	}

	const anchor = currentParagraphIndex.value;
	isRestoringAnchor = true;
	settingsStore.updateReaderSettings({ mode: targetMode });
	await nextTick();

	if (targetMode === "paginated") {
		await syncPaginatedLayout(anchor);
		currentParagraphIndex.value = anchor;
	} else {
		const el = scrollContainerRef.value?.querySelector<HTMLElement>(
			`[data-block-index="${anchor}"]`,
		);
		if (el) {
			el.scrollIntoView({ block: "start" });
		} else {
			window.scrollTo({ top: 0 });
		}
		currentParagraphIndex.value = anchor;
	}

	releaseAnchorRestorationLater();
}

function goToPage(nextPage: number): void {
	if (nextPage < 0) {
		if (prevChapter.value) {
			void navigateToChapter(prevChapter.value.chapter.id);
		} else {
			showToast("已经是第一章第一页", 1600);
		}
		return;
	}

	if (nextPage >= totalPages.value) {
		if (nextChapter.value) {
			void navigateToChapter(nextChapter.value.chapter.id);
		} else {
			showToast("已经是最后一页", 1600);
		}
		return;
	}

	hasUserInteracted = true;
	currentPage.value = nextPage;
	const visibleBlock = findFirstVisibleBlockIndexOnPage(nextPage);
	currentParagraphIndex.value = visibleBlock;
	void persistProgress(visibleBlock);
}

function detectScrollParagraphIndex(): number {
	if (window.scrollY <= 8) {
		return 0;
	}
	const container = scrollContainerRef.value;
	if (!container || blocks.value.length === 0) {
		return 0;
	}
	const targetY = window.innerHeight * 0.25;
	const blockEls = container.querySelectorAll<HTMLElement>("[data-block-index]");
	let activeIdx = 0;

	for (const el of blockEls) {
		const rawIdx = el.dataset.blockIndex;
		if (rawIdx === undefined) {
			continue;
		}
		const idx = Number(rawIdx);
		if (!Number.isFinite(idx)) {
			continue;
		}
		const rect = el.getBoundingClientRect();
		if (rect.top <= targetY) {
			activeIdx = idx;
		} else {
			break;
		}
	}

	return activeIdx;
}

function handleWindowScroll(): void {
	if (mode.value !== "scroll" || loading.value || isRestoringAnchor) {
		return;
	}
	if (scrollRafId !== null) {
		return;
	}

	scrollRafId = requestAnimationFrame(() => {
		scrollRafId = null;
		if (mode.value !== "scroll" || loading.value || isRestoringAnchor) {
			return;
		}
		hasUserInteracted = true;
		const detected = detectScrollParagraphIndex();
		if (detected !== currentParagraphIndex.value) {
			currentParagraphIndex.value = detected;
			void persistProgress(detected);
		}
	});
}

function handleScrollContentClick(event: MouseEvent): void {
	const selection = window.getSelection()?.toString().trim();
	if (selection) {
		return;
	}
	const target = event.target as HTMLElement | null;
	if (target?.closest("a, button, input, select")) {
		return;
	}
	toggleHud();
}

function handlePaginatedClick(event: MouseEvent): void {
	if (justSwiped) {
		return;
	}
	const selection = window.getSelection()?.toString().trim();
	if (selection) {
		return;
	}
	const target = event.target as HTMLElement | null;
	if (target?.closest("a, button, input, select")) {
		return;
	}

	const container = paginatedContainerRef.value;
	if (!container) {
		toggleHud();
		return;
	}
	const rect = container.getBoundingClientRect();
	if (rect.width <= 0) {
		toggleHud();
		return;
	}

	const ratio = (event.clientX - rect.left) / rect.width;
	if (ratio < 1 / 3) {
		goToPage(currentPage.value - 1);
	} else if (ratio > 2 / 3) {
		goToPage(currentPage.value + 1);
	} else {
		toggleHud();
	}
}

function handleTouchStart(event: TouchEvent): void {
	const touch = event.touches[0];
	if (!touch) {
		return;
	}
	touchStartX = touch.clientX;
	touchStartY = touch.clientY;
}

function handleTouchEnd(event: TouchEvent): void {
	if (mode.value !== "paginated") {
		return;
	}
	const touch = event.changedTouches[0];
	if (!touch) {
		return;
	}
	const dx = touch.clientX - touchStartX;
	const dy = touch.clientY - touchStartY;

	if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
		justSwiped = true;
		if (swipeResetTimer !== null) {
			clearTimeout(swipeResetTimer);
		}
		swipeResetTimer = setTimeout(() => {
			swipeResetTimer = null;
			justSwiped = false;
		}, 280);

		if (dx < 0) {
			goToPage(currentPage.value + 1);
		} else {
			goToPage(currentPage.value - 1);
		}
	}
}

function handleKeyDown(event: KeyboardEvent): void {
	const target = event.target as HTMLElement | null;
	if (
		target &&
		(target.tagName === "INPUT" ||
			target.tagName === "TEXTAREA" ||
			target.isContentEditable)
	) {
		return;
	}

	if (event.key === "Escape") {
		if (showToc.value) {
			showToc.value = false;
		} else if (showAppearance.value) {
			showAppearance.value = false;
		} else if (showHud.value) {
			showHud.value = false;
		}
		return;
	}

	if (mode.value !== "paginated" || showToc.value) {
		return;
	}

	if (event.key === "ArrowRight" || event.key === "PageDown") {
		event.preventDefault();
		goToPage(currentPage.value + 1);
	} else if (event.key === "ArrowLeft" || event.key === "PageUp") {
		event.preventDefault();
		goToPage(currentPage.value - 1);
	}
}

function toggleHud(): void {
	showHud.value = !showHud.value;
	if (!showHud.value) {
		showAppearance.value = false;
	}
}

function handleExportCurrentVolumeSlot(): void {
	const volLabel = currentVolumeTitle.value
		? `「${currentVolumeTitle.value}」`
		: "当前卷";
	showToast(
		`已预留${volLabel} EPUB 导出入口（将于 Task 8 接入 Web Worker 导出）`,
		3200,
	);
}

async function navigateToChapter(
	targetChapterId: string,
	paragraph?: number,
): Promise<void> {
	if (isUnresolvedChapterId(targetChapterId)) {
		return;
	}
	showToc.value = false;
	showHud.value = false;
	showAppearance.value = false;
	remoteChapterPrompt.value = null;
	await router.push(buildChapterRoute(targetChapterId, paragraph));
}

function acceptRemoteChapterPrompt(): void {
	const prompt = remoteChapterPrompt.value;
	if (!prompt) {
		return;
	}
	void navigateToChapter(prompt.chapterId, prompt.paragraphIndex);
}

function dismissRemoteChapterPrompt(): void {
	remoteChapterPrompt.value = null;
}

function adjustFontSize(delta: number): void {
	const next = clamp(settingsStore.readerSettings.fontSize + delta, 14, 28);
	settingsStore.updateReaderSettings({ fontSize: next });
}

function adjustLineHeight(delta: number): void {
	const next = clamp(
		Number((settingsStore.readerSettings.lineHeight + delta).toFixed(1)),
		1.4,
		2.4,
	);
	settingsStore.updateReaderSettings({ lineHeight: next });
}

function setTheme(theme: ReaderTheme): void {
	settingsStore.updateReaderSettings({ theme });
}

function attachPaginatedResizeObserver(): void {
	if (resizeObserver) {
		resizeObserver.disconnect();
		resizeObserver = null;
	}
	if (
		typeof ResizeObserver === "undefined" ||
		!paginatedViewportRef.value ||
		mode.value !== "paginated"
	) {
		return;
	}
	resizeObserver = new ResizeObserver(() => {
		if (mode.value === "paginated" && !loading.value) {
			void syncPaginatedLayout(currentParagraphIndex.value);
		}
	});
	resizeObserver.observe(paginatedViewportRef.value);
}

async function checkRemoteSyncAfterEntry(
	seq: number,
	entryBaselineUpdatedAt: number,
	targetPlatform: string,
	targetNovelId: string,
	targetChapterId: string,
	previousLocalChapterId: string | undefined,
): Promise<void> {
	await libraryStore.syncNow();
	if (seq !== loadSequence) {
		return;
	}

	const latest = libraryStore.getProgress(targetPlatform, targetNovelId);
	if (latest && latest.updatedAt > entryBaselineUpdatedAt) {
		if (latest.chapterId === targetChapterId) {
			if (
				!hasUserInteracted &&
				Math.abs(latest.paragraphIndex - currentParagraphIndex.value) >= 3
			) {
				const maxIdx = Math.max(0, blocks.value.length - 1);
				const targetPara = clamp(latest.paragraphIndex, 0, maxIdx);
				await scrollToParagraph(targetPara, true);
				showToast("已同步至上次阅读位置");
			}
			return;
		}

		remoteChapterPrompt.value = latest;
		return;
	}

	if (!hasUserInteracted && previousLocalChapterId !== targetChapterId) {
		void persistProgress(currentParagraphIndex.value);
	}
}

async function loadReaderState(): Promise<void> {
	const targetPlatform = platform.value;
	const targetNovelId = novelId.value;
	const targetChapterId = chapterId.value;
	if (!targetPlatform || !targetNovelId || !targetChapterId) {
		return;
	}

	const seq = ++loadSequence;
	hasUserInteracted = false;
	loading.value = true;
	errorMessage.value = null;
	remoteChapterPrompt.value = null;

	await libraryStore.hydrate();
	if (seq !== loadSequence) {
		return;
	}

	const existing = libraryStore.getProgress(targetPlatform, targetNovelId);
	const entryBaselineUpdatedAt = existing?.updatedAt ?? 0;

	try {
		let loadedNovel = novel.value;
		if (
			!loadedNovel ||
			loadedNovel.id !== targetNovelId ||
			loadedNovel.platform !== targetPlatform
		) {
			loadedNovel = await webDb
				.getNovelCache(targetPlatform, targetNovelId)
				.catch(() => null);
			if (loadedNovel && seq === loadSequence) {
				novel.value = loadedNovel;
			}
		}

		if (!loadedNovel) {
			const freshNovel = await fetchNovelDetail(
				targetPlatform,
				targetNovelId,
			).catch(() => null);
			if (seq !== loadSequence) {
				return;
			}
			if (freshNovel) {
				novel.value = freshNovel;
				void webDb.putNovelCache(freshNovel).catch(() => {});
			}
		}

		const cachedChapter = await webDb
			.getChapterCache(targetPlatform, targetChapterId)
			.catch(() => null);
		if (seq !== loadSequence) {
			return;
		}

		if (cachedChapter) {
			rawHtml.value = cachedChapter.content;
			cachedChapterTitle.value = cachedChapter.title;
		} else {
			const fetched = await fetchChapterContent(
				targetPlatform,
				targetChapterId,
				targetNovelId,
			);
			if (seq !== loadSequence) {
				return;
			}
			rawHtml.value = fetched.content;
			const resolvedTitle =
				currentChapterEntry.value?.chapter.title || targetChapterId;
			cachedChapterTitle.value = resolvedTitle;
			void webDb
				.putChapterCache(
					{
						key: makeChapterCacheKey(targetPlatform, targetChapterId),
						platform: targetPlatform,
						novelId: targetNovelId,
						chapterId: targetChapterId,
						title: resolvedTitle,
						content: fetched.content,
						accessedAt: Date.now(),
					},
					200,
				)
				.catch(() => {});
		}

		const maxIdx = Math.max(0, blocks.value.length - 1);
		let initialAnchor = 0;
		if (queryParagraph.value !== null) {
			initialAnchor = clamp(queryParagraph.value, 0, maxIdx);
		} else if (existing && existing.chapterId === targetChapterId) {
			initialAnchor = clamp(existing.paragraphIndex, 0, maxIdx);
		}

		currentParagraphIndex.value = initialAnchor;
		loading.value = false;
		await nextTick();
		attachPaginatedResizeObserver();
		await scrollToParagraph(initialAnchor, false);

		void checkRemoteSyncAfterEntry(
			seq,
			entryBaselineUpdatedAt,
			targetPlatform,
			targetNovelId,
			targetChapterId,
			existing?.chapterId,
		);
	} catch (err) {
		if (seq !== loadSequence) {
			return;
		}
		errorMessage.value =
			err instanceof ApiError
				? err.message
				: err instanceof Error
					? err.message
					: "加载章节内容失败";
		loading.value = false;
	}
}

watch([platform, novelId, chapterId], () => {
	void loadReaderState();
});

watch(
	() => [
		mode.value,
		settingsStore.readerSettings.fontSize,
		settingsStore.readerSettings.lineHeight,
		settingsStore.readerSettings.pagePadding,
	],
	async () => {
		if (loading.value) {
			return;
		}
		await nextTick();
		attachPaginatedResizeObserver();
		if (mode.value === "paginated") {
			await syncPaginatedLayout(currentParagraphIndex.value);
		}
	},
);

onMounted(() => {
	window.addEventListener("scroll", handleWindowScroll, { passive: true });
	window.addEventListener("keydown", handleKeyDown);
	void loadReaderState();
});

onBeforeRouteLeave(() => {
	libraryStore.flushOnLeave();
});

onBeforeUnmount(() => {
	loadSequence += 1;
	window.removeEventListener("scroll", handleWindowScroll);
	window.removeEventListener("keydown", handleKeyDown);
	if (resizeObserver) {
		resizeObserver.disconnect();
		resizeObserver = null;
	}
	if (scrollRafId !== null) {
		cancelAnimationFrame(scrollRafId);
		scrollRafId = null;
	}
	if (restoreReleaseTimer !== null) {
		clearTimeout(restoreReleaseTimer);
	}
	if (toastTimer !== null) {
		clearTimeout(toastTimer);
	}
	if (swipeResetTimer !== null) {
		clearTimeout(swipeResetTimer);
	}
});
</script>

<template>
	<div
		class="min-h-screen bg-[var(--reader-bg)] text-[var(--reader-text)] transition-colors duration-200"
	>
		<!-- Lightweight Toast -->
		<div
			v-if="toastMessage"
			role="status"
			aria-live="polite"
			class="pointer-events-none fixed inset-x-0 top-14 z-50 flex justify-center px-4"
		>
			<div
				class="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/95 px-4 py-2 text-xs font-medium text-[var(--text-primary)] shadow-lg backdrop-blur"
			>
				{{ toastMessage }}
			</div>
		</div>

		<!-- Top Auto-Hiding HUD -->
		<header
			v-if="showHud"
			class="fixed inset-x-0 top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/95 text-[var(--text-primary)] backdrop-blur pt-safe"
		>
			<div
				class="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4"
			>
				<div class="flex min-w-0 items-center gap-2.5">
					<RouterLink
						:to="novelDetailRoute()"
						aria-label="返回作品详情"
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl hover:bg-[var(--bg-secondary)]"
					>
						<ArrowLeft class="h-5 w-5" />
					</RouterLink>
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold">
							{{ currentChapterTitle }}
						</p>
						<p class="truncate text-[11px] text-[var(--text-muted)]">
							{{ currentNovelTitle }}
						</p>
					</div>
				</div>

				<div class="flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						class="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
						@click="handleExportCurrentVolumeSlot"
					>
						<Download class="h-3.5 w-3.5" />
						<span class="hidden sm:inline">导出当前卷 EPUB</span>
					</button>

					<button
						type="button"
						aria-label="打开目录"
						class="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-[var(--bg-secondary)]"
						@click="showToc = true"
					>
						<List class="h-5 w-5" />
					</button>
				</div>
			</div>
		</header>

		<!-- Loading State -->
		<div
			v-if="loading"
			class="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center"
		>
			<BookOpen class="h-8 w-8 animate-pulse text-[var(--accent)]" />
			<p class="text-sm text-[var(--text-secondary)]">正在加载章节内容…</p>
		</div>

		<!-- Error State -->
		<div
			v-else-if="errorMessage"
			class="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center"
		>
			<div
				class="w-full max-w-md space-y-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-6"
			>
				<p class="text-sm text-red-600">{{ errorMessage }}</p>
				<div class="flex justify-center gap-2.5">
					<button
						type="button"
						class="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white"
						@click="loadReaderState()"
					>
						重试加载
					</button>
					<RouterLink
						:to="novelDetailRoute()"
						class="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2 text-xs font-medium text-[var(--text-primary)]"
					>
						返回详情
					</RouterLink>
				</div>
			</div>
		</div>

		<!-- Scroll Mode -->
		<main
			v-else-if="mode === 'scroll'"
			ref="scrollContainerRef"
			class="mx-auto min-h-screen max-w-3xl pb-24 pt-10"
			:style="scrollContentStyle"
			@click="handleScrollContentClick"
		>
			<div v-if="blocks.length === 0" class="py-16 text-center text-sm text-[var(--text-muted)]">
				本章暂无正文内容
			</div>

			<article v-else class="reader-flow space-y-5">
				<template v-for="block in blocks" :key="block.blockIndex">
					<component
						:is="block.tag"
						v-if="block.kind === 'heading'"
						:data-block-index="block.blockIndex"
						class="reader-heading font-bold tracking-tight text-[var(--text-primary)]"
						v-html="block.html"
					/>
					<figure
						v-else-if="block.kind === 'image'"
						:data-block-index="block.blockIndex"
						class="reader-image my-6 flex flex-col items-center gap-2"
					>
						<img
							v-if="block.src"
							:src="block.src"
							:alt="block.alt"
							loading="lazy"
							class="max-h-[82vh] w-auto max-w-full rounded-xl object-contain"
						/>
						<figcaption
							v-if="block.alt"
							class="text-center text-xs text-[var(--text-muted)]"
						>
							{{ block.alt }}
						</figcaption>
					</figure>
					<div
						v-else-if="block.html.trim().toLowerCase() === '<hr>'"
						:data-block-index="block.blockIndex"
						class="py-3"
					>
						<hr class="border-[var(--border-subtle)]" />
					</div>
					<p
						v-else
						:data-block-index="block.blockIndex"
						class="reader-paragraph break-words"
						v-html="block.html"
					/>
				</template>
			</article>

			<!-- Bottom Chapter Navigation Bar (Scroll Mode) -->
			<nav
				aria-label="章节导航"
				class="mt-14 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-6"
				@click.stop
			>
				<button
					type="button"
					:disabled="!prevChapter"
					class="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-xs sm:text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-40"
					@click="prevChapter && navigateToChapter(prevChapter.chapter.id)"
				>
					<ChevronLeft class="h-4 w-4" />
					上一章
				</button>

				<button
					type="button"
					class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2.5 text-xs sm:text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
					@click="showToc = true"
				>
					<List class="h-4 w-4" />
					目录
				</button>

				<button
					type="button"
					:disabled="!nextChapter"
					class="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-[var(--accent)] px-3 py-2.5 text-xs sm:text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
					@click="nextChapter && navigateToChapter(nextChapter.chapter.id)"
				>
					下一章
					<ChevronRight class="h-4 w-4" />
				</button>
			</nav>
		</main>

		<!-- Paginated Mode -->
		<main
			v-else
			ref="paginatedContainerRef"
			class="flex h-dvh w-full flex-col overflow-hidden select-none"
			@click="handlePaginatedClick"
			@touchstart.passive="handleTouchStart"
			@touchend.passive="handleTouchEnd"
		>
			<!-- Subtle Header Status Strip -->
			<div
				class="flex h-9 shrink-0 items-center justify-between px-4 text-[11px] text-[var(--text-muted)]"
			>
				<span class="truncate">{{ currentChapterTitle }}</span>
				<span class="shrink-0">{{ currentNovelTitle }}</span>
			</div>

			<!-- Padded Column Viewport -->
			<div
				class="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col"
				:style="{
					paddingLeft: `${settingsStore.readerSettings.pagePadding}px`,
					paddingRight: `${settingsStore.readerSettings.pagePadding}px`,
				}"
			>
				<div
					ref="paginatedViewportRef"
					class="relative min-h-0 w-full flex-1 overflow-hidden"
				>
					<div
						v-if="blocks.length === 0"
						class="flex h-full items-center justify-center text-sm text-[var(--text-muted)]"
					>
						本章暂无正文内容
					</div>

					<article
						v-else
						ref="paginatedColumnsRef"
						class="reader-paginated-columns relative"
						:style="paginatedColumnsStyle"
					>
						<template v-for="block in blocks" :key="block.blockIndex">
							<component
								:is="block.tag"
								v-if="block.kind === 'heading'"
								:data-block-index="block.blockIndex"
								class="reader-heading mb-4 font-bold tracking-tight text-[var(--text-primary)]"
								v-html="block.html"
							/>
							<figure
								v-else-if="block.kind === 'image'"
								:data-block-index="block.blockIndex"
								class="reader-image my-4 flex flex-col items-center gap-1.5"
							>
								<img
									v-if="block.src"
									:src="block.src"
									:alt="block.alt"
									class="max-h-[72vh] w-auto max-w-full rounded-lg object-contain"
								/>
								<figcaption
									v-if="block.alt"
									class="text-center text-xs text-[var(--text-muted)]"
								>
									{{ block.alt }}
								</figcaption>
							</figure>
							<div
								v-else-if="block.html.trim().toLowerCase() === '<hr>'"
								:data-block-index="block.blockIndex"
								class="py-2"
							>
								<hr class="border-[var(--border-subtle)]" />
							</div>
							<p
								v-else
								:data-block-index="block.blockIndex"
								class="reader-paragraph mb-4 break-words"
								v-html="block.html"
							/>
						</template>
					</article>
				</div>
			</div>

			<!-- Subtle Footer Page Indicator -->
			<div
				class="flex h-9 shrink-0 items-center justify-between px-4 text-[11px] text-[var(--text-muted)] safe-bottom"
			>
				<span>第 {{ currentPage + 1 }} / {{ totalPages }} 页</span>
				<span>{{ progressPercent }}%</span>
			</div>
		</main>

		<!-- Cross-Device Different-Chapter Sync Prompt Bar -->
		<aside
			v-if="remoteChapterPrompt"
			aria-label="跨设备阅读进度提示"
			class="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--accent)]/40 bg-[var(--bg-elevated)]/95 p-3.5 text-[var(--text-primary)] shadow-xl backdrop-blur"
		>
			<div class="flex min-w-0 flex-1 items-start gap-2">
				<Smartphone class="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
				<p class="text-xs sm:text-sm leading-snug">
					其他设备（{{ remoteChapterPrompt.deviceLabel }}）已读到「{{
						remoteChapterPrompt.chapterTitle
					}}」，是否跳转？
				</p>
			</div>
			<div class="flex shrink-0 items-center gap-2">
				<button
					type="button"
					class="rounded-xl border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
					@click="dismissRemoteChapterPrompt"
				>
					忽略
				</button>
				<button
					type="button"
					class="rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
					@click="acceptRemoteChapterPrompt"
				>
					立即跳转
				</button>
			</div>
		</aside>

		<!-- Bottom Auto-Hiding HUD -->
		<footer
			v-if="showHud"
			class="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/95 text-[var(--text-primary)] backdrop-blur pb-safe"
		>
			<div class="mx-auto max-w-3xl space-y-3 px-4 pt-3">
				<!-- Appearance Sub-panel -->
				<div
					v-if="showAppearance"
					class="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3.5"
				>
					<div class="flex items-center justify-between gap-3">
						<span class="text-xs font-medium text-[var(--text-secondary)]">
							主题
						</span>
						<div class="flex gap-2">
							<button
								v-for="item in themeOptions"
								:key="item.value"
								type="button"
								class="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors"
								:class="
									settingsStore.readerSettings.theme === item.value
										? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
										: 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
								"
								@click="setTheme(item.value)"
							>
								<span
									class="h-3 w-3 rounded-full border border-black/15"
									:style="{ backgroundColor: item.swatch }"
								/>
								{{ item.label }}
							</button>
						</div>
					</div>

					<div class="flex items-center justify-between gap-3">
						<span class="text-xs font-medium text-[var(--text-secondary)]">
							字号（{{ settingsStore.readerSettings.fontSize }} px）
						</span>
						<div class="flex items-center gap-2">
							<button
								type="button"
								class="rounded-lg border border-[var(--border-subtle)] px-3 py-1 text-xs font-medium hover:bg-[var(--bg-secondary)]"
								@click="adjustFontSize(-1)"
							>
								A-
							</button>
							<button
								type="button"
								class="rounded-lg border border-[var(--border-subtle)] px-3 py-1 text-xs font-medium hover:bg-[var(--bg-secondary)]"
								@click="adjustFontSize(1)"
							>
								A+
							</button>
						</div>
					</div>

					<div class="flex items-center justify-between gap-3">
						<span class="text-xs font-medium text-[var(--text-secondary)]">
							行高（{{ settingsStore.readerSettings.lineHeight.toFixed(1) }}）
						</span>
						<div class="flex items-center gap-2">
							<button
								type="button"
								class="rounded-lg border border-[var(--border-subtle)] px-3 py-1 text-xs font-medium hover:bg-[var(--bg-secondary)]"
								@click="adjustLineHeight(-0.1)"
							>
								紧凑
							</button>
							<button
								type="button"
								class="rounded-lg border border-[var(--border-subtle)] px-3 py-1 text-xs font-medium hover:bg-[var(--bg-secondary)]"
								@click="adjustLineHeight(0.1)"
							>
								宽松
							</button>
						</div>
					</div>
				</div>

				<!-- Chapter & Quick Controls -->
				<div class="flex items-center justify-between gap-2 text-xs">
					<button
						type="button"
						:disabled="!prevChapter"
						class="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] px-3 py-2 font-medium disabled:opacity-40"
						@click="prevChapter && navigateToChapter(prevChapter.chapter.id)"
					>
						<ChevronLeft class="h-4 w-4" />
						上一章
					</button>

					<div class="flex items-center gap-1.5">
						<button
							type="button"
							class="rounded-xl border px-3 py-2 font-medium transition-colors"
							:class="
								mode === 'scroll'
									? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
									: 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
							"
							@click="switchReaderMode(mode === 'scroll' ? 'paginated' : 'scroll')"
						>
							{{ mode === "scroll" ? "上下滚动" : "左右翻页" }}
						</button>

						<button
							type="button"
							class="inline-flex items-center gap-1 rounded-xl border px-3 py-2 font-medium transition-colors"
							:class="
								showAppearance
									? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
									: 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
							"
							@click="showAppearance = !showAppearance"
						>
							<Settings2 class="h-3.5 w-3.5" />
							外观
						</button>
					</div>

					<button
						type="button"
						:disabled="!nextChapter"
						class="inline-flex items-center gap-1 rounded-xl bg-[var(--accent)] px-3 py-2 font-medium text-white disabled:opacity-40"
						@click="nextChapter && navigateToChapter(nextChapter.chapter.id)"
					>
						下一章
						<ChevronRight class="h-4 w-4" />
					</button>
				</div>
			</div>
		</footer>

		<!-- Table of Contents Drawer -->
		<div
			v-if="showToc"
			class="fixed inset-0 z-50 flex bg-black/50 backdrop-blur-xs"
			@click="showToc = false"
		>
			<aside
				aria-label="章节目录"
				class="flex h-full w-80 max-w-[85vw] flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-2xl"
				@click.stop
			>
				<div
					class="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3.5"
				>
					<div class="min-w-0">
						<h2 class="truncate text-sm font-semibold">
							{{ currentNovelTitle }}
						</h2>
						<p class="text-[11px] text-[var(--text-muted)]">
							共 {{ flatChapters.length }} 章
						</p>
					</div>
					<button
						type="button"
						aria-label="关闭目录"
						class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--bg-secondary)]"
						@click="showToc = false"
					>
						<X class="h-4 w-4" />
					</button>
				</div>

				<div class="flex-1 overflow-y-auto px-2 py-3 space-y-4">
					<div v-if="!novel" class="px-3 py-6 text-center text-xs text-[var(--text-muted)]">
						目录尚未加载
					</div>
					<section
						v-for="volume in novel?.volumes ?? []"
						:key="volume.id"
						class="space-y-1"
					>
						<h3
							class="px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)]"
						>
							{{ volume.title }}
						</h3>
						<template v-for="ch in volume.chapters" :key="ch.id">
							<div
								v-if="isUnresolvedChapterId(ch.id)"
								aria-disabled="true"
								class="flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs text-[var(--text-muted)] opacity-60 cursor-not-allowed"
							>
								<span class="truncate">{{ ch.title }}</span>
								<Lock class="h-3 w-3 shrink-0" />
							</div>
							<button
								v-else
								type="button"
								class="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors"
								:class="
									ch.id === chapterId
										? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
										: 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
								"
								@click="navigateToChapter(ch.id)"
							>
								<span class="truncate">{{ ch.title }}</span>
							</button>
						</template>
					</section>
				</div>
			</aside>
		</div>
	</div>
</template>

<style scoped>
.reader-heading {
	font-size: 1.35em;
	line-height: 1.4;
	break-inside: avoid;
	break-after: avoid;
}

.reader-image {
	break-inside: avoid;
}

.reader-paragraph {
	orphans: 2;
	widows: 2;
}
</style>
