/**
 * 表数据浏览单元格展示：NULL / 日期时间 / JSON / 二进制摘要 / 长文本截断。
 * - date / datetime：带时区 ISO → 本地；其余走 @niuma/ui 规范格式
 * - text 等：仅当值形态像带时区 ISO 时才转换（覆盖 SQLite TEXT 存 UTC）
 * - 二进制 `{ $bin }`：网格只显示摘要，避免把 base64 塞进 DOM
 * - 超长字符串：只预览前 N 字，完整内容走弹窗编辑
 */
import { formatDateTimeValue, formatDateValue } from '@niuma/ui'
import type { GridCellValueType } from './column-value-type'
import { formatIsoUtcToLocal, looksLikeIsoDateTimeWithTz } from './iso-local-datetime'

/** 网格内文本预览上限（字符），超出截断；完整值仅在弹窗查看/编辑 */
export const BROWSE_CELL_PREVIEW_CHARS = 200

/** 后端编码的二进制单元格：`{ $bin: base64 }` */
export function isBrowseBinCell(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      '$bin' in (value as Record<string, unknown>),
  )
}

/** Oracle 等：超预览上限的 LOB 单元格 `{ $lob: { type, preview, truncated, byteLength } }` */
export type BrowseLobMarker = {
  type?: string
  preview?: unknown
  value?: unknown
  truncated?: boolean
  byteLength?: number
}

export function getBrowseLobMarker(value: unknown): BrowseLobMarker | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!('$lob' in (value as Record<string, unknown>))) return null
  const lob = (value as { $lob?: unknown }).$lob
  if (!lob || typeof lob !== 'object' || Array.isArray(lob)) return null
  return lob as BrowseLobMarker
}

export function isBrowseLobCell(value: unknown): boolean {
  return getBrowseLobMarker(value) != null
}

export function isBrowseBinaryLobCell(value: unknown): boolean {
  if (isBrowseBinCell(value)) return true
  const lob = getBrowseLobMarker(value)
  if (!lob) return false
  return String(lob.type ?? '').toUpperCase() === 'BLOB'
}

/** CLOB `$lob` → 可编辑/展示的文本（preview）；BLOB `$lob` 不走此路径。 */
export function extractBrowseLobText(value: unknown): string {
  const lob = getBrowseLobMarker(value)
  if (!lob) return ''
  const raw = lob.preview ?? lob.value ?? ''
  return typeof raw === 'string' ? raw : JSON.stringify(raw)
}

export function formatBrowseLobSummary(value: unknown): string {
  const lob = getBrowseLobMarker(value)
  if (!lob) return 'LOB'
  const type = String(lob.type ?? 'LOB').toUpperCase()
  const size =
    typeof lob.byteLength === 'number' && Number.isFinite(lob.byteLength)
      ? formatByteSize(lob.byteLength)
      : undefined
  if (type === 'BLOB') {
    return size ? `BLOB · ${size}` : 'BLOB'
  }
  const preview = extractBrowseLobText(value)
  const head = truncateBrowsePreview(preview)
  if (!lob.truncated) return head
  return size ? `${head} … [CLOB · ${size}]` : `${head} … [CLOB truncated]`
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/** base64 长度近似原始字节数 */
export function estimateBase64Bytes(base64: string): number {
  const len = base64.replace(/\s/g, '').length
  if (len <= 0) return 0
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((len * 3) / 4) - padding)
}

export function formatBrowseBinSummary(value: unknown): string {
  if (!isBrowseBinCell(value)) return 'BLOB'
  const b64 = String((value as { $bin?: unknown }).$bin ?? '')
  return `BLOB · ${formatByteSize(estimateBase64Bytes(b64))}`
}

/** 二进制只读查看：摘要 + 短 hex 头（只解码 base64 前缀，不展开全量） */
export function formatBrowseBinViewText(value: unknown, previewBytes = 64): string {
  const summary = formatBrowseBinSummary(value)
  if (!isBrowseBinCell(value)) return summary
  const b64 = String((value as { $bin?: unknown }).$bin ?? '').replace(/\s/g, '')
  const bytes = estimateBase64Bytes(b64)
  const lines = [summary, `size: ${formatByteSize(bytes)}`]
  if (!b64 || previewBytes <= 0) return lines.join('\n')
  const needChars = Math.ceil(previewBytes / 3) * 4 + 4
  try {
    const binary = atob(b64.slice(0, needChars))
    const n = Math.min(binary.length, previewBytes)
    const parts: string[] = new Array(n)
    for (let i = 0; i < n; i += 1) {
      parts[i] = binary.charCodeAt(i).toString(16).padStart(2, '0')
    }
    lines.push('', `hex[0..${previewBytes}):`, parts.join(' '))
    if (bytes > previewBytes) lines.push('…')
  } catch {
    /* ignore decode errors */
  }
  return lines.join('\n')
}

export function truncateBrowsePreview(
  text: string,
  maxChars = BROWSE_CELL_PREVIEW_CHARS,
): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}…`
}

export function formatBrowseCellValue(
  value: unknown,
  valueType: GridCellValueType = 'text',
): string {
  if (value === null || value === undefined) return 'NULL'

  if (isBrowseBinCell(value)) return formatBrowseBinSummary(value)
  if (isBrowseLobCell(value)) return formatBrowseLobSummary(value)

  if (valueType === 'date') {
    if (typeof value === 'string') {
      const local = formatIsoUtcToLocal(value)
      if (local) return local.slice(0, 10)
    }
    const raw = String(value)
    return formatDateValue(raw) || raw
  }

  if (valueType === 'datetime') {
    if (typeof value === 'string') {
      const local = formatIsoUtcToLocal(value)
      if (local) return local
    }
    const raw = String(value)
    return formatDateTimeValue(raw) || raw
  }

  // 非时间列：廉价前缀命中才尝试（避免对 SYSTEM / id 等跑完整解析）
  if (typeof value === 'string' && looksLikeIsoDateTimeWithTz(value.trim())) {
    const local = formatIsoUtcToLocal(value)
    if (local) return local
  }

  if (typeof value === 'object') {
    return truncateBrowsePreview(JSON.stringify(value))
  }

  return truncateBrowsePreview(String(value))
}
