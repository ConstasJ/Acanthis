<script setup lang="ts">
import type { BookshelfCategory } from "@acanthis-dec/core";
import {
	ArrowDown,
	ArrowUp,
	Check,
	FolderPlus,
	Pencil,
	Trash2,
	X,
} from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { MAX_CATEGORY_NAME_LENGTH, useLibraryStore } from "@/stores/library";

const props = defineProps<{
	open: boolean;
}>();

const emit = defineEmits<{
	close: [];
}>();

const libraryStore = useLibraryStore();

const newShelfName = ref<string>("");
const createError = ref<string | null>(null);
const creating = ref<boolean>(false);

const editingId = ref<string | null>(null);
const editingName = ref<string>("");
const editError = ref<string | null>(null);
const savingEdit = ref<boolean>(false);

const confirmDeleteId = ref<string | null>(null);
const busyCategoryId = ref<string | null>(null);

const categoryCountMap = computed<Map<string, number>>(() => {
	const counts = new Map<string, number>();
	for (const item of libraryStore.activeBookshelf) {
		for (const id of libraryStore.getEffectiveCategoryIds(item)) {
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
	}
	return counts;
});

watch(
	() => props.open,
	(isOpen) => {
		if (!isOpen) {
			newShelfName.value = "";
			createError.value = null;
			editingId.value = null;
			editingName.value = "";
			editError.value = null;
			confirmDeleteId.value = null;
		}
	},
);

async function handleCreate(): Promise<void> {
	if (creating.value) {
		return;
	}
	createError.value = null;
	const trimmed = newShelfName.value.trim();
	if (trimmed.length < 1) {
		createError.value = "请输入书架名称";
		return;
	}
	if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
		createError.value = `书架名称不能超过 ${MAX_CATEGORY_NAME_LENGTH} 个字符`;
		return;
	}

	creating.value = true;
	try {
		await libraryStore.createCategory(trimmed);
		newShelfName.value = "";
	} catch (err) {
		createError.value = err instanceof Error ? err.message : String(err);
	} finally {
		creating.value = false;
	}
}

function startEditing(category: BookshelfCategory): void {
	confirmDeleteId.value = null;
	editingId.value = category.id;
	editingName.value = category.name;
	editError.value = null;
}

function cancelEditing(): void {
	editingId.value = null;
	editingName.value = "";
	editError.value = null;
}

async function handleSaveRename(id: string): Promise<void> {
	if (savingEdit.value) {
		return;
	}
	editError.value = null;
	const trimmed = editingName.value.trim();
	if (trimmed.length < 1) {
		editError.value = "书架名称不能为空";
		return;
	}
	if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
		editError.value = `书架名称不能超过 ${MAX_CATEGORY_NAME_LENGTH} 个字符`;
		return;
	}

	savingEdit.value = true;
	try {
		await libraryStore.renameCategory(id, trimmed);
		cancelEditing();
	} catch (err) {
		editError.value = err instanceof Error ? err.message : String(err);
	} finally {
		savingEdit.value = false;
	}
}

async function handleMove(index: number, direction: -1 | 1): Promise<void> {
	const list = libraryStore.activeCategories;
	const targetIndex = index + direction;
	if (targetIndex < 0 || targetIndex >= list.length) {
		return;
	}
	const ids = list.map((category) => category.id);
	const currentId = ids[index];
	const targetId = ids[targetIndex];
	if (!currentId || !targetId) {
		return;
	}
	ids[index] = targetId;
	ids[targetIndex] = currentId;

	busyCategoryId.value = currentId;
	try {
		await libraryStore.reorderCategories(ids);
	} finally {
		busyCategoryId.value = null;
	}
}

async function handleDelete(id: string): Promise<void> {
	busyCategoryId.value = id;
	try {
		await libraryStore.deleteCategory(id);
		if (confirmDeleteId.value === id) {
			confirmDeleteId.value = null;
		}
		if (editingId.value === id) {
			cancelEditing();
		}
	} finally {
		busyCategoryId.value = null;
	}
}
</script>

<template>
	<div
		v-if="open"
		role="dialog"
		aria-modal="true"
		aria-labelledby="shelf-manager-title"
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
		@click.self="emit('close')"
		@keydown.esc="emit('close')"
	>
		<div
			class="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-xl"
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4"
			>
				<div>
					<h2
						id="shelf-manager-title"
						class="text-base font-semibold text-[var(--text-primary)]"
					>
						管理书架
					</h2>
					<p class="mt-0.5 text-xs text-[var(--text-muted)]">
						新建、重命名、排序或删除自定义书架
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
				<!-- Create Form -->
				<form class="space-y-1.5" @submit.prevent="handleCreate">
					<div class="flex gap-2">
						<input
							v-model="newShelfName"
							type="text"
							:maxlength="MAX_CATEGORY_NAME_LENGTH"
							placeholder="输入新书架名称（1~32 字）"
							aria-label="新书架名称"
							class="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
						/>
						<button
							type="submit"
							:disabled="creating || !newShelfName.trim()"
							class="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<FolderPlus class="h-3.5 w-3.5" />
							新建
						</button>
					</div>
					<p v-if="createError" class="text-xs text-red-500">
						{{ createError }}
					</p>
				</form>

				<!-- Category List -->
				<div
					v-if="libraryStore.activeCategories.length === 0"
					class="rounded-xl border border-dashed border-[var(--border-subtle)] p-6 text-center text-xs text-[var(--text-muted)]"
				>
					还没有自定义书架。新建后即可把作品同时归类到多个书架。
				</div>

				<ul v-else class="space-y-2">
					<li
						v-for="(category, index) in libraryStore.activeCategories"
						:key="category.id"
						class="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-2.5 space-y-2"
					>
						<!-- Inline Rename Mode -->
						<form
							v-if="editingId === category.id"
							class="space-y-1.5"
							@submit.prevent="handleSaveRename(category.id)"
						>
							<div class="flex items-center gap-1.5">
								<input
									v-model="editingName"
									type="text"
									:maxlength="MAX_CATEGORY_NAME_LENGTH"
									aria-label="重命名书架"
									class="flex-1 rounded-lg border border-[var(--accent)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none"
									@keydown.esc.stop="cancelEditing"
								/>
								<button
									type="submit"
									:disabled="savingEdit"
									aria-label="保存名称"
									class="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
								>
									<Check class="h-4 w-4" />
								</button>
								<button
									type="button"
									aria-label="取消重命名"
									class="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
									@click="cancelEditing"
								>
									<X class="h-4 w-4" />
								</button>
							</div>
							<p v-if="editError" class="text-xs text-red-500">
								{{ editError }}
							</p>
						</form>

						<!-- Normal Display Mode -->
						<div v-else class="flex items-center justify-between gap-2">
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium text-[var(--text-primary)]">
									{{ category.name }}
								</p>
								<p class="text-[11px] text-[var(--text-muted)]">
									{{ categoryCountMap.get(category.id) ?? 0 }} 部作品
								</p>
							</div>

							<div class="flex shrink-0 items-center gap-1">
								<button
									type="button"
									aria-label="上移"
									title="上移"
									:disabled="index === 0 || busyCategoryId === category.id"
									class="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:cursor-not-allowed disabled:opacity-30"
									@click="handleMove(index, -1)"
								>
									<ArrowUp class="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									aria-label="下移"
									title="下移"
									:disabled="
										index === libraryStore.activeCategories.length - 1 ||
										busyCategoryId === category.id
									"
									class="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:cursor-not-allowed disabled:opacity-30"
									@click="handleMove(index, 1)"
								>
									<ArrowDown class="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									aria-label="重命名"
									title="重命名"
									class="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
									@click="startEditing(category)"
								>
									<Pencil class="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									aria-label="删除书架"
									title="删除书架"
									class="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-600"
									@click="
										confirmDeleteId =
											confirmDeleteId === category.id ? null : category.id
									"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</button>
							</div>
						</div>

						<!-- Inline Delete Confirmation -->
						<div
							v-if="confirmDeleteId === category.id"
							class="flex items-center justify-between gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs"
						>
							<span class="text-red-600">
								仅删除分组，不会移除书架中的作品
							</span>
							<div class="flex shrink-0 items-center gap-1.5">
								<button
									type="button"
									class="rounded-md px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
									@click="confirmDeleteId = null"
								>
									取消
								</button>
								<button
									type="button"
									:disabled="busyCategoryId === category.id"
									class="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
									@click="handleDelete(category.id)"
								>
									删除
								</button>
							</div>
						</div>
					</li>
				</ul>

				<p class="text-[11px] leading-relaxed text-[var(--text-muted)]">
					「全部」与「默认」为内置视图。删除自定义书架后，仅属于该书架的作品会自动归入「默认」，不会丢失收藏。
				</p>
			</div>

			<!-- Footer -->
			<div
				class="flex justify-end border-t border-[var(--border-subtle)] px-5 py-3"
			>
				<button
					type="button"
					class="rounded-xl border border-[var(--border-subtle)] px-4 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
					@click="emit('close')"
				>
					完成
				</button>
			</div>
		</div>
	</div>
</template>
