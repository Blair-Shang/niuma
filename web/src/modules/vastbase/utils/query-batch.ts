/**
 * Vastbase 查询批跑约定 — 复用跨库共享实现。
 */
export {
  BATCH_SQL_PREVIEW_CHARS,
  MAX_BATCH_STATEMENTS,
  MAX_OPEN_RESULT_CURSORS,
  MAX_RESULT_GRID_TABS,
  previewSql,
  resultHasGrid,
  yieldToEventLoop,
  type BatchStatementItem,
  type BatchStatementStatus,
} from '@/modules/database/utils/query-batch'
