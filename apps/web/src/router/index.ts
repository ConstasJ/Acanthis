import { computed, defineComponent, h } from "vue";
import {
	createRouter,
	createWebHistory,
	RouterLink,
	useRoute,
} from "vue-router";

declare module "vue-router" {
	interface RouteMeta {
		immersive?: boolean;
		title?: string;
	}
}

const ReaderPlaceholderView = defineComponent({
	name: "ReaderPlaceholderView",
	setup() {
		const route = useRoute();
		const platform = computed(() => String(route.params.platform ?? ""));
		const novelId = computed(() => String(route.params.novelId ?? ""));
		const chapterId = computed(() => String(route.params.chapterId ?? ""));

		return () =>
			h(
				"main",
				{
					class:
						"min-h-screen bg-[var(--reader-bg)] text-[var(--reader-text)] flex flex-col items-center justify-center p-6 text-center",
				},
				[
					h(
						"div",
						{
							class:
								"max-w-md w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 space-y-4",
						},
						[
							h(
								"h1",
								{ class: "text-lg font-semibold text-[var(--text-primary)]" },
								"沉浸式阅读器加载中",
							),
							h(
								"p",
								{ class: "text-sm text-[var(--text-secondary)]" },
								`书源：${platform.value} · 作品：${novelId.value} · 章节：${chapterId.value}`,
							),
							h(
								RouterLink,
								{
									to: `/novel/${encodeURIComponent(platform.value)}/${encodeURIComponent(novelId.value)}`,
									class:
										"inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white",
								},
								() => "返回作品详情",
							),
						],
					),
				],
			);
	},
});

const router = createRouter({
	history: createWebHistory(),
	scrollBehavior(_to, _from, savedPosition) {
		if (savedPosition) {
			return savedPosition;
		}
		return { top: 0 };
	},
	routes: [
		{
			path: "/",
			name: "bookshelf",
			component: () => import("@/views/BookshelfView.vue"),
			meta: { title: "书架" },
		},
		{
			path: "/explore",
			name: "explore",
			component: () => import("@/views/ExploreView.vue"),
			meta: { title: "发现" },
		},
		{
			path: "/novel/:platform/:novelId",
			name: "novel-detail",
			component: () => import("@/views/NovelDetailView.vue"),
			meta: { title: "作品详情" },
		},
		{
			path: "/read/:platform/:novelId/:chapterId",
			name: "reader",
			component: ReaderPlaceholderView,
			meta: { immersive: true, title: "阅读" },
		},
		{
			path: "/settings",
			name: "settings",
			component: () => import("@/views/SettingsView.vue"),
			meta: { title: "设置" },
		},
	],
});

router.afterEach((to) => {
	if (typeof document !== "undefined") {
		const pageTitle = to.meta.title;
		document.title = pageTitle ? `${pageTitle} · Acanthis` : "Acanthis";
	}
});

export default router;
