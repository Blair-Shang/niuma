<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from './reka'
import { useRsI18n } from '../composables/useRsI18n'
import RsButton from './RsButton.vue'
import type { RsFeedbackTone } from './overlay-utils'
import { useRsDialogWindow } from './dialog-window'

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    width?: 'sm' | 'md' | 'lg'
    tone?: RsFeedbackTone
    layout?: 'window' | 'confirm'
    draggable?: boolean
    resizable?: boolean
    fullscreenable?: boolean
    /** 是否模态（false 时允许外部交互，适合页签切换等场景） */
    modal?: boolean
    showOverlay?: boolean
    showClose?: boolean
    closeOnOverlayClick?: boolean
    /** DialogPortal 挂载目标（id 选择器或 Element） */
    teleportTo?: string | HTMLElement
    /**
     * 延后挂载 #body 插槽，避免与打开动画/重组件 init 争抢主线程。
     * 默认：window 布局为 true，confirm 为 false。
     */
    deferBodyMount?: boolean
    /** 全屏/还原时是否播放 bounds 过渡（含编辑器时建议保持 false） */
    boundsTransition?: boolean
  }>(),
  {
    width: 'md',
    tone: 'default',
    layout: 'window',
    draggable: false,
    resizable: true,
    fullscreenable: true,
    modal: true,
    showOverlay: false,
    showClose: true,
    closeOnOverlayClick: false,
    boundsTransition: false,
  },
)

const { t } = useRsI18n()
const isWindowLayout = computed(() => props.layout === 'window')
const isConfirmLayout = computed(() => props.layout === 'confirm')
const enableDraggable = computed(() => props.draggable && isWindowLayout.value)
const enableResizable = computed(() => props.resizable && isWindowLayout.value)
const deferBodyMount = computed(() => props.deferBodyMount ?? isWindowLayout.value)

const bodyReady = ref(false)
let bodyMountFrameOuter = 0
let bodyMountFrameInner = 0

function resetBodyMount(): void {
  if (bodyMountFrameOuter) {
    cancelAnimationFrame(bodyMountFrameOuter)
    bodyMountFrameOuter = 0
  }
  if (bodyMountFrameInner) {
    cancelAnimationFrame(bodyMountFrameInner)
    bodyMountFrameInner = 0
  }
  bodyReady.value = false
}

function scheduleBodyMount(): void {
  resetBodyMount()
  bodyMountFrameOuter = requestAnimationFrame(() => {
    bodyMountFrameOuter = 0
    bodyMountFrameInner = requestAnimationFrame(() => {
      bodyMountFrameInner = 0
      if (open.value) bodyReady.value = true
    })
  })
}

watch(
  [open, deferBodyMount],
  ([isOpen, defer]) => {
    if (!isOpen || !defer) {
      resetBodyMount()
      if (isOpen) bodyReady.value = true
      return
    }
    scheduleBodyMount()
  },
  { immediate: true },
)

onBeforeUnmount(resetBodyMount)

const showBodyContent = computed(() => !deferBodyMount.value || bodyReady.value)

/** 非模态窗允许外部交互；模态且不允许点遮罩关闭时拦截 outside。 */
function onPointerDownOutside(event: Event): void {
  if (!props.modal) return
  if (!props.closeOnOverlayClick) event.preventDefault()
}

function onInteractOutside(event: Event): void {
  if (!props.modal) return
  if (!props.closeOnOverlayClick) event.preventDefault()
}

const {
  isFullscreen,
  boundsTransitionEnabled,
  dialogStyle,
  resizeHandles,
  toggleFullscreen,
  onHeaderPointerDown,
  onResizePointerDown,
} = useRsDialogWindow({
  open,
  widthPreset: toRef(props, 'width'),
  draggable: enableDraggable,
  resizable: enableResizable,
  compact: isConfirmLayout,
  boundsTransition: toRef(props, 'boundsTransition'),
})
</script>

<template>
  <DialogRoot v-model:open="open" :modal="modal">
    <DialogPortal :to="teleportTo">
      <DialogOverlay v-if="showOverlay" class="rs-dialog__overlay rs-motion-reduce" />
      <DialogContent
        class="rs-dialog__content rs-motion-reduce"
        :class="[
          `rs-dialog__content--${width}`,
          `rs-dialog__content--${layout}`,
          `rs-dialog__content--tone-${tone}`,
          {
            'rs-dialog__content--fullscreen': isFullscreen,
            'rs-dialog__content--draggable': enableDraggable,
            'rs-dialog__content--bounds-transition': boundsTransitionEnabled,
          },
        ]"
        :style="isWindowLayout ? dialogStyle : undefined"
        @pointer-down-outside="onPointerDownOutside"
        @interact-outside="onInteractOutside"
      >
        <template v-if="enableResizable && !isFullscreen">
          <div
            v-for="handle in resizeHandles"
            :key="handle"
            :class="['rs-dialog__resize-handle', `rs-dialog__resize-handle--${handle}`]"
            :aria-hidden="true"
            @pointerdown.stop="onResizePointerDown(handle, $event)"
          />
        </template>
        <header class="rs-dialog__header" @pointerdown="onHeaderPointerDown">
          <div class="rs-dialog__heading">
            <DialogTitle class="rs-dialog__title">{{ title }}</DialogTitle>
            <DialogDescription
              class="rs-dialog__description"
              :class="{ 'rs-dialog__description--sr-only': !description }"
            >
              {{ description || title }}
            </DialogDescription>
          </div>
          <div class="rs-dialog__actions">
            <RsButton
              v-if="fullscreenable && isWindowLayout"
              variant="ghost"
              size="sm"
              :icon="isFullscreen ? 'minimize-2' : 'maximize-2'"
              :tooltip="isFullscreen ? t('dialog.restore') : t('dialog.fullscreen')"
              @click="toggleFullscreen"
            />
            <RsButton
              v-if="showClose"
              variant="ghost"
              size="sm"
              icon="x"
              :tooltip="t('dialog.close')"
              @click="open = false"
            />
          </div>
        </header>
        <div class="rs-dialog__body" :aria-busy="deferBodyMount && !bodyReady ? 'true' : undefined">
          <slot v-if="showBodyContent" name="body" />
          <div v-else class="rs-dialog__body-placeholder">
            <slot name="body-placeholder" />
          </div>
        </div>
        <footer v-if="$slots.footer" class="rs-dialog__footer">
          <slot name="footer" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.rs-dialog__overlay {
  position: fixed;
  inset: 0;
  z-index: var(--rs-z-modal);
  background: var(--rs-dialog-overlay-bg);
  backdrop-filter: blur(var(--rs-dialog-overlay-blur)) saturate(120%);
  -webkit-backdrop-filter: blur(var(--rs-dialog-overlay-blur)) saturate(120%);
}
.rs-dialog__overlay[data-state='open'] {
  animation: rs-dialog-overlay-in 220ms ease;
}
.rs-dialog__overlay[data-state='closed'] {
  animation: rs-dialog-overlay-out 160ms ease;
}
.rs-dialog__content {
  position: fixed;
  left: 50%;
  top: calc(
    var(--rs-dialog-inset-top, 1rem) +
      (100vh - var(--rs-dialog-inset-top, 1rem) - var(--rs-dialog-inset-bottom, 1rem)) / 2
  );
  z-index: calc(var(--rs-z-modal) + 1);
  display: flex;
  max-height: min(
    calc(100vh - var(--rs-dialog-inset-top, 1rem) - var(--rs-dialog-inset-bottom, 1rem) - 2rem),
    40rem
  );
  width: calc(100vw - 2 * var(--rs-dialog-inset-x, 1rem));
  max-width: calc(100vw - 2 * var(--rs-dialog-inset-x, 1rem));
  flex-direction: column;
  transform: translate(-50%, -50%);
  overflow: hidden;
  border-radius: var(--rs-radius-lg);
  border: 1px solid var(--rs-dialog-border);
  background: var(--rs-dialog-header-bg);
  box-shadow: var(--rs-dialog-shadow);
  outline: none;
}

/* 亮色 confirm：轻微 vibrancy；window 用实底避免 CEF 下 blur 合成开销 */
[data-rs-theme='light'] .rs-dialog__content--confirm {
  background: color-mix(in srgb, var(--rs-dialog-bg) 94%, transparent);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
}
[data-rs-theme='light'] .rs-dialog__content--window {
  background: var(--rs-dialog-bg);
}
/* confirm 布局：缩放 + 淡入（居中，含 translate）；苹果 sheet 缓动曲线 */
.rs-dialog__content--confirm[data-state='open'] {
  animation: rs-dialog-pop-in 240ms cubic-bezier(0.32, 0.72, 0, 1);
}
.rs-dialog__content--confirm[data-state='closed'] {
  animation: rs-dialog-pop-out 180ms ease;
}
/* window 布局：位置由拖拽内联样式控制，仅淡入避免与 transform 冲突 */
.rs-dialog__content--window[data-state='open'] {
  animation: rs-dialog-fade-in 220ms ease;
}
.rs-dialog__content--window[data-state='closed'] {
  animation: rs-dialog-fade-out 150ms ease;
}
@keyframes rs-dialog-overlay-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes rs-dialog-overlay-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
@keyframes rs-dialog-pop-in {
  from {
    opacity: 0;
    transform: translate(-50%, -46%) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}
@keyframes rs-dialog-pop-out {
  from {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  to {
    opacity: 0;
    transform: translate(-50%, -47%) scale(0.97);
  }
}
@keyframes rs-dialog-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes rs-dialog-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
.rs-dialog__content--window {
  left: 50%;
  top: 50%;
  max-width: none;
  max-height: none;
  transform: none;
}
.rs-dialog__content--window.rs-dialog__content--bounds-transition {
  transition:
    left 220ms cubic-bezier(0.32, 0.72, 0, 1),
    top 220ms cubic-bezier(0.32, 0.72, 0, 1),
    width 220ms cubic-bezier(0.32, 0.72, 0, 1),
    height 220ms cubic-bezier(0.32, 0.72, 0, 1),
    border-radius 220ms cubic-bezier(0.32, 0.72, 0, 1);
}
.rs-dialog__content--sm {
  max-width: 24rem;
}
.rs-dialog__content--md {
  max-width: 32rem;
}
.rs-dialog__content--lg {
  max-width: 42rem;
}
.rs-dialog__content--window.rs-dialog__content--sm,
.rs-dialog__content--window.rs-dialog__content--md,
.rs-dialog__content--window.rs-dialog__content--lg {
  max-width: none;
}
.rs-dialog__content--fullscreen {
  border-radius: var(--rs-radius);
}
.rs-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-shrink: 0;
  padding: 0.625rem 0.75rem 0.625rem 1.25rem;
  background: var(--rs-dialog-header-bg);
  border-bottom: 1px solid var(--rs-dialog-separator);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05);
}
.rs-dialog__content--window.rs-dialog__content--draggable .rs-dialog__header {
  cursor: grab;
  user-select: none;
}
.rs-dialog__title {
  margin: 0;
  font-size: var(--rs-font-size-base);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--rs-dialog-title-fg);
}
.rs-dialog__description {
  margin: 0.25rem 0 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-dialog-description-fg);
  line-height: var(--rs-line-height-normal);
}
.rs-dialog__description--sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.rs-dialog__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1.25rem;
  background: var(--rs-dialog-body-bg);
}
.rs-dialog__content--window .rs-dialog__body {
  display: flex;
  flex-direction: column;
}
.rs-dialog__body-placeholder {
  flex: 1;
  min-height: 0;
}
.rs-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-shrink: 0;
  padding: 0.75rem 1.25rem;
  background: var(--rs-dialog-footer-bg);
  border-top: 1px solid var(--rs-dialog-separator);
}
[data-rs-theme='light'] .rs-dialog__header {
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.75);
}
.rs-dialog__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs);
}
.rs-dialog__resize-handle {
  position: absolute;
  z-index: 2;
}
.rs-dialog__resize-handle--n,
.rs-dialog__resize-handle--s {
  left: 0.5rem;
  right: 0.5rem;
  height: 0.5rem;
  cursor: ns-resize;
}
.rs-dialog__resize-handle--n {
  top: -0.25rem;
}
.rs-dialog__resize-handle--s {
  bottom: -0.25rem;
}
.rs-dialog__resize-handle--e,
.rs-dialog__resize-handle--w {
  top: 0.5rem;
  bottom: 0.5rem;
  width: 0.5rem;
  cursor: ew-resize;
}
.rs-dialog__resize-handle--e {
  right: -0.25rem;
}
.rs-dialog__resize-handle--w {
  left: -0.25rem;
}
.rs-dialog__resize-handle--ne,
.rs-dialog__resize-handle--nw,
.rs-dialog__resize-handle--se,
.rs-dialog__resize-handle--sw {
  width: 0.75rem;
  height: 0.75rem;
}
.rs-dialog__resize-handle--ne {
  top: -0.25rem;
  right: -0.25rem;
  cursor: nesw-resize;
}
.rs-dialog__resize-handle--nw {
  top: -0.25rem;
  left: -0.25rem;
  cursor: nwse-resize;
}
.rs-dialog__resize-handle--se {
  right: -0.25rem;
  bottom: -0.25rem;
  cursor: nwse-resize;
}
.rs-dialog__resize-handle--sw {
  left: -0.25rem;
  bottom: -0.25rem;
  cursor: nesw-resize;
}
</style>
