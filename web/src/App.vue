<script setup lang="ts">
import { RsConfigProvider, RsToaster, RsTooltipProvider } from '@niuma/ui'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { watch } from 'vue'

const appStore = useAppStore()
const { locale } = useI18n()

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
