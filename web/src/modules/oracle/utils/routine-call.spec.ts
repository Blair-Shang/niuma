import { describe, expect, it } from 'vitest'
import {
  buildOracleRoutineCallSql,
  parseOracleRoutineParamsFromDdl,
} from './routine-call'

const newProcDdl = `
CREATE OR REPLACE PROCEDURE "NIUMA"."new_proc" (
  p_in_id      IN  NUMBER,
  p_in_name    IN  VARCHAR2,
  p_inout_cnt  IN OUT NUMBER,
  p_out_code   OUT NUMBER,   -- 成功/错误码
  p_out_msg    OUT VARCHAR2  -- 文本消息
) AS
BEGIN
  NULL;
END;
`

describe('parseOracleRoutineParamsFromDdl', () => {
  it('parses IN / IN OUT / OUT like new_proc', () => {
    const params = parseOracleRoutineParamsFromDdl(newProcDdl, 'procedure')
    expect(params.map((p) => [p.name, p.mode, p.dataType])).toEqual([
      ['p_in_id', 'IN', 'NUMBER'],
      ['p_in_name', 'IN', 'VARCHAR2'],
      ['p_inout_cnt', 'INOUT', 'NUMBER'],
      ['p_out_code', 'OUT', 'NUMBER'],
      ['p_out_msg', 'OUT', 'VARCHAR2'],
    ])
  })

  it('strips DEFAULT from type when falling back to DDL', () => {
    const ddl = `
CREATE OR REPLACE FUNCTION "NIUMA"."new_func" (
  p_in_id IN NUMBER,
  p_in_name IN VARCHAR2 DEFAULT 'world'
) RETURN VARCHAR2 AS BEGIN RETURN ''; END;`
    const params = parseOracleRoutineParamsFromDdl(ddl, 'function')
    expect(params.map((p) => [p.name, p.mode, p.dataType, p.dtdIdentifier])).toEqual([
      ['p_in_id', 'IN', 'NUMBER', 'NUMBER'],
      ['p_in_name', 'IN', 'VARCHAR2', 'VARCHAR2'],
    ])
  })
})

describe('buildOracleRoutineCallSql', () => {
  it('uses anonymous block + DBMS_OUTPUT for OUT (no GTT / DDL)', () => {
    const params = parseOracleRoutineParamsFromDdl(newProcDdl, 'procedure')
    const sql = buildOracleRoutineCallSql({
      schema: 'NIUMA',
      name: 'new_proc',
      kind: 'procedure',
      parameters: params,
    })
    expect(sql).toContain('0 /* p_in_id NUMBER */')
    expect(sql).toContain("'' /* p_in_name VARCHAR2 */")
    expect(sql).toContain('v_p_inout_cnt')
    expect(sql).toContain(
      '"NIUMA"."new_proc"(0 /* p_in_id NUMBER */, \'\' /* p_in_name VARCHAR2 */, v_p_inout_cnt, v_p_out_code, v_p_out_msg)',
    )
    expect(sql).toContain('DBMS_OUTPUT.ENABLE')
    expect(sql).toContain("DBMS_OUTPUT.PUT_LINE('p_out_code='")
    expect(sql).toContain('bind OUT')
    expect(sql).not.toContain('GLOBAL TEMPORARY TABLE')
    expect(sql).not.toContain('NM_CO_')
    expect(sql).not.toMatch(/\bCREATE\b/)
    expect(sql).not.toContain('DROP TABLE')
  })

  it('omits empty DECLARE when only IN params but still enables DBMS_OUTPUT', () => {
    const sql = buildOracleRoutineCallSql({
      schema: 'NIUMA',
      name: 'p_in_only',
      kind: 'procedure',
      parameters: [
        { ordinal: 1, name: 'a', mode: 'IN', dataType: 'NUMBER' },
        { ordinal: 2, name: 'b', mode: 'IN', dataType: 'VARCHAR2', dtdIdentifier: 'VARCHAR2' },
      ],
    })
    expect(sql).not.toMatch(/^DECLARE$/m)
    expect(sql).toContain('BEGIN')
    expect(sql).toContain('DBMS_OUTPUT.ENABLE')
    expect(sql).toContain('0 /* a NUMBER */')
    expect(sql).toContain("'' /* b VARCHAR2 */")
    expect(sql).not.toContain('PUT_LINE')
  })
})
