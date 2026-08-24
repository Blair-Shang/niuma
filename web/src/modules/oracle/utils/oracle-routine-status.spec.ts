import { describe, expect, it } from 'vitest'
import {
  buildOracleRoutineErrorsSql,
  buildOracleRoutineStatusSql,
  formatOracleRoutineErrors,
  isOracleInvalidObjectError,
  oracleObjectStatusI18nKey,
} from './oracle-routine-status'

describe('oracle-routine-status', () => {
  it('builds status / errors SQL with quoted literals', () => {
    expect(buildOracleRoutineStatusSql("NIU'MA", 'new_proc', 'procedure')).toContain(
      "UPPER('NIU''MA')",
    )
    expect(buildOracleRoutineStatusSql('NIUMA', 'new_proc', 'procedure')).toContain(
      "OBJECT_TYPE = 'PROCEDURE'",
    )
    expect(buildOracleRoutineErrorsSql('NIUMA', 'fn', 'function')).toContain("TYPE = 'FUNCTION'")
  })

  it('formats ALL_ERRORS rows', () => {
    expect(
      formatOracleRoutineErrors([
        [10, 5, 'PLS-00201: identifier must be declared'],
        [12, 1, 'PL/SQL: Statement ignored'],
      ]),
    ).toBe(
      'L10:C5 PLS-00201: identifier must be declared\nL12:C1 PL/SQL: Statement ignored',
    )
  })

  it('detects PLS-00905 / ORA-24344', () => {
    expect(isOracleInvalidObjectError('PLS-00905: object NIUMA.new_proc is invalid')).toBe(true)
    expect(isOracleInvalidObjectError('ORA-24344: success with compilation error')).toBe(true)
    expect(isOracleInvalidObjectError('ORA-00942: table or view does not exist')).toBe(false)
  })

  it('maps dictionary STATUS to i18n keys', () => {
    expect(oracleObjectStatusI18nKey('VALID')).toBe('statusValid')
    expect(oracleObjectStatusI18nKey('invalid')).toBe('statusInvalid')
    expect(oracleObjectStatusI18nKey('UNKNOWN')).toBeNull()
  })
})
