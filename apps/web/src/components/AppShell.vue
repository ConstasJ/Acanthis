<script setup lang="ts">
import {
	BookMarked,
	BookOpen,
	Compass,
	History,
	RefreshCw,
	Settings,
} from "lucide-vue-next";
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useLibraryStore } from "@/stores/library";

const route = useRoute();
const libraryStore = useLibraryStore();

const isImmersive = computed(() => route.meta.immersive === true);

const navItems = [
	{ name: "bookshelf", to: "/", label: "书架", icon: BookMarked },
	{ name: "history", to: "/history", label: "历史", icon: History },
	{ name: "explore", to: "/explore", label: "发现", icon: Compass },
	{ name: "settings", to: "/settings", label: "设置", icon: Settings },
] as const;

function isActive(name: string): boolean {
	return route.name === name;
}
</script>

<template>
	<div v-if="isImmersive" class="min-h-screen">
		<slot />
	</div>

	<div
		v-else
		class="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] md:flex"
	>
		<!-- Desktop Navigation Rail -->
		<aside
			class="hidden md:flex md:w-20 lg:w-56 md:shrink-0 md:flex-col md:border-r md:border-[var(--border-subtle)] md:bg-[var(--bg-elevated)] md:sticky md:top-0 md:h-screen"
		>
			<div
				class="flex items-center justify-center lg:justify-start gap-2.5 px-4 py-5 border-b border-[var(--border-subtle)]"
			>
				<div
					class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white"
				>
					<BookOpen class="h-5 w-5" />
				</div>
				<div class="hidden lg:block min-w-0">
					<p class="text-base font-semibold tracking-tight truncate">
						Acanthis
					</p>
					<p class="text-xs text-[var(--text-muted)] truncate">
						在线轻小说阅读
					</p>
				</div>
			</div>

			<nav class="flex-1 px-2.5 py-4 space-y-1.5" aria-label="主导航">
				<RouterLink
					v-for="item in navItems"
					:key="item.name"
					:to="item.to"
					class="flex items-center justify-center lg:justify-start gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors"
					:class="
						isActive(item.name)
							? 'bg-[var(--accent-soft)] text-[var(--accent)]'
							: 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
					"
				>
					<component :is="item.icon" class="h-5 w-5 shrink-0" />
					<span class="hidden lg:inline">{{ item.label }}</span>
				</RouterLink>
			</nav>

			<div
				class="px-3 py-4 border-t border-[var(--border-subtle)] flex items-center justify-center lg:justify-start gap-2 text-xs text-[var(--text-muted)]"
			>
				<RefreshCw
					class="h-3.5 w-3.5 shrink-0"
					:class="{ 'animate-spin text-[var(--accent)]': libraryStore.syncStatus === 'syncing' }"
				/>
				<span class="hidden lg:inline truncate">
					{{
						libraryStore.syncStatus === "syncing"
							? "正在同步…"
							: libraryStore.syncStatus === "error"
								? "同步待重试"
								: "本地已就绪"
					}}
				</span>
			</div>
		</aside>

		<!-- Main Content Area -->
		<main class="flex-1 min-w-0 pb-24 md:pb-10">
			<div class="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
				<slot />
			</div>
		</main>

		<!-- Mobile Bottom Navigation -->
		<nav
			aria-label="移动端主导航"
			class="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/95 backdrop-blur px-2 pt-2 pb-safe md:hidden"
		>
			<RouterLink
				v-for="item in navItems"
				:key="item.name"
				:to="item.to"
				class="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 text-xs font-medium transition-colors"
				:class="
					isActive(item.name)
						? 'text-[var(--accent)]'
						: 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
				"
			>
				<component :is="item.icon" class="h-5 w-5" />
				<span>{{ item.label }}</span>
			</RouterLink>
		</nav>
	</div>
</template>
