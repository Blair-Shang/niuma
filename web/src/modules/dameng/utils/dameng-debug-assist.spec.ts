import { describe, expect, it } from 'vitest'
import {
  NM_DEBUG_CLIENT_INFO,
  NM_DEBUG_PARAM,
  addDamengRoutineInParam,
  buildDamengDebugRoutineDraft,
  countDamengDebugLogPoints,
  insertDamengDebugLogPoint,
  insertDamengDebugLogPointAtLine,
  renameDamengRoutineInDdl,
  wrapDamengCallWithDebugSession,
} from './dameng-debug-assist'

const PROC = `CREATE OR REPLACE PROCEDURE "DEMO"."SP_MIX"(A INT)
AS
BEGIN
  A := A + 1;
END;`

const FUNC = `CREATE OR REPLACE FUNCTION "DEMO"."FN_ADD"(A INT, B INT) RETURN INT
AS
BEGIN
  RETURN A + B;
END;`

describe('insertDamengDebugLogPoint', () => {
  it('inserts DBMS_OUTPUT gate after BEGIN', () => {
    const out = insertDamengDebugLogPoint(PROC)
    expect(countDamengDebugLogPoints(out)).toBe(1)
    expect(out).toContain(`'${NM_DEBUG_CLIENT_INFO}'`)
    expect(out).toContain('DBMS_OUTPUT.PUT_LINE')
    expect(out).toContain('A := A + 1;')
  })

  it('inserts after a chosen line', () => {
    const out = insertDamengDebugLogPointAtLine(PROC, { line: 4, label: 'mid' })
    const lines = out.split('\n')
    const assignIdx = lines.findIndex((l) => l.includes('A := A + 1'))
    const pointIdx = lines.findIndex((l) => l.includes('/* nm-debug-point: mid */'))
    expect(pointIdx).toBeGreaterThan(assignIdx)
  })

  it('keeps label inside the comment (valid SQL)', () => {
    const out = insertDamengDebugLogPoint(FUNC, { label: 'point_1' })
    expect(out).toContain('/* nm-debug-point: point_1 */')
    expect(out).not.toMatch(/\*\/\s*point_1\b/)
  })
})

describe('buildDamengDebugRoutineDraft', () => {
  it('renames, adds p_nm_debug, and injects enter point', () => {
    const { ddl, draftName } = buildDamengDebugRoutineDraft({
      ddl: PROC,
      kind: 'procedure',
      originalName: 'SP_MIX',
    })
    expect(draftName).toBe('SP_MIX_debug')
    expect(ddl).toContain('"SP_MIX_debug"')
    expect(ddl).toContain(`${NM_DEBUG_PARAM} INT DEFAULT 0`)
    expect(ddl).toContain('enter')
    expect(ddl).toMatch(/nm-debug draft/)
  })
})

describe('rename / add param helpers', () => {
  it('renames qualified routine', () => {
    expect(renameDamengRoutineInDdl(PROC, 'procedure', 'SP_MIX', 'SP_MIX_debug')).toContain(
      '"SP_MIX_debug"',
    )
  })

  it('appends IN param to empty and non-empty lists', () => {
    const empty = `CREATE OR REPLACE PROCEDURE "DEMO"."NOOP"()\nAS\nBEGIN\nNULL;\nEND;`
    expect(addDamengRoutineInParam(empty, 'procedure', 'p_nm_debug INT DEFAULT 0')).toContain(
      '(p_nm_debug INT DEFAULT 0)',
    )
    expect(addDamengRoutineInParam(PROC, 'procedure', 'p_nm_debug INT DEFAULT 0')).toContain(
      'A INT, p_nm_debug INT DEFAULT 0',
    )
  })
})

describe('wrapDamengCallWithDebugSession', () => {
  it('enables DBMS_OUTPUT and CLIENT_INFO', () => {
    const wrapped = wrapDamengCallWithDebugSession('SELECT 1 FROM DUAL;\n')
    expect(wrapped).toContain('DBMS_OUTPUT.ENABLE')
    expect(wrapped).toContain(`SET_CLIENT_INFO('${NM_DEBUG_CLIENT_INFO}')`)
    expect(wrapped).toContain('SELECT 1 FROM DUAL;')
  })
})
