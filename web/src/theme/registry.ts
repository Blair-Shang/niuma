import {
  applyColorTheme,
  clearColorTheme,
  isSafeColorThemeValue,
} from '@niuma/ui'
import { lantaiTheme } from './themes/lantai'
import { wuxiaTheme } from './themes/wuxia'
import { yuegongTheme } from './themes/yuegong'
import type { HostColorTheme, ThemeMenuItem } from './types'

export type { HostColorTheme, HostTokenName, HostTokens, ThemeMenuItem } from './types'

/**
 * 已安装主题。新产品主题：
 * 1. `themes/` 里用 `defineHostTheme` 写一份（语义色、壳、终端色都要齐）
 * 2. 追加到这个数组
 * 3. 语言包加上 `labelKey`
 * 设置菜单、store、主题 id 类型都从这里来。
 */
export const HOST_COLOR_THEMES = [wuxiaTheme, lantaiTheme, yuegongTheme] as const

/** 从已安装主题推导，加主题只改上面的数组。 */
export type HostThemeId = (typeof HOST_COLOR_THEMES)[number]['id']

const BUILTIN_THEMES = [
  { id: 'light', labelKey: 'settings.themeLight', icon: 'sun' },
  { id: 'dark', labelKey: 'settings.themeDark', icon: 'moon' },
  { id: 'system', labelKey: 'settings.themeSystem', icon: 'monitor' },
] as const

export type BuiltinThemeId = (typeof BUILTIN_THEMES)[number]['id']

const hostApplied = new Set<string>()

export function hostColorTheme(id: string): HostColorTheme | undefined {
  return HOST_COLOR_THEMES.find((theme) => theme.id === id)
}

export function isHostThemeId(value: string | null): value is HostThemeId {
  return value != null && HOST_COLOR_THEMES.some((theme) => theme.id === value)
}

/** 旧存储值（例如已删除的配色 id）迁到当前主题。 */
export function themeIdForLegacySkin(legacy: string): HostThemeId | undefined {
  for (const theme of HOST_COLOR_THEMES) {
    if ('legacyIds' in theme && theme.legacyIds.includes(legacy)) return theme.id
  }
  return undefined
}

/** 浅色 / 深色 / 跟随系统，然后是已安装主题。 */
export function themeMenu(): ThemeMenuItem[] {
  return [
    ...BUILTIN_THEMES,
    ...HOST_COLOR_THEMES.map((theme) => ({
      id: theme.id,
      labelKey: theme.labelKey,
      icon: theme.icon,
    })),
  ]
}

/** 装上语义色和宿主令牌（含终端）。内置明暗走 `clearHostTheme`。 */
export function applyHostTheme(id: string): boolean {
  const theme = hostColorTheme(id)
  if (!theme || typeof document === 'undefined') return false
  if (!applyColorTheme(theme)) return false
  const root = document.documentElement
  const next = new Set<string>()
  for (const [prop, value] of Object.entries(theme.tokens)) {
    if (!isSafeColorThemeValue(value)) continue
    root.style.setProperty(prop, value)
    next.add(prop)
  }
  for (const prop of hostApplied) {
    if (!next.has(prop)) root.style.removeProperty(prop)
  }
  hostApplied.clear()
  for (const prop of next) hostApplied.add(prop)
  // 令牌写完再拨一下身份，已打开的终端才会重读 --rs-terminal-*。
  const mark = root.dataset.rsColorTheme
  if (mark) {
    delete root.dataset.rsColorTheme
    root.dataset.rsColorTheme = mark
  }
  return true
}

/** 去掉已安装主题，回到样式表里的浅色 / 深色。 */
export function clearHostTheme(): void {
  if (typeof document === 'undefined') return
  clearColorTheme()
  const root = document.documentElement
  for (const prop of hostApplied) root.style.removeProperty(prop)
  hostApplied.clear()
}
