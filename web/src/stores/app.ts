import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { RsCodeEditorTheme, RsLocale, RsResolvedTheme } from '@niuma/ui'
import {
  applyHostTheme,
  clearHostTheme,
  hostColorTheme,
  isHostThemeId,
  themeIdForLegacySkin,
  themeMenu,
  type BuiltinThemeId,
  type HostThemeId,
} from '@/theme/registry'

export type ThemePreference = BuiltinThemeId

/** 内置明暗，或已安装主题的 id。名单来自注册表，不要在这里再写一遍。 */
export type ThemeId = ThemePreference | HostThemeId

const STORAGE_THEME = 'niuma-theme'
const LEGACY_COLOR_SKIN = 'niuma-color-skin'
const STORAGE_LOCALE = 'niuma-locale'

export function isThemeId(value: string | null): value is ThemeId {
  return value === 'light' || value === 'dark' || value === 'system' || isHostThemeId(value)
}

function readStoredTheme(): ThemeId {
  const legacy = localStorage.getItem(LEGACY_COLOR_SKIN)
  if (legacy != null) {
    localStorage.removeItem(LEGACY_COLOR_SKIN)
    const migrated = themeIdForLegacySkin(legacy)
    if (migrated) return migrated
  }
  const saved = localStorage.getItem(STORAGE_THEME)
  if (isThemeId(saved)) return saved
  return 'system'
}

function syncInstalledTheme(id: ThemeId): void {
  if (id === 'light' || id === 'dark' || id === 'system') {
    clearHostTheme()
    return
  }
  applyHostTheme(id)
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
  const themeId = ref<ThemeId>(readStoredTheme())
  const locale = ref<RsLocale>(readStoredLocale())
  const systemTheme = ref<RsResolvedTheme>(resolveSystemTheme())

  if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      systemTheme.value = e.matches ? 'dark' : 'light'
    })
  }

  /** 交给 RsConfigProvider 的明暗。已安装主题用自己的 uiTheme。 */
  const themePreference = computed<ThemePreference>(() => {
    const installed = hostColorTheme(themeId.value)
    if (installed) return installed.uiTheme
    return themeId.value as ThemePreference
  })

  const resolvedTheme = computed<RsResolvedTheme>(() =>
    themePreference.value === 'system' ? systemTheme.value : themePreference.value,
  )

  /** 代码编辑器没有 system：跟随时用 auto，继承页面上已解析的明暗。 */
  const editorTheme = computed<RsCodeEditorTheme>(() => {
    if (themeId.value === 'system') return 'auto'
    return themePreference.value === 'dark' ? 'dark' : 'light'
  })

  function setTheme(id: ThemeId) {
    themeId.value = id
  }

  function setThemePreference(mode: ThemePreference) {
    setTheme(mode)
  }

  function setLocale(value: RsLocale) {
    locale.value = value
    localStorage.setItem(STORAGE_LOCALE, value)
  }

  function toggleTheme() {
    const ids = themeMenu().map((item) => item.id).filter(isThemeId)
    const idx = ids.indexOf(themeId.value)
    const next = ids[(idx + 1) % ids.length]
    if (next) setTheme(next)
  }

  watch(themeId, (id) => {
    localStorage.setItem(STORAGE_THEME, id)
    syncInstalledTheme(id)
  }, { immediate: true })
  watch(locale, (v) => localStorage.setItem(STORAGE_LOCALE, v))

  return {
    themeId,
    themePreference,
    theme: resolvedTheme,
    editorTheme,
    locale,
    setTheme,
    setThemePreference,
    setLocale,
    toggleTheme,
  }
})
