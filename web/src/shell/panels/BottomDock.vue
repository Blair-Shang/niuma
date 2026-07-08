<script setup lang="ts">
import { RsIcon } from '@niuma/ui'
import { onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import TransferQueue from '@/modules/ftp/components/TransferQueue.vue'
import { useShellStore } from '@/stores/shell'
import { useTransferHubStore } from '@/stores/transfer-hub'

const { t } = useI18n()
const shellStore = useShellStore()
const transferHub = useTransferHubStore()

let stopDrag: (() => void) | null = null

function beginResize(event: PointerEvent): void {
  event.preventDefault()
  const startY = event.clientY
  const startHeight = shellStore.bottomDockHeight

  const onMove = (ev: PointerEvent): void => {
    shellStore.setBottomDockHeight(startHeight - (ev.clientY - startY))
  }
  const onUp = (): void => {
    globalThis.removeEventListener('pointermove', onMove)
    globalThis.removeEventListener('pointerup', onUp)
    stopDrag = null
    document.body.style.removeProperty('cursor')
  }

  stopDrag = onUp
  document.body.style.cursor = 'row-resize'
  globalThis.addEventListener('pointermove', onMove)
  globalThis.addEventListener('pointerup', onUp)
}

onBeforeUnmount(() => stopDrag?.())
</script>

<template>
  <Teleport to="body">
    <Transition name="nm-dock-slide">
      <section
        v-if="shellStore.bottomDockOpen"
        class="nm-bottom-dock"
        :style="{ height: `${shellStore.bottomDockHeight}px` }"
      >
        <div class="nm-bottom-dock__resizer" @pointerdown="beginResize" />

        <header class="nm-bottom-dock__head">
          <div class="nm-bottom-dock__tabs">
            <button
              type="button"
              class="nm-bottom-dock__tab"
              :class="{ 'nm-bottom-dock__tab--active': shellStore.bottomDockTab === 'transfers' }"
              @click="shellStore.bottomDockTab = 'transfers'"
            >
              {{ t('shell.bottomDock.transfers') }}
              <span
                v-if="transferHub.activeCount > 0"
                class="nm-bottom-dock__badge"
              >
                {{ transferHub.activeCount }}
              </span>
            </button>
          </div>
          <button
            type="button"
            class="nm-bottom-dock__close"
            :aria-label="t('shell.bottomDock.collapse')"
            @click="shellStore.closeBottomDock()"
          >
            <RsIcon name="chevron-down" :size="14" />
          </button>
        </header>

        <div class="nm-bottom-dock__body">
          <TransferQueue
            v-if="shellStore.bottomDockTab === 'transfers'"
            class="nm-bottom-dock__queue"
            hide-header
            :tasks="transferHub.tasks"
            :sessions="transferHub.sessions"
            @cancel="(id) => void transferHub.cancel(id)"
            @pause="(id) => void transferHub.pause(id)"
            @resume="(id) => void transferHub.resume(id)"
          />
        </div>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.nm-bottom-dock {
  position: fixed;
  right: 0;
  bottom: var(--nm-statusbar-h, 1.625rem);
  left: 0;
  z-index: 120;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--rs-border-subtle);
  border-right: none;
  border-left: none;
  background: var(--nm-editor-bg, var(--rs-surface));
  box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.18);
}

/* 滑入/滑出动画 */
.nm-dock-slide-enter-from,
.nm-dock-slide-leave-to {
  transform: translateY(105%);
  opacity: 0;
}

.nm-dock-slide-enter-active,
.nm-dock-slide-leave-active {
  transition:
    transform 0.22s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.18s ease;
}

.nm-bottom-dock__resizer {
  flex-shrink: 0;
  height: 4px;
  cursor: row-resize;
  background: transparent;
  transition: background var(--rs-transition-fast);
}

.nm-bottom-dock__resizer:hover {
  background: var(--rs-primary);
}

.nm-bottom-dock__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  height: 2rem;
  padding: 0 0.25rem 0 0.75rem;
  flex-shrink: 0;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--nm-frame-bg);
}

.nm-bottom-dock__tabs {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  min-width: 0;
}

.nm-bottom-dock__tab {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 1.5rem;
  padding: 0 0.5rem;
  border: none;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.nm-bottom-dock__tab:hover {
  color: var(--rs-text);
  background: var(--rs-item-hover);
}

.nm-bottom-dock__tab--active {
  color: var(--rs-text);
  background: var(--rs-item-hover);
}

.nm-bottom-dock__badge {
  min-width: 1.125rem;
  height: 1.125rem;
  padding: 0 0.3rem;
  border-radius: var(--rs-radius-full);
  background: var(--rs-primary);
  color: var(--rs-primary-foreground);
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1.125rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.nm-bottom-dock__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: none;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-bottom-dock__close:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-bottom-dock__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.nm-bottom-dock__queue {
  height: 100%;
}
</style>
