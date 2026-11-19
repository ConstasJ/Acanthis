<script setup lang="ts">
import { AlertCircle, ArrowRight, RotateCw } from "lucide-vue-next";
import { RouterLink } from "vue-router";
import { useSourcesStore } from "@/stores/sources";

const sourcesStore = useSourcesStore();
</script>

<template>
	<section
		v-if="sourcesStore.needsSetup"
		class="mb-5 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/70 p-4 sm:p-5"
	>
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex items-start gap-3">
				<AlertCircle class="h-5 w-5 shrink-0 text-[var(--accent)] mt-0.5" />
				<div class="space-y-1">
					<h2 class="text-sm font-semibold text-[var(--text-primary)]">
						需要配置后端连接或访问令牌
					</h2>
					<p class="text-xs sm:text-sm text-[var(--text-secondary)]">
						{{
							sourcesStore.error ||
							"当前未能连接至 Acanthis 后端服务，请检查 API Base URL 与可选 Access Token。"
						}}
					</p>
				</div>
			</div>

			<div class="flex items-center gap-2 shrink-0 pl-8 sm:pl-0">
				<button
					type="button"
					:disabled="sourcesStore.loading"
					class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
					@click="sourcesStore.refreshSources()"
				>
					<RotateCw
						class="h-3.5 w-3.5"
						:class="{ 'animate-spin': sourcesStore.loading }"
					/>
					重试
				</button>
				<RouterLink
					to="/settings"
					class="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white hover:opacity-90"
				>
					前往设置
					<ArrowRight class="h-3.5 w-3.5" />
				</RouterLink>
			</div>
		</div>
	</section>
</template>
