import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRsToast, type RsContextMenuItem, type RsTableColumn } from '@niuma/ui'
import { oracleApi } from '@/api/oracle'
import type { OracleQueryColumn, OracleQueryExecResult } from '@/api/types/oracle'
import { defaultOracleProfile, resolveSplitFeaturesFromProfile } from '@/modules/sql-editor/capabilities'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import { useOracleSqlEditor } from '@/modules/oracle/composables/useOracleSqlEditor'
import { alignForValueType, buildSqlQueryContextMenuItems, formatBrowseCellValue, resolveSqlValueType, useSqlQueryHistory, type QueryResultMessageItem, type QueryResultPanelLabels, type SqlQueryToolbarLabels } from '@/modules/database'
import { mapResultRowsByName, type QueryResultRow } from '@/modules/database/utils/query-result-tabs'
import { useSessionRegistry } from '@/stores/session-registry'

export type OracleQueryPaneProps = {
  sessionId: string | null
  profileId?: string
  schema?: string
  initialSql?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
  active?: boolean
}

type GridTab = {
  id: string
  sqlPreview: string
  columns: OracleQueryColumn[]
  rows: QueryResultRow[]
  rowCount: number
  fetchedCount: number
  hasMore: boolean
  truncated?: boolean
  resultSetId?: string
  durationMs: number
  label: string
  stmtIndex: number
}
const PAGE_LIMIT = 1000

function formatOracleCellValue(value: unknown, valueType: ReturnType<typeof resolveSqlValueType>): string {
  if (value && typeof value === 'object' && '$lob' in value) {
    const lob = (value as { $lob?: { preview?: unknown; value?: unknown; truncated?: boolean; byteLength?: number } }).$lob
    const preview = lob?.preview ?? lob?.value ?? ''
    const text = typeof preview === 'string' ? preview : JSON.stringify(preview)
    return `${text ?? ''}${lob?.truncated ? ' … [LOB truncated]' : ''}`
  }
  return formatBrowseCellValue(value, valueType)
}

export function useOracleQueryPane(props: OracleQueryPaneProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const sessions = useSessionRegistry()
  const sqlText = ref(props.initialSql?.trim() || 'SELECT 1 FROM DUAL;\n')
  const running = ref(false)
  const cancelling = ref(false)
  const loadingMore = ref(false)
  const filterText = ref('')
  const activePaneTab = ref<string>('messages')
  const lastError = ref<string | null>(null)
  const lastExecSummary = ref('')
  const activeRequestId = ref<string | null>(null)
  const gridTabs = shallowRef<GridTab[]>([])
  const batchItems = shallowRef([])
  const batchActive = computed(() => false)
  const autoCommit = ref(true)
  const inTransaction = ref(false)
  const txBusy = ref(false)
  const profile = () => props.sessionId ? sessions.getDialectForSession(props.sessionId) ?? defaultOracleProfile() : defaultOracleProfile()
  const editor = useOracleSqlEditor({
    sqlText, active: () => props.active !== false, onRun: () => { void runSql() },
    getDialect: profile,
    getSuggestScope: () => props.sessionId ? { sessionId: props.sessionId, schema: props.schema?.trim() || undefined } : null,
  })
  const { historyOpen, historyEntries, rememberSql, onHistoryPick } = useSqlQueryHistory({
    profileId: () => props.profileId, storagePrefix: 'niuma.oracle.sqlHistory.', sqlText,
  })
  const activeGrid = computed(() => gridTabs.value.find((tab) => tab.id === activePaneTab.value) ?? null)
  const resultColumns = computed((): RsTableColumn[] => (activeGrid.value?.columns ?? []).map((column, index) => {
    const name = column.name || `col${index + 1}`
    const valueType = resolveSqlValueType(column.dataType)
    return { key: name, title: name, width: 120, minWidth: 96, ellipsis: true, sortable: true, filterable: true, align: alignForValueType(valueType), valueType, headerTip: [t('modules.oracle.query.colTipField', { name }), column.dataType ? t('modules.oracle.query.colTipType', { type: column.dataType }) : ''].filter(Boolean).join('\n'), formatter: valueType === 'boolean' ? undefined : (value) => formatOracleCellValue(value, valueType) }
  }))
  const resultRows = computed(() => activeGrid.value?.rows ?? [])
  const filterKeys = computed(() => resultColumns.value.map((column) => String(column.key)))
  const hasMore = computed(() => Boolean(activeGrid.value?.hasMore && activeGrid.value.resultSetId))
  const identityTitle = computed(() => [props.sessionLabel || 'Oracle', props.schema].filter(Boolean).join(' · '))
  const resultSummaryText = computed(() => {
    const grid = activeGrid.value ?? gridTabs.value.at(-1)
    if (grid) return t('modules.oracle.query.resultSummary', { rows: grid.rowCount, cols: grid.columns.length, ms: grid.durationMs })
    return lastError.value ? t('modules.oracle.query.execFailed') : lastExecSummary.value
  })
  const messageItems = computed((): QueryResultMessageItem[] => lastError.value
    ? [{ key: 'error', label: t('modules.oracle.query.msgError'), value: lastError.value, tone: 'error' }]
    : lastExecSummary.value ? [{ key: 'summary', label: t('modules.oracle.query.msgOk'), value: lastExecSummary.value, tone: 'success' }] : [])
  const hasMessages = computed(() => messageItems.value.length > 0)

  function addGrid(result: OracleQueryExecResult, index: number): void {
    const columns = result.columns ?? []
    const tab: GridTab = { id: `result-${Date.now()}-${index}`, sqlPreview: `Result ${index + 1}`, columns, rows: mapResultRowsByName(columns, result.rows ?? [], 0), rowCount: result.rowCount, fetchedCount: result.fetchedCount ?? result.rowCount, hasMore: Boolean(result.hasMore), truncated: result.truncated, resultSetId: result.resultSetId, durationMs: result.durationMs, label: t('modules.oracle.query.batchResultTab', { n: index + 1 }), stmtIndex: index }
    gridTabs.value = [...gridTabs.value, tab]
    activePaneTab.value = tab.id
  }
  async function runSql(): Promise<void> {
    if (!props.sessionId || running.value) return
    const sql = editor.resolveSql()
    if (!sql.trim()) { toast.warning(t('modules.oracle.query.empty')); return }
    running.value = true; lastError.value = null; lastExecSummary.value = ''; gridTabs.value = []
    const requestId = `oracle-${Date.now()}`; activeRequestId.value = requestId
    const statements = splitSqlStatementsWithFeatures(sql, resolveSplitFeaturesFromProfile(profile())).filter((item) => item.sql.trim())
    try {
      for (const [index, statement] of statements.entries()) {
        const result = await oracleApi.queryExec({ sessionId: props.sessionId, schema: props.schema?.trim() || undefined, sql: statement.sql, limit: PAGE_LIMIT, requestId })
        if (result.columns?.length) addGrid(result, index)
        else { lastExecSummary.value = result.rowsAffected ? t('modules.oracle.query.affected', { n: result.rowsAffected }) : t('modules.oracle.query.rows', { n: result.rowCount }) }
      }
      rememberSql(sql)
    } catch (error) { lastError.value = error instanceof Error ? error.message : String(error); activePaneTab.value = 'messages' }
    finally { running.value = false; cancelling.value = false; activeRequestId.value = null }
  }
  async function cancelRun(): Promise<void> {
    if (!running.value || !props.sessionId) return
    cancelling.value = true
    try { await oracleApi.queryCancel({ sessionId: props.sessionId, requestId: activeRequestId.value ?? undefined }) } catch {}
  }
  async function runExplain(): Promise<void> {
    if (!props.sessionId || running.value) return
    const sql = editor.resolveSql()
    if (!sql.trim()) { toast.warning(t('modules.oracle.query.empty')); return }
    running.value = true; lastError.value = null; lastExecSummary.value = ''; gridTabs.value = []
    try {
      const result = await oracleApi.queryExplain({ sessionId: props.sessionId, schema: props.schema?.trim() || undefined, sql, limit: PAGE_LIMIT })
      if (result.columns?.length) addGrid(result, 0)
      else lastExecSummary.value = t('modules.oracle.query.explainDone')
    } catch (error) { lastError.value = error instanceof Error ? error.message : String(error); activePaneTab.value = 'messages' }
    finally { running.value = false }
  }
  async function fetchMore(): Promise<void> {
    const grid = activeGrid.value
    if (!grid?.resultSetId || !props.sessionId) return
    loadingMore.value = true
    try {
      const result = await oracleApi.queryFetch({ sessionId: props.sessionId, resultSetId: grid.resultSetId, limit: PAGE_LIMIT })
      const updated = { ...grid, rows: [...grid.rows, ...mapResultRowsByName(grid.columns, result.rows, grid.rows.length)], rowCount: grid.rowCount + result.rowCount, fetchedCount: grid.fetchedCount + result.fetchedCount, hasMore: result.hasMore, truncated: result.truncated, resultSetId: result.hasMore ? result.resultSetId : undefined, durationMs: grid.durationMs + result.durationMs }
      gridTabs.value = gridTabs.value.map((tab) => tab.id === grid.id ? updated : tab)
    } catch { toast.error(t('modules.oracle.query.fetchError')) } finally { loadingMore.value = false }
  }
  async function fetchAll(): Promise<void> { while (hasMore.value) await fetchMore() }
  async function syncTxState(): Promise<void> {
    if (!props.sessionId) return
    try {
      const state = await oracleApi.txGetState({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
    } catch {
      // Older services may not expose transaction state yet.
    }
  }
  async function setAutoCommit(value: boolean): Promise<void> {
    if (!props.sessionId || txBusy.value) return
    txBusy.value = true
    try {
      const state = await oracleApi.txSetAutoCommit({ sessionId: props.sessionId, autoCommit: value })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { txBusy.value = false }
  }
  async function commitTx(): Promise<void> {
    if (!props.sessionId || txBusy.value) return
    txBusy.value = true
    try {
      const state = await oracleApi.txCommit({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
      toast.success(t('modules.oracle.query.commitDone'))
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { txBusy.value = false }
  }
  async function rollbackTx(): Promise<void> {
    if (!props.sessionId || txBusy.value) return
    txBusy.value = true
    try {
      const state = await oracleApi.txRollback({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
      toast.success(t('modules.oracle.query.rollbackDone'))
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { txBusy.value = false }
  }
  function closeResultGridTab(id: string): void {
    const tab = gridTabs.value.find((item) => item.id === id)
    if (tab?.resultSetId && props.sessionId) void oracleApi.queryClose({ sessionId: props.sessionId, resultSetId: tab.resultSetId })
    gridTabs.value = gridTabs.value.filter((item) => item.id !== id)
    if (activePaneTab.value === id) activePaneTab.value = gridTabs.value.at(-1)?.id ?? 'messages'
  }
  function exportCsv(): void {
    const grid = activeGrid.value
    if (!grid) { toast.warning(t('modules.oracle.query.noResult')); return }
    const columns = grid.columns.map((column) => column.name)
    const blob = new Blob(['\uFEFF' + [columns.join(','), ...grid.rows.map((row) => columns.map((column) => JSON.stringify(row[column] ?? '')).join(','))].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'oracle-export.csv'; link.click(); URL.revokeObjectURL(link.href)
  }
  const contextMenuItems = computed((): RsContextMenuItem[] => buildSqlQueryContextMenuItems({ labels: { run: t('modules.oracle.query.run'), runSelection: t('modules.oracle.query.runSelection'), cancel: t('modules.oracle.query.cancel'), format: t('modules.oracle.query.format'), compress: t('modules.oracle.query.format'), copy: t('modules.oracle.query.run'), paste: t('modules.oracle.query.run'), explain: t('modules.oracle.query.explain'), explainAnalyze: '', exportCsv: t('modules.oracle.query.exportCsv'), fetchMore: t('modules.oracle.query.loadMore'), fetchAll: t('modules.oracle.query.fetchAll') }, running: running.value, cancelling: cancelling.value, hasSelection: editor.hasSelection.value, sqlEmpty: !sqlText.value.trim(), hasResultRows: Boolean(resultRows.value.length), hasMore: hasMore.value, loadingMore: loadingMore.value, showAskAi: false }))
  const toolbarLabels = computed((): SqlQueryToolbarLabels => ({ toolbarAria: 'Oracle', run: t('modules.oracle.query.run'), runSelection: t('modules.oracle.query.runSelection'), runTooltip: t('modules.oracle.query.runHint'), cancel: t('modules.oracle.query.cancel'), cancelTooltip: t('modules.oracle.query.cancel'), format: t('modules.oracle.query.format'), formatTooltip: t('modules.oracle.query.formatTooltip'), explain: t('modules.oracle.query.explain'), explainTooltip: t('modules.oracle.query.explainHint'), explainAnalyze: '', explainAnalyzeTooltip: '', history: t('modules.oracle.query.history'), historyEmpty: t('modules.oracle.query.historyEmpty'), historyClear: t('modules.oracle.query.historyClear'), autoCommit: t('modules.oracle.query.autoCommit'), autoCommitTooltip: t('modules.oracle.query.autoCommitTooltip'), commit: t('modules.oracle.query.commit'), commitTooltip: t('modules.oracle.query.commitTooltip'), rollback: t('modules.oracle.query.rollback'), rollbackTooltip: t('modules.oracle.query.rollbackTooltip'), inTransaction: t('modules.oracle.query.inTransaction') }))
  const resultPanelLabels = computed((): QueryResultPanelLabels => ({ messages: t('modules.oracle.query.messages'), messagesEmpty: t('modules.oracle.query.messagesEmpty'), filterPlaceholder: t('modules.oracle.query.filterPlaceholder'), loadMore: t('modules.oracle.query.loadMore'), fetchAll: t('modules.oracle.query.fetchAll'), exportCsv: t('modules.oracle.query.exportCsv'), emptyResult: t('modules.oracle.query.emptyResult'), resultEmpty: t('modules.oracle.query.resultEmpty'), closeResultTab: t('modules.oracle.query.closeResultTab'), batchResultTab: (n) => t('modules.oracle.query.batchResultTab', { n }), tabRowCount: (n) => t('modules.oracle.query.rows', { n }), batchStmtLabel: (n) => `#${n}`, batchStmtSkipped: '', batchStmtRunning: '', batchStmtPending: '', batchOpenResult: '', logColStatus: '', logColTime: '', logColRows: '', msgOk: t('modules.oracle.query.msgOk'), msgError: t('modules.oracle.query.msgError'), cancelled: t('modules.oracle.query.cancelled') }))
  onMounted(() => { void syncTxState(); if (props.autoRunInitialSql && props.initialSql?.trim()) void runSql() })
  watch(() => props.sessionId, (sessionId) => { if (sessionId) void syncTxState() })
  onUnmounted(() => { if (props.sessionId) gridTabs.value.forEach((tab) => { if (tab.resultSetId) void oracleApi.queryClose({ sessionId: props.sessionId!, resultSetId: tab.resultSetId }) }) })
  function onContextMenuSelect(key: string): void {
    if (key === 'run') {
      void runSql()
    } else if (key === 'explain') {
      void runExplain()
    } else if (key === 'format') {
      void editor.formatSql()
    }
  }
  return { t, sqlText, running, cancelling, loadingMore, filterText, activePaneTab, lastError, gridTabs, batchItems, batchActive, identityTitle, resultColumns, resultRows, filterKeys, hasMore, resultSummaryText, messageItems, hasMessages, resultPanelLabels, monacoLanguage: computed(() => editor.sqlLanguage.value), languageReady: editor.languageReady, editorRef: editor.editorRef, hasSelection: editor.hasSelection, historyOpen, historyEntries, toolbarLabels, contextMenuItems, autoCommit, inTransaction, txBusy, formatEditor: () => { void editor.formatSql() }, selectResultTab: (id: string) => { activePaneTab.value = id }, closeResultGridTab, openBatchGrid: () => {}, runSql, runExplain, cancelRun, fetchMore, fetchAll, exportCsv, onHistoryPick, setAutoCommit, commitTx, rollbackTx, onContextMenuSelect }
}
