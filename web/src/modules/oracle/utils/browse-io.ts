/**
 * Oracle Browse 当前页导入导出工具；不依赖其他数据库模块。
 * 解析能力对齐 MySQL browse-io（多行 INSERT / SpreadsheetML / 对象数组 JSON）。
 */
import { qualifiedName, quoteIdent } from '@/modules/oracle/sql-seed'
import { sqlWhereEquals, toSqlLiteral } from './sql-literal'

export type BrowseDataFormat = 'csv' | 'sql' | 'xls' | 'json'
export interface ParsedBrowseData { columns: string[]; rows: string[][] }
export interface BrowseExportPayload { content: string; filename: string; accept: string[] }
export interface BrowseExportOptions {
  schema: string
  table: string
  columns: Array<{ name: string }>
  rows: unknown[][]
  baseName: string
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function flattenCellText(s: string): string {
  return s.replace(/\r\n|\r|\n/g, ' ')
}

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"'
        index += 1
      } else quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else cell += char
  }
  cells.push(cell)
  return cells
}

export function buildInsertSqlText(
  schema: string, table: string, columns: Array<{ name: string }>, rows: unknown[][],
): string {
  if (rows.length === 0) return '-- no rows\n'
  const target = qualifiedName(schema, table)
  const names = columns.map((column) => quoteIdent(column.name)).join(', ')
  return rows
    .map((row) => `INSERT INTO ${target} (${names}) VALUES (${columns.map((_, i) => toSqlLiteral(row[i] ?? null)).join(', ')});`)
    .join('\n') + '\n'
}

function keyColumns(keys: string[], fallback: string[], row: Record<string, unknown>): string[] {
  return keys.length ? keys : fallback.length ? fallback : Object.keys(row).filter((key) => !key.startsWith('__'))
}

export function buildDeleteSqlText(
  schema: string, table: string, keys: string[], rows: Array<Record<string, unknown>>, fallback: string[] = [],
): string {
  const target = qualifiedName(schema, table)
  return rows.map((row) => {
    const columns = keyColumns(keys, fallback, row)
    return columns.length ? `DELETE FROM ${target} WHERE ${columns.map((column) => sqlWhereEquals(column, row[column])).join(' AND ')};` : '-- no columns'
  }).join('\n') + (rows.length ? '\n' : '-- no rows\n')
}

export function buildUpdateSqlText(
  schema: string, table: string, columns: string[], keys: string[], rows: Array<Record<string, unknown>>, fallback: string[] = [],
): string {
  const target = qualifiedName(schema, table)
  if (!rows.length || !columns.length) return '-- no rows\n'
  return rows.map((row) => {
    const locate = keyColumns(keys, fallback, row)
    if (!locate.length) return '-- no columns'
    const set = columns.map((column) => `${quoteIdent(column)} = ${toSqlLiteral(row[column])}`).join(', ')
    return `UPDATE ${target} SET ${set} WHERE ${locate.map((column) => sqlWhereEquals(column, row[column])).join(' AND ')};`
  }).join('\n') + '\n'
}

export function buildCsvText(columns: Array<{ name: string }>, rows: unknown[][]): string {
  const escape = (value: unknown) => {
    const text = flattenCellText(cellText(value))
    return /[",]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return `\uFEFF${[columns.map((column) => escape(column.name)).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\r\n')}`
}

export function buildJsonText(columns: Array<{ name: string }>, rows: unknown[][]): string {
  return JSON.stringify({
    columns: columns.map((column) => column.name),
    rows: rows.map((row) =>
      columns.map((_, i) => {
        const v = row[i]
        if (v === null || v === undefined) return null
        return v
      }),
    ),
  }, null, 2)
}

export function buildSpreadsheetXmlText(columns: Array<{ name: string }>, rows: unknown[][], sheetName = 'Sheet1'): string {
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

export function buildBrowseExportPayload(format: BrowseDataFormat, options: BrowseExportOptions): BrowseExportPayload {
  const stamp = `${options.baseName}-${Date.now()}`
  if (format === 'csv') return { content: buildCsvText(options.columns, options.rows), filename: `${stamp}.csv`, accept: ['.csv'] }
  if (format === 'sql') return { content: buildInsertSqlText(options.schema, options.table, options.columns, options.rows), filename: `${stamp}.sql`, accept: ['.sql'] }
  if (format === 'json') return { content: buildJsonText(options.columns, options.rows), filename: `${stamp}.json`, accept: ['.json'] }
  return { content: buildSpreadsheetXmlText(options.columns, options.rows, options.table), filename: `${stamp}.xls`, accept: ['.xls'] }
}

export function acceptExtensionsForFormat(format: BrowseDataFormat): string[] {
  return format === 'csv' ? ['.csv', '.txt'] : format === 'sql' ? ['.sql', '.txt'] : format === 'json' ? ['.json', '.txt'] : ['.xls', '.xml']
}

function parseCsv(text: string): ParsedBrowseData {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?|\n/g, '\n').split('\n').filter(Boolean)
  return lines.length
    ? { columns: splitCsvLine(lines[0]!).map((value) => value.trim()), rows: lines.slice(1).map(splitCsvLine) }
    : { columns: [], rows: [] }
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

function normalizeSqlCell(raw: string): string {
  const s = raw.trim()
  if (/^null$/i.test(s)) return ''
  return s
}

function splitSqlTuple(tuple: string): string[] {
  const cells: string[] = []
  let buf = ''
  let inQuote: string | null = null
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i]!
    if (inQuote) {
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

/** 解析 INSERT … VALUES (…), (…)；忽略注释与空行。 */
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

/** 是否为 OOXML (.xlsx) 等 ZIP 二进制，而非 SpreadsheetML 文本。 */
export function looksLikeOfficeZip(text: string): boolean {
  return text.length >= 2 && text.charCodeAt(0) === 0x50 && text.charCodeAt(1) === 0x4b
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
  if (format === 'csv') return parseCsv(normalized)
  if (format === 'sql') return parseInsertSql(normalized)
  if (format === 'json') return parseJsonTable(normalized)
  return parseSpreadsheetXml(normalized)
}
