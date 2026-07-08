import { computed, inject } from 'vue'
import { localeMap } from '../locale/messages'
import { defaultLocale, type RsLocale } from '../locale/types'
import { rsConfigKey } from './useRsConfig'

export type RsTranslateFn = (key: string, fallback?: string) => string

/** 组件内安全取文案：Provider 内跟随 locale，否则回退 defaultLocale */
export function useRsI18n() {
  const ctx = inject(rsConfigKey, null)
  const locale = computed<RsLocale>(() => ctx?.locale.value ?? defaultLocale)

  function t(key: string, fallback?: string): string {
    return localeMap[locale.value][key] ?? fallback ?? key
  }

  return { t, locale }
}

export function createTranslator(locale: RsLocale): RsTranslateFn {
  return (key, fallback) => localeMap[locale][key] ?? fallback ?? key
}
