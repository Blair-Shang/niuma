/**
 * MySQL 查询结果多 Tab 模型（批跑：每个结果集一页）。
 */
import type { MysqlQueryColumn } from '@/api/types/mysql'
import {
  countOpenCursors,
  createGridTabId,
  mapResultRowsByName,
  type QueryResultRow,
} from '@/modules/database/utils/query-result-tabs'
import type { QueryResultPaneTabId } from '@/modules/database/types/query-result'

export type MysqlQueryResultRow = QueryResultRow
export type MysqlResultPaneTabId = QueryResultPaneTabId

export interface MysqlGridTab {
  id: string
  stmtIndex: number
  ordinal: number
  sqlPreview: string
  columns: MysqlQueryColumn[]
  rows: MysqlQueryResultRow[]
  resultSetId: string | null
  hasMore: boolean
  truncated?: boolean
  durationMs: number
  fetchedCount: number
  rowCount: number
  rowsAffected?: number
  commandTag?: string
  requestId?: string
}

export { createGridTabId, countOpenCursors }

export function mapResultRows(
  columns: readonly MysqlQueryColumn[],
  rows: unknown[][],
  startIndex: number,
): MysqlQueryResultRow[] {
  return mapResultRowsByName(columns, rows, startIndex)
}
