import type { RsThemeMode } from './types'

/**
 * 切换明暗主题：仅设置 data-rs-theme，色值由 styles.css 中的 CSS 变量提供。
 * 业务定制请写 CSS 覆盖 --rs-*，见 theme/brand.example.css
 */
export function applyTheme(
  mode: RsThemeMode,
  el: HTMLElement = document.documentElement,
) {
  el.setAttribute('data-rs-theme', mode)
}
