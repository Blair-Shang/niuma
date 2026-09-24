import type { RsColorTheme, RsColorThemeToken } from '@niuma/ui'

/**
 * 宿主主题额外令牌。语义色走 `colors`（niuma-ui 允许表）。
 * 壳、极光、终端写在这里，由同一个安装函数落到根节点。
 * 新增键时每套主题都要填，缺一项过不了类型检查。
 */
export const HOST_TOKEN_KEYS = [
  '--nm-aurora-a',
  '--nm-aurora-b',
  '--nm-aurora-c',
  '--nm-aurora-d',
  '--nm-aurora-e',
  '--nm-on-aurora',
  '--nm-aurora-opacity',
  '--nm-glass-bg',
  '--nm-glass-blur',
  '--nm-elev-highlight',
  '--nm-elev-shadow',
  '--nm-editor-glow',
  '--nm-letter-spacing',
  '--nm-activity-explorer',
  '--nm-activity-data',
  '--nm-activity-ops',
  '--nm-activity-devtools',
  '--rs-radius-xs',
  '--rs-radius-sm',
  '--rs-radius',
  '--rs-radius-lg',
  '--rs-terminal-shell-bg',
  '--rs-terminal-bg',
  '--rs-terminal-fg',
  '--rs-terminal-cursor',
  '--rs-terminal-cursor-accent',
  '--rs-terminal-row-stripe',
  '--rs-terminal-selection-bg',
  '--rs-terminal-selection-fg',
  '--rs-terminal-border',
  '--rs-terminal-ansi-black',
  '--rs-terminal-ansi-red',
  '--rs-terminal-ansi-green',
  '--rs-terminal-ansi-yellow',
  '--rs-terminal-ansi-blue',
  '--rs-terminal-ansi-magenta',
  '--rs-terminal-ansi-cyan',
  '--rs-terminal-ansi-white',
  '--rs-terminal-ansi-bright-black',
  '--rs-terminal-ansi-bright-red',
  '--rs-terminal-ansi-bright-green',
  '--rs-terminal-ansi-bright-yellow',
  '--rs-terminal-ansi-bright-blue',
  '--rs-terminal-ansi-bright-magenta',
  '--rs-terminal-ansi-bright-cyan',
  '--rs-terminal-ansi-bright-white',
] as const

export type HostTokenName = (typeof HOST_TOKEN_KEYS)[number]

export type HostTokens = Record<HostTokenName, string>

/** 一份可安装主题。`label` 英文；界面文案用 `labelKey`。 */
export interface HostColorTheme extends Omit<RsColorTheme, 'colors'> {
  labelKey: string
  icon: string
  /** 旧存储值，读到后迁到本主题 id。 */
  legacyIds?: readonly string[]
  colors: Record<RsColorThemeToken, string>
  tokens: HostTokens
}

export interface ThemeMenuItem {
  id: string
  labelKey: string
  icon: string
}

/** 收窄字面量 id，同时要求语义色和宿主令牌齐全。 */
export function defineHostTheme<const T extends HostColorTheme>(theme: T): T {
  return theme
}
