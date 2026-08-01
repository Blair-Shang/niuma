import type { SqlHistoryEntry } from '../utils/sql-history'

/** 查询工具栏文案（由方言 i18n 注入，便于 Oracle/PG 复用壳层） */
export interface SqlQueryToolbarLabels {
  toolbarAria: string
  format: string
  formatTooltip: string
  explain: string
  explainTooltip: string
  explainAnalyze: string
  explainAnalyzeTooltip: string
  run: string
  runSelection: string
  runTooltip: string
  cancel: string
  cancelTooltip: string
  history: string
  historyEmpty: string
  historyClear: string
  /** 事务条（可选） */
  autoCommit?: string
  autoCommitTooltip?: string
  commit?: string
  commitTooltip?: string
  rollback?: string
  rollbackTooltip?: string
  inTransaction?: string
}

/** 编辑器右键菜单文案 */
export interface SqlQueryContextMenuLabels {
  run: string
  runSelection: string
  cancel: string
  format: string
  compress: string
  copy: string
  paste: string
  explain: string
  explainAnalyze: string
  askAi?: string
  exportCsv: string
  fetchMore: string
  fetchAll: string
}

export type SqlQueryHistoryEntry = SqlHistoryEntry
