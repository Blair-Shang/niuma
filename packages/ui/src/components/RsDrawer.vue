<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from './reka'
import RsButton from './RsButton.vue'
import { useRsI18n } from '../composables/useRsI18n'

export type RsDrawerSide = 'left' | 'right' | 'top' | 'bottom'
export type RsDrawerSize = 'sm' | 'md' | 'lg' | 'full'

const open = defineModel<boolean>('open', { default: false })

withDefaults(
  defineProps<{
    title?: string
    description?: string
    side?: RsDrawerSide
    size?: RsDrawerSize
    showOverlay?: boolean
    showClose?: boolean
    closeOnOverlayClick?: boolean
  }>(),
  {
    side: 'right',
    size: 'md',
    showOverlay: true,
    showClose: true,
    closeOnOverlayClick: true,
  },
)

const { t } = useRsI18n()
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay v-if="showOverlay" class="rs-drawer__overlay" />
      <DialogContent
        class="rs-drawer__content"
        :class="[`rs-drawer__content--${side}`, `rs-drawer__content--${size}`]"
        @pointer-down-outside="closeOnOverlayClick ? undefined : $event.preventDefault()"
      >
        <header v-if="title || description || showClose || $slots.header" class="rs-drawer__header">
          <slot name="header">
            <div class="rs-drawer__heading">
              <DialogTitle v-if="title" class="rs-drawer__title">{{ title }}</DialogTitle>
              <DialogDescription v-if="description" class="rs-drawer__description">
                {{ description }}
              </DialogDescription>
            </div>
          </slot>
          <DialogClose v-if="showClose" as-child>
            <RsButton variant="ghost" size="sm" icon="x" :tooltip="t('dialog.close')" />
          </DialogClose>
        </header>
        <div class="rs-drawer__body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="rs-drawer__footer">
          <slot name="footer" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.rs-drawer__overlay {
  position: fixed;
  inset: 0;
  z-index: var(--rs-z-modal);
  background: rgb(0 0 0 / 0.45);
  backdrop-filter: blur(4px);
}
.rs-drawer__content {
  position: fixed;
  z-index: calc(var(--rs-z-modal) + 1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  border: 1px solid var(--rs-border);
  background: var(--rs-surface-elevated);
  color: var(--rs-text);
  box-shadow: var(--rs-shadow-lg);
  outline: none;
}
.rs-drawer__content--right,
.rs-drawer__content--left {
  top: 0;
  bottom: 0;
  width: min(100vw, 28rem);
}
.rs-drawer__content--right {
  right: 0;
  border-right: 0;
  border-radius: var(--rs-radius) 0 0 var(--rs-radius);
}
.rs-drawer__content--left {
  left: 0;
  border-left: 0;
  border-radius: 0 var(--rs-radius) var(--rs-radius) 0;
}
.rs-drawer__content--top,
.rs-drawer__content--bottom {
  left: 0;
  right: 0;
  height: min(100vh, 22rem);
}
.rs-drawer__content--top {
  top: 0;
  border-top: 0;
  border-radius: 0 0 var(--rs-radius) var(--rs-radius);
}
.rs-drawer__content--bottom {
  bottom: 0;
  border-bottom: 0;
  border-radius: var(--rs-radius) var(--rs-radius) 0 0;
}
.rs-drawer__content--sm:is(.rs-drawer__content--left, .rs-drawer__content--right) {
  width: min(100vw, 20rem);
}
.rs-drawer__content--lg:is(.rs-drawer__content--left, .rs-drawer__content--right) {
  width: min(100vw, 36rem);
}
.rs-drawer__content--full:is(.rs-drawer__content--left, .rs-drawer__content--right) {
  width: 100vw;
}
.rs-drawer__content--sm:is(.rs-drawer__content--top, .rs-drawer__content--bottom) {
  height: min(100vh, 16rem);
}
.rs-drawer__content--lg:is(.rs-drawer__content--top, .rs-drawer__content--bottom) {
  height: min(100vh, 32rem);
}
.rs-drawer__content--full:is(.rs-drawer__content--top, .rs-drawer__content--bottom) {
  height: 100vh;
}
.rs-drawer__header,
.rs-drawer__footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
  padding: var(--rs-space-lg) var(--rs-space-xl);
  border-bottom: 1px solid var(--rs-border-subtle);
}
.rs-drawer__footer {
  justify-content: flex-end;
  border-top: 1px solid var(--rs-border-subtle);
  border-bottom: 0;
}
.rs-drawer__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--rs-space-xl);
}
.rs-drawer__title {
  margin: 0;
  font-size: var(--rs-font-size-base);
  font-weight: 600;
}
.rs-drawer__description {
  margin: var(--rs-space-xs) 0 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
}
</style>
