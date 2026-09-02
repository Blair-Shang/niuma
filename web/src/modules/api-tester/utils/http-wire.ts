import { enabledRows, interpolateEnv } from './format'
import type { ApiEnvironment, ApiKvRow, ApiRequest } from '../types'

/** 把工作台请求编成 HTTP/1.1 明文（经 api-service TCP 发出）。 */
export function buildHttpRequest(req: ApiRequest, env: ApiEnvironment | undefined, path: string, host: string, port: number): string {
  const hostHeader = formatHostHeader(host, port)
  const headers = new Map<string, string>()
  headers.set('host', hostHeader)
  headers.set('connection', 'close')
  for (const row of enabledRows(req.headers)) {
    const key = row.key.trim()
    if (!key) continue
    headers.set(key.toLowerCase(), interpolateEnv(row.value, env))
  }

  const body = req.method === 'GET' || req.method === 'HEAD' ? '' : interpolateEnv(req.body, env)
  if (body && !headers.has('content-length')) {
    headers.set('content-length', String(new TextEncoder().encode(body).length))
  }

  const lines = [`${req.method} ${path || '/'} HTTP/1.1`]
  for (const [key, value] of headers) {
    lines.push(`${titleHeader(key)}: ${value}`)
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

/** 解析已收到的 HTTP 响应；缺头或未凑齐 Content-Length 时 complete=false。 */
export function parseHttpResponse(raw: string, method: string): ParsedHttpResponse | null {
  const sep = headerSep(raw)
  if (sep < 0) return null
  const head = raw.slice(0, sep)
  const body = raw.slice(sep + (raw.includes('\r\n\r\n') ? 4 : 2))
  const lines = head.split(/\r?\n/)
  const start = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/.exec(lines[0] ?? '')
  if (!start) return null
  const headers: ApiKvRow[] = []
  let contentLength: number | null = null
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    headers.push({ id: `hdr-${headers.length}`, enabled: true, key, value })
    if (key.toLowerCase() === 'content-length') {
      const n = Number(value)
      if (Number.isInteger(n) && n >= 0) contentLength = n
    }
  }
  const expectBody = method !== 'HEAD' && contentLength !== 0
  const complete =
    method === 'HEAD' ||
    (contentLength != null && new TextEncoder().encode(body).length >= contentLength) ||
    (!expectBody && contentLength === 0)
  return {
    status: Number(start[1]),
    statusText: (start[2] ?? '').trim(),
    headers,
    body,
    complete,
  }
}

function headerSep(raw: string): number {
  const crlf = raw.indexOf('\r\n\r\n')
  if (crlf >= 0) return crlf
  return raw.indexOf('\n\n')
}

function formatHostHeader(host: string, port: number): string {
  const wrapped = host.includes(':') ? `[${host}]` : host
  return port === 80 ? wrapped : `${wrapped}:${port}`
}

function titleHeader(key: string): string {
  return key
    .split('-')
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join('-')
}
