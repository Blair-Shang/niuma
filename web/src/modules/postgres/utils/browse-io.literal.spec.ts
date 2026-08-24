import { describe, expect, it } from 'vitest'
import { toSqlLiteral } from '@/modules/postgres/utils/sql-literal'
import {
  buildDeleteSqlText,
  buildUpdateSqlText,
  sqlWhereEquals,
} from './browse-io'

describe('sqlWhereEquals / toSqlLiteral', () => {
  it('uses IS NULL for null cells', () => {
    expect(sqlWhereEquals('a', null)).toBe('"a" IS NULL')
    expect(sqlWhereEquals('a', 1)).toBe('"a" = 1')
  })

  it('quotes identifiers and string literals', () => {
    expect(toSqlLiteral("O'Reilly")).toBe("'O''Reilly'")
    expect(toSqlLiteral(null)).toBe('NULL')
    expect(toSqlLiteral(true)).toBe('TRUE')
  })
})

describe('buildDeleteSqlText', () => {
  it('falls back to all columns when no primary key', () => {
    const sql = buildDeleteSqlText(
      'public',
      't',
      [],
      [{ id: 1, name: null }],
      ['id', 'name'],
    )
    expect(sql).toBe('DELETE FROM "public"."t" WHERE "id" = 1 AND "name" IS NULL;\n')
  })

  it('prefers primary key columns when present', () => {
    const sql = buildDeleteSqlText(
      'public',
      't',
      ['id'],
      [{ id: 2, name: 'x' }],
      ['id', 'name'],
    )
    expect(sql).toBe('DELETE FROM "public"."t" WHERE "id" = 2;\n')
  })
})

describe('buildUpdateSqlText', () => {
  it('builds UPDATE with all-column WHERE when no primary key', () => {
    const sql = buildUpdateSqlText(
      'public',
      't',
      ['id', 'name'],
      [],
      [{ id: 1, name: 'a' }],
      ['id', 'name'],
    )
    expect(sql).toBe(
      'UPDATE "public"."t" SET "id" = 1, "name" = \'a\' WHERE "id" = 1 AND "name" = \'a\';\n',
    )
  })
})
