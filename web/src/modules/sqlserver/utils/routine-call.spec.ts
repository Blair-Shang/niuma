import { describe, expect, it } from 'vitest'
import {
  buildSqlServerRoutineCallSql,
  formatSqlServerCallParamLiteral,
  paramVarName,
  sqlserverCallLiteral,
} from './routine-call'

describe('paramVarName', () => {
  it('keeps @ prefix and sanitizes', () => {
    expect(paramVarName({ ordinal: 1, name: '@CustomerId', mode: 'IN', dataType: 'int' })).toBe(
      '@CustomerId',
    )
    expect(paramVarName({ ordinal: 2, name: 'out_total', mode: 'OUTPUT', dataType: 'int' })).toBe(
      '@out_total',
    )
    expect(paramVarName({ ordinal: 3, name: '', mode: 'IN', dataType: 'int' })).toBe('@p3')
  })
})

describe('formatSqlServerCallParamLiteral', () => {
  it('quotes unicode strings with N', () => {
    expect(formatSqlServerCallParamLiteral('hello', 'nvarchar(32)')).toBe("N'hello'")
    expect(formatSqlServerCallParamLiteral("O'Hara", 'sysname')).toBe("N'O''Hara'")
  })

  it('keeps numbers and NULL', () => {
    expect(formatSqlServerCallParamLiteral('42', 'int')).toBe('42')
    expect(formatSqlServerCallParamLiteral('null', 'int')).toBe('NULL')
    expect(formatSqlServerCallParamLiteral("N'x'", 'nvarchar')).toBe("N'x'")
  })
})

describe('buildSqlServerRoutineCallSql', () => {
  it('builds scalar function SELECT', () => {
    const sql = buildSqlServerRoutineCallSql({
      schema: 'dbo',
      name: 'fnAdd',
      kind: 'function',
      returnType: 'int',
      parameters: [
        { ordinal: 1, name: '@a', mode: 'IN', dataType: 'int', dtdIdentifier: 'int' },
        { ordinal: 2, name: '@b', mode: 'IN', dataType: 'int', dtdIdentifier: 'int', isNull: true },
      ],
    })
    expect(sql).toContain('-- Call function [dbo].[fnAdd] → int')
    expect(sql).toContain('SELECT [dbo].[fnAdd](0, NULL) AS [result];')
  })

  it('builds table-valued function FROM', () => {
    const sql = buildSqlServerRoutineCallSql({
      schema: 'dbo',
      name: 'fnRows',
      kind: 'function',
      returnType: 'table',
      isTableValued: true,
      parameters: [{ ordinal: 1, name: '@id', mode: 'IN', dataType: 'int', value: '7' }],
    })
    expect(sql).toContain('SELECT *')
    expect(sql).toContain('FROM [dbo].[fnRows](7);')
  })

  it('builds procedure with named args, OUTPUT and return value', () => {
    const sql = buildSqlServerRoutineCallSql({
      schema: 'Sales',
      name: 'uspGet',
      kind: 'procedure',
      parameters: [
        { ordinal: 1, name: '@id', mode: 'IN', dataType: 'int', dtdIdentifier: 'int', value: '9' },
        {
          ordinal: 2,
          name: '@name',
          mode: 'OUTPUT',
          dataType: 'nvarchar',
          dtdIdentifier: 'nvarchar(64)',
        },
      ],
    })
    expect(sql).toContain('SET NOCOUNT ON;')
    expect(sql).toContain('DECLARE @return_value int,\n        @name nvarchar(64);')
    expect(sql).toContain('EXEC @return_value = [Sales].[uspGet]')
    expect(sql).toContain('@id = 9')
    expect(sql).toContain('@name = @name OUTPUT')
    expect(sql).not.toContain('/* int */')
    expect(sql).toContain('SELECT @name AS [@name],\n       @return_value AS [Return Value];')
  })

  it('builds no-arg procedure', () => {
    const sql = buildSqlServerRoutineCallSql({
      schema: 'dbo',
      name: 'uspNoop',
      kind: 'procedure',
      parameters: [],
    })
    expect(sql).toContain('SET NOCOUNT ON;')
    expect(sql).toContain('DECLARE @return_value int;')
    expect(sql).toContain('EXEC @return_value = [dbo].[uspNoop];')
    expect(sql).toContain('SELECT @return_value AS [Return Value];')
  })
})

describe('sqlserverCallLiteral', () => {
  it('uses typed defaults', () => {
    expect(sqlserverCallLiteral({ ordinal: 1, name: '@n', mode: 'IN', dataType: 'bigint' })).toBe('0')
    expect(sqlserverCallLiteral({ ordinal: 1, name: '@s', mode: 'IN', dataType: 'varchar' })).toBe(
      "''",
    )
    expect(
      sqlserverCallLiteral({ ordinal: 1, name: '@s', mode: 'IN', dataType: 'nvarchar' }),
    ).toBe("N''")
  })
})
