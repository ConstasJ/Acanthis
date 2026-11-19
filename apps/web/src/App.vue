<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { RouterView } from "vue-router";
import AppShell from "@/components/AppShell.vue";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { useSourcesStore } from "@/stores/sources";

// Ensure settings store initializes data-theme attribute at boot.
useSettingsStore();
const libraryStore = useLibraryStore();
const sourcesStore = useSourcesStore();

function handleVisibilityChange(): void {
	if (document.visibilityState === "visible") {
		void libraryStore.syncNow();
	} else if (document.visibilityState === "hidden") {
		libraryStore.flushOnLeave();
	}
}

function handlePageHide(): void {
	libraryStore.flushOnLeave();
}

onMounted(async () => {
	document.addEventListener("visibilitychange", handleVisibilityChange);
	window.addEventListener("pagehide", handlePageHide);

	await libraryStore.hydrate();
	await sourcesStore.refreshSources();
	await libraryStore.syncNow();
});

onBeforeUnmount(() => {
	document.removeEventListener("visibilitychange", handleVisibilityChange);
	window.removeEventListener("pagehide", handlePageHide);
});
</script>

<template>
	<AppShell>
		<RouterView />
	</AppShell>
</template>
