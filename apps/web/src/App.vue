<script setup lang="ts">
import { resolveApiBaseUrl } from "@/config/runtime";

const apiBaseUrl = resolveApiBaseUrl();
</script>

<template>
	<main class="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] p-6">
		<h1 class="text-xl font-semibold">Acanthis Web</h1>
		<p class="mt-2 text-sm text-[var(--text-secondary)]">
			API Base URL: {{ apiBaseUrl }}
		</p>
	</main>
</template>
