/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import {
  buildBrowseExportPayload,
  buildInsertSqlText,
  buildSpreadsheetXmlText,
  parseBrowseImport,
  parseInsertSql,
  parseSpreadsheetXml,
} from './browse-io'

describe('parseSpreadsheetXml', () => {
  it('parses SpreadsheetML with default xmlns', () => {
    const xml = buildSpreadsheetXmlText([{ name: 'id' }, { name: 'name' }], [[1, 'a']], 't1')
    const parsed = parseSpreadsheetXml(xml)
    expect(parsed.headers).toEqual(['id', 'name'])
    expect(parsed.rows).toEqual([['1', 'a']])
  })

  it('round-trips browse xls export', () => {
    const payload = buildBrowseExportPayload('xls', {
      schema: 'public',
      table: 't1',
      columns: [{ name: 'id' }, { name: 'name' }],
      rows: [[1, 'hello']],
      baseName: 'public_t1',
    })
    const parsed = parseBrowseImport('xls', payload.content)
    expect(parsed.headers).toEqual(['id', 'name'])
    expect(parsed.rows).toEqual([['1', 'hello']])
  })
})

describe('parseInsertSql', () => {
  it('parses quoted schema.table INSERT from export', () => {
    const sql = buildInsertSqlText(
      'public',
      't1',
      [{ name: 'id' }, { name: 'name' }],
      [[1, "o'brien"]],
    )
    const parsed = parseInsertSql(sql)
    expect(parsed.headers).toEqual(['id', 'name'])
    expect(parsed.rows).toEqual([['1', "o'brien"]])
  })

  it('round-trips browse sql export', () => {
    const payload = buildBrowseExportPayload('sql', {
      schema: 'public',
      table: 't1',
      columns: [{ name: 'id' }],
      rows: [[42]],
      baseName: 'public_t1',
    })
    const parsed = parseBrowseImport('sql', payload.content)
    expect(parsed.headers).toEqual(['id'])
    expect(parsed.rows).toEqual([['42']])
  })

  it('repairs shell writeText newline corruption', () => {
    const broken =
      `INSERT INTO "public"."t1" ("id", "sku")nVALUES(1, 'G40'),n(2, 'X');`
    const parsed = parseInsertSql(broken)
    expect(parsed.headers).toEqual(['id', 'sku'])
    expect(parsed.rows).toEqual([
      ['1', 'G40'],
      ['2', 'X'],
    ])
  })

  it('parses column named values', () => {
    const sql = buildInsertSqlText(
      'public',
      't1',
      [{ name: 'id' }, { name: 'values' }],
      [[1, 'x']],
    )
    const parsed = parseInsertSql(sql)
    expect(parsed.headers).toEqual(['id', 'values'])
    expect(parsed.rows).toEqual([['1', 'x']])
  })
})

describe('parseBrowseImport csv', () => {
  it('parses csv with bom', () => {
    const payload = buildBrowseExportPayload('csv', {
      schema: 'public',
      table: 't1',
      columns: [{ name: 'id' }, { name: 'name' }],
      rows: [[1, 'x']],
      baseName: 'public_t1',
    })
    const parsed = parseBrowseImport('csv', payload.content)
    expect(parsed.headers).toEqual(['id', 'name'])
    expect(parsed.rows).toEqual([['1', 'x']])
  })
})
