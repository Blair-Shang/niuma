import { describe, expect, it } from 'vitest'
import { isBinCell, sqlWhereEquals, toSqlLiteral } from './sql-literal'

describe('sqlite sql-literal', () => {
  it('toSqlLiteral covers null / bool / number / string', () => {
    expect(toSqlLiteral(null)).toBe('NULL')
    expect(toSqlLiteral(true)).toBe('1')
    expect(toSqlLiteral(false)).toBe('0')
    expect(toSqlLiteral(42)).toBe('42')
    expect(toSqlLiteral("O'Reilly")).toBe("'O''Reilly'")
  })

  it('sqlWhereEquals uses IS NULL', () => {
    expect(sqlWhereEquals('a', null)).toBe('"a" IS NULL')
    expect(sqlWhereEquals('a', 1)).toBe('"a" = 1')
  })

  it('detects $bin cells', () => {
    expect(isBinCell({ $bin: 'YQ==' })).toBe(true)
    expect(isBinCell('x')).toBe(false)
  })
})
