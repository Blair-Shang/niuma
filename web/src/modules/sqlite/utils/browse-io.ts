/**
 * SQLite Browse 本页多格式导出 / 简易导入解析（CSV · SQL INSERT · SpreadsheetML · JSON）。
 * 仅本模块使用；勿 import `@/modules/mysql/**`。
 */
import { quoteIdent, qualifiedName } from '@/modules/sqlite/sql-seed'
import { splitCsvLine } from '@/modules/sqlite/utils/csv-header'
import { sqlWhereEquals, toSqlLiteral } from '@/modules/sqlite/utils/sql-literal'

export type BrowseDataFormat = 'csv' | 'sql' | 'xls' | 'json'

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
  schema: string,
  table: string,
  columns: Array<{ name: string }>,
  rows: unknown[][],
): string {
  const cols = columns.map((c) => quoteIdent(c.name)).join(', ')
  const target = qualifiedName(schema, table)
  const tuples = rows.map((row) => {
    const vals = columns.map((_, i) => toSqlLiteral(row[i] ?? null))
    return `(${vals.join(', ')})`
  })
  if (tuples.length === 0) return `-- no rows\n`
  return `INSERT INTO ${target} (${cols}) VALUES ${tuples.join(', ')};\n`
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

export function buildDeleteSqlText(
  schema: string,
  table: string,
  keyColumns: string[],
  rows: Array<Record<string, unknown>>,
  fallbackColumns: string[] = [],
): string {
  const target = qualifiedName(schema, table)
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

export function buildUpdateSqlText(
  schema: string,
  table: string,
  columns: string[],
  keyColumns: string[],
  rows: Array<Record<string, unknown>>,
  fallbackColumns: string[] = [],
): string {
  const target = qualifiedName(schema, table)
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
  schema: string
  table: string
  columns: Array<{ name: string }>
  rows: unknown[][]
  baseName: string
}

export function buildBrowseExportPayload(
  format: BrowseDataFormat,
  options: BrowseExportOptions,
): BrowseExportPayload {
  const { schema, table, columns, rows, baseName } = options
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
      content: buildInsertSqlText(schema, table, columns, rows),
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

export function acceptExtensionsForFormat(format: BrowseDataFormat): string[] {
  if (format === 'csv') return ['.csv', '.txt']
  if (format === 'sql') return ['.sql', '.txt']
  if (format === 'json') return ['.json', '.txt']
  return ['.xls', '.xml']
}

export interface ParsedBrowseData {
  columns: string[]
  rows: string[][]
}

function parseCsvText(text: string): ParsedBrowseData {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').filter((l, idx, arr) => {
    if (l.length > 0) return true
    return idx < arr.length - 1 && arr.slice(idx + 1).some((x) => x.length > 0)
  })
  if (lines.length === 0) return { columns: [], rows: [] }
  const columns = splitCsvLine(lines[0]!).map((h) => h.trim())
  const rows: string[][] = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]!.trim()) continue
    rows.push(splitCsvLine(lines[i]!))
  }
  return { columns, rows }
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

export function repairBrokenSqlNewlines(text: string): string {
  if (text.includes('\n') || text.includes('\r')) return text
  if (!/\)nVALUES\b/i.test(text)) return text
  return text.replace(/\)nVALUES\b/gi, ') VALUES').replace(/,n\(/g, ', (')
}

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

export function looksLikeOfficeZip(text: string): boolean {
  return text.length >= 2 && text.charCodeAt(0) === 0x50 && text.charCodeAt(1) === 0x4b
}

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
  if (format === 'csv') return parseCsvText(normalized)
  if (format === 'sql') return parseInsertSql(normalized)
  if (format === 'json') return parseJsonTable(normalized)
  return parseSpreadsheetXml(normalized)
}
