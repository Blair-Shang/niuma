/** 从终端缓冲倒查的提示符行数。 */
const PROMPT_SCAN_LINES = 8

/** 只读 xterm 活动缓冲，避免 web 直接依赖 @xterm/xterm。 */
export interface TerminalCwdBufferHost {
  buffer: {
    active: {
      type?: string
      baseY: number
      cursorY: number
      getLine(y: number): { translateToString(trimRight?: boolean): string } | undefined
    }
  }
}

/**
 * 把 OSC 7 / 提示符里扫到的路径收成 SFTP 可导航形式。
 * 允许 `~` 与绝对 Unix 路径；拒绝空串与控制字符。
 */
export function normalizeRemoteCwd(raw: string): string | null {
  const trimmed = raw.trim().replaceAll('\\', '/')
  if (!trimmed) {
    return null
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return null
  }
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    return trimmed
  }
  if (trimmed.startsWith('/')) {
    return trimmed.replaceAll(/\/{2,}/g, '/') || '/'
  }
  return null
}

/** 解析 OSC 7 载荷 `file://[host]/path`。 */
export function parseOsc7Payload(data: string): string | null {
  const trimmed = data.trim()
  if (!trimmed.toLowerCase().startsWith('file:')) {
    return null
  }
  let decoded = trimmed
  try {
    decoded = decodeURIComponent(trimmed)
  } catch {
    // 保留未解码原文
  }
  const withoutScheme = decoded.replace(/^file:\/\//i, '')
  const slash = withoutScheme.indexOf('/')
  if (slash < 0) {
    return null
  }
  return normalizeRemoteCwd(withoutScheme.slice(slash))
}

/** 解析 iTerm2 `OSC 1337 ; CurrentDir=path`。 */
export function parseItermCurrentDir(data: string): string | null {
  const match = /^CurrentDir=(.+)$/i.exec(data.trim())
  if (!match) {
    return null
  }
  return normalizeRemoteCwd(match[1] ?? '')
}

/**
 * 从常见 shell 提示符抽出路径。
 * 支持 `user@host:/abs$`、`user@host:~/rel#`、`[user@host /abs]`。
 */
export function extractPromptPath(line: string): string | null {
  const text = line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').trim()
  if (!text) {
    return null
  }
  const userHost = /[\w.-]+@[\w.-]+/
  const atColon = new RegExp(
    `(?:^|[\\s(])${userHost.source}:(~(?:/[^\\s:#$%>]*)?|\\/[^\\s:#$%>]*)\\s*[#$%>]?`,
  ).exec(text)
  if (atColon?.[1]) {
    return normalizeRemoteCwd(atColon[1].replace(/[#$%>]+$/, ''))
  }
  const bracket = new RegExp(
    `\\[(?:${userHost.source})\\s+(~(?:/[^\\]\\s]*)?|\\/[^\\]\\s]+)\\]`,
  ).exec(text)
  if (bracket?.[1]) {
    return normalizeRemoteCwd(bracket[1])
  }
  return null
}

/** 从 xterm 活动缓冲自光标向上扫描提示符路径。备用屏（vim/less）不扫。 */
export function extractPromptPathFromTerminal(term: TerminalCwdBufferHost | null | undefined): string | null {
  if (!term) {
    return null
  }
  const buf = term.buffer.active
  if (buf.type === 'alternate') {
    return null
  }
  const cursor = buf.baseY + buf.cursorY
  const start = Math.max(0, cursor - PROMPT_SCAN_LINES + 1)
  for (let y = cursor; y >= start; y -= 1) {
    const line = buf.getLine(y)?.translateToString(true) ?? ''
    const path = extractPromptPath(line)
    if (path) {
      return path
    }
  }
  return null
}

/** 把 `~` / `~/foo` 接到 SFTP 会话起始目录（通常是家目录）。 */
export function joinHomeRelative(home: string, path: string): string {
  if (path === '~') {
    return home || '.'
  }
  if (!path.startsWith('~/')) {
    return path
  }
  const root = home.replace(/\/+$/, '') || ''
  const rest = path.slice(2).replace(/^\/+/, '')
  if (!root) {
    return `/${rest}`
  }
  return `${root}/${rest}`.replaceAll(/\/{2,}/g, '/')
}
