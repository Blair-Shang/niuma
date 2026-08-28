<script setup lang="ts">
import { RsConfigProvider, RsToaster, RsTooltipProvider, useRsToast } from '@niuma/ui'
import { useAppStore } from '@/stores/app'
import { useSessionRegistry } from '@/stores/session-registry'
import { SESSION_POLICY } from '@/modules/connection/session-policy'
import type { ConnKind } from '@/modules/ops/types'
import { subscribeBridgeEvent } from '@/api/event-bus'
import { useI18n } from 'vue-i18n'
import { onBeforeUnmount, onMounted, watch } from 'vue'

const appStore = useAppStore()
const { locale, t } = useI18n()
const toast = useRsToast()
const sessionRegistry = useSessionRegistry()

watch(
  () => appStore.locale,
  (v) => {
    locale.value = v
    if (typeof document !== 'undefined') {
      document.documentElement.lang = v
    }
  },
  { immediate: true },
)

function isConnKind(value: string): value is ConnKind {
  return Object.prototype.hasOwnProperty.call(SESSION_POLICY, value)
}

function namespaceLabel(ns: string): string {
  const key = `nav.${ns}`
  const label = t(key)
  return label === key ? ns : label
}

function onServiceLost(detail: unknown): void {
  if (typeof detail !== 'object' || detail === null || !('type' in detail)) {
    return
  }
  const ev = detail as Record<string, unknown>
  const type = typeof ev.type === 'string' ? ev.type : ''
  if (type === 'platform.service.state' && ev.state === 'lost') {
    const ns = typeof ev.namespace === 'string' ? ev.namespace : ''
    if (!ns || !isConnKind(ns)) {
      return
    }
    void sessionRegistry.markKindLost(ns).then((count) => {
      if (count > 0) {
        toast.warning(t('common.serviceExited', { name: namespaceLabel(ns) }))
      }
    })
    return
  }
  if (type.endsWith('.session.state') && ev.state === 'lost') {
    const ns = type.slice(0, -'.session.state'.length)
    if (!ns || !isConnKind(ns)) {
      return
    }
    const sessionId = typeof ev.sessionId === 'string' ? ev.sessionId : ''
    if (sessionId === '*') {
      void sessionRegistry.markKindLost(ns).then((count) => {
        if (count > 0) {
          toast.warning(t('common.serviceExited', { name: namespaceLabel(ns) }))
        }
      })
      return
    }
    if (!sessionId) {
      return
    }
    void sessionRegistry.markSessionLost(ns, sessionId).then((count) => {
      if (count > 0) {
        toast.warning(t('common.sessionLost', { name: namespaceLabel(ns) }))
      }
    })
  }
}

let offLost: (() => void) | undefined
onMounted(() => {
  offLost = subscribeBridgeEvent(onServiceLost)
})
onBeforeUnmount(() => {
  offLost?.()
})
</script>

<template>
  <RsConfigProvider :theme="appStore.theme" :locale="appStore.locale" class="nm-root">
    <RsTooltipProvider>
      <RsToaster />
      <router-view class="nm-root__view" />
    </RsTooltipProvider>
  </RsConfigProvider>
</template>

<style>
.nm-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.nm-root__view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/*
 * 桌面 Shell 对话框安全区（RsDialog / RsConfirmDialog 读取）。
 * Teleport 到 body 时仍生效，避免 window 布局全屏/缩放覆盖顶栏与状态栏。
 */
:root {
  --rs-dialog-inset-top: var(--nm-topbar-h);
  --rs-dialog-inset-bottom: var(--nm-statusbar-h);
  --rs-dialog-inset-x: 1rem;
}
</style>
