/** TCP/UDP 发送条：编码与行尾。auto 与后台 codec.Detect 对齐。 */

export type SocketEncode = 'auto' | 'utf8' | 'hex' | 'base64'
export type SocketLineEnd = 'none' | 'lf' | 'cr' | 'crlf'

const LINE_UTF8: Record<SocketLineEnd, string> = {
  none: '',
  lf: '\n',
  cr: '\r',
  crlf: '\r\n',
}

const LINE_HEX: Record<SocketLineEnd, string> = {
  none: '',
  lf: '0a',
  cr: '0d',
  crlf: '0d0a',
}

/** 去掉空格与冒号，便于对照 hex dump 粘贴。 */
export function normalizeHexDraft(text: string): string {
  return text.replace(/[\s:]/g, '')
}

export function isHexDraft(text: string): boolean {
  const hex = normalizeHexDraft(text)
  return hex.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(hex)
}

/** 与后台 StdEncoding 一致：空串或可解码的标准 Base64。 */
export function isBase64Draft(text: string): boolean {
  const s = text.trim()
  if (!s) return true
  if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false
  try {
    atob(s)
    return true
  } catch {
    return false
  }
}

/** 与后台 Detect 一致：成对十六进制走 hex，否则 utf8。 */
export function detectSocketEncode(text: string): 'utf8' | 'hex' {
  const hex = normalizeHexDraft(text)
  if (hex.length >= 2 && isHexDraft(text)) return 'hex'
  return 'utf8'
}

export function resolveSocketEncode(text: string, encode: SocketEncode): Exclude<SocketEncode, 'auto'> {
  if (encode === 'auto') return detectSocketEncode(text)
  return encode
}

export function applySocketLineEnd(text: string, encode: SocketEncode, end: SocketLineEnd): string {
  const resolved = resolveSocketEncode(text, encode)
  if (resolved === 'hex') return normalizeHexDraft(text) + LINE_HEX[end]
  if (resolved === 'base64') {
    if (end === 'none') return text.trim()
    try {
      return btoa(atob(text.trim()) + LINE_UTF8[end])
    } catch {
      return text
    }
  }
  return text + LINE_UTF8[end]
}
