import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { RsLocale, RsThemeMode } from '@niuma/ui'

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

function resolveSystemTheme(): RsThemeMode {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useAppStore = defineStore('app', () => {
  const themePreference = ref<ThemePreference>(readStoredTheme())
  const locale = ref<RsLocale>(readStoredLocale())
  const systemTheme = ref<RsThemeMode>(resolveSystemTheme())

  if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      systemTheme.value = e.matches ? 'dark' : 'light'
    })
  }

  const resolvedTheme = computed<RsThemeMode>(() =>
    themePreference.value === 'system' ? systemTheme.value : themePreference.value,
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
    locale,
    setThemePreference,
    setLocale,
    toggleTheme,
  }
})
