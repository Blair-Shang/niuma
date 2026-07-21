<script setup lang="ts">
import { computed, useSlots } from 'vue'
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from './reka'
import RsIcon from './RsIcon.vue'

const props = withDefaults(
  defineProps<{
    content?: string
    side?: 'top' | 'right' | 'bottom' | 'left'
    align?: 'start' | 'center' | 'end'
    sideOffset?: number
    disabled?: boolean
    /** 单行展示并按内容撑开宽度（适合集合名等标识符） */
    nowrap?: boolean
    /**
     * 业界表单帮助模式：标签后跟小图标，仅图标悬停出提示
     *（对齐 Ant Design Form.Item `tooltip` / Element Plus 问号说明）。
     */
    icon?: boolean
    /** 后缀图标名，默认 info（问号/说明圆标；对齐表单帮助惯用） */
    iconName?: string
  }>(),
  {
    side: 'top',
    align: 'center',
    sideOffset: 6,
    disabled: false,
    nowrap: false,
    icon: false,
    iconName: 'info',
  },
)

const slots = useSlots()
const hasLabelSlot = computed(() => Boolean(slots.default))
const iconAriaLabel = computed(() => props.content?.trim() || 'Help')
</script>

<template>
  <TooltipRoot :disabled="disabled">
    <template v-if="icon">
      <span class="rs-tooltip__with-icon">
        <span v-if="hasLabelSlot" class="rs-tooltip__label">
          <slot />
        </span>
        <TooltipTrigger as-child>
          <button
            type="button"
            class="rs-tooltip__icon-trigger"
            :aria-label="iconAriaLabel"
          >
            <RsIcon :name="iconName" :size="12" />
          </button>
        </TooltipTrigger>
      </span>
    </template>
    <TooltipTrigger v-else as-child>
      <slot />
    </TooltipTrigger>

    <TooltipPortal>
      <TooltipContent
        class="rs-tooltip__content"
        :class="{ 'rs-tooltip__content--nowrap': nowrap }"
        :side="side"
        :align="align"
        :side-offset="sideOffset"
      >
        <slot name="content">
          {{ content }}
        </slot>
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>

<style>
.rs-tooltip__with-icon {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 100%;
  vertical-align: baseline;
}

.rs-tooltip__label {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
}

.rs-tooltip__icon-trigger {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--rs-muted);
  cursor: help;
  line-height: 0;
  border-radius: var(--rs-radius-full);
}

.rs-tooltip__icon-trigger:hover,
.rs-tooltip__icon-trigger:focus-visible {
  color: var(--rs-text);
}

.rs-tooltip__icon-trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

/* 提到 modal 之上：Dialog 内悬浮时否则会被遮挡（portal 挂 body） */
.rs-tooltip__content {
  z-index: calc(var(--rs-z-modal) + 2);
  width: max-content;
  max-width: min(20rem, 90vw);
  padding: 0.375rem 0.625rem;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface-elevated);
  color: var(--rs-text);
  font-size: var(--rs-font-size-xs);
  line-height: var(--rs-line-height-tight);
  box-shadow: var(--rs-shadow-sm);
  overflow: hidden;
  overflow-wrap: break-word;
}

[data-reka-popper-content-wrapper]:has(> .rs-tooltip__content) {
  z-index: calc(var(--rs-z-modal) + 2);
}

.rs-tooltip__content--nowrap {
  max-width: min(48rem, 90vw);
  white-space: nowrap;
}
</style>
