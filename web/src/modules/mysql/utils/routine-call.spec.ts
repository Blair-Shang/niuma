import { describe, expect, it } from 'vitest'
import {
  buildMysqlRoutineCallSql,
  mysqlCallPlaceholder,
  mysqlUserVarName,
} from './routine-call'

describe('mysqlUserVarName', () => {
  it('sanitizes names', () => {
    expect(mysqlUserVarName('out_total', 1)).toBe('@out_total')
    expect(mysqlUserVarName('出参', 2)).toBe('@out_2')
    expect(mysqlUserVarName('', 3)).toBe('@out_3')
  })
})

describe('buildMysqlRoutineCallSql', () => {
  it('builds function SELECT with IN placeholders', () => {
    const sql = buildMysqlRoutineCallSql({
      database: 'demo',
      name: 'fn_add',
      kind: 'function',
      returnType: 'int',
      parameters: [
        { ordinal: 1, name: 'a', mode: 'IN', dataType: 'int', dtdIdentifier: 'int' },
        { ordinal: 2, name: 'b', mode: 'IN', dataType: 'int', dtdIdentifier: 'int' },
      ],
    })
    expect(sql).toContain('SELECT `demo`.`fn_add`(')
    expect(sql).toContain('0 /* a int */')
    expect(sql).toContain('AS `result`')
    expect(sql).not.toContain('CALL')
  })

  it('builds procedure with OUT / INOUT user vars', () => {
    const sql = buildMysqlRoutineCallSql({
      database: 'demo',
      name: 'sp_mix',
      kind: 'procedure',
      parameters: [
        { ordinal: 1, name: 'a', mode: 'IN', dataType: 'int', dtdIdentifier: 'int' },
        { ordinal: 2, name: 'b', mode: 'OUT', dataType: 'varchar', dtdIdentifier: 'varchar(32)' },
        { ordinal: 3, name: 'c', mode: 'INOUT', dataType: 'int', dtdIdentifier: 'int' },
      ],
    })
    expect(sql).toContain('SET @b = NULL; -- OUT b varchar(32)')
    expect(sql).toContain('SET @c = 0; -- INOUT c int')
    expect(sql).toContain('CALL `demo`.`sp_mix`(0 /* a int */, @b, @c);')
    expect(sql).toContain('SELECT @b AS `b`, @c AS `c`;')
  })

  it('handles no-arg procedure', () => {
    const sql = buildMysqlRoutineCallSql({
      database: 'demo',
      name: 'sp_noop',
      kind: 'procedure',
      parameters: [],
    })
    expect(sql).toBe('-- Call procedure `demo`.`sp_noop`\nCALL `demo`.`sp_noop`();\n')
  })

  it('uses grid values / NULL for IN args', () => {
    const sql = buildMysqlRoutineCallSql({
      database: 'demo',
      name: 'fn_add',
      kind: 'function',
      parameters: [
        { ordinal: 1, name: 'a', mode: 'IN', dataType: 'int', value: '7' },
        { ordinal: 2, name: 'b', mode: 'IN', dataType: 'int', isNull: true },
      ],
    })
    expect(sql).toContain('7 /* a int */')
    expect(sql).toContain('NULL /* b int */')
  })
})

describe('mysqlCallPlaceholder', () => {
  it('uses typed defaults', () => {
    expect(mysqlCallPlaceholder({ ordinal: 1, name: 'n', mode: 'IN', dataType: 'bigint' })).toContain(
      '0',
    )
    expect(
      mysqlCallPlaceholder({ ordinal: 1, name: 's', mode: 'IN', dataType: 'varchar' }),
    ).toContain("''")
  })
})
