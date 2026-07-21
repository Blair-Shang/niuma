export type RsThemeMode = 'dark' | 'light'

/**
 * 控件尺寸（由小到大）：
 * - ssm：极小
 * - sm：小号
 * - md：中号（默认）
 * - lg：大号
 *
 * 高度由 `--rs-control-height-*` 统一控制，业务侧勿用 :deep 覆盖。
 */
export type RsComponentSize = 'ssm' | 'sm' | 'md' | 'lg'

export const RS_COMPONENT_SIZES: readonly RsComponentSize[] = ['ssm', 'sm', 'md', 'lg']

/** 各档控件图标默认像素边长。 */
export const RS_COMPONENT_SIZE_ICON_PX: Record<RsComponentSize, number> = {
  ssm: 12,
  sm: 14,
  md: 16,
  lg: 18,
}

/**
 * 圆角档位（由小到大）：
 * - none：直角（无圆角）
 * - xs / sm / md / lg：对应 `--rs-radius-*`
 * - full：胶囊 / 圆形
 *
 * 业务侧用组件 `radius` / `iconRadius` 等 prop，勿 :deep 改 border-radius。
 */
export type RsRadius = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'full'

export const RS_RADII: readonly RsRadius[] = ['none', 'xs', 'sm', 'md', 'lg', 'full']

/** 各档圆角对应的 CSS 值（可直接赋给 border-radius / CSS 变量）。 */
export const RS_RADIUS_CSS: Record<RsRadius, string> = {
  none: '0',
  xs: 'var(--rs-radius-xs)',
  sm: 'var(--rs-radius-sm)',
  md: 'var(--rs-radius)',
  lg: 'var(--rs-radius-lg)',
  full: 'var(--rs-radius-full)',
}

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
