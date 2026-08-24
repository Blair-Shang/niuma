import { describe, expect, it } from 'vitest'
import {
  looksLikeOfficeZip,
  parseBrowseImport,
  parseInsertSql,
  parseJsonTable,
} from './browse-io'

describe('oracle browse-io import parsers', () => {
  it('parses multi-tuple INSERT VALUES', () => {
    const sql = `INSERT INTO "NIUMA"."T" ("A", "B") VALUES ('1', 'x'), ('2', 'y');`
    const parsed = parseInsertSql(sql)
    expect(parsed.columns).toEqual(['A', 'B'])
    expect(parsed.rows).toEqual([
      ['1', 'x'],
      ['2', 'y'],
    ])
  })

  it('parses object-array JSON', () => {
    const parsed = parseJsonTable(JSON.stringify([{ ORGANIZATIONID: 'A', NLSLANG: 'zh' }]))
    expect(parsed.columns).toEqual(['ORGANIZATIONID', 'NLSLANG'])
    expect(parsed.rows).toEqual([['A', 'zh']])
  })

  it('rejects office zip as spreadsheet', () => {
    expect(looksLikeOfficeZip('PK\u0003\u0004')).toBe(true)
    expect(parseBrowseImport('xls', 'PK\u0003\u0004').columns).toEqual([])
  })
})
