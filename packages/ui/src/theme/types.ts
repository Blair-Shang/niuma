export type RsThemeMode = 'dark' | 'light'

/** 控件尺寸：国际 SaaS 通用 sm / md / lg 三档 */
export type RsComponentSize = 'sm' | 'md' | 'lg'

/**
 * 设计 token
 * 色彩语义：Google MD3 容器色 + 字节 Arco 中性色 + 国际 SaaS 功能色
 */
export interface RsThemeTokens {
  primary: string
  primaryHover: string
  primaryForeground: string
  primaryContainer: string
  onPrimaryContainer: string
  bg: string
  surface: string
  surfaceElevated: string
  surfaceHover: string
  inputBg: string
  border: string
  borderSubtle: string
  text: string
  muted: string
  placeholder: string
  danger: string
  dangerContainer: string
  onDangerContainer: string
  success: string
  successContainer: string
  onSuccessContainer: string
  warning: string
  warningContainer: string
  onWarningContainer: string
  info: string
  infoContainer: string
  onInfoContainer: string
  focusRing: string
}

export const themeAttribute = 'data-rs-theme'
