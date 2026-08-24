export type {
  QueryBatchStatementItem,
  QueryBatchStatementStatus,
  QueryResultGridTabSummary,
  QueryResultMessageItem,
  QueryResultMessageTone,
  QueryResultPanelLabels,
  QueryResultPaneTabId,
  QueryResultRow,
} from './types/query-result'

export type {
  SqlQueryContextMenuLabels,
  SqlQueryHistoryEntry,
  SqlQueryToolbarLabels,
} from './types/sql-query-shell'

export type {
  DataTransferFileFieldLabels,
  DataTransferLogLine,
  DataTransferPanelLabels,
  DataTransferShellLabels,
} from './types/data-transfer'

export type {
  TableDesignMode,
  TableDesignSection,
  TableDesignSectionItem,
  TableDesignShellLabels,
} from './types/table-design'

export type {
  ObjectScriptMode,
  ObjectScriptMessageTone,
  ObjectScriptShellLabels,
  ObjectScriptContextMenuLabels,
} from './types/object-script'

export type {
  DebugShellLabels,
  DebugShellParamRow,
  DebugShellState,
  DebugShellStateTone,
} from './types/debug-shell'

export type { DebugResultGrid, DebugResultPanelLabels } from './types/debug-result'

export type { DebugMessageItem, DebugMessageTone } from './types/debug-assist'
export { debugMessageBadge, parseDebugMessageLines } from './types/debug-assist'

export type { BrowseDataRow, BrowseDataShellLabels } from './types/browse-data'

export type { DdlShellLabels } from './types/ddl-shell'

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
} from './utils/query-batch'

export {
  countOpenCursors,
  createGridTabId,
  mapResultRowsByName,
} from './utils/query-result-tabs'

export {
  clearSqlHistory,
  loadSqlHistory,
  previewSqlHistory,
  pushSqlHistory,
  type SqlHistoryEntry,
  type SqlHistoryStoragePrefix,
} from './utils/sql-history'

export { buildSqlQueryContextMenuItems } from './utils/sql-query-context-menu'
export type { SqlQueryContextMenuState } from './utils/sql-query-context-menu'

export { buildObjectScriptContextMenuItems } from './utils/object-script-context-menu'
export type { ObjectScriptContextMenuState } from './utils/object-script-context-menu'

export { useSqlQueryEditor } from './composables/useSqlQueryEditor'
export type { SqlQueryEditorPrepareContext } from './composables/useSqlQueryEditor'
export { useSqlQueryHistory } from './composables/useSqlQueryHistory'
export {
  hasQueryDraft,
  QUERY_DRAFT_MAX_CHARS,
  QUERY_DRAFT_PERSIST_MS,
  resolveQueryDraftSql,
  useQueryDraftPersist,
} from './composables/useQueryDraftPersist'
export { useDataTransferPresentation } from './composables/useDataTransferPresentation'

export { default as QueryResultPanel } from './components/QueryResultPanel.vue'
export { default as SqlQueryToolbar } from './components/SqlQueryToolbar.vue'
export { default as SqlQueryShell } from './components/SqlQueryShell.vue'
export { default as DataTransferShell } from './components/DataTransferShell.vue'
export { default as DataTransferPanel } from './components/DataTransferPanel.vue'
export { default as DataTransferSection } from './components/DataTransferSection.vue'
export { default as DataTransferFileField } from './components/DataTransferFileField.vue'
export { default as DataTransferCheck } from './components/DataTransferCheck.vue'
export { default as TableDesignShell } from './components/TableDesignShell.vue'
export { default as TableDesignPreviewPopover } from './components/TableDesignPreviewPopover.vue'
export { default as ObjectScriptShell } from './components/ObjectScriptShell.vue'
export { default as DebugShell } from './components/DebugShell.vue'
export { default as DebugParamsGrid } from './components/DebugParamsGrid.vue'
export { default as DebugResultPanel } from './components/DebugResultPanel.vue'
export { default as DebugMessagesPanel } from './components/DebugMessagesPanel.vue'
export { default as DebugHelpPanel } from './components/DebugHelpPanel.vue'
export { default as BrowseDataShell } from './components/BrowseDataShell.vue'
export { default as BrowseIoMenu } from './components/BrowseIoMenu.vue'
export { default as BrowseDataGrid } from './components/BrowseDataGrid.vue'
export { default as BrowseCellEditorDialog } from './components/BrowseCellEditorDialog.vue'
export { default as DdlShell } from './components/DdlShell.vue'

export {
  formatRowsAsTsv,
  mapPasteToColumnRecords,
  parseClipboardMatrix,
} from './utils/browse-clipboard'
export { parseEditValue } from './utils/sql-literal'
export {
  formatBrowseCellValue,
  isBrowseBinCell,
  isBrowseLobCell,
  isBrowseBinaryLobCell,
  extractBrowseLobText,
  formatBrowseLobSummary,
  formatBrowseBinSummary,
  formatBrowseBinViewText,
  truncateBrowsePreview,
  BROWSE_CELL_PREVIEW_CHARS,
} from './utils/browse-cell-format'
export {
  alignForValueType,
  normalizeSqlDataType,
  resolveSqlValueType,
  isSqlBinaryLobType,
  isSqlTextLobType,
  type GridCellValueType,
} from './utils/column-value-type'
export { useBrowseCellDialog } from './composables/useBrowseCellDialog'
export type { BrowseCellEditorDialogLabels } from './composables/useBrowseCellDialog'
export { useCellViewDialog } from './composables/useCellViewDialog'
export type { CellViewDialogLabels } from './composables/useCellViewDialog'
export {
  useBrowseGridEditing,
  BROWSE_GRID_EDIT_PROPS,
} from './composables/useBrowseGridEditing'
export type { BrowseStageableTable, UseBrowseGridEditingOptions } from './composables/useBrowseGridEditing'
export {
  buildBrowseResultColumn,
  type BuildBrowseResultColumnOptions,
  type BrowseRowChange,
} from './utils/browse-result-column'
export {
  formatIsoUtcToLocal,
  looksLikeIsoDateTimeWithTz,
  parseLocalDateTimeToUtcIso,
} from './utils/iso-local-datetime'
export { isBrowseFilterCompletionOpen } from './utils/browse-filter-keydown'

export {
  autoMatchColumns,
  firstCsvLine,
  parseCsvPreview,
  parseCsvSourceColumns,
  parseTsvPreview,
  splitCsvLine,
  splitCsvRecords,
  unescapeTsvField,
  type CsvPreviewResult,
} from './utils/csv-header'
