import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'
import { localeMap } from '../locale/messages'
import { defaultLocale, type RsLocale } from '../locale/types'
import type { RsThemeMode } from '../theme/types'

export interface RsConfigContext {
  theme: Ref<RsThemeMode>
  locale: Ref<RsLocale>
  setTheme: (mode: RsThemeMode) => void
  setLocale: (locale: RsLocale) => void
  t: (key: string, fallback?: string) => string
}

export const rsConfigKey: InjectionKey<RsConfigContext> = Symbol('rs-config')

export function useRsConfig(): RsConfigContext {
  const ctx = inject(rsConfigKey)
  if (!ctx) {
    throw new Error('useRsConfig() must be used within RsConfigProvider')
  }
  return ctx
}

export function createRsConfigState(
  initialTheme: RsThemeMode = 'light',
  initialLocale: RsLocale = defaultLocale,
): RsConfigContext {
  const theme = ref<RsThemeMode>(initialTheme)
  const locale = ref<RsLocale>(initialLocale)

  function setTheme(mode: RsThemeMode) {
    theme.value = mode
  }

  function setLocale(next: RsLocale) {
    locale.value = next
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-rs-locale', next)
    }
  }

  function t(key: string, fallback?: string) {
    return localeMap[locale.value][key] ?? fallback ?? key
  }

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-rs-locale', locale.value)
  }

  return { theme, locale, setTheme, setLocale, t }
}

export function provideRsConfig(ctx: RsConfigContext) {
  provide(rsConfigKey, ctx)
}
