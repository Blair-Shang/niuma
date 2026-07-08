<script setup lang="ts">
import { RsConfigProvider, RsToaster } from '@niuma/ui'
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
    <RsToaster />
    <router-view class="nm-root__view" />
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
</style>
