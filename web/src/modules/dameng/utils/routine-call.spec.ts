import { describe, expect, it } from 'vitest'
import {
  allocDamengCallOutTableName,
  buildDamengRoutineCallSql,
  formatDamengCallParamLiteral,
} from '@/modules/dameng/utils/routine-call'

describe('formatDamengCallParamLiteral', () => {
  it('auto-quotes bare VARCHAR2 values', () => {
    expect(formatDamengCallParamLiteral('werwe', 'VARCHAR2')).toBe("'werwe'")
    expect(formatDamengCallParamLiteral("O'Reilly", 'VARCHAR2(50)')).toBe("'O''Reilly'")
  })

  it('passes through already-quoted / NULL / typed literals', () => {
    expect(formatDamengCallParamLiteral("'werwe'", 'VARCHAR2')).toBe("'werwe'")
    expect(formatDamengCallParamLiteral('NULL', 'VARCHAR2')).toBe('NULL')
    expect(formatDamengCallParamLiteral("DATE '2020-01-01'", 'DATE')).toBe("DATE '2020-01-01'")
  })

  it('keeps numeric bare values for NUMBER', () => {
    expect(formatDamengCallParamLiteral('42', 'NUMBER')).toBe('42')
    expect(formatDamengCallParamLiteral('3.14', 'NUMBER(10,2)')).toBe('3.14')
  })
})

describe('allocDamengCallOutTableName', () => {
  it('is unique across different seeds and stays identifier-safe', () => {
    const a = allocDamengCallOutTableName(1_700_000_000_000, 0.1)
    const b = allocDamengCallOutTableName(1_700_000_000_001, 0.2)
    expect(a).not.toBe(b)
    expect(a).toMatch(/^NM_CO_[A-Z0-9_]+$/)
    expect(a.length).toBeLessThanOrEqual(28)
  })
})

describe('buildDamengRoutineCallSql', () => {
  it('builds function SELECT from DUAL', () => {
    const sql = buildDamengRoutineCallSql({
      schema: 'SYSDBA',
      name: 'fn_add',
      kind: 'function',
      parameters: [
        { ordinal: 1, name: 'a', mode: 'IN', dataType: 'INT' },
        { ordinal: 2, name: 'b', mode: 'IN', dataType: 'INT' },
      ],
      returnType: 'INT',
    })
    expect(sql).toContain('SELECT "SYSDBA"."fn_add"(0 /* a INT */, 0 /* b INT */) AS "result" FROM DUAL')
  })

  it('builds procedure block with OUT locals echoed via unique temp table', () => {
    const sql = buildDamengRoutineCallSql({
      schema: 'SYSDBA',
      name: 'p_demo',
      kind: 'procedure',
      parameters: [
        { ordinal: 1, name: 'p_in', mode: 'IN', dataType: 'INT' },
        { ordinal: 2, name: 'p_out', mode: 'OUT', dataType: 'INT' },
      ],
      outTableName: 'NM_CO_TEST1',
    })
    expect(sql).toContain('CREATE GLOBAL TEMPORARY TABLE "NM_CO_TEST1"')
    expect(sql).toContain('ON COMMIT PRESERVE ROWS')
    expect(sql).toContain('v_p_out INT; -- OUT p_out INT')
    expect(sql).toContain('"SYSDBA"."p_demo"(0 /* p_in INT */, v_p_out);')
    expect(sql).toContain('INSERT INTO "NM_CO_TEST1" ("p_out") VALUES (v_p_out);')
    expect(sql).toContain('SELECT * FROM "NM_CO_TEST1";')
    expect(sql).toContain(`EXECUTE IMMEDIATE 'DROP TABLE "NM_CO_TEST1"'`)
    // 头尾各一次 DROP：重跑安全 + 收尾清目录；表名唯一故不伤其它页签
    expect(sql.split('DROP TABLE').length - 1).toBe(2)
    expect(sql.indexOf('DROP TABLE')).toBeLessThan(sql.indexOf('CREATE GLOBAL TEMPORARY TABLE'))
  })

  it('allocates distinct out tables when outTableName omitted', () => {
    const opts = {
      schema: 'SYSDBA',
      name: 'p_demo',
      kind: 'procedure' as const,
      parameters: [{ ordinal: 1, name: 'p_out', mode: 'OUT', dataType: 'INT' }],
    }
    const a = buildDamengRoutineCallSql(opts)
    const b = buildDamengRoutineCallSql(opts)
    const re = /CREATE GLOBAL TEMPORARY TABLE "([^"]+)"/
    const ta = re.exec(a)?.[1]
    const tb = re.exec(b)?.[1]
    expect(ta).toBeTruthy()
    expect(tb).toBeTruthy()
    expect(ta).not.toBe(tb)
  })

  it('builds IN-only procedure as plain anonymous block', () => {
    const sql = buildDamengRoutineCallSql({
      schema: 'SYSDBA',
      name: 'p_in_only',
      kind: 'procedure',
      parameters: [{ ordinal: 1, name: 'p_in', mode: 'IN', dataType: 'INT' }],
    })
    expect(sql).toContain('-- no OUT/INOUT locals')
    expect(sql).not.toContain('NM_CO_')
    expect(sql.trimEnd().endsWith('/')).toBe(true)
  })

  it('quotes bare string IN args so they are not treated as identifiers', () => {
    const sql = buildDamengRoutineCallSql({
      schema: 'WMS_DEV',
      name: 'FLUX_DM01_SPAPP_DOCK_ALLOC',
      kind: 'procedure',
      parameters: [
        { ordinal: 1, name: 'IN_DOCNO', mode: 'IN', dataType: 'VARCHAR2', value: 'werwe' },
        { ordinal: 2, name: 'IN_LANGUAGE', mode: 'IN', dataType: 'VARCHAR2', value: 'we' },
        { ordinal: 3, name: 'IN_USERID', mode: 'IN', dataType: 'VARCHAR2', value: 'w' },
        { ordinal: 4, name: 'OUT_RETURN_CODE', mode: 'INOUT', dataType: 'VARCHAR2', value: '' },
      ],
      outTableName: 'NM_CO_DOCK',
    })
    expect(sql).toContain("'werwe' /* IN_DOCNO VARCHAR2 */")
    expect(sql).toContain("'we' /* IN_LANGUAGE VARCHAR2 */")
    expect(sql).toContain("'w' /* IN_USERID VARCHAR2 */")
    expect(sql).toContain("v_OUT_RETURN_CODE VARCHAR2(4000) := '';")
    expect(sql).toContain('"NM_CO_DOCK"')
  })
})
