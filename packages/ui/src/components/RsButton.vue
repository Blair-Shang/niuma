<script setup lang="ts">
import { computed, nextTick, ref, useSlots, watch } from 'vue'
import type { RsComponentSize } from '../theme/types'
import RsIcon from './RsIcon.vue'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'default' | 'secondary' | 'ghost' | 'danger' | 'link'
    size?: RsComponentSize
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    loading?: boolean
    /** 前缀图标（Lucide kebab-case 名称） */
    icon?: string
    iconSize?: number
    /** 仅显示图标，文字通过 tooltip / slot 悬浮展示 */
    iconOnly?: boolean
    /** 悬浮提示文案 */
    tooltip?: string
    /** 默认收起文字，悬浮时展开（需配合 slot 文案） */
    revealLabel?: boolean
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
    disabled: false,
    loading: false,
    iconSize: 16,
    iconOnly: false,
    revealLabel: false,
  },
)

const slots = useSlots()
const btnRef = ref<HTMLButtonElement | null>(null)

const hasLabel = computed(() => Boolean(slots.default))

const resolvedVariant = computed(() => (props.variant === 'secondary' ? 'default' : props.variant))

const showFloatingText = computed(() => props.iconOnly || Boolean(props.tooltip))

const ariaLabel = computed(() => {
  if (!props.iconOnly) return undefined
  return props.tooltip || undefined
})

/** tooltip 水平对齐方式：center / left / right */
const tooltipAlign = ref<'center' | 'left' | 'right'>('center')

function updateTooltipAlign(): void {
  const el = btnRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const mid = rect.left + rect.width / 2
  const vw = window.innerWidth
  if (mid > vw * 0.72) {
    tooltipAlign.value = 'right'
  } else if (mid < vw * 0.28) {
    tooltipAlign.value = 'left'
  } else {
    tooltipAlign.value = 'center'
  }
}

watch(
  () => props.loading,
  async (loading) => {
    const el = btnRef.value
    if (!el) return
    if (loading) {
      await nextTick()
      const w = el.offsetWidth
      if (w > 0) {
        el.style.minWidth = `${w}px`
      }
    } else {
      el.style.minWidth = ''
    }
  },
)
</script>

<template>
  <button
    ref="btnRef"
    :type="type"
    :disabled="disabled"
    class="rs-btn"
    :class="{
      [`rs-btn--${resolvedVariant}`]: true,
      [`rs-btn--${size}`]: true,
      'rs-btn--icon-only': iconOnly,
      'rs-btn--reveal-label': revealLabel && icon && hasLabel,
      'rs-btn--loading': loading,
    }"
    :aria-busy="loading || undefined"
    :aria-disabled="disabled || loading || undefined"
    :aria-label="ariaLabel"
    @mouseenter="updateTooltipAlign"
  >
    <span v-if="loading" class="rs-btn__spinner" aria-hidden="true">
      <span class="rs-btn__spinner-ring" />
    </span>
    <RsIcon
      v-if="icon && !loading"
      class="rs-btn__icon"
      :name="icon"
      :size="iconSize"
      :label="iconOnly && tooltip ? tooltip : undefined"
    />
    <span
      v-if="hasLabel && !iconOnly"
      class="rs-btn__label"
      :class="{ 'rs-btn__label--reveal': revealLabel && icon }"
    >
      <slot />
    </span>
    <span
      v-if="showFloatingText"
      class="rs-btn__tooltip"
      :class="`rs-btn__tooltip--${tooltipAlign}`"
      role="tooltip"
    >
      <template v-if="tooltip">{{ tooltip }}</template>
      <slot v-else-if="iconOnly" />
    </span>
  </button>
</template>

<style scoped>
.rs-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--rs-space-sm);
  min-height: var(--rs-control-height-md);
  padding: 0 var(--rs-space-lg);
  border-radius: var(--rs-radius-full);
  border: 1px solid transparent;
  font-size: var(--rs-font-size-sm);
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: var(--rs-line-height-tight);
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    border-color var(--rs-transition-fast),
    color var(--rs-transition-fast),
    box-shadow var(--rs-transition-fast),
    padding var(--rs-transition-normal),
    gap var(--rs-transition-normal);
}
.rs-btn--sm {
  min-height: var(--rs-control-height-sm);
  padding: 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
  gap: var(--rs-space-xs);
}
.rs-btn--lg {
  min-height: var(--rs-control-height-lg);
  padding: 0 var(--rs-space-xl);
  font-size: var(--rs-font-size-base);
}
.rs-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.rs-btn--loading {
  pointer-events: none;
  cursor: wait;
  transition: none;
}
/* loading 时不使用 disabled，避免部分浏览器暂停子元素 CSS 动画 */
.rs-btn--loading:disabled {
  opacity: 1;
  cursor: wait;
}
.rs-btn--loading.rs-btn--default {
  color: var(--rs-text);
  border-color: var(--rs-border);
  background: var(--rs-surface);
}
.rs-btn--loading.rs-btn--ghost {
  color: var(--rs-text);
  background: var(--rs-surface-hover);
}
.rs-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
.rs-btn--icon-only {
  padding: 0;
  min-width: var(--rs-control-height-md);
}
.rs-btn--icon-only.rs-btn--sm {
  min-width: var(--rs-control-height-sm);
}
.rs-btn--icon-only.rs-btn--lg {
  min-width: var(--rs-control-height-lg);
}
.rs-btn--primary {
  background: var(--rs-primary);
  color: var(--rs-primary-foreground);
  box-shadow: var(--rs-shadow-sm);
}
.rs-btn--primary:hover:not(:disabled) {
  background: var(--rs-primary-hover);
  box-shadow: var(--rs-shadow);
}
.rs-btn--primary:active:not(:disabled) {
  box-shadow: none;
}
.rs-btn--default {
  background: var(--rs-surface);
  border-color: var(--rs-border);
  color: var(--rs-text);
  box-shadow: var(--rs-shadow-sm);
}
.rs-btn--default:hover:not(:disabled) {
  color: var(--rs-primary);
  border-color: var(--rs-primary);
}
.rs-btn--default:active:not(:disabled) {
  color: var(--rs-primary-hover);
  border-color: var(--rs-primary-hover);
}
.rs-btn--ghost {
  background: transparent;
  border-color: var(--rs-border);
  color: var(--rs-text);
}
.rs-btn--ghost:hover:not(:disabled) {
  background: var(--rs-surface-hover);
  border-color: var(--rs-border);
}
.rs-btn--danger {
  background: var(--rs-danger-container);
  border-color: color-mix(in srgb, var(--rs-danger) 30%, transparent);
  color: var(--rs-on-danger-container);
}
.rs-btn--danger:hover:not(:disabled) {
  border-color: var(--rs-danger);
  background: color-mix(in srgb, var(--rs-danger) 20%, var(--rs-danger-container));
}
.rs-btn--link {
  min-height: auto;
  padding: 0;
  border-color: transparent;
  border-radius: 0;
  background: transparent;
  color: var(--rs-primary);
  box-shadow: none;
}
.rs-btn--link:hover:not(:disabled) {
  color: var(--rs-primary-hover);
  text-decoration: underline;
}
.rs-btn__spinner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  pointer-events: none;
}
.rs-btn__spinner-ring {
  display: block;
  width: 100%;
  height: 100%;
  border: 2px solid color-mix(in srgb, var(--rs-primary) 28%, transparent);
  border-top-color: var(--rs-primary);
  border-radius: var(--rs-radius-full);
  transform-origin: center center;
  animation: rs-spin 0.75s linear infinite;
}
.rs-btn--default .rs-btn__spinner-ring,
.rs-btn--ghost .rs-btn__spinner-ring {
  border-color: color-mix(in srgb, var(--rs-primary) 28%, transparent);
  border-top-color: var(--rs-primary);
}
.rs-btn--primary .rs-btn__spinner-ring {
  border-color: color-mix(in srgb, currentcolor 35%, transparent);
  border-top-color: currentcolor;
}
.rs-btn--danger .rs-btn__spinner-ring {
  border-color: color-mix(in srgb, var(--rs-danger) 28%, transparent);
  border-top-color: var(--rs-danger);
}
.rs-btn__icon {
  flex-shrink: 0;
}
.rs-btn__label--reveal {
  display: inline-block;
  max-width: 0;
  opacity: 0;
  overflow: hidden;
  white-space: nowrap;
  vertical-align: bottom;
  transition:
    max-width 0.2s ease,
    opacity 0.15s ease;
}
.rs-btn--reveal-label:hover:not(:disabled) .rs-btn__label--reveal,
.rs-btn--reveal-label:focus-visible .rs-btn__label--reveal {
  max-width: 12rem;
  opacity: 1;
}
.rs-btn__tooltip {
  position: absolute;
  left: 50%;
  top: calc(100% + 0.375rem);
  transform: translateX(-50%) translateY(-2px);
  padding: 0.25rem 0.5rem;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface-elevated);
  color: var(--rs-text);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  line-height: 1.25rem;
  white-space: nowrap;
  box-shadow: var(--rs-shadow-sm);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
  z-index: var(--rs-z-tooltip);
}
/* 靠左边的按钮：tooltip 左对齐 */
.rs-btn__tooltip--left {
  left: 0;
  transform: translateY(-2px);
}
/* 靠右边的按钮：tooltip 右对齐 */
.rs-btn__tooltip--right {
  left: auto;
  right: 0;
  transform: translateY(-2px);
}
.rs-btn:hover:not(:disabled) .rs-btn__tooltip,
.rs-btn:focus-visible .rs-btn__tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.rs-btn:hover:not(:disabled) .rs-btn__tooltip--left,
.rs-btn:focus-visible .rs-btn__tooltip--left {
  transform: translateY(0);
}
.rs-btn:hover:not(:disabled) .rs-btn__tooltip--right,
.rs-btn:focus-visible .rs-btn__tooltip--right {
  transform: translateY(0);
}
@keyframes rs-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
