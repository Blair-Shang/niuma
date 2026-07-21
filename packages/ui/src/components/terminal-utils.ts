import type { ITheme, Terminal } from 'xterm'
import { readDocumentTheme } from './code-editor-utils'

export type RsTerminalThemeMode = 'auto' | 'light' | 'dark'
export type RsResolvedTerminalTheme = 'light' | 'dark'

export type RsTerminalAction = 'copy' | 'paste' | 'selectAll' | 'clear'

const TERMINAL_CSS_KEYS: Array<[keyof ITheme, string]> = [
  ['background', '--rs-terminal-bg'],
  ['foreground', '--rs-terminal-fg'],
  ['cursor', '--rs-terminal-cursor'],
  ['cursorAccent', '--rs-terminal-cursor-accent'],
  ['selectionBackground', '--rs-terminal-selection-bg'],
  ['selectionForeground', '--rs-terminal-selection-fg'],
  ['black', '--rs-terminal-ansi-black'],
  ['red', '--rs-terminal-ansi-red'],
  ['green', '--rs-terminal-ansi-green'],
  ['yellow', '--rs-terminal-ansi-yellow'],
  ['blue', '--rs-terminal-ansi-blue'],
  ['magenta', '--rs-terminal-ansi-magenta'],
  ['cyan', '--rs-terminal-ansi-cyan'],
  ['white', '--rs-terminal-ansi-white'],
  ['brightBlack', '--rs-terminal-ansi-bright-black'],
  ['brightRed', '--rs-terminal-ansi-bright-red'],
  ['brightGreen', '--rs-terminal-ansi-bright-green'],
  ['brightYellow', '--rs-terminal-ansi-bright-yellow'],
  ['brightBlue', '--rs-terminal-ansi-bright-blue'],
  ['brightMagenta', '--rs-terminal-ansi-bright-magenta'],
  ['brightCyan', '--rs-terminal-ansi-bright-cyan'],
  ['brightWhite', '--rs-terminal-ansi-bright-white'],
]

const themeProbeCache = new Map<RsResolvedTerminalTheme, HTMLElement>()

const TERMINAL_ROW_STRIPE_VAR = '--rs-terminal-row-stripe'

function readCssVar(name: string, element: HTMLElement): string {
  return getComputedStyle(element).getPropertyValue(name).trim()
}

function channelToHex(raw: string): string | null {
  const value = raw.endsWith('%')
    ? Math.round((Number(raw.slice(0, -1)) / 100) * 255)
    : Math.round(Number(raw))
  if (!Number.isFinite(value)) {
    return null
  }
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')
}

function parseRgbChannels(value: string): [string, string, string] | null {
  const lower = value.toLowerCase()
  if (!lower.startsWith('rgb')) {
    return null
  }
  const open = value.indexOf('(')
  const close = value.indexOf(')', open + 1)
  if (open === -1 || close === -1) {
    return null
  }
  const parts = value
    .slice(open + 1, close)
    .replaceAll('/', ' ')
    .replaceAll(',', ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length < 3) {
    return null
  }
  const r = channelToHex(parts[0])
  const g = channelToHex(parts[1])
  const b = channelToHex(parts[2])
  if (!r || !g || !b) {
    return null
  }
  return [r, g, b]
}

/** 将 CSS 颜色规范为 #RRGGBB（支持 hex 与 computed rgb） */
export function normalizeTerminalHexColor(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  const rgb = parseRgbChannels(trimmed)
  if (!rgb) {
    return null
  }
  return `#${rgb[0]}${rgb[1]}${rgb[2]}`
}

/** 将 lab()/color() 等现代 CSS 色值转为 xterm 可解析的 #RRGGBB */
export function resolveCssColorForXterm(value: string): string | null {
  const direct = normalizeTerminalHexColor(value)
  if (direct) {
    return direct
  }
  if (typeof document === 'undefined') {
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return null
  }
  try {
    ctx.fillStyle = '#000000'
    ctx.fillStyle = value
    if (typeof ctx.fillStyle !== 'string') {
      return null
    }
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    if (a === 0) {
      return null
    }
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
  } catch {
    return null
  }
}

const BACKGROUND_THEME_KEYS = new Set<keyof ITheme>(['background', 'selectionBackground'])

function readResolvedCssColor(cssVar: string, source: HTMLElement, asBackground: boolean): string {
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
  if (asBackground) {
    probe.style.backgroundColor = `var(${cssVar})`
  } else {
    probe.style.color = `var(${cssVar})`
  }
  source.appendChild(probe)
  const computed = getComputedStyle(probe)
  const raw = asBackground ? computed.backgroundColor : computed.color
  probe.remove()
  return raw
}

function themeProbeElement(mode: RsResolvedTerminalTheme): HTMLElement {
  const cached = themeProbeCache.get(mode)
  if (cached) {
    return cached
  }
  const probe = document.createElement('div')
  probe.dataset.rsTheme = mode
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  themeProbeCache.set(mode, probe)
  return probe
}

function themeSourceElement(mode: RsResolvedTerminalTheme): HTMLElement {
  if (document.documentElement.dataset.rsTheme === mode) {
    return document.documentElement
  }
  return themeProbeElement(mode)
}

/** 从全局 `--rs-terminal-*` token 构建 xterm 调色板（须已加载 styles.css） */
export function readTerminalThemeFromCss(mode: RsResolvedTerminalTheme): ITheme {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return {}
  }
  const source = themeSourceElement(mode)
  const theme: ITheme = {}
  for (const [key, cssVar] of TERMINAL_CSS_KEYS) {
    const raw = readResolvedCssColor(cssVar, source, BACKGROUND_THEME_KEYS.has(key))
    const value = resolveCssColorForXterm(raw)
    if (value) {
      ;(theme as Record<string, string>)[key] = value
    }
  }
  return theme
}

export function resolveTerminalTheme(mode: RsTerminalThemeMode = 'auto'): RsResolvedTerminalTheme {
  return mode === 'auto' ? readDocumentTheme() : mode
}

export function getTerminalThemePalette(mode: RsResolvedTerminalTheme): ITheme {
  return readTerminalThemeFromCss(mode)
}

export function mergeTerminalTheme(
  mode: RsResolvedTerminalTheme,
  overrides?: Partial<ITheme>,
): ITheme {
  return {
    ...readTerminalThemeFromCss(mode),
    ...overrides,
  }
}

/** 读取斑马纹行底色（`--rs-terminal-row-stripe`，解析后供 xterm decoration 使用） */
export function readTerminalRowStripeFromCss(mode: RsResolvedTerminalTheme): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return ''
  }
  return readCssVar(TERMINAL_ROW_STRIPE_VAR, themeSourceElement(mode))
}

/** PTY 输出是否含终端控制序列（ESC / CSI），此类数据不应批量延迟。 */
export function containsEscapeSequence(data: string): boolean {
  return data.includes('\x1b') || data.includes('\x9b')
}

const TUI_REFRESH_PATTERN =
  /\x1b\[[0-9;]*[Hf]|\x1b\[2J|\x1b\[\?1049[hl]|\x1b\[\?47[hl]|\x1b\[1049[hl]/

/** 检测 ncurses/vim/top 等全屏刷新常用的光标定位与清屏序列 */
export function containsTuiRefreshSequence(data: string): boolean {
  return TUI_REFRESH_PATTERN.test(data)
}

const FULL_SCREEN_CLEAR_PATTERN = /\x1b\[[0-9;]*2J|\x1b\[[0-9;]*3J/
const CURSOR_HOME_TOP_PATTERN = /^\x1b\[H|^\x1b\[1;1H|^\x1b\[1H/

/** 全屏清屏（top/vim 新一轮绘制常见） */
export function containsFullScreenClear(data: string): boolean {
  return FULL_SCREEN_CLEAR_PATTERN.test(data)
}

/** 数据块以光标归位首行开头（top 每轮刷新常见） */
export function startsWithCursorHome(data: string): boolean {
  return CURSOR_HOME_TOP_PATTERN.test(data.trimStart())
}

/**
 * 在本地解析层重置滚动边距等模式（不发给 PTY）。
 * 仅在全屏清屏等明确「新一轮绘制」时调用，避免打断进行中的 TUI 光标位置。
 */
export function resetLocalTerminalModes(terminal: Terminal): void {
  terminal.write('\x1b[r')
}

export function snapTerminalViewportToBottom(terminal: Terminal): void {
  terminal.scrollToBottom()
}

/** 处理 PTY 写入前的视口/模式准备（不移动写入光标，避免输入错位） */
export function prepareTerminalForPtyWrite(terminal: Terminal, data: string): void {
  if (containsFullScreenClear(data)) {
    resetLocalTerminalModes(terminal)
    return
  }
  const buffer = terminal.buffer.active
  if (buffer.viewportY < buffer.baseY) {
    snapTerminalViewportToBottom(terminal)
  }
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

/** 菜单/文档展示的修饰键标签 */
export function terminalShortcutLabel(key: string): string {
  return isMacPlatform() ? `⌘${key}` : `Ctrl+${key}`
}

/** ANSI 16 色演示文本 */
export function buildAnsiColorDemo(): string {
  const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
  const rows = [0, 1].map((row) => {
    const base = row === 0 ? 30 : 90
    let line = ''
    for (let i = 0; i < 8; i += 1) {
      line += `\x1b[${base + i}m ${names[i].padEnd(8)} \x1b[0m`
    }
    return line
  })
  let gradient = ''
  for (let i = 16; i < 52; i += 1) {
    gradient += `\x1b[48;5;${i}m \x1b[0m`
  }
  const lines = [
    '\x1b[1mANSI 16 colors\x1b[0m',
    ...rows,
    '',
    '\x1b[1mStyles\x1b[0m  \x1b[1mbold\x1b[0m  \x1b[3mitalic\x1b[0m  \x1b[4munderline\x1b[0m  \x1b[9mstrikethrough\x1b[0m',
    '',
    '\x1b[38;5;196m256-color\x1b[0m sample:',
    gradient,
  ]
  return `${lines.join('\r\n')}\r\n`
}
