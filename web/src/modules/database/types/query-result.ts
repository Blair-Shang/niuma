/**
 * 跨库查询结果面板的展示态类型（不绑定具体方言 API）。
 */

export type QueryResultMessageTone = 'default' | 'success' | 'warning' | 'error'

export type QueryResultPaneTabId = 'messages' | (string & {})

/** 结果顶栏 Tab 摘要（面板只读这些字段） */
export interface QueryResultGridTabSummary {
  id: string
  sqlPreview: string
  fetchedCount: number
  hasMore: boolean
}

export type QueryBatchStatementStatus =
  | 'pending'
  | 'running'
  | 'ok'
  | 'error'
  | 'cancelled'
  | 'skipped'

/** 批跑单句摘要（不含 rows） */
export interface QueryBatchStatementItem {
  index: number
  sqlPreview: string
  status: QueryBatchStatementStatus
  durationMs?: number
  rowCount?: number
  hasMore?: boolean
  commandTag?: string
  hasGrid?: boolean
  gridTabId?: string
  error?: string
}

export interface QueryResultMessageItem {
  key: string
  label: string
  value: string
  tone?: QueryResultMessageTone
}

/** 行对象约定：至少含稳定 `__rowKey` */
export type QueryResultRow = Record<string, unknown> & { __rowKey: string }

/** 注入文案，避免组件绑定 modules.mysql / modules.vastbase */
export interface QueryResultPanelLabels {
  batchResultTab: (n: number) => string
  /** 结果 Tab 行数徽章，避免与「结果 n」序号混淆 */
  tabRowCount: (n: number, hasMore: boolean) => string
  messages: string
  closeResultTab: string
  filterPlaceholder: string
  loadMore: string
  fetchAll: string
  exportCsv: string
  messagesEmpty: string
  emptyResult: string
  resultEmpty: string
  batchStmtLabel: (n: number) => string
  batchStmtSkipped: string
  batchStmtRunning: string
  batchStmtPending: string
  batchOpenResult: string
  msgOk: string
  msgError: string
  cancelled: string
  /** 消息日志列表表头 */
  logColStatus: string
  logColTime: string
  logColRows: string
  /** 复制消息/错误全文 */
  copyMessage?: string
  /** 复制成功短暂提示 */
  copiedHint?: string
  /** 双击单元格查看标题前缀 */
  cellViewTitle?: string
  /** 查看弹窗关闭 */
  cellViewClose?: string
  /** 复制单元格全文 */
  cellViewCopyFull?: string
  /** 复制成功短暂提示（单元格） */
  cellViewCopied?: string
}
