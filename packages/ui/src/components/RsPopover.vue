<script setup lang="ts">
import { computed } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from './reka'
import type { RsPopoverAlign, RsPopoverSide, RsPopoverWidth } from './popover-utils'

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    side?: RsPopoverSide
    align?: RsPopoverAlign
    sideOffset?: number
    modal?: boolean
    width?: RsPopoverWidth
    lazyMount?: boolean
    forceMount?: boolean
  }>(),
  {
    side: 'bottom',
    align: 'start',
    sideOffset: 6,
    modal: false,
    width: 'md',
    lazyMount: true,
    forceMount: false,
  },
)

const contentForceMount = computed(() => props.forceMount || !props.lazyMount)
const portalMounted = computed(() => props.forceMount || !props.lazyMount || open.value)
</script>

<template>
  <PopoverRoot v-model:open="open" :modal="modal">
    <PopoverTrigger as-child>
      <slot />
    </PopoverTrigger>
    <PopoverPortal v-if="portalMounted">
      <PopoverContent
        class="rs-popover__content"
        :class="`rs-popover__content--${width}`"
        :side="side"
        :align="align"
        :side-offset="sideOffset"
        :force-mount="contentForceMount"
      >
        <slot name="content" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style>
.rs-popover__content {
  z-index: var(--rs-z-dropdown);
  padding: 0.75rem;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface-elevated);
  box-shadow: var(--rs-shadow);
  outline: none;
}
.rs-popover__content--sm {
  width: 12rem;
}
.rs-popover__content--md {
  width: 16rem;
}
.rs-popover__content--lg {
  width: 22rem;
}
.rs-popover__content--auto {
  width: auto;
  min-width: 10rem;
}
</style>
