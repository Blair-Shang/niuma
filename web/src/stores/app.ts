import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { RsCodeEditorTheme, RsLocale, RsResolvedTheme } from '@niuma/ui'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_THEME = 'niuma-theme'
const STORAGE_LOCALE = 'niuma-locale'

function readStoredTheme(): ThemePreference {
  const saved = localStorage.getItem(STORAGE_THEME)
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  return 'system'
}

function readStoredLocale(): RsLocale {
  const saved = localStorage.getItem(STORAGE_LOCALE)
  if (saved === 'zh-CN' || saved === 'en-US') return saved
  return 'zh-CN'
}

function resolveSystemTheme(): RsResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useAppStore = defineStore('app', () => {
  const themePreference = ref<ThemePreference>(readStoredTheme())
  const locale = ref<RsLocale>(readStoredLocale())
  const systemTheme = ref<RsResolvedTheme>(resolveSystemTheme())

  if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      systemTheme.value = e.matches ? 'dark' : 'light'
    })
  }

  const resolvedTheme = computed<RsResolvedTheme>(() =>
    themePreference.value === 'system' ? systemTheme.value : themePreference.value,
  )

  /** 代码编辑器没有 system：跟随时用 auto，继承页面上已解析的明暗。 */
  const editorTheme = computed<RsCodeEditorTheme>(() =>
    themePreference.value === 'system' ? 'auto' : themePreference.value,
  )

  function setThemePreference(mode: ThemePreference) {
    themePreference.value = mode
    localStorage.setItem(STORAGE_THEME, mode)
  }

  function setLocale(value: RsLocale) {
    locale.value = value
    localStorage.setItem(STORAGE_LOCALE, value)
  }

  function toggleTheme() {
    const order: ThemePreference[] = ['light', 'dark', 'system']
    const idx = order.indexOf(themePreference.value)
    setThemePreference(order[(idx + 1) % order.length]!)
  }

  watch(themePreference, (v) => localStorage.setItem(STORAGE_THEME, v))
  watch(locale, (v) => localStorage.setItem(STORAGE_LOCALE, v))

  return {
    themePreference,
    theme: resolvedTheme,
    editorTheme,
    locale,
    setThemePreference,
    setLocale,
    toggleTheme,
  }
})
