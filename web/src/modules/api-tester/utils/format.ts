/**
 * 跨协议展示：字节、hex、状态色、键值行。
 * curl 在 http/utils/curl，不放这里。
 */
import { createId } from '@/utils/id'
import type { ApiKvRow } from '../types'

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
