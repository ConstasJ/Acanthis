import { createRouter, createWebHistory } from "vue-router";

declare module "vue-router" {
	interface RouteMeta {
		immersive?: boolean;
		title?: string;
	}
}

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
			path: "/history",
			name: "history",
			component: () => import("@/views/HistoryView.vue"),
			meta: { title: "历史" },
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
			component: () => import("@/views/ReaderView.vue"),
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
