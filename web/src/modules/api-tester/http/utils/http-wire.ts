/**
 * HTTP/1.1 明文编解码（RFC 9110 / RFC 9112）。不插值、不写 Auth；调用方先 resolveRequest。
 * 请求补齐 Host、Connection、User-Agent、Accept-Encoding、Content-Length，并去掉字段里的 CR/LF。
 * 响应按 Content-Length 或 chunked 取正文。gzip / deflate 由 api-service 的 http 切帧解开后再送到这里。
 */
import type { ApiKvRow } from '../../types'
import type { ResolvedRequest } from './request-resolve'

const USER_AGENT = 'NiuMa'
const ACCEPT_ENCODING = 'gzip, deflate'
const HEADER_TOKEN = /^[-!#$%&'*+.^_`|~0-9A-Za-z]+$/

/** 把已解析请求编成 HTTP/1.1 明文（经 api-service TCP 发出）。 */
export function buildHttpRequest(
  method: string,
  path: string,
  host: string,
  port: number,
  resolved: ResolvedRequest,
): string {
  const verb = method.trim().toUpperCase() || 'GET'
  const body = resolved.body
  const headers = applyMessageHeaders(verb, body, resolved.headers)
  headers.set('host', formatHostHeader(host, port))
  headers.set('connection', 'close')

  const lines = [`${verb} ${path || '/'} HTTP/1.1`]
  for (const [key, value] of headers) {
    lines.push(`${titleHttpHeader(key)}: ${value}`)
  }
  return `${lines.join('\r\n')}\r\n\r\n${body}`
}

export interface ParsedHttpResponse {
  status: number
  statusText: string
  headers: ApiKvRow[]
  body: string
  complete: boolean
}

/** 解析已收到的 HTTP 响应；缺头、未凑齐 Content-Length 或 chunk 未结束时 complete=false。 */
export function parseHttpResponse(raw: string, method: string): ParsedHttpResponse | null {
  const sep = headerSep(raw)
  if (sep < 0) return null
  const sepLen = raw.startsWith('\r\n\r\n', sep) ? 4 : 2
  const head = raw.slice(0, sep)
  const body = raw.slice(sep + sepLen)
  const lines = head.split(/\r?\n/)
  const start = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/.exec(lines[0] ?? '')
  if (!start) return null
  const status = Number(start[1])
  const headers: ApiKvRow[] = []
  let contentLength: number | null = null
  let chunked = false
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const field = sanitizeHeader(line.slice(0, colon), line.slice(colon + 1))
    if (!field) continue
    headers.push({ id: `hdr-${headers.length}`, enabled: true, key: field.key, value: field.value })
    const name = field.key.toLowerCase()
    if (name === 'content-length') {
      const n = Number(field.value)
      if (Number.isInteger(n) && n >= 0) contentLength = n
    }
    if (name === 'transfer-encoding' && field.value.toLowerCase().includes('chunked')) chunked = true
  }
  if (noMessageBody(status, method)) {
    return { status, statusText: (start[2] ?? '').trim(), headers, body: '', complete: true }
  }
  if (chunked) {
    const decoded = decodeChunked(body)
    return {
      status,
      statusText: (start[2] ?? '').trim(),
      headers,
      body: decoded.data,
      complete: decoded.complete,
    }
  }
  const complete =
    (contentLength != null && new TextEncoder().encode(body).length >= contentLength) ||
    contentLength === 0
  return {
    status,
    statusText: (start[2] ?? '').trim(),
    headers,
    body,
    complete,
  }
}

/** 请求头补齐：去掉 CR/LF，缺省时写入 User-Agent、Accept-Encoding，并按正文长度写 Content-Length。 */
export function applyMessageHeaders(
  method: string,
  body: string,
  source: ReadonlyMap<string, string>,
): Map<string, string> {
  const headers = new Map<string, string>()
  for (const [key, value] of source) {
    const field = sanitizeHeader(key, value)
    if (!field) continue
    headers.set(field.key.toLowerCase(), field.value)
  }
  if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT)
  if (!headers.has('accept-encoding')) headers.set('accept-encoding', ACCEPT_ENCODING)
  if (!headers.has('content-length') && needsContentLength(method, body)) {
    headers.set('content-length', String(new TextEncoder().encode(body).length))
  }
  return headers
}

/** curl / 报文共用的 Header 标题化。 */
export function titleHttpHeader(key: string): string {
  return key
    .split('-')
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join('-')
}

function needsContentLength(method: string, body: string): boolean {
  if (body.length > 0) return true
  return method === 'POST' || method === 'PUT' || method === 'PATCH'
}

function noMessageBody(status: number, method: string): boolean {
  return method.toUpperCase() === 'HEAD' || status < 200 || status === 204 || status === 304
}

function sanitizeHeader(key: string, value: string): { key: string; value: string } | null {
  const name = key.replace(/[\r\n]/g, '').trim()
  if (!HEADER_TOKEN.test(name)) return null
  return { key: name, value: value.replace(/[\r\n]+/g, ' ').trim() }
}

function headerSep(raw: string): number {
  const crlf = raw.indexOf('\r\n\r\n')
  if (crlf >= 0) return crlf
  return raw.indexOf('\n\n')
}

function formatHostHeader(host: string, port: number): string {
  const wrapped = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return port === 80 ? wrapped : `${wrapped}:${port}`
}

function decodeChunked(body: string): { data: string; complete: boolean } {
  const bytes = new TextEncoder().encode(body)
  const out: number[] = []
  let i = 0
  while (i < bytes.length) {
    const lineEnd = bytes.indexOf(0x0a, i)
    if (lineEnd < 0) return { data: decodeBytes(out), complete: false }
    let line = bytes.subarray(i, lineEnd)
    if (line.length > 0 && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1)
    const sizeText = new TextDecoder().decode(line).split(';')[0]?.trim() ?? ''
    const size = Number.parseInt(sizeText, 16)
    if (!Number.isFinite(size) || size < 0) return { data: decodeBytes(out), complete: false }
    i = lineEnd + 1
    if (size === 0) {
      if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) return { data: decodeBytes(out), complete: true }
      if (bytes[i] === 0x0a) return { data: decodeBytes(out), complete: true }
      const end = indexOfCrlfPair(bytes, i)
      if (end < 0) return { data: decodeBytes(out), complete: false }
      return { data: decodeBytes(out), complete: true }
    }
    if (i + size > bytes.length) return { data: decodeBytes(out), complete: false }
    for (let n = 0; n < size; n += 1) out.push(bytes[i + n]!)
    i += size
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) i += 2
    else if (bytes[i] === 0x0a) i += 1
    else return { data: decodeBytes(out), complete: false }
  }
  return { data: decodeBytes(out), complete: false }
}

function decodeBytes(bytes: number[]): string {
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

function indexOfCrlfPair(bytes: Uint8Array, from: number): number {
  for (let i = from; i + 3 < bytes.length; i += 1) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a && bytes[i + 2] === 0x0d && bytes[i + 3] === 0x0a) return i
  }
  for (let i = from; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === 0x0a && bytes[i + 1] === 0x0a) return i
  }
  return -1
}
