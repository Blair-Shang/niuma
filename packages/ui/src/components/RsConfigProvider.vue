<script setup lang="ts">
import { ref, watch } from 'vue'
import { createRsConfigState, provideRsConfig } from '../composables/useRsConfig'
import { applyTheme } from '../theme/apply'
import { defaultLocale, type RsLocale } from '../locale/types'
import type { RsComponentSize, RsRadius, RsThemeMode } from '../theme/types'

const props = withDefaults(
  defineProps<{
    theme?: RsThemeMode
    locale?: RsLocale
    /** 全局默认控件尺寸：ssm 极小 / sm 小号 / md 中号 / lg 大号 */
    controlSize?: RsComponentSize
    /**
     * 全局默认圆角：none 直角 / xs~lg / full。
     * 未传时各组件保留自身默认；传入后覆盖未显式指定 radius 的控件。
     */
    controlRadius?: RsRadius
    /**
     * global：data-rs-theme 写到 document（默认，Portal 弹出层同步）
     * local：写到 Provider 根节点（子树隔离，业务 CSS 可 scoped 到 .rs-app-*）
     */
    themeScope?: 'global' | 'local'
  }>(),
  {
    theme: 'light',
    locale: defaultLocale,
    controlSize: 'md',
    themeScope: 'global',
  },
)

const rootEl = ref<HTMLElement | null>(null)
const config = createRsConfigState(
  props.theme,
  props.locale,
  props.controlSize,
  props.controlRadius,
)
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
watch(
  () => props.controlSize,
  (value) => {
    if (value && value !== config.controlSize.value) config.setControlSize(value)
  },
)
watch(
  () => props.controlRadius,
  (value) => {
    if (value !== config.controlRadius.value) config.setControlRadius(value)
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
