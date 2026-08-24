import { describe, expect, it } from 'vitest'
import { toOracleTemporalLiteral } from './oracle-temporal-literal'

describe('toOracleTemporalLiteral', () => {
  it('wraps DATE datetime with TO_DATE to avoid ORA-01861', () => {
    expect(toOracleTemporalLiteral('2024-06-17 21:47:00', 'DATE')).toBe(
      "TO_DATE('2024-06-17 21:47:00', 'YYYY-MM-DD HH24:MI:SS')",
    )
  })

  it('uses ANSI DATE for date-only DATE columns', () => {
    expect(toOracleTemporalLiteral('2024-06-17', 'DATE')).toBe("DATE '2024-06-17'")
  })

  it('wraps TIMESTAMP with TO_TIMESTAMP', () => {
    expect(toOracleTemporalLiteral('2024-06-17 21:47:00', 'TIMESTAMP(6)')).toBe(
      "TO_TIMESTAMP('2024-06-17 21:47:00', 'YYYY-MM-DD HH24:MI:SS')",
    )
  })

  it('infers TO_DATE for untyped datetime shapes (ODPI DATE cells)', () => {
    expect(toOracleTemporalLiteral('2024-06-17 21:47:00')).toBe(
      "TO_DATE('2024-06-17 21:47:00', 'YYYY-MM-DD HH24:MI:SS')",
    )
    expect(toOracleTemporalLiteral('2024-06-17')).toBeNull()
  })

  it('normalizes ISO T separator before TO_DATE', () => {
    expect(toOracleTemporalLiteral('2024-06-17T21:47:00', 'DATE')).toBe(
      "TO_DATE('2024-06-17 21:47:00', 'YYYY-MM-DD HH24:MI:SS')",
    )
  })

  it('leaves non-temporal text alone', () => {
    expect(toOracleTemporalLiteral("O'Reilly")).toBeNull()
    expect(toOracleTemporalLiteral('NULL')).toBeNull()
  })
})
