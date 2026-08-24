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
    expect(parseIdentityArg('INOUT out_return_code varchar')).toEqual({
      name: 'out_return_code',
      type: 'varchar',
      mode: 'inout',
    })
  })

  it('parses Postgres name-MODE-type infix', () => {
    expect(parseIdentityArg('out_return_code INOUT varchar')).toEqual({
      name: 'out_return_code',
      type: 'varchar',
      mode: 'inout',
    })
    expect(parseIdentityArg('in_docno IN varchar')).toEqual({
      name: 'in_docno',
      type: 'varchar',
      mode: 'in',
    })
  })
})

describe('buildCallParams / serializeCallParams', () => {
  it('builds WYSIWYG rows', () => {
    const rows = buildCallParams('p_word varchar, n integer')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      name: 'p_word',
      type: 'varchar',
      isNull: false,
      value: '',
    })
    expect(serializeCallParams(rows)).toBe('NULL::varchar, NULL::integer')
  })

  it('serializes user values', () => {
    const rows = buildCallParams('p_word varchar, n integer')
    rows[0]!.value = 'hello'
    rows[1]!.value = '42'
    expect(serializeCallParams(rows)).toBe("'hello', 42")
  })

  it('keeps typed NULL placeholders when values are empty (avoids fn())', () => {
    const rows = buildCallParams('p_name varchar')
    expect(serializeCallParams(rows)).toBe('NULL::varchar')
    const sql = buildRoutineCallSql({
      schema: 'public',
      name: 'f_pinyin',
      kind: 'function',
      params: rows,
      qualify: (s, n) => `"${s}"."${n}"`,
    })
    expect(sql).toContain('SELECT * FROM "public"."f_pinyin"(NULL::varchar)')
    expect(sql).not.toContain('f_pinyin()')
  })

  it('formats literals by type', () => {
    expect(formatCallParamLiteral('abc', 'text')).toBe("'abc'")
    expect(formatCallParamLiteral("a'b", 'text')).toBe("'a''b'")
    expect(formatCallParamLiteral('3.14', 'numeric')).toBe('3.14')
    expect(formatCallParamLiteral('true', 'boolean')).toBe('TRUE')
  })
})

describe('buildCallPlaceholders / buildRoutineCallSql', () => {
  const qualify = (s: string, n: string) => `"${s}"."${n}"`

  it('builds typed NULL placeholders', () => {
    expect(buildCallPlaceholders('a integer, b text')).toBe(
      'NULL::integer /* a */,\n  NULL::text /* b */',
    )
  })

  it('builds SELECT for functions', () => {
    const sql = buildRoutineCallSql({
      schema: 'public',
      name: 'fn',
      kind: 'function',
      args: 'integer',
      qualify,
    })
    expect(sql).toContain('SELECT * FROM "public"."fn"(')
    expect(sql).toContain('NULL::integer')
  })

  it('keeps closing paren after single-arg placeholder (no line-comment swallow)', () => {
    const sql = buildRoutineCallSql({
      schema: 'public',
      name: 'f_pinyin',
      kind: 'function',
      args: 'p_name varchar',
      qualify,
    })
    expect(sql).toBe(
      '-- Call function "public"."f_pinyin"\nSELECT * FROM "public"."f_pinyin"(NULL::varchar /* p_name */);\n',
    )
    expect(sql).not.toMatch(/NULL::varchar\s+--/)
  })

  it('builds CALL for procedures without OUT', () => {
    const sql = buildRoutineCallSql({
      schema: 'public',
      name: 'proc',
      kind: 'procedure',
      args: 'in_id varchar',
      qualify,
    })
    expect(sql).toContain('CALL "public"."proc"(')
    expect(sql).toContain('NULL::varchar /* in_id */')
    expect(sql).not.toContain('DO $$')
  })

  it('builds DO + temp table for OUT/INOUT procedures (Postgres)', () => {
    const sql = buildRoutineCallSql({
      schema: 'public',
      name: 'flux_kes_spapp_dock_alloc',
      kind: 'procedure',
      args:
        'in_organizationid varchar, in_warehouseid varchar, out_return_code INOUT varchar',
      qualify,
    })
    expect(sql).toContain('-- niuma:exec=batch')
    expect(sql).toContain('DO $$')
    expect(sql).toContain('CALL "public"."flux_kes_spapp_dock_alloc"(')
    expect(sql).toContain('CREATE TEMP TABLE nm_call_out')
    expect(sql).toContain('SELECT * FROM nm_call_out')
    expect(sql).toContain('v_out_return_code')
    expect(sql).toContain('NULL::varchar /* in_organizationid */')
    expect(sql).not.toContain('NULL::varchar /* OUT')
    expect(sql).not.toContain('in_organizationid varchar')
    expect(sql).not.toContain('out_return_code INOUT varchar')
    expect(sql).not.toMatch(/NULL::varchar\s+--/)
  })

  it('does not mark batch for functions / procedures without OUT', () => {
    const fn = buildRoutineCallSql({
      schema: 'public',
      name: 'fn',
      kind: 'function',
      args: 'integer',
      qualify,
    })
    const proc = buildRoutineCallSql({
      schema: 'public',
      name: 'proc',
      kind: 'procedure',
      args: 'in_id varchar',
      qualify,
    })
    expect(fn).not.toContain('niuma:exec=batch')
    expect(proc).not.toContain('niuma:exec=batch')
  })
})
