<script setup lang="ts">
import { FolderPlus, X } from "lucide-vue-next";
import { ref, watch } from "vue";
import { MAX_CATEGORY_NAME_LENGTH, useLibraryStore } from "@/stores/library";

const props = defineProps<{
	open: boolean;
	platform: string;
	novelId: string;
	title: string;
	initialCategoryIds: string[];
}>();

const emit = defineEmits<{
	close: [];
	saved: [categoryIds: string[]];
}>();

const libraryStore = useLibraryStore();

const selectedIds = ref<Set<string>>(new Set());
const quickName = ref<string>("");
const quickError = ref<string | null>(null);
const creating = ref<boolean>(false);
const saving = ref<boolean>(false);

watch(
	() => [props.open, props.platform, props.novelId, props.initialCategoryIds] as const,
	([isOpen]) => {
		if (isOpen) {
			const activeIds = new Set(
				libraryStore.activeCategories.map((category) => category.id),
			);
			selectedIds.value = new Set(
				props.initialCategoryIds.filter((id) => activeIds.has(id)),
			);
			quickName.value = "";
			quickError.value = null;
		}
	},
	{ immediate: true },
);

function toggleCategory(id: string): void {
	const next = new Set(selectedIds.value);
	if (next.has(id)) {
		next.delete(id);
	} else {
		next.add(id);
	}
	selectedIds.value = next;
}

async function handleQuickCreate(): Promise<void> {
	if (creating.value) {
		return;
	}
	quickError.value = null;
	const trimmed = quickName.value.trim();
	if (trimmed.length < 1) {
		quickError.value = "请输入书架名称";
		return;
	}
	if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
		quickError.value = `书架名称不能超过 ${MAX_CATEGORY_NAME_LENGTH} 个字符`;
		return;
	}

	creating.value = true;
	try {
		const created = await libraryStore.createCategory(trimmed);
		const next = new Set(selectedIds.value);
		next.add(created.id);
		selectedIds.value = next;
		quickName.value = "";
	} catch (err) {
		quickError.value = err instanceof Error ? err.message : String(err);
	} finally {
		creating.value = false;
	}
}

async function handleSave(): Promise<void> {
	if (saving.value) {
		return;
	}
	saving.value = true;
	try {
		const ids = Array.from(selectedIds.value);
		await libraryStore.setBookshelfCategories(
			props.platform,
			props.novelId,
			ids,
		);
		emit("saved", ids);
		emit("close");
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<div
		v-if="open"
		role="dialog"
		aria-modal="true"
		aria-labelledby="shelf-assign-title"
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
		@click.self="emit('close')"
		@keydown.esc="emit('close')"
	>
		<div
			class="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-xl"
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-5 py-4"
			>
				<div class="min-w-0">
					<h2
						id="shelf-assign-title"
						class="text-base font-semibold text-[var(--text-primary)]"
					>
						管理所属书架
					</h2>
					<p class="mt-0.5 truncate text-xs text-[var(--text-muted)]">
						{{ title }}
					</p>
				</div>
				<button
					type="button"
					aria-label="关闭弹窗"
					class="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
					@click="emit('close')"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
				<div
					v-if="libraryStore.activeCategories.length === 0"
					class="rounded-xl border border-dashed border-[var(--border-subtle)] p-5 text-center text-xs text-[var(--text-muted)]"
				>
					当前还没有自定义书架，可在下方快速新建并勾选。
				</div>

				<div v-else class="space-y-1.5">
					<label
						v-for="category in libraryStore.activeCategories"
						:key="category.id"
						class="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-2.5 text-sm transition-colors hover:border-[var(--accent)]/50"
					>
						<input
							type="checkbox"
							:checked="selectedIds.has(category.id)"
							class="h-4 w-4 rounded accent-[var(--accent)]"
							@change="toggleCategory(category.id)"
						/>
						<span class="min-w-0 flex-1 truncate font-medium text-[var(--text-primary)]">
							{{ category.name }}
						</span>
					</label>
				</div>

				<!-- Quick Create Shelf -->
				<form class="space-y-1.5 pt-1" @submit.prevent="handleQuickCreate">
					<div class="flex gap-2">
						<input
							v-model="quickName"
							type="text"
							:maxlength="MAX_CATEGORY_NAME_LENGTH"
							placeholder="快速新建书架并勾选…"
							aria-label="快速新建书架"
							class="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
						/>
						<button
							type="submit"
							:disabled="creating || !quickName.trim()"
							class="inline-flex shrink-0 items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-primary)] disabled:cursor-not-allowed disabled:opacity-50"
						>
							<FolderPlus class="h-3.5 w-3.5" />
							新建
						</button>
					</div>
					<p v-if="quickError" class="text-xs text-red-500">
						{{ quickError }}
					</p>
				</form>

				<p class="text-[11px] text-[var(--text-muted)]">
					不勾选任何自定义书架时，作品将保留在「默认」视图中；如需移出书架，请使用移出操作。
				</p>
			</div>

			<!-- Footer -->
			<div
				class="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3"
			>
				<button
					type="button"
					:disabled="saving"
					class="rounded-xl border border-[var(--border-subtle)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
					@click="emit('close')"
				>
					取消
				</button>
				<button
					type="button"
					:disabled="saving"
					class="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
					@click="handleSave"
				>
					{{ saving ? "保存中…" : "保存" }}
				</button>
			</div>
		</div>
	</div>
</template>
