/**
 * Oracle Browse 当前页导入导出工具；不依赖其他数据库模块。
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
    const text = cellText(value).replace(/\r\n|\r|\n/g, ' ')
    return /[",]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return `\uFEFF${[columns.map((column) => escape(column.name)).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\r\n')}`
}

export function buildJsonText(columns: Array<{ name: string }>, rows: unknown[][]): string {
  return JSON.stringify({ columns: columns.map((column) => column.name), rows }, null, 2)
}

export function buildSpreadsheetXmlText(columns: Array<{ name: string }>, rows: unknown[][], sheetName = 'Sheet1'): string {
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const row = (values: unknown[]) => `<Row>${values.map((value) => `<Cell><Data ss:Type="String">${escape(cellText(value))}</Data></Cell>`).join('')}</Row>`
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${escape(sheetName)}"><Table>${row(columns.map((column) => column.name))}${rows.map(row).join('')}</Table></Worksheet></Workbook>`
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
  return lines.length ? { columns: splitCsvLine(lines[0]!).map((value) => value.trim()), rows: lines.slice(1).map(splitCsvLine) } : { columns: [], rows: [] }
}

function parseJson(text: string): ParsedBrowseData {
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, '')) as { columns?: unknown; rows?: unknown }
    if (!Array.isArray(value.columns) || !Array.isArray(value.rows)) return { columns: [], rows: [] }
    return { columns: value.columns.map(String), rows: value.rows.map((row) => Array.isArray(row) ? row.map((cell) => cell == null ? '' : cellText(cell)) : []) }
  } catch { return { columns: [], rows: [] } }
}

export function looksLikeOfficeZip(text: string): boolean {
  return text.length >= 2 && text.charCodeAt(0) === 0x50 && text.charCodeAt(1) === 0x4b
}

/** 支持本模块导出的简单 INSERT VALUES 文本。 */
export function parseInsertSql(text: string): ParsedBrowseData {
  const match = /INSERT\s+INTO\s+.+?\(([^)]+)\)\s+VALUES\s*\(([^)]+)\)/is.exec(text)
  if (!match) return { columns: [], rows: [] }
  const columns = match[1]!.split(',').map((name) => name.trim().replace(/^"|"$/g, '').replaceAll('""', '"'))
  const values = splitCsvLine(match[2]!).map((value) => value.trim().replace(/^'|'$/g, '').replaceAll("''", "'"))
  return { columns, rows: [values] }
}

export function parseBrowseImport(format: BrowseDataFormat, text: string): ParsedBrowseData {
  if (format === 'csv') return parseCsv(text)
  if (format === 'json') return parseJson(text)
  if (format === 'sql') return parseInsertSql(text)
  return { columns: [], rows: [] }
}
