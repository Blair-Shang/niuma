/** 表数据多格式导出 / 简易导入解析（CSV · SQL INSERT · Excel SpreadsheetML）。 */

import { quoteIdent, qualifiedName } from '@/modules/postgres/sql-seed'
import { toSqlLiteral } from '@/modules/postgres/utils/sql-literal'
import { exportQueryResultAsCsv } from '@/modules/postgres/utils/export-csv'
import { parseCsv } from '@/modules/postgres/utils/parse-csv'

export type BrowseDataFormat = 'csv' | 'json' | 'tsv' | 'sql' | 'xls'

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
  // 单行写出，避免历史壳层 JsonGetString 把 \n 解成字母 n 导致文件损坏
  return `INSERT INTO ${target} (${cols}) VALUES ${tuples.join(', ')};\n`
}

/** 导出当前结果为 INSERT SQL。 */
export function exportQueryResultAsSql(
  schema: string,
  table: string,
  columns: Array<{ name: string }>,
  rows: unknown[][],
  filename: string,
): void {
  const body = buildInsertSqlText(schema, table, columns, rows)
  const blob = new Blob([body], { type: 'application/sql;charset=utf-8' })
  downloadBlob(blob, filename.endsWith('.sql') ? filename : `${filename}.sql`)
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
    .join('\n')

  // 紧凑单行，降低历史壳层 writeText 转义 bug 的影响
  return (
    `<?xml version="1.0"?>` +
    `<?mso-application progid="Excel.Application"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="${escapeXml(sheetName)}"><Table>` +
    `<Row>${header}</Row>${body.replace(/\n/g, '')}` +
    `</Table></Worksheet></Workbook>`
  )
}

/**
 * 导出 Excel 可打开的 SpreadsheetML（.xls）。
 * 无需第三方库；Excel / WPS 可直接打开。
 */
export function exportQueryResultAsXls(
  columns: Array<{ name: string }>,
  rows: unknown[][],
  filename: string,
  sheetName = 'Sheet1',
): void {
  const xml = buildSpreadsheetXmlText(columns, rows, sheetName)
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' })
  downloadBlob(blob, filename.endsWith('.xls') ? filename : `${filename}.xls`)
}

function flattenCellText(s: string): string {
  return s.replace(/\r\n|\r|\n/g, ' ')
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

export interface BrowseExportPayload {
  content: string
  filename: string
  accept: string[]
}

/** 构建可写入本地文件的导出内容（供壳层 saveFile / writeText 使用）。 */
export function buildBrowseExportPayload(
  format: BrowseDataFormat,
  options: {
    schema: string
    table: string
    columns: Array<{ name: string }>
    rows: unknown[][]
    baseName: string
  },
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
  if (format === 'json') {
    return {
      content: JSON.stringify(rows.map((row) => Object.fromEntries(columns.map((column, i) => [column.name, row[i] ?? null]))), null, 2),
      filename: `${stamp}.json`,
      accept: ['.json'],
    }
  }
  if (format === 'tsv') {
    return {
      content: [columns.map((column) => column.name).join('\t'), ...rows.map((row) => row.map((cell) => cellText(cell).replaceAll('\t', ' ').replaceAll('\n', ' ')).join('\t'))].join('\n'),
      filename: `${stamp}.tsv`,
      accept: ['.tsv', '.txt'],
    }
  }
  if (format === 'sql') {
    return {
      content: buildInsertSqlText(schema, table, columns, rows),
      filename: `${stamp}.sql`,
      accept: ['.sql'],
    }
  }
  return {
    content: buildSpreadsheetXmlText(columns, rows, table),
    filename: `${stamp}.xls`,
    accept: ['.xls'],
  }
}

export function exportBrowseData(
  format: BrowseDataFormat,
  options: {
    schema: string
    table: string
    columns: Array<{ name: string }>
    rows: unknown[][]
    baseName: string
  },
): void {
  const { schema, table, columns, rows, baseName } = options
  const stamp = `${baseName}-${Date.now()}`
  if (format === 'csv') {
    exportQueryResultAsCsv(columns, rows, stamp)
    return
  }
  if (format === 'sql') {
    exportQueryResultAsSql(schema, table, columns, rows, stamp)
    return
  }
  exportQueryResultAsXls(columns, rows, stamp, table)
}

export function acceptExtensionsForFormat(format: BrowseDataFormat): string[] {
  if (format === 'csv') return ['.csv', '.txt']
  if (format === 'json') return ['.json']
  if (format === 'tsv') return ['.tsv', '.txt']
  if (format === 'sql') return ['.sql', '.txt']
  // 仅 SpreadsheetML 文本 .xls / .xml；二进制 .xlsx 无法用 readText 解析
  return ['.xls', '.xml']
}

export interface ParsedTableData {
  headers: string[]
  rows: string[][]
}

function stripIdentQuotes(name: string): string {
  const s = name.trim()
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith('`') && s.endsWith('`')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1).replaceAll('""', '"')
  }
  return s
}

/**
 * 修复旧版壳层 writeText 把 JSON `\n` 写成字母 `n` 的损坏 SQL：
 * `)nVALUES` → `) VALUES`，`,n(` → `, (`。
 */
export function repairBrokenSqlNewlines(text: string): string {
  if (text.includes('\n') || text.includes('\r')) return text
  if (!/\)nVALUES\b/i.test(text)) return text
  return text.replace(/\)nVALUES\b/gi, ') VALUES').replace(/,n\(/g, ', (')
}

/** 解析简单 INSERT … VALUES (…), (…)；忽略注释与空行。 */
export function parseInsertSql(text: string): ParsedTableData {
  const cleaned = repairBrokenSqlNewlines(text)
    .replace(/^\uFEFF/, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .trim()
  if (!cleaned) return { headers: [], rows: [] }

  // 定位「列清单 )」与 VALUES 的衔接，避免列名恰好叫 values 时误匹配
  const bridge = /\)\s*values\b/i.exec(cleaned)
  if (!bridge) return { headers: [], rows: [] }

  const beforeValues = cleaned.slice(0, bridge.index + 1).trimEnd()
  const colMatch = /\(\s*([^)]+?)\s*\)\s*$/.exec(beforeValues)
  if (!colMatch) return { headers: [], rows: [] }

  const headers = colMatch[1]!
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
        // SQL '' / "" 转义
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

  return { headers, rows }
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
        // '' escape inside SQL string
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
export function parseSpreadsheetXml(text: string): ParsedTableData {
  const raw = text.replace(/^\uFEFF/, '').trim()
  if (!raw || looksLikeOfficeZip(raw)) return { headers: [], rows: [] }

  const doc = new DOMParser().parseFromString(raw, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    const html = new DOMParser().parseFromString(raw, 'text/html')
    const trs = Array.from(html.querySelectorAll('table tr'))
    if (trs.length === 0) return { headers: [], rows: [] }
    const matrix = trs.map((tr) =>
      Array.from(tr.querySelectorAll('th,td')).map((td) => (td.textContent ?? '').trim()),
    )
    return { headers: matrix[0] ?? [], rows: matrix.slice(1) }
  }

  // SpreadsheetML 带默认 xmlns 时 getElementsByTagName('Row') 在 CEF 中常为空
  const rows = elementsByLocalName(doc, 'Row')
  if (rows.length === 0) return { headers: [], rows: [] }
  const matrix = rows.map((row) => {
    const cells = childrenByLocalName(row, 'Cell')
    return cells.map((cell) => {
      const data = childrenByLocalName(cell, 'Data')[0] ?? elementsByLocalName(cell, 'Data')[0]
      return (data?.textContent ?? '').trim()
    })
  })
  return { headers: matrix[0] ?? [], rows: matrix.slice(1) }
}

export function parseBrowseImport(format: BrowseDataFormat, text: string): ParsedTableData {
  const normalized = text.replace(/^\uFEFF/, '')
  if (format === 'csv') return parseCsv(normalized)
  if (format === 'json') {
    try {
      const values = JSON.parse(normalized) as Array<Record<string, unknown>>
      const headers = Object.keys(values[0] ?? {})
      return { headers, rows: values.map((value) => headers.map((header) => cellText(value[header]))) }
    } catch { return { headers: [], rows: [] } }
  }
  if (format === 'tsv') {
    const rows = normalized.split(/\r?\n/).filter(Boolean).map((line) => line.split('\t'))
    return { headers: rows[0] ?? [], rows: rows.slice(1) }
  }
  if (format === 'sql') return parseInsertSql(normalized)
  return parseSpreadsheetXml(normalized)
}

export function acceptForFormat(format: BrowseDataFormat): string {
  if (format === 'csv') return '.csv,text/csv'
  if (format === 'sql') return '.sql,text/plain'
  return '.xls,.xlsx,application/vnd.ms-excel,application/xml,text/xml'
}
