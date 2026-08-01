/** 表数据多格式导出 / 简易导入解析（CSV · SQL INSERT · Excel SpreadsheetML · JSON）。 */

import { quoteIdent, qualifiedName } from '@/modules/mysql/sql-seed'
import { exportQueryResultAsCsv } from '@/modules/mysql/utils/export-csv'
import { parseCsv } from '@/modules/vastbase/utils/parse-csv'

export type BrowseDataFormat = 'csv' | 'sql' | 'xls' | 'json'

/**
 * ISO-8601（`2026-07-23T06:36:55Z`）→ MySQL DATETIME 字面量（`2026-07-23 06:36:55`）。
 * 复制粘贴 / 行编辑写回时后端常带 T/Z，MySQL 会报 Error 1292。
 */
const ISO_DATETIME_RE =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i

export function normalizeMysqlDateTimeString(value: string): string {
  const t = value.trim()
  const m = t.match(ISO_DATETIME_RE)
  if (!m) return t
  return `${m[1]} ${m[2]}${m[3] ?? ''}`
}

/** null→NULL；number / bool；string 转义单引号；ISO 日期时间规范化。 */
export function toSqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'NULL'
    return String(v)
  }
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (typeof v === 'object') {
    return `'${JSON.stringify(v).replaceAll("'", "''")}'`
  }
  const s = normalizeMysqlDateTimeString(String(v))
  return `'${s.replaceAll("'", "''")}'`
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function flattenCellText(s: string): string {
  return s.replace(/\r\n|\r|\n/g, ' ')
}

/** 生成 INSERT SQL 文本。 */
export function buildInsertSqlText(
  database: string,
  table: string,
  columns: Array<{ name: string }>,
  rows: unknown[][],
): string {
  const cols = columns.map((c) => quoteIdent(c.name)).join(', ')
  const target = qualifiedName(database, table)
  const tuples = rows.map((row) => {
    const vals = columns.map((_, i) => toSqlLiteral(row[i] ?? null))
    return `(${vals.join(', ')})`
  })
  if (tuples.length === 0) return `-- no rows\n`
  return `INSERT INTO ${target} (${cols}) VALUES ${tuples.join(', ')};\n`
}

/**
 * WHERE 等值片段：NULL 用 IS NULL（对齐 DBeaver / Navicat，避免 `= NULL`）。
 */
export function sqlWhereEquals(column: string, value: unknown): string {
  if (value === null || value === undefined) {
    return `${quoteIdent(column)} IS NULL`
  }
  return `${quoteIdent(column)} = ${toSqlLiteral(value)}`
}

function resolveKeyColumns(
  keyColumns: string[],
  fallbackColumns: string[],
  row: Record<string, unknown>,
): string[] {
  if (keyColumns.length > 0) return keyColumns
  if (fallbackColumns.length > 0) return fallbackColumns
  return Object.keys(row).filter((k) => !k.startsWith('__'))
}

/**
 * 生成 DELETE SQL（每行一条）。
 * keyColumns 一般为主键；为空时用 fallbackColumns（通常为全列，对齐 DBeaver
 * SQLGeneratorDelete：无 key 时 getAllAttributes）。
 */
export function buildDeleteSqlText(
  database: string,
  table: string,
  keyColumns: string[],
  rows: Array<Record<string, unknown>>,
  fallbackColumns: string[] = [],
): string {
  const target = qualifiedName(database, table)
  if (rows.length === 0) return `-- no rows\n`
  return (
    rows
      .map((row) => {
        const cols = resolveKeyColumns(keyColumns, fallbackColumns, row)
        if (cols.length === 0) return `-- no columns`
        const where = cols.map((c) => sqlWhereEquals(c, row[c])).join(' AND ')
        return `DELETE FROM ${target} WHERE ${where};`
      })
      .join('\n') + '\n'
  )
}

/**
 * 生成 UPDATE SQL（每行一条）。
 * SET 写全部 columns；WHERE 用主键，无主键时用 fallbackColumns（全列）。
 */
export function buildUpdateSqlText(
  database: string,
  table: string,
  columns: string[],
  keyColumns: string[],
  rows: Array<Record<string, unknown>>,
  fallbackColumns: string[] = [],
): string {
  const target = qualifiedName(database, table)
  if (rows.length === 0 || columns.length === 0) return `-- no rows\n`
  return (
    rows
      .map((row) => {
        const keys = resolveKeyColumns(keyColumns, fallbackColumns, row)
        if (keys.length === 0) return `-- no columns`
        const set = columns
          .map((c) => `${quoteIdent(c)} = ${toSqlLiteral(row[c])}`)
          .join(', ')
        const where = keys.map((c) => sqlWhereEquals(c, row[c])).join(' AND ')
        return `UPDATE ${target} SET ${set} WHERE ${where};`
      })
      .join('\n') + '\n'
  )
}

/** 生成 SpreadsheetML（.xls）文本。 */
export function buildSpreadsheetXmlText(
  columns: Array<{ name: string }>,
  rows: unknown[][],
  sheetName = 'Sheet1',
): string {
  const header = columns
    .map((c) => `<Cell><Data ss:Type="String">${escapeXml(c.name)}</Data></Cell>`)
    .join('')
  const body = rows
    .map((row) => {
      const cells = columns
        .map((_, i) => {
          const raw = row[i]
          if (raw === null || raw === undefined) {
            return `<Cell><Data ss:Type="String"></Data></Cell>`
          }
          if (typeof raw === 'number' && Number.isFinite(raw)) {
            return `<Cell><Data ss:Type="Number">${raw}</Data></Cell>`
          }
          return `<Cell><Data ss:Type="String">${escapeXml(cellText(raw))}</Data></Cell>`
        })
        .join('')
      return `<Row>${cells}</Row>`
    })
    .join('')

  return (
    `<?xml version="1.0"?>` +
    `<?mso-application progid="Excel.Application"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="${escapeXml(sheetName)}"><Table>` +
    `<Row>${header}</Row>${body}` +
    `</Table></Worksheet></Workbook>`
  )
}

/** 生成 CSV 文本（含 UTF-8 BOM）。 */
export function buildCsvText(columns: Array<{ name: string }>, rows: unknown[][]): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const raw = typeof v === 'object' ? JSON.stringify(v) : String(v)
    const s = flattenCellText(raw)
    if (/[",]/.test(s)) return `"${s.replaceAll('"', '""')}"`
    return s
  }
  const lines = [
    columns.map((c) => escape(c.name)).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ]
  return `\uFEFF${lines.join('\r\n')}`
}

/** 生成 JSON 文本：`{ columns, rows }`。 */
export function buildJsonText(columns: Array<{ name: string }>, rows: unknown[][]): string {
  return JSON.stringify(
    {
      columns: columns.map((c) => c.name),
      rows: rows.map((row) =>
        columns.map((_, i) => {
          const v = row[i]
          if (v === null || v === undefined) return null
          if (typeof v === 'object') return v
          return v
        }),
      ),
    },
    null,
    2,
  )
}

export interface BrowseExportPayload {
  content: string
  filename: string
  accept: string[]
}

export interface BrowseExportOptions {
  database: string
  table: string
  columns: Array<{ name: string }>
  rows: unknown[][]
  baseName: string
}

/** 构建可写入本地文件的导出内容（供壳层 saveFile / writeText 使用）。 */
export function buildBrowseExportPayload(
  format: BrowseDataFormat,
  options: BrowseExportOptions,
): BrowseExportPayload {
  const { database, table, columns, rows, baseName } = options
  const stamp = `${baseName}-${Date.now()}`
  if (format === 'csv') {
    return {
      content: buildCsvText(columns, rows),
      filename: `${stamp}.csv`,
      accept: ['.csv'],
    }
  }
  if (format === 'sql') {
    return {
      content: buildInsertSqlText(database, table, columns, rows),
      filename: `${stamp}.sql`,
      accept: ['.sql'],
    }
  }
  if (format === 'json') {
    return {
      content: buildJsonText(columns, rows),
      filename: `${stamp}.json`,
      accept: ['.json'],
    }
  }
  return {
    content: buildSpreadsheetXmlText(columns, rows, table),
    filename: `${stamp}.xls`,
    accept: ['.xls'],
  }
}

export function exportBrowseData(format: BrowseDataFormat, options: BrowseExportOptions): void {
  const { database, table, columns, rows, baseName } = options
  const stamp = `${baseName}-${Date.now()}`
  if (format === 'csv') {
    exportQueryResultAsCsv(columns, rows, stamp)
    return
  }
  if (format === 'sql') {
    const body = buildInsertSqlText(database, table, columns, rows)
    downloadBlob(new Blob([body], { type: 'application/sql;charset=utf-8' }), `${stamp}.sql`)
    return
  }
  if (format === 'json') {
    const body = buildJsonText(columns, rows)
    downloadBlob(new Blob([body], { type: 'application/json;charset=utf-8' }), `${stamp}.json`)
    return
  }
  const xml = buildSpreadsheetXmlText(columns, rows, table)
  downloadBlob(new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' }), `${stamp}.xls`)
}

export function acceptExtensionsForFormat(format: BrowseDataFormat): string[] {
  if (format === 'csv') return ['.csv', '.txt']
  if (format === 'sql') return ['.sql', '.txt']
  if (format === 'json') return ['.json', '.txt']
  // 仅 SpreadsheetML 文本 .xls / .xml；二进制 .xlsx 无法用 readText 解析
  return ['.xls', '.xml']
}

export interface ParsedBrowseData {
  columns: string[]
  rows: string[][]
}

function stripIdentQuotes(name: string): string {
  const s = name.trim()
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith('`') && s.endsWith('`')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1).replaceAll('""', '"').replaceAll('``', '`')
  }
  return s
}

/** 修复旧版壳层 writeText 把 JSON `\n` 写成字母 `n` 的损坏 SQL。 */
export function repairBrokenSqlNewlines(text: string): string {
  if (text.includes('\n') || text.includes('\r')) return text
  if (!/\)nVALUES\b/i.test(text)) return text
  return text.replace(/\)nVALUES\b/gi, ') VALUES').replace(/,n\(/g, ', (')
}

/** 解析简单 INSERT … VALUES (…), (…)；忽略注释与空行。 */
export function parseInsertSql(text: string): ParsedBrowseData {
  const cleaned = repairBrokenSqlNewlines(text)
    .replace(/^\uFEFF/, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .trim()
  if (!cleaned) return { columns: [], rows: [] }

  const bridge = /\)\s*values\b/i.exec(cleaned)
  if (!bridge) return { columns: [], rows: [] }

  const beforeValues = cleaned.slice(0, bridge.index + 1).trimEnd()
  const colMatch = /\(\s*([^)]+?)\s*\)\s*$/.exec(beforeValues)
  if (!colMatch) return { columns: [], rows: [] }

  const columns = colMatch[1]!
    .split(',')
    .map((h) => stripIdentQuotes(h))
    .filter(Boolean)

  const valuesPart = cleaned
    .slice(bridge.index + bridge[0].length)
    .trim()
    .replace(/;\s*$/, '')
  const rows: string[][] = []
  let depth = 0
  let inQuote: string | null = null
  let tuple = ''

  for (let i = 0; i < valuesPart.length; i++) {
    const ch = valuesPart[i]!
    if (inQuote) {
      tuple += ch
      if (ch === inQuote) {
        if (valuesPart[i + 1] === inQuote) {
          tuple += valuesPart[i + 1]!
          i += 1
          continue
        }
        inQuote = null
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch
      tuple += ch
      continue
    }
    if (ch === '(') {
      depth += 1
      if (depth === 1) {
        tuple = ''
        continue
      }
      tuple += ch
      continue
    }
    if (ch === ')') {
      depth -= 1
      if (depth === 0) {
        rows.push(splitSqlTuple(tuple))
        tuple = ''
        continue
      }
      tuple += ch
      continue
    }
    if (depth >= 1) tuple += ch
  }

  return { columns, rows }
}

function splitSqlTuple(tuple: string): string[] {
  const cells: string[] = []
  let buf = ''
  let inQuote: string | null = null
  let escape = false
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i]!
    if (inQuote) {
      if (escape) {
        buf += ch
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === inQuote) {
        if (tuple[i + 1] === inQuote) {
          buf += inQuote
          i += 1
          continue
        }
        inQuote = null
        continue
      }
      buf += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch
      continue
    }
    if (ch === ',') {
      cells.push(normalizeSqlCell(buf))
      buf = ''
      continue
    }
    buf += ch
  }
  cells.push(normalizeSqlCell(buf))
  return cells
}

function normalizeSqlCell(raw: string): string {
  const s = raw.trim()
  if (/^null$/i.test(s)) return ''
  return s
}

function elementsByLocalName(root: ParentNode, localName: string): Element[] {
  const all = (root as Document | Element).getElementsByTagName('*')
  const out: Element[] = []
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!
    if (el.localName === localName) out.push(el)
  }
  return out
}

function childrenByLocalName(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((el) => el.localName === localName)
}

/** 是否为 OOXML (.xlsx) 等 ZIP 二进制，而非 SpreadsheetML 文本。 */
export function looksLikeOfficeZip(text: string): boolean {
  return text.length >= 2 && text.charCodeAt(0) === 0x50 && text.charCodeAt(1) === 0x4b
}

/** 解析 SpreadsheetML / 简单 HTML table（Excel 另存为 XML/HTML）。 */
export function parseSpreadsheetXml(text: string): ParsedBrowseData {
  const raw = text.replace(/^\uFEFF/, '').trim()
  if (!raw || looksLikeOfficeZip(raw)) return { columns: [], rows: [] }

  const doc = new DOMParser().parseFromString(raw, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    const html = new DOMParser().parseFromString(raw, 'text/html')
    const trs = Array.from(html.querySelectorAll('table tr'))
    if (trs.length === 0) return { columns: [], rows: [] }
    const matrix = trs.map((tr) =>
      Array.from(tr.querySelectorAll('th,td')).map((td) => (td.textContent ?? '').trim()),
    )
    return { columns: matrix[0] ?? [], rows: matrix.slice(1) }
  }

  const rows = elementsByLocalName(doc, 'Row')
  if (rows.length === 0) return { columns: [], rows: [] }
  const matrix = rows.map((row) => {
    const cells = childrenByLocalName(row, 'Cell')
    return cells.map((cell) => {
      const data = childrenByLocalName(cell, 'Data')[0] ?? elementsByLocalName(cell, 'Data')[0]
      return (data?.textContent ?? '').trim()
    })
  })
  return { columns: matrix[0] ?? [], rows: matrix.slice(1) }
}

/** 解析 JSON：对象数组，或 `{ columns, rows }` / `{ headers, rows }`。 */
export function parseJsonTable(text: string): ParsedBrowseData {
  const raw = text.replace(/^\uFEFF/, '').trim()
  if (!raw) return { columns: [], rows: [] }
  try {
    const data = JSON.parse(raw) as unknown
    if (Array.isArray(data)) {
      if (data.length === 0) return { columns: [], rows: [] }
      if (typeof data[0] !== 'object' || data[0] === null || Array.isArray(data[0])) {
        return { columns: [], rows: [] }
      }
      const columns: string[] = []
      for (const item of data) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
        for (const key of Object.keys(item)) {
          if (!columns.includes(key)) columns.push(key)
        }
      }
      const rows = data.map((item) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          return columns.map(() => '')
        }
        const obj = item as Record<string, unknown>
        return columns.map((c) => {
          const v = obj[c]
          if (v === null || v === undefined) return ''
          if (typeof v === 'object') return JSON.stringify(v)
          return String(v)
        })
      })
      return { columns, rows }
    }
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>
      const colsRaw = obj.columns ?? obj.headers
      const rowsRaw = obj.rows
      if (!Array.isArray(colsRaw) || !Array.isArray(rowsRaw)) return { columns: [], rows: [] }
      const columns = colsRaw.map((c) => String(c))
      const rows = rowsRaw.map((row) => {
        if (!Array.isArray(row)) return columns.map(() => '')
        return columns.map((_, i) => {
          const v = row[i]
          if (v === null || v === undefined) return ''
          if (typeof v === 'object') return JSON.stringify(v)
          return String(v)
        })
      })
      return { columns, rows }
    }
  } catch {
    return { columns: [], rows: [] }
  }
  return { columns: [], rows: [] }
}

export function parseBrowseImport(format: BrowseDataFormat, text: string): ParsedBrowseData {
  const normalized = text.replace(/^\uFEFF/, '')
  if (format === 'csv') {
    const parsed = parseCsv(normalized)
    return { columns: parsed.headers, rows: parsed.rows }
  }
  if (format === 'sql') return parseInsertSql(normalized)
  if (format === 'json') return parseJsonTable(normalized)
  return parseSpreadsheetXml(normalized)
}
