import { describe, expect, it } from 'vitest'
import {
  collationsForCharset,
  normalizeMysqlCharset,
  normalizeMysqlCollation,
} from '@/modules/mysql/mysql-charset'
import { mysqlConnectionFormAdapter } from '@/modules/mysql/connection-form-adapter'

describe('mysql charset catalog', () => {
  it('defaults charset to utf8mb4', () => {
    expect(normalizeMysqlCharset('')).toBe('utf8mb4')
    expect(normalizeMysqlCharset('  gbk  ')).toBe('gbk')
  })

  it('clears collation when charset prefix mismatches', () => {
    expect(normalizeMysqlCollation('utf8mb4', 'utf8mb4_unicode_ci')).toBe('utf8mb4_unicode_ci')
    expect(normalizeMysqlCollation('utf8mb4', 'latin1_swedish_ci')).toBe('')
    expect(normalizeMysqlCollation('utf8', 'utf8mb3_general_ci')).toBe('utf8mb3_general_ci')
  })

  it('lists common collations for utf8mb4', () => {
    const list = collationsForCharset('utf8mb4')
    expect(list).toContain('utf8mb4_unicode_ci')
    expect(list).toContain('utf8mb4_0900_ai_ci')
  })
})

describe('mysql connection form adapter encoding', () => {
  it('persists charset and collation in connection_options', () => {
    const form = {
      ...mysqlConnectionFormAdapter.defaults(),
      mysqlCharset: 'gbk',
      mysqlCollation: 'gbk_chinese_ci',
      mysqlDatabase: 'app',
      mysqlSslMode: 'preferred',
      mysqlExcludeSystemSchemas: 'true',
      connectTimeoutSeconds: '10',
    } as never
    const opts = mysqlConnectionFormAdapter.buildOptions({
      form,
      accent: {},
      proxy: { type: 'none' },
      tunnel: undefined,
    }) as { charset: string; collation: string; database: string }
    expect(opts.charset).toBe('gbk')
    expect(opts.collation).toBe('gbk_chinese_ci')
    expect(opts.database).toBe('app')
  })

  it('drops mismatched collation on build', () => {
    const form = {
      ...mysqlConnectionFormAdapter.defaults(),
      mysqlCharset: 'utf8mb4',
      mysqlCollation: 'latin1_swedish_ci',
      connectTimeoutSeconds: '10',
    } as never
    const opts = mysqlConnectionFormAdapter.buildOptions({
      form,
      accent: {},
      proxy: { type: 'none' },
      tunnel: undefined,
    }) as { collation: string }
    expect(opts.collation).toBe('')
  })
})
