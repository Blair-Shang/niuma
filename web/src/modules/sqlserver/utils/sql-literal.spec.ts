import { describe, expect, it } from 'vitest'
import { toSqlLiteral } from '@/modules/sqlserver/utils/sql-literal'

describe('toSqlLiteral', () => {
  it('formats null boolean number and unicode string', () => {
    expect(toSqlLiteral(null)).toBe('NULL')
    expect(toSqlLiteral(true)).toBe('1')
    expect(toSqlLiteral(false)).toBe('0')
    expect(toSqlLiteral(12)).toBe('12')
    expect(toSqlLiteral("O'Brien")).toBe("N'O''Brien'")
    expect(toSqlLiteral('中文')).toBe("N'中文'")
  })
})
