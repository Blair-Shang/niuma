<script setup lang="ts">
import { ref, watch } from 'vue'
import { createRsConfigState, provideRsConfig } from '../composables/useRsConfig'
import { applyTheme } from '../theme/apply'
import { defaultLocale, type RsLocale } from '../locale/types'
import type { RsThemeMode } from '../theme/types'

const props = withDefaults(
  defineProps<{
    theme?: RsThemeMode
    locale?: RsLocale
    /**
     * global：data-rs-theme 写到 document（默认，Portal 弹出层同步）
     * local：写到 Provider 根节点（子树隔离，业务 CSS 可 scoped 到 .rs-app-*）
     */
    themeScope?: 'global' | 'local'
  }>(),
  {
    theme: 'light',
    locale: defaultLocale,
    themeScope: 'global',
  },
)

const rootEl = ref<HTMLElement | null>(null)
const config = createRsConfigState(props.theme, props.locale)
provideRsConfig(config)

function syncTheme() {
  if (typeof document === 'undefined') return
  const el =
    props.themeScope === 'local' && rootEl.value
      ? rootEl.value
      : document.documentElement
  applyTheme(config.theme.value, el)
}

watch(
  () => props.theme,
  (value) => {
    if (value !== config.theme.value) config.setTheme(value)
  },
)
watch(
  () => props.locale,
  (value) => {
    if (value !== config.locale.value) config.setLocale(value)
  },
)
watch(() => config.theme.value, syncTheme, { immediate: true })
watch(() => props.themeScope, syncTheme)
</script>

<template>
  <div ref="rootEl" class="rs-config-provider">
    <slot />
  </div>
</template>

<style scoped>
.rs-config-provider {
  color: var(--rs-text);
  background: var(--rs-bg);
  height: 100%;
  min-height: 0;
}
</style>
