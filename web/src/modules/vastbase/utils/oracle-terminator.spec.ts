import { describe, expect, it } from 'vitest'
import {
  prepareDialectExecSql,
  stripOracleScriptTerminator,
} from './oracle-terminator'

describe('stripOracleScriptTerminator', () => {
  it('removes trailing slash line', () => {
    expect(stripOracleScriptTerminator('END;\n/\n')).toBe('END;')
  })

  it('keeps slash inside body', () => {
    expect(stripOracleScriptTerminator('SELECT 1 / 2;')).toBe('SELECT 1 / 2;')
  })

  it('prepareDialectExecSql respects strip flag', () => {
    const sql = `END;\n/\n`
    expect(prepareDialectExecSql(sql, { stripOracleSlash: true })).toBe('END;')
    expect(prepareDialectExecSql(sql, { stripOracleSlash: false }).includes('/')).toBe(true)
  })
})
