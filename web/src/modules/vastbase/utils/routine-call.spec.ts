import { describe, expect, it } from 'vitest'
import {
  buildCallParams,
  buildCallPlaceholders,
  buildRoutineCallSql,
  formatCallParamLiteral,
  parseIdentityArg,
  serializeCallParams,
  splitIdentityArgs,
} from './routine-call'

describe('splitIdentityArgs', () => {
  it('splits simple types', () => {
    expect(splitIdentityArgs('integer, text')).toEqual(['integer', 'text'])
  })

  it('keeps commas inside type modifiers', () => {
    expect(splitIdentityArgs('numeric(10, 2), text')).toEqual(['numeric(10, 2)', 'text'])
  })
})

describe('parseIdentityArg', () => {
  it('parses bare types and named args', () => {
    expect(parseIdentityArg('integer')).toEqual({ type: 'integer', mode: 'in' })
    expect(parseIdentityArg('x integer')).toEqual({ name: 'x', type: 'integer', mode: 'in' })
    expect(parseIdentityArg('IN p_id bigint')).toEqual({
      name: 'p_id',
      type: 'bigint',
      mode: 'in',
    })
    expect(parseIdentityArg('double precision')).toEqual({
      type: 'double precision',
      mode: 'in',
    })
    expect(parseIdentityArg('character varying')).toEqual({
      type: 'character varying',
      mode: 'in',
    })
    expect(parseIdentityArg('p_word varchar')).toEqual({
      name: 'p_word',
      type: 'varchar',
      mode: 'in',
    })
  })
})

describe('buildCallParams / serializeCallParams', () => {
  it('builds WYSIWYG rows defaulting to empty (use formal DEFAULT)', () => {
    const rows = buildCallParams('p_word varchar, n integer')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      name: 'p_word',
      type: 'varchar',
      isNull: false,
      value: '',
    })
    expect(serializeCallParams(rows)).toBe('')
  })

  it('serializes user values like Navicat', () => {
    const rows = buildCallParams('p_word varchar, n integer')
    rows[0]!.isNull = false
    rows[0]!.value = 'hello'
    rows[1]!.isNull = false
    rows[1]!.value = '42'
    expect(serializeCallParams(rows)).toBe("'hello', 42")
  })

  it('uses DEFAULT for blank slots and NULL when checked', () => {
    const rows = buildCallParams('p_debug boolean, p_msg varchar')
    rows[0]!.value = 'true'
    expect(serializeCallParams(rows)).toBe('TRUE, DEFAULT')
    rows[1]!.isNull = true
    expect(serializeCallParams(rows)).toBe('TRUE, NULL')
  })

  it('formats literals by type', () => {
    expect(formatCallParamLiteral('abc', 'text')).toBe("'abc'")
    expect(formatCallParamLiteral("a'b", 'text')).toBe("'a''b'")
    expect(formatCallParamLiteral('3.14', 'numeric')).toBe('3.14')
    expect(formatCallParamLiteral('true', 'boolean')).toBe('TRUE')
    expect(formatCallParamLiteral('NULL', 'text')).toBe('NULL')
  })
})

describe('buildCallPlaceholders / buildRoutineCallSql', () => {
  it('builds typed NULL placeholders', () => {
    expect(buildCallPlaceholders('a integer, b text')).toBe(
      'NULL::integer /* a */,\n  NULL::text /* b */',
    )
  })

  it('keeps closing paren after single-arg placeholder (no line-comment swallow)', () => {
    const qualify = (s: string, n: string) => `"${s}"."${n}"`
    const sql = buildRoutineCallSql({
      schema: 'public',
      name: 'f_pinyin',
      kind: 'function',
      args: 'p_name varchar',
      qualify,
    })
    expect(sql).toContain('SELECT "public"."f_pinyin"(NULL::varchar /* p_name */);')
    expect(sql).not.toMatch(/NULL::varchar\s+--/)
  })

  it('builds SELECT / CALL SQL', () => {
    const qualify = (s: string, n: string) => `"${s}"."${n}"`
    expect(
      buildRoutineCallSql({
        schema: 'public',
        name: 'fn',
        kind: 'function',
        args: 'integer',
        qualify,
      }),
    ).toContain('SELECT "public"."fn"(')
    expect(
      buildRoutineCallSql({
        schema: 'public',
        name: 'proc',
        kind: 'procedure',
        args: '',
        qualify,
      }),
    ).toContain('CALL "public"."proc"();')
  })
})
