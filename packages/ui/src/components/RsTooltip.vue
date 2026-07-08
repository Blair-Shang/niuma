<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from './reka'

withDefaults(
  defineProps<{
    content?: string
    side?: 'top' | 'right' | 'bottom' | 'left'
    align?: 'start' | 'center' | 'end'
    sideOffset?: number
    disabled?: boolean
  }>(),
  {
    side: 'top',
    align: 'center',
    sideOffset: 6,
    disabled: false,
  },
)
</script>

<template>
  <TooltipRoot :disabled="disabled">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        class="rs-tooltip__content"
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
.rs-tooltip__content {
  z-index: var(--rs-z-tooltip);
  max-width: 16rem;
  padding: 0.375rem 0.625rem;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface-elevated);
  color: var(--rs-text);
  font-size: var(--rs-font-size-xs);
  line-height: var(--rs-line-height-tight);
  box-shadow: var(--rs-shadow-sm);
}
</style>
