/**
 * 查询结果多 Tab 通用工具（跨库共享）。
 */
import type { QueryResultRow } from '../types/query-result'

export type { QueryResultRow }

export function createGridTabId(stmtIndex: number): string {
  return `grid-${stmtIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function countOpenCursors(
  tabs: readonly { resultSetId: string | null; hasMore: boolean }[],
): number {
  let n = 0
  for (const tab of tabs) {
    if (tab.resultSetId && tab.hasMore) n += 1
  }
  return n
}

export function mapResultRowsByName(
  columns: readonly { name: string }[],
  rows: unknown[][],
  startIndex: number,
): QueryResultRow[] {
  return rows.map((row, rowIdx) => {
    const obj: QueryResultRow = { __rowKey: String(startIndex + rowIdx) }
    columns.forEach((col, colIdx) => {
      const key = col.name || `col${colIdx + 1}`
      obj[key] = row[colIdx]
    })
    return obj
  })
}
