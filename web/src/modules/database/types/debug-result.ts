/**
 * 调试辅助结果区：跨方言复用的结果网格展示态（不绑定具体方言 API）。
 */

import type { RsTableColumn } from '@niuma/ui'

/** 单个结果集（行至少含稳定 `__rowKey`） */
export interface DebugResultGrid {
  id: string
  title: string
  columns: RsTableColumn<any>[]
  rows: Array<Record<string, unknown> & { __rowKey: string }>
  /** SQL / CALL 预览 */
  sqlPreview?: string
  rowCount?: number
  durationMs?: number
}

/** 注入文案，避免组件绑定 modules.* 方言 i18n */
export interface DebugResultPanelLabels {
  empty: string
  emptyTable?: string
  rows: (n: number) => string
  duration: (ms: number) => string
  /** 单行结果转置：左列出参名 */
  outName: string
  /** 单行结果转置：右列出参值 */
  outValue: string
}
