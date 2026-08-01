/**
 * 调试辅助侧栏：消息 / 说明（跨方言复用，不绑定具体方言 API）。
 */

export type DebugMessageTone = 'ok' | 'err' | 'info'

export interface DebugMessageItem {
  id: string
  text: string
  tone: DebugMessageTone
}

/** 从 `OK …` / `ERR …` / `NOTICE …` 行解析展示态 */
export function parseDebugMessageLines(lines: string[]): DebugMessageItem[] {
  return lines.map((raw, i) => {
    const text = raw ?? ''
    let tone: DebugMessageTone = 'info'
    let body = text
    if (/^ERR\b/i.test(text)) {
      tone = 'err'
      body = text.replace(/^ERR\b\s*/i, '')
    } else if (/^OK\b/i.test(text)) {
      tone = 'ok'
      body = text.replace(/^OK\b\s*/i, '')
    } else if (/^NOTICE\b/i.test(text)) {
      tone = 'info'
      body = text.replace(/^NOTICE\b\s*/i, '')
    }
    return { id: `m-${i}`, text: body || text, tone }
  })
}

export function debugMessageBadge(tone: DebugMessageTone): string {
  if (tone === 'err') return 'ERR'
  if (tone === 'ok') return 'OK'
  return '·'
}
