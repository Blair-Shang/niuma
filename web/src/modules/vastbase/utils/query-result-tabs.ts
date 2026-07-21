/**
 * 查询结果多 Tab 模型（批跑：每个结果集一页）。
 */
import type { VastQueryColumn } from '@/api/types/vastbase'

export type VastQueryResultRow = Record<string, unknown> & { __rowKey: string }

export type VastResultPaneTabId = 'messages' | (string & {})

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

export function createGridTabId(stmtIndex: number): string {
  return `grid-${stmtIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function countOpenCursors(tabs: readonly VastGridTab[]): number {
  let n = 0
  for (const tab of tabs) {
    if (tab.resultSetId && tab.hasMore) n += 1
  }
  return n
}
