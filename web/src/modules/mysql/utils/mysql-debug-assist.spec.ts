import { describe, expect, it } from 'vitest'
import {
  NM_DEBUG_PARAM,
  NM_DEBUG_SESSION_VAR,
  addMysqlRoutineInParam,
  buildMysqlDebugRoutineDraft,
  countMysqlDebugLogPoints,
  insertMysqlDebugLogPoint,
  insertMysqlDebugLogPointAtLine,
  renameMysqlRoutineInDdl,
  wrapMysqlCallWithDebugSession,
} from './mysql-debug-assist'

const PROC = `CREATE PROCEDURE \`demo\`.\`sp_mix\`(IN a INT)
BEGIN
  SET a = a + 1;
END`

const FUNC = `CREATE FUNCTION \`demo\`.\`fn_add\`(a INT, b INT) RETURNS INT
BEGIN
  RETURN a + b;
END`

describe('insertMysqlDebugLogPoint', () => {
  it('inserts SELECT gate after BEGIN for procedures', () => {
    const out = insertMysqlDebugLogPoint(PROC, { kind: 'procedure' })
    expect(countMysqlDebugLogPoints(out)).toBe(1)
    expect(out).toContain(`IF IFNULL(${NM_DEBUG_SESSION_VAR}, 0) <> 0 THEN`)
    expect(out).toContain('nm_debug_point')
    expect(out).toContain('SET a = a + 1;')
  })

  it('uses SET trace for functions', () => {
    const out = insertMysqlDebugLogPoint(FUNC, { kind: 'function', label: 'enter' })
    expect(out).toContain("SET @nm_debug_trace = CONCAT")
    expect(out).toContain('enter;')
    expect(out).not.toContain('SELECT \'enter\'')
  })

  it('inserts after a chosen line', () => {
    const out = insertMysqlDebugLogPointAtLine(PROC, { kind: 'procedure', line: 3, label: 'mid' })
    const lines = out.split('\n')
    const setIdx = lines.findIndex((l) => l.includes('SET a = a + 1'))
    const pointIdx = lines.findIndex((l) => l.includes('/* nm-debug-point: mid */'))
    expect(pointIdx).toBeGreaterThan(setIdx)
  })

  it('keeps label inside the comment (valid SQL)', () => {
    const out = insertMysqlDebugLogPoint(FUNC, { kind: 'function', label: 'point_1' })
    expect(out).toContain('/* nm-debug-point: point_1 */')
    expect(out).not.toMatch(/\*\/\s*point_1\b/)
  })
})

describe('buildMysqlDebugRoutineDraft', () => {
  it('renames, adds p_nm_debug, and injects enter point', () => {
    const { ddl, draftName } = buildMysqlDebugRoutineDraft({
      ddl: PROC,
      kind: 'procedure',
      originalName: 'sp_mix',
    })
    expect(draftName).toBe('sp_mix_debug')
    expect(ddl).toContain('`sp_mix_debug`')
    expect(ddl).toContain(`IN ${NM_DEBUG_PARAM} TINYINT`)
    expect(ddl).toContain('enter')
    expect(ddl).toMatch(/nm-debug draft/)
  })
})

describe('rename / add param helpers', () => {
  it('renames qualified routine', () => {
    expect(renameMysqlRoutineInDdl(PROC, 'procedure', 'sp_mix', 'sp_mix_debug')).toContain(
      '`sp_mix_debug`',
    )
  })

  it('appends IN param to empty and non-empty lists', () => {
    const empty = `CREATE PROCEDURE \`demo\`.\`noop\`()\nBEGIN\nEND`
    expect(addMysqlRoutineInParam(empty, 'procedure', 'p_nm_debug TINYINT')).toContain(
      '(IN p_nm_debug TINYINT)',
    )
    expect(addMysqlRoutineInParam(PROC, 'procedure', 'p_nm_debug TINYINT')).toContain(
      'IN a INT, IN p_nm_debug TINYINT',
    )
  })
})

describe('wrapMysqlCallWithDebugSession', () => {
  it('prefixes SET and reads function trace', () => {
    const wrapped = wrapMysqlCallWithDebugSession('SELECT 1;\n', { kind: 'function' })
    expect(wrapped).toContain(`SET ${NM_DEBUG_SESSION_VAR} = 1;`)
    expect(wrapped).toContain('nm_debug_trace')
  })
})
