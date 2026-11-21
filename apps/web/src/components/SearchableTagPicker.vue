<script setup lang="ts">
import { Check, ChevronDown, Search, Tag, X } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

export interface TagPickerOption {
	value: string;
	label: string;
	count?: number | undefined;
}

const props = withDefaults(
	defineProps<{
		options: readonly TagPickerOption[];
		modelValue: string | string[];
		multiple?: boolean;
		label: string;
		panelTitle?: string;
		placeholder?: string;
		emptyText?: string;
		defaultValue?: string;
		loading?: boolean;
		align?: "left" | "right";
	}>(),
	{
		multiple: true,
		panelTitle: "",
		placeholder: "搜索标签…",
		emptyText: "暂无可选项",
		defaultValue: "",
		loading: false,
		align: "left",
	},
);

const emit = defineEmits<{
	"update:modelValue": [value: string | string[]];
}>();

const open = ref<boolean>(false);
const searchQuery = ref<string>("");
const rootRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);

const selectedValues = computed<string[]>(() => {
	if (props.multiple) {
		if (Array.isArray(props.modelValue)) {
			return props.modelValue;
		}
		return props.modelValue ? [props.modelValue] : [];
	}
	const single = Array.isArray(props.modelValue)
		? (props.modelValue[0] ?? props.defaultValue)
		: props.modelValue;
	return single !== "" ? [single] : [];
});

const selectedSet = computed<Set<string>>(() => new Set(selectedValues.value));

const singleSelectedValue = computed<string>(() => {
	if (Array.isArray(props.modelValue)) {
		return props.modelValue[0] ?? props.defaultValue;
	}
	return props.modelValue;
});

const singleSelectedOption = computed<TagPickerOption | undefined>(() =>
	props.options.find((opt) => opt.value === singleSelectedValue.value),
);

const hasActiveSelection = computed<boolean>(() => {
	if (props.multiple) {
		return selectedValues.value.length > 0;
	}
	return (
		singleSelectedValue.value !== props.defaultValue &&
		singleSelectedValue.value !== ""
	);
});

const triggerDisplayValue = computed<string>(() => {
	if (props.multiple) {
		return props.label;
	}
	if (hasActiveSelection.value) {
		return `${props.label}：${singleSelectedOption.value?.label ?? singleSelectedValue.value}`;
	}
	const defaultOption = props.options.find(
		(opt) => opt.value === props.defaultValue,
	);
	if (defaultOption && defaultOption.label !== props.label) {
		return `${props.label}：${defaultOption.label}`;
	}
	return props.label;
});

const filteredOptions = computed<TagPickerOption[]>(() => {
	const keyword = searchQuery.value.trim().toLowerCase();
	const matched = keyword
		? props.options.filter(
				(opt) =>
					opt.label.toLowerCase().includes(keyword) ||
					opt.value.toLowerCase().includes(keyword),
			)
		: [...props.options];

	if (!props.multiple) {
		if (!hasActiveSelection.value) {
			return matched;
		}
		const active: TagPickerOption[] = [];
		const rest: TagPickerOption[] = [];
		for (const opt of matched) {
			if (opt.value === singleSelectedValue.value) {
				active.push(opt);
			} else {
				rest.push(opt);
			}
		}
		return [...active, ...rest];
	}

	if (selectedSet.value.size === 0) {
		return matched;
	}

	const pinned: TagPickerOption[] = [];
	const rest: TagPickerOption[] = [];
	for (const opt of matched) {
		if (selectedSet.value.has(opt.value)) {
			pinned.push(opt);
		} else {
			rest.push(opt);
		}
	}
	return [...pinned, ...rest];
});

function closePanel(): void {
	open.value = false;
	searchQuery.value = "";
}

function togglePanel(): void {
	if (open.value) {
		closePanel();
		return;
	}
	open.value = true;
	searchQuery.value = "";
	void nextTick().then(() => {
		searchInputRef.value?.focus();
	});
}

function isOptionSelected(value: string): boolean {
	if (props.multiple) {
		return selectedSet.value.has(value);
	}
	return singleSelectedValue.value === value;
}

function handleSelectOption(value: string): void {
	if (props.multiple) {
		if (selectedSet.value.has(value)) {
			emit(
				"update:modelValue",
				selectedValues.value.filter((item) => item !== value),
			);
		} else {
			emit("update:modelValue", [...selectedValues.value, value]);
		}
		return;
	}

	emit("update:modelValue", value);
	closePanel();
}

function handleClear(): void {
	if (props.multiple) {
		emit("update:modelValue", []);
	} else {
		emit("update:modelValue", props.defaultValue);
		closePanel();
	}
}

function handleDocumentClick(event: MouseEvent): void {
	if (!open.value) {
		return;
	}
	const target = event.target as Node | null;
	if (target && rootRef.value && !rootRef.value.contains(target)) {
		closePanel();
	}
}

function handleDocumentKeyDown(event: KeyboardEvent): void {
	if (event.key === "Escape" && open.value) {
		closePanel();
	}
}

onMounted(() => {
	document.addEventListener("click", handleDocumentClick);
	document.addEventListener("keydown", handleDocumentKeyDown);
});

onBeforeUnmount(() => {
	document.removeEventListener("click", handleDocumentClick);
	document.removeEventListener("keydown", handleDocumentKeyDown);
});
</script>

<template>
	<div ref="rootRef" class="relative inline-block">
		<button
			type="button"
			:aria-expanded="open"
			aria-haspopup="listbox"
			class="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors max-w-full"
			:class="
				hasActiveSelection
					? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
					: 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
			"
			@click="togglePanel"
		>
			<Tag class="h-3.5 w-3.5 shrink-0" />
			<span class="truncate">{{ triggerDisplayValue }}</span>
			<span
				v-if="multiple && selectedValues.length > 0"
				class="shrink-0 rounded-full bg-[var(--accent)] px-1.5 text-[10px] text-white"
			>
				{{ selectedValues.length }}
			</span>
			<ChevronDown
				class="h-3.5 w-3.5 shrink-0 transition-transform"
				:class="{ 'rotate-180': open }"
			/>
		</button>

		<div
			v-if="open"
			class="absolute top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 shadow-xl space-y-2.5"
			:class="align === 'right' ? 'left-0 sm:left-auto sm:right-0' : 'left-0'"
		>
			<!-- Header -->
			<div class="flex items-center justify-between gap-2">
				<span class="text-xs font-semibold text-[var(--text-primary)] truncate">
					{{ panelTitle || label }}
				</span>
				<button
					v-if="hasActiveSelection"
					type="button"
					class="shrink-0 text-[11px] font-medium text-[var(--accent)] hover:underline"
					@click="handleClear"
				>
					清空
				</button>
			</div>

			<!-- Search Box -->
			<div class="relative">
				<Search
					class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"
				/>
				<input
					ref="searchInputRef"
					v-model="searchQuery"
					type="search"
					:placeholder="placeholder"
					:aria-label="placeholder"
					class="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] py-1.5 pl-8 pr-7 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
				/>
				<button
					v-if="searchQuery"
					type="button"
					aria-label="清除搜索词"
					class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
					@click="searchQuery = ''"
				>
					<X class="h-3 w-3" />
				</button>
			</div>

			<!-- Options List -->
			<div
				v-if="loading && options.length === 0"
				class="space-y-1.5 py-1"
			>
				<div
					v-for="idx in 4"
					:key="idx"
					class="h-7 rounded-lg bg-[var(--bg-secondary)] animate-pulse"
				/>
			</div>

			<p
				v-else-if="options.length === 0"
				class="py-4 text-center text-xs text-[var(--text-muted)]"
			>
				{{ emptyText }}
			</p>

			<p
				v-else-if="filteredOptions.length === 0"
				class="py-4 text-center text-xs text-[var(--text-muted)]"
			>
				未找到匹配「{{ searchQuery.trim() }}」的选项
			</p>

			<div
				v-else
				role="listbox"
				:aria-multiselectable="multiple"
				class="max-h-60 space-y-0.5 overflow-y-auto pr-0.5"
			>
				<button
					v-for="opt in filteredOptions"
					:key="opt.value"
					type="button"
					role="option"
					:aria-selected="isOptionSelected(opt.value)"
					class="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors"
					:class="
						isOptionSelected(opt.value)
							? 'bg-[var(--accent-soft)]/70 font-medium text-[var(--accent)]'
							: 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
					"
					@click="handleSelectOption(opt.value)"
				>
					<span
						v-if="multiple"
						class="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors"
						:class="
							isOptionSelected(opt.value)
								? 'border-[var(--accent)] bg-[var(--accent)] text-white'
								: 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-transparent'
						"
					>
						<Check class="h-3 w-3 stroke-[2.5]" />
					</span>
					<span
						v-else
						class="flex h-4 w-4 shrink-0 items-center justify-center"
						:class="
							isOptionSelected(opt.value)
								? 'text-[var(--accent)]'
								: 'text-transparent'
						"
					>
						<Check class="h-3.5 w-3.5 stroke-[2.5]" />
					</span>

					<span class="min-w-0 flex-1 truncate">{{ opt.label }}</span>

					<span
						v-if="opt.count !== undefined"
						class="shrink-0 rounded-md bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
					>
						{{ opt.count }}
					</span>
				</button>
			</div>
		</div>
	</div>
</template>
