import { describe, expect, it } from 'vitest'
import {
  buildBrowseExportPayload,
  buildInsertSqlText,
  parseBrowseImport,
} from './browse-io'

describe('sqlite browse-io', () => {
  it('builds INSERT with double-quoted identifiers', () => {
    const sql = buildInsertSqlText(
      'main',
      'users',
      [{ name: 'id' }, { name: 'name' }],
      [[1, "O'Reilly"]],
    )
    expect(sql).toContain('INSERT INTO "main"."users"')
    expect(sql).toContain('"id", "name"')
    expect(sql).toContain("'O''Reilly'")
  })

  it('builds CSV export with BOM', () => {
    const payload = buildBrowseExportPayload('csv', {
      schema: 'main',
      table: 't',
      columns: [{ name: 'a' }],
      rows: [[1]],
      baseName: 'main_t',
    })
    expect(payload.content.startsWith('\uFEFF')).toBe(true)
    expect(payload.accept).toEqual(['.csv'])
  })

  it('parses JSON table import', () => {
    const parsed = parseBrowseImport(
      'json',
      JSON.stringify({ columns: ['id', 'name'], rows: [[1, 'a']] }),
    )
    expect(parsed.columns).toEqual(['id', 'name'])
    expect(parsed.rows).toEqual([['1', 'a']])
  })
})
