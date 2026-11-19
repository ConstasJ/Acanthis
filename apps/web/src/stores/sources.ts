import type { NovelSourceDescriptor } from "@acanthis-dec/core";
import { defineStore } from "pinia";
import { ref } from "vue";
import { ApiError, fetchSources } from "@/api/client";
import { useSettingsStore } from "@/stores/settings";

export const useSourcesStore = defineStore("sources", () => {
	const sources = ref<NovelSourceDescriptor[]>([]);
	const loading = ref<boolean>(false);
	const error = ref<string | null>(null);
	const needsSetup = ref<boolean>(false);
	const lastCheckedAt = ref<number | null>(null);

	async function refreshSources(): Promise<boolean> {
		const settingsStore = useSettingsStore();
		loading.value = true;
		error.value = null;

		try {
			const list = await fetchSources();
			sources.value = list;
			needsSetup.value = false;
			lastCheckedAt.value = Date.now();

			const firstSource = list[0];
			if (
				firstSource &&
				(!settingsStore.selectedExplorePlatform ||
					!list.some((s) => s.id === settingsStore.selectedExplorePlatform))
			) {
				settingsStore.setSelectedExplorePlatform(firstSource.id);
			}
			return true;
		} catch (err) {
			if (err instanceof ApiError) {
				if (err.status === 401 || err.code === 40100) {
					needsSetup.value = true;
					error.value = "后端鉴权失败（401），请在设置中检查 Access Token。";
				} else if (err.status === 0) {
					needsSetup.value = true;
					error.value = `无法连接到后端服务（${err.message}），请检查 API Base URL。`;
				} else {
					error.value = err.message;
				}
			} else {
				needsSetup.value = true;
				error.value =
					err instanceof Error ? err.message : "加载书源列表时发生未知错误";
			}
			return false;
		} finally {
			loading.value = false;
		}
	}

	return {
		sources,
		loading,
		error,
		needsSetup,
		lastCheckedAt,
		refreshSources,
	};
});
