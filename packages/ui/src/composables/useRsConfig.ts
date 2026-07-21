import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'
import { localeMap } from '../locale/messages'
import { defaultLocale, type RsLocale } from '../locale/types'
import type { RsComponentSize, RsRadius, RsThemeMode } from '../theme/types'

export interface RsConfigContext {
  theme: Ref<RsThemeMode>
  locale: Ref<RsLocale>
  /** 全局默认控件尺寸（ssm / sm / md / lg）。 */
  controlSize: Ref<RsComponentSize>
  /**
   * 全局默认圆角。未设置时各组件保留自身默认档（如按钮 full、输入 sm）。
   * 设为 `none` 可整站直角风格。
   */
  controlRadius: Ref<RsRadius | undefined>
  setTheme: (mode: RsThemeMode) => void
  setLocale: (locale: RsLocale) => void
  setControlSize: (size: RsComponentSize) => void
  setControlRadius: (radius: RsRadius | undefined) => void
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

/** 可选读取；组件在 Provider 外也可独立使用。 */
export function useRsConfigOptional(): RsConfigContext | null {
  return inject(rsConfigKey, null)
}

export function createRsConfigState(
  initialTheme: RsThemeMode = 'light',
  initialLocale: RsLocale = defaultLocale,
  initialControlSize: RsComponentSize = 'md',
  initialControlRadius?: RsRadius,
): RsConfigContext {
  const theme = ref<RsThemeMode>(initialTheme)
  const locale = ref<RsLocale>(initialLocale)
  const controlSize = ref<RsComponentSize>(initialControlSize)
  const controlRadius = ref<RsRadius | undefined>(initialControlRadius)

  function setTheme(mode: RsThemeMode) {
    theme.value = mode
  }

  function setLocale(next: RsLocale) {
    locale.value = next
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-rs-locale', next)
    }
  }

  function setControlSize(size: RsComponentSize) {
    controlSize.value = size
  }

  function setControlRadius(radius: RsRadius | undefined) {
    controlRadius.value = radius
  }

  function t(key: string, fallback?: string) {
    return localeMap[locale.value][key] ?? fallback ?? key
  }

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-rs-locale', locale.value)
  }

  return {
    theme,
    locale,
    controlSize,
    controlRadius,
    setTheme,
    setLocale,
    setControlSize,
    setControlRadius,
    t,
  }
}

export function provideRsConfig(ctx: RsConfigContext) {
  provide(rsConfigKey, ctx)
}
