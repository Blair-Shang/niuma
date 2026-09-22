/**
 * 展示层格式化：curl、字节、hex、状态色。
 * 插值与拼包走 request-resolve，这里不再自己合并变量表。
 */
import { createId } from '@/utils/id'
import type { ApiEnvironment, ApiKvRow, ApiRequest } from '../types'
import { titleHttpHeader } from '../http/http-wire'
import { resolveRequest } from '../http/request-resolve'
import type { ApiVariableScope } from './folder-tree'

export function enabledRows(rows: ApiKvRow[]): ApiKvRow[] {
  return rows.filter((row) => row.enabled && row.key.trim())
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

/** 把十六进制字符串打成 Hex + ASCII 对照。 */
export function formatHexDumpFromHex(hex: string): string {
  const cleaned = hex.replace(/[^0-9a-fA-F]/g, '')
  const bytes = new Uint8Array(Math.floor(cleaned.length / 2))
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  }
  return formatHexBytes(bytes)
}

/** 把文本打成 Hex + ASCII 对照，16 字节一行。 */
export function formatHexDump(text: string): string {
  return formatHexBytes(new TextEncoder().encode(text))
}

function formatHexBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  const lines: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const slice = bytes.subarray(offset, offset + 16)
    const hexParts: string[] = []
    let ascii = ''
    for (let i = 0; i < slice.length; i += 1) {
      const byte = slice[i]!
      hexParts.push(byte.toString(16).padStart(2, '0'))
      if (i === 7) hexParts.push('')
      ascii += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.'
    }
    lines.push(`${offset.toString(16).padStart(4, '0')}  ${hexParts.join(' ').padEnd(48)}  ${ascii}`)
  }
  return lines.join('\n')
}

export function prettyJson(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return text
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return text
  }
}

/** 生成可粘贴的 curl（仅演示，不含 cookie 文件）。 */
export function buildCurl(
  req: ApiRequest,
  env: ApiEnvironment | undefined,
  scope?: ApiVariableScope,
): string {
  const resolved = resolveRequest(req, env, scope)
  const parts = ['curl']
  if (req.method !== 'GET' && req.method !== 'TCP' && req.method !== 'UDP' && req.method !== 'WS') {
    parts.push('-X', req.method)
  }
  parts.push(shellQuote(resolved.url))

  for (const [key, value] of resolved.headers) {
    parts.push('-H', shellQuote(`${titleHttpHeader(key)}: ${value}`))
  }

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'TCP') {
    return parts.join(' ')
  }
  if (req.bodyMode === 'urlencoded' && resolved.body) {
    parts.push('--data-urlencode', shellQuote(resolved.body))
    return parts.join(' ')
  }
  if (resolved.body) {
    parts.push('--data-raw', shellQuote(resolved.body))
  }
  return parts.join(' ')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function newKvRow(key = '', value = '', enabled = true): ApiKvRow {
  return {
    id: createId('kv'),
    enabled,
    key,
    value,
  }
}

export function methodTone(method: string): 'get' | 'post' | 'put' | 'delete' | 'other' {
  switch (method) {
    case 'GET':
    case 'HEAD':
      return 'get'
    case 'POST':
    case 'WS':
      return 'post'
    case 'PUT':
    case 'PATCH':
      return 'put'
    case 'DELETE':
      return 'delete'
    default:
      return 'other'
  }
}

export function statusTone(status: number | null, ok: boolean): 'success' | 'warning' | 'danger' | 'muted' {
  if (!ok) return 'danger'
  if (status == null) return 'success'
  if (status >= 200 && status < 300) return 'success'
  if (status >= 400 && status < 500) return 'warning'
  if (status >= 500) return 'danger'
  return 'muted'
}
