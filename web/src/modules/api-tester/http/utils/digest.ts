/**
 * HTTP Digest（RFC 2617，qop=auth）。第一次 401 之后再发带 Authorization 的请求。
 */
import { md5Hex } from './md5'

export interface DigestChallenge {
  realm: string
  nonce: string
  opaque: string
  qop: string
  algorithm: string
}

/** 从 WWW-Authenticate 取出 Digest 参数。不是 Digest 时返回 null。 */
export function parseDigestChallenge(header: string): DigestChallenge | null {
  const text = header.trim()
  if (!/^digest\s/i.test(text)) return null
  const realm = param(text, 'realm')
  const nonce = param(text, 'nonce')
  if (!realm || !nonce) return null
  return {
    realm,
    nonce,
    opaque: param(text, 'opaque'),
    qop: param(text, 'qop').split(',')[0]?.trim() ?? '',
    algorithm: param(text, 'algorithm') || 'MD5',
  }
}

/** 生成 Authorization 头的值（含 Digest 前缀）。 */
export function buildDigestAuthorization(opts: {
  username: string
  password: string
  method: string
  uri: string
  challenge: DigestChallenge
  nc?: string
  cnonce?: string
}): string {
  const nc = opts.nc ?? '00000001'
  const cnonce = opts.cnonce ?? randomCnonce()
  const qop = opts.challenge.qop === 'auth' ? 'auth' : ''
  const ha1 = md5Hex(`${opts.username}:${opts.challenge.realm}:${opts.password}`)
  const ha2 = md5Hex(`${opts.method.toUpperCase()}:${opts.uri}`)
  const response = qop
    ? md5Hex(`${ha1}:${opts.challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5Hex(`${ha1}:${opts.challenge.nonce}:${ha2}`)
  const parts = [
    `username="${opts.username}"`,
    `realm="${opts.challenge.realm}"`,
    `nonce="${opts.challenge.nonce}"`,
    `uri="${opts.uri}"`,
    `response="${response}"`,
    `algorithm=${opts.challenge.algorithm || 'MD5'}`,
  ]
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`)
  if (opts.challenge.opaque) parts.push(`opaque="${opts.challenge.opaque}"`)
  return `Digest ${parts.join(', ')}`
}

function param(header: string, name: string): string {
  const match = header.match(new RegExp(`${name}=(?:"([^"]*)"|([^\\s,]+))`, 'i'))
  return (match?.[1] ?? match?.[2] ?? '').trim()
}

function randomCnonce(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
