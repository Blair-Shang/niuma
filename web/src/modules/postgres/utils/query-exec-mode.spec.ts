import { describe, expect, it } from 'vitest'
import {
  ensureBatchExecMarker,
  hasBatchExecMarker,
  NIUMA_EXEC_BATCH_MARKER,
  resolveQueryExecMode,
} from '@/modules/postgres/utils/query-exec-mode'

describe('query-exec-mode', () => {
  it('detects batch marker case-insensitively', () => {
    expect(hasBatchExecMarker(`${NIUMA_EXEC_BATCH_MARKER}\nSELECT 1`)).toBe(true)
    expect(hasBatchExecMarker('-- NIUMA:EXEC=BATCH\nSELECT 1')).toBe(true)
    expect(hasBatchExecMarker('SELECT 1;\n-- niuma:exec=batch\nSELECT 2')).toBe(true)
    expect(hasBatchExecMarker('SELECT 1')).toBe(false)
  })

  it('ensureBatchExecMarker is idempotent', () => {
    const once = ensureBatchExecMarker('CREATE TEMP TABLE t(i int);\nSELECT 1;')
    expect(once.startsWith(NIUMA_EXEC_BATCH_MARKER)).toBe(true)
    expect(ensureBatchExecMarker(once)).toBe(once)
  })

  it('resolveQueryExecMode prefers SQL marker over prop', () => {
    expect(resolveQueryExecMode(undefined, 'SELECT 1')).toBe('paged')
    expect(resolveQueryExecMode('paged', 'SELECT 1')).toBe('paged')
    expect(resolveQueryExecMode('batch', 'SELECT 1')).toBe('batch')
    expect(resolveQueryExecMode('paged', `${NIUMA_EXEC_BATCH_MARKER}\nSELECT 1`)).toBe('batch')
    expect(resolveQueryExecMode(undefined, `${NIUMA_EXEC_BATCH_MARKER}\nSELECT 1`)).toBe('batch')
  })
})
