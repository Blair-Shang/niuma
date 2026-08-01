/**
 * 查询结果多 Tab 模型（批跑：每个结果集一页）。
 */
import type { VastQueryColumn } from '@/api/types/vastbase'
import {
  countOpenCursors,
  createGridTabId,
  type QueryResultRow,
} from '@/modules/database/utils/query-result-tabs'
import type { QueryResultPaneTabId } from '@/modules/database/types/query-result'

export type VastQueryResultRow = QueryResultRow
export type VastResultPaneTabId = QueryResultPaneTabId

/** 单个结果集 Tab（含首屏/已续取行） */
export interface VastGridTab {
  id: string
  /** 批跑句序号（0-based）；单句为 0 */
  stmtIndex: number
  /** 展示序号（结果 1 / Result 1） */
  ordinal: number
  sqlPreview: string
  columns: VastQueryColumn[]
  rows: VastQueryResultRow[]
  resultSetId: string | null
  hasMore: boolean
  truncated?: boolean
  durationMs: number
  fetchedCount: number
  rowCount: number
  commandTag?: string
  notices?: string[]
  requestId?: string
}

export { createGridTabId, countOpenCursors }
