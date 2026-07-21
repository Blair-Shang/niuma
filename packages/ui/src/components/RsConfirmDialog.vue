<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from './reka'
import RsButton from './RsButton.vue'
import { useRsI18n } from '../composables/useRsI18n'
import type { RsFeedbackTone } from './overlay-utils'

const open = defineModel<boolean>('open', { default: false })

withDefaults(
  defineProps<{
    title?: string
    description?: string
    tone?: RsFeedbackTone
    confirmText?: string
    cancelText?: string
    confirmVariant?: 'primary' | 'danger'
    showOverlay?: boolean
    /** AlertDialogPortal 挂载目标（id 选择器或 Element） */
    teleportTo?: string | HTMLElement
  }>(),
  {
    tone: 'danger',
    confirmVariant: 'danger',
    showOverlay: false,
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useRsI18n()

function onConfirm(): void {
  emit('confirm')
  open.value = false
}

function onCancel(): void {
  emit('cancel')
}
</script>

<template>
  <AlertDialogRoot v-model:open="open">
    <AlertDialogPortal :to="teleportTo">
      <AlertDialogOverlay v-if="showOverlay" class="rs-confirm-dialog__overlay" />
      <AlertDialogContent
        class="rs-confirm-dialog__content"
        :disable-outside-pointer-events="true"
      >
        <div class="rs-confirm-dialog__icon" :class="`rs-confirm-dialog__icon--${tone}`">
          !
        </div>
        <div class="rs-confirm-dialog__main">
          <AlertDialogTitle class="rs-confirm-dialog__title">
            {{ title ?? t('confirm.title') }}
          </AlertDialogTitle>
          <AlertDialogDescription class="rs-confirm-dialog__description">
            {{ description ?? t('confirm.description') }}
          </AlertDialogDescription>
          <footer class="rs-confirm-dialog__footer">
            <AlertDialogCancel as-child>
              <RsButton variant="default" @click="onCancel">
                {{ cancelText ?? t('common.cancel') }}
              </RsButton>
            </AlertDialogCancel>
            <AlertDialogAction as-child>
              <RsButton :variant="confirmVariant" @click="onConfirm">
                {{ confirmText ?? t('common.confirm') }}
              </RsButton>
            </AlertDialogAction>
          </footer>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style>
.rs-confirm-dialog__overlay {
  position: fixed;
  inset: 0;
  z-index: var(--rs-z-modal);
  background: var(--rs-dialog-overlay-bg);
  backdrop-filter: blur(var(--rs-dialog-overlay-blur)) saturate(120%);
  -webkit-backdrop-filter: blur(var(--rs-dialog-overlay-blur)) saturate(120%);
}
.rs-confirm-dialog__content {
  position: fixed;
  left: 50%;
  top: calc(
    var(--rs-dialog-inset-top, 1rem) +
      (100vh - var(--rs-dialog-inset-top, 1rem) - var(--rs-dialog-inset-bottom, 1rem)) / 2
  );
  z-index: calc(var(--rs-z-modal) + 1);
  display: flex;
  gap: var(--rs-space-lg);
  width: calc(100vw - 2 * var(--rs-dialog-inset-x, 1rem));
  max-width: 28rem;
  transform: translate(-50%, -50%);
  box-sizing: border-box;
  padding: var(--rs-space-xl);
  border: 1px solid var(--rs-dialog-border);
  border-radius: var(--rs-radius-lg);
  background: var(--rs-dialog-body-bg);
  color: var(--rs-text);
  box-shadow: var(--rs-dialog-shadow);
  outline: none;
}
[data-rs-theme='light'] .rs-confirm-dialog__content {
  background: color-mix(in srgb, var(--rs-dialog-bg) 94%, transparent);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
}
.rs-confirm-dialog__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  flex: 0 0 auto;
  border-radius: var(--rs-radius);
  font-weight: 700;
}
.rs-confirm-dialog__icon--danger {
  background: var(--rs-danger-container);
  color: var(--rs-on-danger-container);
}
.rs-confirm-dialog__icon--warning {
  background: var(--rs-warning-container);
  color: var(--rs-on-warning-container);
}
.rs-confirm-dialog__icon--success {
  background: var(--rs-success-container);
  color: var(--rs-on-success-container);
}
.rs-confirm-dialog__icon--info,
.rs-confirm-dialog__icon--default {
  background: var(--rs-info-container);
  color: var(--rs-on-info-container);
}
.rs-confirm-dialog__main {
  min-width: 0;
  flex: 1;
}
.rs-confirm-dialog__title {
  margin: 0;
  font-size: var(--rs-font-size-base);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--rs-dialog-title-fg);
}
.rs-confirm-dialog__description {
  margin: var(--rs-space-sm) 0 0;
  color: var(--rs-dialog-description-fg);
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-normal);
}
.rs-confirm-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--rs-space-sm);
  margin-top: var(--rs-space-xl);
  padding-top: var(--rs-space-lg);
  border-top: 1px solid var(--rs-dialog-separator);
}
</style>
