<script setup lang="ts">
/**
 * 选项芯片 / 勾选行：用于对象类型、导入选项等。
 * variant=chip 适合「表 / 视图」多选；option 适合普通开关。
 */
withDefaults(
  defineProps<{
    label: string
    hint?: string
    disabled?: boolean
    variant?: 'chip' | 'option'
  }>(),
  {
    hint: '',
    disabled: false,
    variant: 'option',
  },
)

const model = defineModel<boolean>({ required: true })
</script>

<template>
  <label
    class="nm-dt-check"
    :class="variant === 'chip' ? 'nm-dt-check--chip' : 'nm-dt-check--option'"
  >
    <input v-model="model" type="checkbox" :disabled="disabled" />
    <span class="nm-dt-check__text">
      {{ label }}
      <span v-if="hint" class="nm-dt-check__hint">{{ hint }}</span>
    </span>
  </label>
</template>

<style scoped>
.nm-dt-check {
  display: inline-flex;
  align-items: flex-start;
  gap: 8px;
  font-size: var(--rs-font-size-xs, 12px);
  line-height: 1.4;
  color: var(--rs-text);
  cursor: pointer;
  user-select: none;
}

.nm-dt-check input {
  margin: 2px 0 0;
  accent-color: var(--rs-primary);
  flex: 0 0 auto;
}

.nm-dt-check:has(input:disabled) {
  opacity: 0.55;
  cursor: not-allowed;
}

.nm-dt-check--chip {
  align-items: center;
  padding: 5px 10px;
  border-radius: var(--rs-radius-sm, 6px);
  border: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-elevated);
  transition:
    border-color var(--rs-transition-fast, 120ms),
    background var(--rs-transition-fast, 120ms);
}

.nm-dt-check--chip:has(input:checked) {
  border-color: color-mix(in srgb, var(--rs-primary) 45%, var(--rs-border-subtle));
  background: color-mix(in srgb, var(--rs-primary) 12%, var(--rs-surface));
}

.nm-dt-check--chip input {
  margin: 0;
}

.nm-dt-check__hint {
  display: block;
  margin-top: 2px;
  color: var(--rs-muted);
  font-weight: 400;
}
</style>
