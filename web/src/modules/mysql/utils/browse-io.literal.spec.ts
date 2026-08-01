import { describe, expect, it } from 'vitest'
import {
  buildDeleteSqlText,
  buildUpdateSqlText,
  normalizeMysqlDateTimeString,
  sqlWhereEquals,
  toSqlLiteral,
} from './browse-io'

describe('normalizeMysqlDateTimeString / toSqlLiteral', () => {
  it('normalizes ISO datetime with Z for MySQL', () => {
    expect(normalizeMysqlDateTimeString('2026-07-23T06:36:55Z')).toBe(
      '2026-07-23 06:36:55',
    )
    expect(toSqlLiteral('2026-07-23T06:36:55Z')).toBe("'2026-07-23 06:36:55'")
  })

  it('keeps fractional seconds and drops offsets', () => {
    expect(normalizeMysqlDateTimeString('2026-07-23T06:36:55.123+08:00')).toBe(
      '2026-07-23 06:36:55.123',
    )
  })

  it('leaves already-normalized datetime unchanged', () => {
    expect(normalizeMysqlDateTimeString('2026-07-23 06:36:55')).toBe(
      '2026-07-23 06:36:55',
    )
  })

  it('does not rewrite plain text', () => {
    expect(toSqlLiteral("O'Reilly")).toBe("'O''Reilly'")
    expect(toSqlLiteral(null)).toBe('NULL')
  })
})

describe('buildDeleteSqlText / sqlWhereEquals', () => {
  it('uses IS NULL for null cells', () => {
    expect(sqlWhereEquals('a', null)).toBe('`a` IS NULL')
    expect(sqlWhereEquals('a', 1)).toBe('`a` = 1')
  })

  it('falls back to all columns when no primary key', () => {
    const sql = buildDeleteSqlText(
      'db',
      't',
      [],
      [{ id: 1, name: null }],
      ['id', 'name'],
    )
    expect(sql).toBe('DELETE FROM `db`.`t` WHERE `id` = 1 AND `name` IS NULL;\n')
  })

  it('prefers primary key columns when present', () => {
    const sql = buildDeleteSqlText(
      'db',
      't',
      ['id'],
      [{ id: 2, name: 'x' }],
      ['id', 'name'],
    )
    expect(sql).toBe('DELETE FROM `db`.`t` WHERE `id` = 2;\n')
  })

  it('builds UPDATE with all-column WHERE when no primary key', () => {
    const sql = buildUpdateSqlText(
      'db',
      't',
      ['id', 'name'],
      [],
      [{ id: 1, name: 'a' }],
      ['id', 'name'],
    )
    expect(sql).toBe(
      "UPDATE `db`.`t` SET `id` = 1, `name` = 'a' WHERE `id` = 1 AND `name` = 'a';\n",
    )
  })
})
