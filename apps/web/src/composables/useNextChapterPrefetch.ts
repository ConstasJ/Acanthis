import type { Chapter, Novel } from "@acanthis-dec/core";
import { onUnmounted, type Ref, watch } from "vue";
import { fetchChapterContent } from "@/api/client";
import { makeChapterCacheKey, webDb } from "@/db/indexedDb";

const DEFAULT_STABLE_MS = 1500;

function findNextReadableChapter(
	novel: Novel,
	currentChapterId: string,
): Chapter | null {
	const flatChapters = novel.volumes.flatMap((volume) => volume.chapters);
	const currentIndex = flatChapters.findIndex(
		(chapter) => chapter.id === currentChapterId,
	);
	if (currentIndex === -1) {
		return null;
	}

	for (let i = currentIndex + 1; i < flatChapters.length; i += 1) {
		const candidate = flatChapters[i];
		if (candidate && !candidate.id.startsWith("TOBEDETERMINED")) {
			return candidate;
		}
	}

	return null;
}

export function useNextChapterPrefetch(options: {
	platform: Ref<string>;
	novelId: Ref<string>;
	chapterId: Ref<string>;
	novel: Ref<Novel | null>;
	stableMs?: number;
}): void {
	const stableMs = options.stableMs ?? DEFAULT_STABLE_MS;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let activeToken = 0;

	function clearPrefetchTimer(): void {
		activeToken += 1;
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	}

	watch(
		[options.platform, options.novelId, options.chapterId, options.novel],
		([platform, novelId, chapterId, novel]) => {
			clearPrefetchTimer();

			if (!platform || !novelId || !chapterId || !novel) {
				return;
			}

			const nextChapter = findNextReadableChapter(novel, chapterId);
			if (!nextChapter) {
				return;
			}

			const runToken = activeToken;
			timer = setTimeout(() => {
				timer = null;
				void (async () => {
					try {
						const cached = await webDb.getChapterCache(
							platform,
							nextChapter.id,
						);
						if (cached || runToken !== activeToken) {
							return;
						}

						const res = await fetchChapterContent(
							platform,
							nextChapter.id,
							novelId,
						);
						if (runToken !== activeToken) {
							return;
						}

						await webDb.putChapterCache(
							{
								key: makeChapterCacheKey(platform, nextChapter.id),
								platform,
								novelId,
								chapterId: nextChapter.id,
								title: nextChapter.title,
								content: res.content,
								accessedAt: Date.now(),
							},
							200,
						);
					} catch {
						// Swallow prefetch errors silently so reading is never interrupted.
					}
				})();
			}, stableMs);
		},
		{ immediate: true },
	);

	onUnmounted(() => {
		clearPrefetchTimer();
	});
}
