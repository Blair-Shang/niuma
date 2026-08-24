import { describe, expect, it } from 'vitest'
import { rewriteOracleViewDdlForRename } from './script-templates'

describe('rewriteOracleViewDdlForRename', () => {
  it('rewrites qualified quoted view name', () => {
    const ddl = `CREATE OR REPLACE VIEW "NIUMA"."new_view1" AS\nSELECT 1 AS X FROM DUAL`
    const out = rewriteOracleViewDdlForRename(ddl, 'NIUMA', 'new_view1', 'new_view12')
    expect(out).toContain('CREATE OR REPLACE VIEW "NIUMA"."new_view12" AS')
    expect(out).not.toMatch(/"new_view1"/)
  })

  it('rewrites unqualified view name', () => {
    const ddl = `CREATE VIEW "aaa" AS SELECT * FROM T`
    const out = rewriteOracleViewDdlForRename(ddl, 'NIUMA', 'aaa', 'bbb')
    expect(out).toMatch(/^CREATE OR REPLACE VIEW "NIUMA"\."bbb" AS/i)
  })

  it('wraps bare SELECT text as new view', () => {
    const out = rewriteOracleViewDdlForRename('SELECT 1 FROM DUAL', 'NIUMA', 'v1', 'v2')
    expect(out).toMatch(/^CREATE OR REPLACE VIEW "NIUMA"\."v2" AS/i)
    expect(out).toContain('SELECT 1 FROM DUAL')
  })
})
