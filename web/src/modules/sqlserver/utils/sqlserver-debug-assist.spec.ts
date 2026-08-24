import { describe, expect, it } from 'vitest'
import {
  countSqlServerDebugLogPoints,
  insertSqlServerDebugLogPoint,
  wrapSqlServerCallWithDebugSession,
} from './sqlserver-debug-assist'

describe('insertSqlServerDebugLogPoint', () => {
  it('inserts after BEGIN', () => {
    const sql = insertSqlServerDebugLogPoint(
      'CREATE PROC dbo.p AS BEGIN\n  SELECT 1;\nEND',
      { kind: 'procedure' },
    )
    expect(countSqlServerDebugLogPoints(sql)).toBe(1)
    expect(sql).toContain('nm_debug_point')
    expect(sql).toContain('AS [nm_debug_point]')
  })
})

describe('wrapSqlServerCallWithDebugSession', () => {
  it('injects @nm_debug after SET NOCOUNT ON', () => {
    const wrapped = wrapSqlServerCallWithDebugSession(
      'SET NOCOUNT ON;\nEXEC [dbo].[p];\nSELECT 1;',
    )
    expect(wrapped).toContain('SET NOCOUNT ON;')
    expect(wrapped).toContain('DECLARE @nm_debug bit = 1;')
    expect(wrapped.indexOf('SET NOCOUNT ON;')).toBeLessThan(wrapped.indexOf('DECLARE @nm_debug'))
    expect(wrapped.indexOf('DECLARE @nm_debug')).toBeLessThan(wrapped.indexOf('EXEC'))
  })
})
