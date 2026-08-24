import { describe, expect, it } from 'vitest'
import {
  countPostgresDebugLogPoints,
  insertPostgresDebugLogPoint,
  insertPostgresDebugLogPointAtLine,
  isPostgresDebugSessionScaffoldSql,
  wrapPostgresCallWithDebugSession,
} from './postgres-debug-assist'

const PROC = `CREATE OR REPLACE PROCEDURE public.demo(a int)
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1;
END;
$$;`

describe('postgres-debug-assist', () => {
  it('inserts log point after first BEGIN', () => {
    const out = insertPostgresDebugLogPoint(PROC)
    expect(countPostgresDebugLogPoints(out)).toBe(1)
    expect(out).toContain('/* nm-debug-point:')
    expect(out).toContain('RAISE NOTICE')
    expect(out).toContain("current_setting('niuma.debug'")
  })

  it('inserts at line', () => {
    const out = insertPostgresDebugLogPointAtLine(PROC, { line: 5, label: 'mid' })
    const lines = out.split('\n')
    const pointIdx = lines.findIndex((l) => l.includes('/* nm-debug-point: mid */'))
    expect(pointIdx).toBeGreaterThan(0)
  })

  it('wraps call with debug session GUC', () => {
    const wrapped = wrapPostgresCallWithDebugSession('CALL public.demo(1);')
    expect(wrapped).toContain("set_config('niuma.debug', '1'")
    expect(wrapped).toContain('CALL public.demo(1);')
    expect(wrapped).toContain("set_config('niuma.debug', ''")
  })

  it('detects debug session scaffold statements', () => {
    expect(
      isPostgresDebugSessionScaffoldSql("SELECT set_config('niuma.debug', '1', false)"),
    ).toBe(true)
    expect(
      isPostgresDebugSessionScaffoldSql(
        "-- Enable NOTICE for RAISE NOTICE log points (session-local)\nSELECT set_config('niuma.debug', '1', false)",
      ),
    ).toBe(true)
    expect(isPostgresDebugSessionScaffoldSql('SET client_min_messages TO NOTICE')).toBe(true)
    expect(
      isPostgresDebugSessionScaffoldSql(
        '-- Call function "public"."f_pinyin"\nSELECT * FROM "public"."f_pinyin"(NULL::varchar)',
      ),
    ).toBe(false)
  })
})
