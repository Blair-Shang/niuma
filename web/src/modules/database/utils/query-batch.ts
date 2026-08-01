/**
 * 查询批跑约定（跨库共享）。
 *
 * - 严禁并发：拆句后严格顺序 await queryExec
 * - 有结果集的语句各开一结果 Tab
 * - 客户端主动关闭过旧游标
 */

import type { QueryBatchStatementItem, QueryBatchStatementStatus } from '../types/query-result'

export const MAX_BATCH_STATEMENTS = 10_000
export const MAX_RESULT_GRID_TABS = 48
export const MAX_OPEN_RESULT_CURSORS = 6
export const BATCH_SQL_PREVIEW_CHARS = 96

export type BatchStatementStatus = QueryBatchStatementStatus
export type BatchStatementItem = QueryBatchStatementItem

export function previewSql(sql: string, max = BATCH_SQL_PREVIEW_CHARS): string {
  const oneLine = sql.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max)}…`
}

export function resultHasGrid(columns: readonly { name: string }[] | undefined): boolean {
  return Array.isArray(columns) && columns.length > 0
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(() => resolve())
    } else {
      globalThis.setTimeout(resolve, 0)
    }
  })
}
