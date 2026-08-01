import { describe, expect, it } from 'vitest'
import { formatSql } from './format'

describe('formatSql · mysql DELIMITER', () => {
  it('keeps DELIMITER lines and // terminator intact', () => {
    const sql = [
      'DELIMITER //',
      'CREATE PROCEDURE `test2`.`new_proc`()',
      'BEGIN',
      'SELECT 1;',
      'END //',
      'DELIMITER ;',
    ].join('\n')

    const out = formatSql(sql, { dialect: 'mysql' })
    expect(out).toContain('DELIMITER //')
    expect(out).toContain('DELIMITER ;')
    expect(out).toMatch(/END\s+\/\//)
    expect(out).not.toContain('/ /')
    expect(out).toMatch(/SELECT\s+1/i)
  })

  it('formats plain mysql without delimiter unchanged path', () => {
    const out = formatSql('select 1 from t;', { dialect: 'mysql' })
    expect(out.toLowerCase()).toContain('select')
    expect(out.toLowerCase()).toContain('from')
  })
})
