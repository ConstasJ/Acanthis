import type {
	ExploreHomeData,
	ExploreNovelItem,
	ExploreSection,
	ExploreSectionLayout,
	ExploreSectionMoreTarget,
} from "@acanthis-dec/core";
import { type Cheerio, type CheerioAPI, load } from "cheerio";
import type { Element } from "domhandler";
import type { NovelExploreQueue } from "../queue";
import {
	type BuildExploreItemInput,
	buildExploreNovelItem,
	cleanBlockText,
	cleanInlineText,
	extractChapterIdFromHref,
	extractImgCoverUrl,
	extractNovelIdFromHref,
	LINOVELIB_DESKTOP_BASE,
	resolveDesktopCoverUrl,
} from "./common";
import {
	getLinovelibChannelOption,
	isValidLinovelibChannel,
	isValidLinovelibRanking,
} from "./schema";

function deduplicateItemsById(items: ExploreNovelItem[]): ExploreNovelItem[] {
	const seen = new Set<string>();
	const result: ExploreNovelItem[] = [];
	for (const item of items) {
		if (seen.has(item.id)) {
			continue;
		}
		seen.add(item.id);
		result.push(item);
	}
	return result;
}

function extractChannelSlugFromHref(href: string | undefined): string | null {
	if (!href) {
		return null;
	}
	const match = href.trim().match(/\/wenku\/([a-z]+)\/1\.html(?:[?#]|$)/);
	const slug = match?.[1];
	return slug && isValidLinovelibChannel(slug) ? slug : null;
}

function parseMoreTarget(
	href: string | undefined,
): ExploreSectionMoreTarget | undefined {
	if (!href) {
		return undefined;
	}
	const trimmed = href.trim();
	const channelSlug = extractChannelSlugFromHref(trimmed);
	if (channelSlug) {
		return {
			type: "channel",
			params: { channel: channelSlug },
		};
	}

	const rankingMatch = trimmed.match(/\/(top|topfull)\/([a-z]+)\/\d+\.html/);
	if (rankingMatch) {
		const isFull = rankingMatch[1] === "topfull";
		const rank = rankingMatch[2] ?? "";
		if (isValidLinovelibRanking(rank, isFull)) {
			return {
				type: "ranking",
				params: { rank, full: String(isFull) },
			};
		}
	}

	const catalogMatch = trimmed.match(
		/\/wenku\/([a-z]+)_(\d+)_(\d+)_(\d+)_(\d+)_\d+_\d+_(\d+)_\d+_(\d+)\.html/,
	);
	if (catalogMatch) {
		const [
			,
			sort = "lastupdate",
			tag = "0",
			progress = "0",
			anime = "0",
			region = "0",
			words = "0",
			updated = "0",
		] = catalogMatch;
		if (
			sort === "lastupdate" &&
			tag === "0" &&
			progress === "0" &&
			anime === "0" &&
			region === "0" &&
			words === "0" &&
			updated === "0"
		) {
			return {
				type: "ranking",
				params: { rank: "lastupdate", full: "false" },
			};
		}
		return {
			type: "catalog",
			params: {
				sort,
				region,
				tag,
				progress,
				anime,
				words,
				updated,
			},
		};
	}

	return undefined;
}

function parseFeaturedSection(
	$: CheerioAPI,
	$root: Cheerio<Element>,
): ExploreSection | null {
	const $tpic = $root.is("#index_tpic")
		? $root
		: $root.find("#index_tpic").first();
	if ($tpic.length === 0) {
		return null;
	}

	const coverMap = new Map<string, string>();
	const titleFallbackMap = new Map<string, string>();
	$tpic.find("#index_tpic_big a").each((_, el) => {
		const $a = $(el);
		const id = extractNovelIdFromHref($a.attr("href"));
		if (!id) {
			return;
		}
		const $img = $a.find("img").first();
		coverMap.set(id, extractImgCoverUrl(id, $img));
		const alt = cleanInlineText($img.attr("alt"));
		if (alt) {
			titleFallbackMap.set(id, alt);
		}
	});

	const items: ExploreNovelItem[] = [];
	$tpic.find("#index_tpic_binfo .index_tpic_info").each((_, el) => {
		const $info = $(el);
		const $titleLink = $info.find("h3 a.title, h3 a").first();
		const id = extractNovelIdFromHref($titleLink.attr("href"));
		if (!id) {
			return;
		}
		const title =
			cleanInlineText($titleLink.text()) ||
			cleanInlineText($titleLink.attr("title")) ||
			titleFallbackMap.get(id) ||
			"";
		if (!title) {
			return;
		}

		const $authorLink = $info.find(".author a").first();
		let author = cleanInlineText($authorLink.text());
		if (!author) {
			const $authorClone = $info.find(".author").first().clone();
			$authorClone.find("span").remove();
			author = cleanInlineText($authorClone.text());
		}

		const $cateLink = $info.find(".cate a").first();
		const channelSlug = extractChannelSlugFromHref($cateLink.attr("href"));
		const category = channelSlug
			? getLinovelibChannelOption(channelSlug)?.label
			: undefined;
		const rawGenresText = cleanInlineText($cateLink.text());
		const genres =
			rawGenresText &&
			rawGenresText !== category &&
			!rawGenresText.startsWith("[")
				? rawGenresText.split(/\s+/).filter((g) => g.length > 0)
				: [];

		const summary = cleanBlockText($info.find("p.info").text()) || undefined;
		const $chapLink = $info.find("p.chapter a").first();
		const latestChapter = cleanInlineText($chapLink.text()) || undefined;
		const latestChapterId =
			extractChapterIdFromHref($chapLink.attr("href"), id) ?? undefined;

		const input: BuildExploreItemInput = {
			id,
			title,
			coverUrl: coverMap.get(id) ?? resolveDesktopCoverUrl(id),
		};
		if (author) {
			input.author = author;
		}
		if (summary) {
			input.summary = summary;
		}
		if (category) {
			input.category = category;
		}
		if (genres.length > 0) {
			input.genres = genres;
		}
		if (latestChapter) {
			input.latestChapter = latestChapter;
		}
		if (latestChapterId) {
			input.latestChapterId = latestChapterId;
		}
		items.push(buildExploreNovelItem(input));
	});

	if (items.length === 0 && coverMap.size > 0) {
		for (const [id, coverUrl] of coverMap.entries()) {
			const title = titleFallbackMap.get(id);
			if (title) {
				items.push(buildExploreNovelItem({ id, title, coverUrl }));
			}
		}
	}

	const deduped = deduplicateItemsById(items);
	if (deduped.length === 0) {
		return null;
	}

	return {
		id: "featured",
		title: "焦点推荐",
		layout: "featured",
		items: deduped,
	};
}

function extractMindBookItems(
	$: CheerioAPI,
	$cards: Cheerio<Element>,
): ExploreNovelItem[] {
	const items: ExploreNovelItem[] = [];
	$cards.each((_, el) => {
		const $card = $(el);
		const $nameLink = $card.find(".bookname a").first();
		const $imgLink = $card.find(".imgbox a").first();
		const $fallbackLink = $card.find("a[href*='/novel/']").first();

		const id =
			extractNovelIdFromHref($nameLink.attr("href")) ??
			extractNovelIdFromHref($imgLink.attr("href")) ??
			extractNovelIdFromHref($fallbackLink.attr("href"));
		if (!id) {
			return;
		}

		const $img = $card.find(".imgbox img, img").first();
		const title =
			cleanInlineText($nameLink.text()) ||
			cleanInlineText($card.find(".bookname").text()) ||
			cleanInlineText($img.attr("alt")) ||
			cleanInlineText($fallbackLink.text());
		if (!title) {
			return;
		}

		const coverUrl = extractImgCoverUrl(id, $img);
		const summary = cleanBlockText($card.find("p.info").text()) || undefined;
		const author = cleanInlineText($card.find(".author").text()) || undefined;
		const category =
			cleanInlineText($card.find(".updatenum, .cate").first().text()).replace(
				/^\[|\]$/g,
				"",
			) || undefined;

		const input: BuildExploreItemInput = {
			id,
			title,
			coverUrl,
		};
		if (author) {
			input.author = author;
		}
		if (summary) {
			input.summary = summary;
		}
		if (category) {
			input.category = category;
		}
		items.push(buildExploreNovelItem(input));
	});
	return items;
}

function extractSwiperItems(
	$: CheerioAPI,
	$swipers: Cheerio<Element>,
): ExploreNovelItem[] {
	const items: ExploreNovelItem[] = [];
	$swipers.each((_, swiperEl) => {
		const $swiper = $(swiperEl);
		const coverMap = new Map<string, string>();
		const titleMap = new Map<string, string>();

		$swiper.find("li.swiper-item").each((__, liEl) => {
			const $li = $(liEl);
			const id = extractNovelIdFromHref($li.attr("data-url"));
			if (!id) {
				return;
			}
			const $img = $li.find("img").first();
			coverMap.set(id, extractImgCoverUrl(id, $img));
			const liTitle =
				cleanInlineText($li.attr("title")) || cleanInlineText($img.attr("alt"));
			if (liTitle) {
				titleMap.set(id, liTitle);
			}
		});

		const $infoCards = $swiper.find(".swiper-book .itemInfo");
		if ($infoCards.length > 0) {
			$infoCards.each((__, infoEl) => {
				const $info = $(infoEl);
				const $nameLink = $info.find("a.name, a[href*='/novel/']").first();
				const id = extractNovelIdFromHref($nameLink.attr("href"));
				if (!id) {
					return;
				}
				const title =
					cleanInlineText($nameLink.text()) ||
					cleanInlineText($nameLink.attr("title")) ||
					titleMap.get(id) ||
					"";
				if (!title) {
					return;
				}
				const author =
					cleanInlineText(
						$info.find("a.author-text, .author").first().text(),
					) || undefined;
				const category =
					cleanInlineText($info.find(".cate-text a").first().text()).replace(
						/^\[|\]$/g,
						"",
					) || undefined;
				const wordCount =
					cleanInlineText($info.find(".cate-text span").first().text()) ||
					undefined;
				const summary =
					cleanBlockText($info.find(".intr-text, .intr").first().text()) ||
					undefined;

				const input: BuildExploreItemInput = {
					id,
					title,
					coverUrl: coverMap.get(id) ?? resolveDesktopCoverUrl(id),
				};
				if (author) {
					input.author = author;
				}
				if (summary) {
					input.summary = summary;
				}
				if (category) {
					input.category = category;
				}
				if (wordCount) {
					input.wordCount = wordCount;
				}
				items.push(buildExploreNovelItem(input));
			});
		} else {
			for (const [id, coverUrl] of coverMap.entries()) {
				const title = titleMap.get(id);
				if (title) {
					items.push(buildExploreNovelItem({ id, title, coverUrl }));
				}
			}
		}
	});
	return items;
}

function extractListItems(
	$: CheerioAPI,
	$listItems: Cheerio<Element>,
	defaultCategory?: string,
): ExploreNovelItem[] {
	const items: ExploreNovelItem[] = [];
	$listItems.each((_, liEl) => {
		const $li = $(liEl);
		const $novelLinks = $li.find("a[href*='/novel/']").filter((__, aEl) => {
			return extractNovelIdFromHref($(aEl).attr("href")) !== null;
		});
		if ($novelLinks.length === 0) {
			return;
		}
		const $titleLink = $li.find("a.title").first();
		const $primaryLink =
			$titleLink.length > 0 && extractNovelIdFromHref($titleLink.attr("href"))
				? $titleLink
				: $novelLinks.last();
		const id = extractNovelIdFromHref($primaryLink.attr("href"));
		if (!id) {
			return;
		}

		const title =
			cleanInlineText($primaryLink.text()) ||
			cleanInlineText($primaryLink.attr("title")) ||
			cleanInlineText($li.find("img").first().attr("alt"));
		if (!title) {
			return;
		}

		const $img = $li.find(".imgbox img, img").first();
		const coverUrl =
			$img.length > 0
				? extractImgCoverUrl(id, $img)
				: resolveDesktopCoverUrl(id);
		const author =
			cleanInlineText(
				$li.find("a.author, a.author2, span.author").first().text(),
			) || undefined;
		const category =
			cleanInlineText($li.find("a.cate").first().text()).replace(
				/^\[|\]$/g,
				"",
			) || defaultCategory;

		const input: BuildExploreItemInput = {
			id,
			title,
			coverUrl,
		};
		if (author) {
			input.author = author;
		}
		if (category) {
			input.category = category;
		}
		items.push(buildExploreNovelItem(input));
	});
	return items;
}

function parseTabListsRankSection(
	$: CheerioAPI,
	$tabLists: Cheerio<Element>,
	id: string,
	fallbackTitle: string,
): ExploreSection | null {
	if ($tabLists.length === 0) {
		return null;
	}
	const $heading = $tabLists.find(".top-title").first();
	const title = extractHeadingTitle($heading) || fallbackTitle;
	const more = parseMoreTarget($heading.find(".more a").first().attr("href"));

	const rawItems = extractListItems($, $tabLists.find(".lists ul li"));
	const items = deduplicateItemsById(rawItems).map((item, idx) => ({
		...item,
		rank: idx + 1,
	}));
	if (items.length === 0) {
		return null;
	}

	const section: ExploreSection = {
		id,
		title,
		layout: "rank",
		items,
	};
	if (more) {
		section.more = more;
	}
	return section;
}

function extractHeadingTitle($heading: Cheerio<Element>): string {
	if ($heading.length === 0) {
		return "";
	}
	const $titleNode =
		$heading.children(".title").first().length > 0
			? $heading.children(".title").first()
			: $heading.find(".title").first();
	if ($titleNode.length > 0) {
		const $clone = $titleNode.clone();
		$clone.find(".more, .compile").remove();
		return cleanInlineText($clone.text());
	}
	const $clone = $heading.clone();
	$clone.find(".more, .compile").remove();
	return cleanInlineText($clone.text());
}

function parseUpdatesSection(
	$: CheerioAPI,
	$newChapter: Cheerio<Element>,
	id: string,
	fallbackMore?: ExploreSectionMoreTarget,
): ExploreSection | null {
	if ($newChapter.length === 0) {
		return null;
	}
	const $tabT = $newChapter.find(".title .tabT.active, .title .tabT").first();
	const $titleClone = (
		$tabT.length > 0 ? $tabT : $newChapter.find(".title").first()
	).clone();
	const moreHref = $newChapter.find(".title .more a").first().attr("href");
	$titleClone.find(".more").remove();
	const title = cleanInlineText($titleClone.text()) || "最近更新";

	const items: ExploreNovelItem[] = [];
	$newChapter.find(".main_con li, ul li").each((_, liEl) => {
		const $li = $(liEl);
		const $bookLink = $li.find("span.bookname a, a[href*='/novel/']").first();
		const novelId = extractNovelIdFromHref($bookLink.attr("href"));
		if (!novelId) {
			return;
		}
		const novelTitle =
			cleanInlineText($bookLink.text()) ||
			cleanInlineText($bookLink.attr("title"));
		if (!novelTitle) {
			return;
		}

		const category =
			cleanInlineText($li.find("span.kind").text()).replace(/^\[|\]$/g, "") ||
			undefined;
		const $chapLink = $li.find("span.chap a").first();
		const latestChapter = cleanInlineText($chapLink.text()) || undefined;
		const latestChapterId =
			extractChapterIdFromHref($chapLink.attr("href"), novelId) ?? undefined;
		const author = cleanInlineText($li.find("span.author").text()) || undefined;
		const wordCount =
			cleanInlineText($li.find("span.count").text()) || undefined;
		const updatedAt =
			cleanInlineText($li.find("span.time").text()) || undefined;

		const input: BuildExploreItemInput = {
			id: novelId,
			title: novelTitle,
			coverUrl: resolveDesktopCoverUrl(novelId),
		};
		if (author) {
			input.author = author;
		}
		if (category) {
			input.category = category;
		}
		if (latestChapter) {
			input.latestChapter = latestChapter;
		}
		if (latestChapterId) {
			input.latestChapterId = latestChapterId;
		}
		if (wordCount) {
			input.wordCount = wordCount;
		}
		if (updatedAt) {
			input.updatedAt = updatedAt;
		}
		items.push(buildExploreNovelItem(input));
	});

	const deduped = deduplicateItemsById(items);
	if (deduped.length === 0) {
		return null;
	}

	const more = parseMoreTarget(moreHref) ?? fallbackMore;
	const section: ExploreSection = {
		id,
		title,
		layout: "updates",
		items: deduped,
	};
	if (more) {
		section.more = more;
	}
	return section;
}

function parseDesktopRootHome($: CheerioAPI): ExploreSection[] {
	const sections: ExploreSection[] = [];

	// 1. 焦点推荐
	const featured = parseFeaturedSection(
		$,
		$(".pdt40 .top-one-blank-left").first(),
	);
	if (featured) {
		sections.push(featured);
	}

	// 2. 强推榜
	const recommendRank = parseTabListsRankSection(
		$,
		$(".pdt40 .top-one-blank-right .tab-lists").first(),
		"recommend-rank",
		"强推榜",
	);
	if (recommendRank) {
		sections.push(recommendRank);
	}

	// 3. 新书精选
	const $firstTwoBlank = $(".top-two-blank").eq(0);
	const $newBooksBox = $firstTwoBlank
		.find(".book-blank-box .tab-lists-two")
		.first();
	const newBooksItems = deduplicateItemsById(
		extractMindBookItems($, $newBooksBox.find(".mind-showbook .mind-book")),
	);
	if (newBooksItems.length > 0) {
		sections.push({
			id: "new-books-featured",
			title:
				extractHeadingTitle($newBooksBox.find(".top-title").first()) ||
				"新书精选",
			layout: "grid",
			items: newBooksItems,
		});
	}

	// 4. 新书榜
	const newBooksRank = parseTabListsRankSection(
		$,
		$firstTwoBlank.find(".top-two-blank-right .tab-lists").first(),
		"new-books-rank",
		"新书榜",
	);
	if (newBooksRank) {
		sections.push(newBooksRank);
	}

	// 5. 热门小说
	const $maleBlank = $(".male-blank").first();
	const hotItems = deduplicateItemsById(
		extractSwiperItems($, $maleBlank.find(".pic-blank-scroll .swiper-wrapper")),
	);
	if (hotItems.length > 0) {
		sections.push({
			id: "hot-novels",
			title:
				extractHeadingTitle(
					$maleBlank.find(".tab-lists-two > .top-title").first(),
				) || "热门小说",
			layout: "grid",
			items: hotItems,
		});
	}

	// 6. 各文库精选（电击、富士见、角川、MF、Fami通、GA、HJ、一迅社）
	$maleBlank.find(".cate-blank .cate-cell").each((index, cellEl) => {
		const $cell = $(cellEl);
		const $heading = $cell.find(".top-title-two").first();
		const title = extractHeadingTitle($heading);
		if (!title) {
			return;
		}
		const moreHref = $heading.find(".more a").first().attr("href");
		const more = parseMoreTarget(moreHref);
		const channelSlug =
			more?.type === "channel" ? more.params.channel : undefined;
		const items = deduplicateItemsById(
			extractListItems($, $cell.find(".lists ul li"), title),
		);
		if (items.length === 0) {
			return;
		}
		const section: ExploreSection = {
			id: channelSlug ? `channel-${channelSlug}` : `channel-grid-${index}`,
			title,
			layout: "grid",
			items,
		};
		if (more) {
			section.more = more;
		}
		sections.push(section);
	});

	// 7. 经典完本
	const $secondTwoBlank = $(".top-two-blank").eq(1);
	const $classicLeft = $secondTwoBlank.find(".top-two-blank-left").first();
	const classicItems = deduplicateItemsById(
		extractSwiperItems($, $classicLeft.find(".swiper-wrapper")),
	);
	if (classicItems.length > 0) {
		sections.push({
			id: "classic-completed",
			title:
				extractHeadingTitle($classicLeft.find(".top-title").first()) ||
				"经典完本",
			layout: "grid",
			items: classicItems,
		});
	}

	// 8. 完本推荐
	const $completedMid = $secondTwoBlank
		.find(".top-two-blank-mid .tab-lists-two")
		.first();
	const completedItems = deduplicateItemsById(
		extractMindBookItems($, $completedMid.find(".mind-showbook .mind-book")),
	);
	if (completedItems.length > 0) {
		sections.push({
			id: "completed-recommended",
			title:
				extractHeadingTitle($completedMid.find(".top-title").first()) ||
				"完本推荐",
			layout: "grid",
			items: completedItems,
		});
	}

	// 9. 热点榜
	const hotRank = parseTabListsRankSection(
		$,
		$secondTwoBlank.find(".top-two-blank-right .tab-lists").first(),
		"hot-rank",
		"热点榜",
	);
	if (hotRank) {
		sections.push(hotRank);
	}

	// 10. 最近更新
	const updates = parseUpdatesSection(
		$,
		$(".new_chapter").first(),
		"recent-updates",
		{ type: "ranking", params: { rank: "lastupdate", full: "false" } },
	);
	if (updates) {
		sections.push(updates);
	}

	return sections;
}

const MODULE_CONTAINER_SELECTOR =
	".tab-lists, .tab-lists-two, .cate-cell, .top-two-blank-left, .new_chapter";

function isDirectChildOfContainer(
	$el: Cheerio<Element>,
	containerEl: Element,
): boolean {
	const $closest = $el.closest(MODULE_CONTAINER_SELECTOR);
	return $closest.length > 0 && $closest.get(0) === containerEl;
}

function mergeSectionIntoList(
	sections: ExploreSection[],
	titleIndexMap: Map<string, number>,
	incoming: ExploreSection,
): void {
	const key = `${incoming.layout}:${incoming.title}`;
	const existingIndex = titleIndexMap.get(key);
	if (existingIndex === undefined) {
		titleIndexMap.set(key, sections.length);
		sections.push(incoming);
		return;
	}
	const existing = sections[existingIndex];
	if (!existing) {
		return;
	}
	const mergedItems = deduplicateItemsById([
		...existing.items,
		...incoming.items,
	]);
	existing.items =
		existing.layout === "rank"
			? mergedItems.map((item, idx) => ({ ...item, rank: idx + 1 }))
			: mergedItems;
	if (!existing.more && incoming.more) {
		existing.more = incoming.more;
	}
}

function parseChannelPageSections(
	$: CheerioAPI,
	channel: string,
): ExploreSection[] {
	const sections: ExploreSection[] = [];
	const titleIndexMap = new Map<string, number>();

	const featured = parseFeaturedSection($, $("#index_tpic").first());
	if (featured) {
		mergeSectionIntoList(sections, titleIndexMap, featured);
	}

	let sectionSeq = 0;
	$(".top-title, .top-title-two, .new_chapter").each((_, el) => {
		const $el = $(el);
		if ($el.hasClass("new_chapter")) {
			const updates = parseUpdatesSection(
				$,
				$el,
				`${channel}-updates-${sectionSeq++}`,
				{ type: "ranking", params: { rank: "lastupdate", full: "false" } },
			);
			if (updates) {
				mergeSectionIntoList(sections, titleIndexMap, updates);
			}
			return;
		}

		if ($el.closest(".new_chapter").length > 0) {
			return;
		}

		const $container = $el.parent();
		const containerEl = $container.get(0);
		if (!containerEl) {
			return;
		}

		const title = extractHeadingTitle($el);
		if (!title) {
			return;
		}
		const more = parseMoreTarget($el.find(".more a").first().attr("href"));

		const directSwipers = $container
			.find(".swiper-wrapper")
			.filter((__, node) => isDirectChildOfContainer($(node), containerEl));
		const directMindBooks = $container
			.find(".mind-book")
			.filter((__, node) => isDirectChildOfContainer($(node), containerEl));
		const directListItems = $container
			.find(".lists ul li")
			.filter((__, node) => isDirectChildOfContainer($(node), containerEl));

		const collected: ExploreNovelItem[] = [
			...extractSwiperItems($, directSwipers),
			...extractMindBookItems($, directMindBooks),
			...extractListItems($, directListItems),
		];

		const isRank =
			$container.hasClass("tab-lists") ||
			title.endsWith("榜") ||
			directListItems.find(".list_icon").length > 0;
		const layout: ExploreSectionLayout = isRank ? "rank" : "grid";

		let items = deduplicateItemsById(collected);
		if (items.length === 0) {
			return;
		}
		if (layout === "rank") {
			items = items.map((item, idx) => ({ ...item, rank: idx + 1 }));
		}

		const section: ExploreSection = {
			id: `${channel}-section-${sectionSeq++}`,
			title,
			layout,
			items,
		};
		if (more) {
			section.more = more;
		}
		mergeSectionIntoList(sections, titleIndexMap, section);
	});

	return sections;
}

export function parseHomeHtml(html: string, channel = "home"): ExploreHomeData {
	if (!isValidLinovelibChannel(channel)) {
		throw new Error(`Invalid linovelib explore channel: ${channel}`);
	}
	const $ = load(html);
	const channelOption = getLinovelibChannelOption(channel);
	const title = channelOption?.label ?? "全站首页";
	const sections =
		channel === "home"
			? parseDesktopRootHome($)
			: parseChannelPageSections($, channel);

	return {
		platform: "linovelib",
		channel,
		title,
		sections,
	};
}

export async function getExploreHome(
	channel: string | undefined,
	queue: NovelExploreQueue,
): Promise<ExploreHomeData> {
	const resolvedChannel = channel ?? "home";
	if (!isValidLinovelibChannel(resolvedChannel)) {
		throw new Error(`Invalid linovelib explore channel: ${resolvedChannel}`);
	}
	const url =
		resolvedChannel === "home"
			? `${LINOVELIB_DESKTOP_BASE}/`
			: `${LINOVELIB_DESKTOP_BASE}/wenku/${resolvedChannel}/1.html`;
	const html = await queue.fetchPage(url);
	return parseHomeHtml(html, resolvedChannel);
}
