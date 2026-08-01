/**
 * SQLite 查询面板：复用公共 database 模块工具，走 sqlite.query.* RPC。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRsToast, type RsContextMenuItem, type RsTableColumn } from '@niuma/ui'
import { sqliteApi } from '@/api/sqlite'
import type { SqliteQueryColumn, SqliteQueryExecResult } from '@/api/types/sqlite'
import {
  defaultSqliteProfile,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import { useSqliteSqlEditor } from '@/modules/sqlite/composables/useSqliteSqlEditor'
import {
  alignForValueType,
  buildSqlQueryContextMenuItems,
  formatBrowseCellValue,
  resolveSqlValueType,
  useSqlQueryHistory,
  type QueryResultMessageItem,
  type QueryResultPanelLabels,
  type SqlQueryToolbarLabels,
} from '@/modules/database'
import {
  MAX_BATCH_STATEMENTS,
  MAX_OPEN_RESULT_CURSORS,
  MAX_RESULT_GRID_TABS,
  previewSql,
  resultHasGrid,
  yieldToEventLoop,
  type BatchStatementItem,
} from '@/modules/database/utils/query-batch'
import {
  countOpenCursors,
  createGridTabId,
  mapResultRowsByName,
  type QueryResultRow,
} from '@/modules/database/utils/query-result-tabs'
import { useSessionRegistry } from '@/stores/session-registry'

export type SqliteQueryPaneProps = {
  sessionId: string | null
  profileId?: string
  schema?: string
  initialSql?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
  active?: boolean
}

type SqliteGridTab = {
  id: string
  sqlPreview: string
  columns: SqliteQueryColumn[]
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

type SqliteResultPaneTabId = 'messages' | string

const PAGE_LIMIT = 1000

export function useSqliteQueryPane(props: SqliteQueryPaneProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const sessionRegistry = useSessionRegistry()

  const sqlText = ref(props.initialSql?.trim() || 'SELECT 1;\n')
  const running = ref(false)
  const cancelling = ref(false)
  const cancelled = ref(false)
  const loadingMore = ref(false)
  const filterText = ref('')
  const activePaneTab = ref<SqliteResultPaneTabId>('messages')
  const lastError = ref<string | null>(null)
  const lastExecSummary = ref('')
  const activeRequestId = ref<string | null>(null)
  const gridTabs = shallowRef<SqliteGridTab[]>([])
  const batchItems = shallowRef<BatchStatementItem[]>([])
  const batchTotalMs = ref(0)
  const autoCommit = ref(true)
  const inTransaction = ref(false)
  const txBusy = ref(false)

  function dialectProfile() {
    if (!props.sessionId) return defaultSqliteProfile()
    return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultSqliteProfile()
  }

  const editor = useSqliteSqlEditor({
    sqlText,
    active: () => props.active !== false,
    onRun: () => {
      void runSql()
    },
    getDialect: () => dialectProfile(),
    getSuggestScope: () => {
      if (!props.sessionId) return null
      return {
        sessionId: props.sessionId,
        schema: props.schema?.trim() || undefined,
        database: props.schema?.trim() || undefined,
      }
    },
  })

  const { historyOpen, historyEntries, rememberSql, onHistoryPick } = useSqlQueryHistory({
    profileId: () => props.profileId,
    storagePrefix: 'niuma.sqlite.sqlHistory.',
    sqlText,
  })

  const identityTitle = computed(() => {
    const parts = [props.sessionLabel || 'SQLite']
    if (props.schema?.trim()) parts.push(props.schema.trim())
    return parts.join(' · ')
  })

  const batchActive = computed(() => batchItems.value.length > 1)

  const activeGrid = computed((): SqliteGridTab | null => {
    const id = activePaneTab.value
    if (id === 'messages') return null
    return gridTabs.value.find((g) => g.id === id) ?? null
  })

  const summaryGrid = computed(
    (): SqliteGridTab | null =>
      activeGrid.value ?? gridTabs.value[gridTabs.value.length - 1] ?? null,
  )

  const resultColumns = computed((): RsTableColumn[] => {
    const cols = activeGrid.value?.columns ?? []
    return cols.map((c, i) => {
      const name = c.name || `col${i + 1}`
      const tipLines = [t('modules.sqlite.query.colTipField', { name })]
      if (c.dataType?.trim()) {
        tipLines.push(t('modules.sqlite.query.colTipType', { type: c.dataType.trim() }))
      }
      const valueType = resolveSqlValueType(c.dataType)
      return {
        key: name,
        title: name,
        width: 120,
        minWidth: 96,
        ellipsis: true,
        sortable: true,
        filterable: true,
        align: alignForValueType(valueType),
        valueType,
        headerTip: tipLines.join('\n'),
        formatter:
          valueType === 'boolean'
            ? undefined
            : (value) => formatBrowseCellValue(value, valueType),
      }
    })
  })

  const resultRows = computed((): QueryResultRow[] => activeGrid.value?.rows ?? [])
  const filterKeys = computed(() => resultColumns.value.map((c) => String(c.key)))
  const hasMore = computed(
    () => Boolean(activeGrid.value?.hasMore && activeGrid.value?.resultSetId),
  )

  const resultSummaryText = computed(() => {
    if (running.value && batchActive.value) {
      const done = batchItems.value.filter(
        (x) => x.status === 'ok' || x.status === 'error',
      ).length
      return t('modules.sqlite.query.batchProgress', { done, total: batchItems.value.length })
    }
    if (batchActive.value && !running.value) {
      return t('modules.sqlite.query.batchResultHint', {
        n: batchItems.value.length,
        tabs: gridTabs.value.length,
      })
    }
    const grid = summaryGrid.value
    if (grid) {
      return t('modules.sqlite.query.resultSummary', {
        rows: grid.rowCount,
        cols: grid.columns.length,
        ms: grid.durationMs,
      })
    }
    if (lastError.value) return t('modules.sqlite.query.execFailed')
    if (lastExecSummary.value) return lastExecSummary.value
    return ''
  })

  const messageItems = computed((): QueryResultMessageItem[] => {
    const items: QueryResultMessageItem[] = []
    if (lastError.value) {
      items.push({ key: 'error', label: t('modules.sqlite.query.msgError'), value: lastError.value, tone: 'error' })
    }
    if (batchActive.value) {
      const ok = batchItems.value.filter((x) => x.status === 'ok').length
      const fail = batchItems.value.filter((x) => x.status === 'error').length
      items.push({
        key: 'batch-summary',
        label: t('modules.sqlite.query.batchLabel'),
        value: t('modules.sqlite.query.batchSummary', {
          ok, fail, total: batchItems.value.length, ms: batchTotalMs.value, tabs: gridTabs.value.length,
        }),
        tone: fail > 0 ? 'warning' : 'success',
      })
      return items
    }
    if (lastExecSummary.value) {
      items.push({ key: 'summary', label: t('modules.sqlite.query.msgOk'), value: lastExecSummary.value, tone: 'success' })
    }
    const grid = summaryGrid.value
    if (grid) {
      items.push({
        key: 'grid',
        label: t('modules.sqlite.query.resultTab'),
        value: t('modules.sqlite.query.resultSummary', { rows: grid.rowCount, cols: grid.columns.length, ms: grid.durationMs }),
        tone: 'default',
      })
      if (grid.hasMore) {
        items.push({ key: 'has-more', label: t('modules.sqlite.query.hasMore'), value: '', tone: 'warning' })
      }
      if (grid.truncated) {
        items.push({ key: 'truncated', label: t('modules.sqlite.query.truncated'), value: t('modules.sqlite.query.truncatedCap', { count: grid.fetchedCount }), tone: 'warning' })
      }
    }
    return items
  })

  const hasMessages = computed(
    () => messageItems.value.length > 0 || batchActive.value || Boolean(lastError.value),
  )

  const monacoLanguage = computed(() => editor.sqlLanguage.value)

  function addGridTab(result: SqliteQueryExecResult, stmtIndex: number, stmtSql: string): SqliteGridTab {
    const id = createGridTabId(stmtIndex)
    const cols = result.columns ?? []
    const rows = result.rows ? mapResultRowsByName(cols, result.rows, 0) : []
    const tab: SqliteGridTab = {
      id,
      sqlPreview: previewSql(stmtSql),
      columns: cols,
      rows,
      rowCount: result.rowCount,
      fetchedCount: result.fetchedCount ?? result.rowCount,
      hasMore: Boolean(result.hasMore),
      truncated: result.truncated,
      resultSetId: result.resultSetId,
      durationMs: result.durationMs,
      label: t('modules.sqlite.query.batchResultTab', { n: stmtIndex + 1 }),
      stmtIndex,
    }

    let tabs = [...gridTabs.value]

    // 释放超出上限的旧游标
    const openCount = countOpenCursors(tabs.map((t) => ({ resultSetId: t.resultSetId ?? null, hasMore: t.hasMore })))
    if (openCount >= MAX_OPEN_RESULT_CURSORS) {
      const oldest = tabs.find((t) => t.hasMore && t.resultSetId)
      if (oldest?.resultSetId) {
        void sqliteApi.queryClose({ sessionId: props.sessionId!, resultSetId: oldest.resultSetId })
        oldest.hasMore = false
        oldest.resultSetId = undefined
      }
    }
    if (tabs.length >= MAX_RESULT_GRID_TABS) {
      const trimCount = tabs.length - MAX_RESULT_GRID_TABS + 1
      const trimmed = tabs.splice(0, trimCount)
      toast.warning(t('modules.sqlite.query.batchTabsTrimmed', { n: trimCount, max: MAX_RESULT_GRID_TABS }))
      for (const old of trimmed) {
        if (old.resultSetId) {
          void sqliteApi.queryClose({ sessionId: props.sessionId!, resultSetId: old.resultSetId })
        }
      }
    }
    tabs.push(tab)
    gridTabs.value = tabs
    return tab
  }

  async function execStatement(
    stmt: string,
    requestId: string,
    stmtIndex: number,
  ): Promise<{ ok: boolean; affectedRows?: number; error?: string; durationMs: number }> {
    if (!props.sessionId) return { ok: false, error: t('modules.sqlite.query.noSession'), durationMs: 0 }
    try {
      const result = await sqliteApi.queryExec({
        sessionId: props.sessionId!,
        schema: props.schema?.trim() || undefined,
        sql: stmt,
        limit: PAGE_LIMIT,
        requestId,
      })
      if (cancelled.value) return { ok: true, durationMs: result.durationMs }
      if (resultHasGrid(result.columns)) {
        const tab = addGridTab(result, stmtIndex, stmt)
        activePaneTab.value = tab.id
      } else {
        const n = result.rowsAffected ?? result.rowCount
        lastExecSummary.value = n > 0
          ? t('modules.sqlite.query.affected', { n })
          : t('modules.sqlite.query.rows', { n: 0 })
        if (gridTabs.value.length > 0) {
          activePaneTab.value = gridTabs.value[gridTabs.value.length - 1].id
        } else {
          activePaneTab.value = 'messages'
        }
      }
      return { ok: true, durationMs: result.durationMs }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), durationMs: 0 }
    }
  }

  async function runSql(): Promise<void> {
    if (!props.sessionId || running.value) return
    const sql = editor.resolveSql()
    if (!sql.trim()) {
      toast.warning(t('modules.sqlite.query.empty'))
      return
    }
    running.value = true
    cancelling.value = false
    cancelled.value = false
    lastError.value = null
    lastExecSummary.value = ''
    gridTabs.value = []
    batchItems.value = []
    batchTotalMs.value = 0
    activePaneTab.value = 'messages'

    const profile = dialectProfile()
    const features = resolveSplitFeaturesFromProfile(profile)
    const stmts = splitSqlStatementsWithFeatures(sql, features).filter((s) => s.sql.trim())

    if (stmts.length > MAX_BATCH_STATEMENTS) {
      toast.error(t('modules.sqlite.query.batchTooMany', { count: stmts.length, max: MAX_BATCH_STATEMENTS }))
      running.value = false
      return
    }

    const requestId = `sqlite-${Date.now()}`
    activeRequestId.value = requestId

    if (stmts.length > 1) {
      const batchDraft: BatchStatementItem[] = stmts.map((s, i) => ({
        index: i,
        sqlPreview: previewSql(s.sql),
        status: 'pending' as const,
        durationMs: 0,
        rowCount: 0,
      }))
      batchItems.value = [...batchDraft]
    }

    rememberSql(sql)

    for (let i = 0; i < stmts.length; i++) {
      if (cancelled.value) break
      if (stmts.length > 1) {
        batchItems.value = batchItems.value.map((b, j) =>
          j === i ? { ...b, status: 'running' as const } : b,
        )
      }
      await yieldToEventLoop()
      const r = await execStatement(stmts[i].sql, requestId, i)
      batchTotalMs.value += r.durationMs
      if (stmts.length > 1) {
        batchItems.value = batchItems.value.map((b, j) =>
          j === i
            ? {
                ...b,
                status: r.ok ? ('ok' as const) : ('error' as const),
                durationMs: r.durationMs,
                error: r.error,
              }
            : b,
        )
      }
      if (!r.ok) {
        lastError.value = r.error ?? 'Unknown error'
        if (stmts.length > 1) {
          toast.error(t('modules.sqlite.query.batchStopped', { n: i + 1, message: r.error }))
        }
        activePaneTab.value = 'messages'
        break
      }
    }

    running.value = false
    cancelling.value = false
    activeRequestId.value = null
  }

  async function runExplain(): Promise<void> {
    if (!props.sessionId || running.value) return
    const sql = editor.resolveSql()
    if (!sql.trim()) return
    running.value = true
    lastError.value = null
    try {
      const result = await sqliteApi.queryExplain({
        sessionId: props.sessionId,
        sql: sql.trim(),
      })
      if (resultHasGrid(result.columns)) {
        const tab = addGridTab(result, 0, sql.trim())
        activePaneTab.value = tab.id
      }
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      activePaneTab.value = 'messages'
    } finally {
      running.value = false
    }
  }

  async function cancelRun(): Promise<void> {
    if (!running.value || !props.sessionId) return
    cancelling.value = true
    cancelled.value = true
    try {
      await sqliteApi.queryCancel({
        sessionId: props.sessionId,
        requestId: activeRequestId.value ?? undefined,
      })
    } catch {
      // 静默
    }
  }

  async function fetchMore(): Promise<void> {
    const grid = activeGrid.value
    if (!grid?.hasMore || !grid.resultSetId || !props.sessionId) return
    loadingMore.value = true
    try {
      const result = await sqliteApi.queryFetch({
        sessionId: props.sessionId,
        resultSetId: grid.resultSetId,
        limit: PAGE_LIMIT,
      })
      const newRows = result.rows
        ? mapResultRowsByName(grid.columns, result.rows, grid.rows.length)
        : []
      const updated = {
        ...grid,
        rows: [...grid.rows, ...newRows],
        fetchedCount: grid.fetchedCount + result.rowCount,
        hasMore: result.hasMore,
        truncated: result.truncated,
        resultSetId: result.hasMore ? result.resultSetId : undefined,
        durationMs: grid.durationMs + result.durationMs,
      }
      gridTabs.value = gridTabs.value.map((g) => (g.id === grid.id ? updated : g))
    } catch (e) {
      toast.error(t('modules.sqlite.query.fetchError'))
    } finally {
      loadingMore.value = false
    }
  }

  async function fetchAll(): Promise<void> {
    while (activeGrid.value?.hasMore) {
      await fetchMore()
      if (!activeGrid.value?.hasMore) break
    }
  }

  function exportCsv(): void {
    const grid = activeGrid.value
    if (!grid) {
      toast.warning(t('modules.sqlite.query.noResult'))
      return
    }
    const cols = grid.columns.map((c) => c.name)
    const lines = [cols.join(',')]
    for (const row of grid.rows) {
      lines.push(cols.map((c) => JSON.stringify(row[c] ?? '')).join(','))
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function selectResultTab(id: string): void {
    activePaneTab.value = id
  }

  function closeResultGridTab(id: string): void {
    const tab = gridTabs.value.find((g) => g.id === id)
    if (tab?.resultSetId && props.sessionId) {
      void sqliteApi.queryClose({ sessionId: props.sessionId, resultSetId: tab.resultSetId })
    }
    const newTabs = gridTabs.value.filter((g) => g.id !== id)
    gridTabs.value = newTabs
    if (activePaneTab.value === id) {
      activePaneTab.value = newTabs[newTabs.length - 1]?.id ?? 'messages'
    }
  }

  function openBatchGrid(item: { index: number }): void {
    const tab = gridTabs.value.find((g) => g.stmtIndex === item.index)
    if (tab) activePaneTab.value = tab.id
  }

  const contextMenuItems = computed((): RsContextMenuItem[] =>
    buildSqlQueryContextMenuItems({
      labels: {
        run: t('modules.sqlite.query.run'),
        runSelection: t('modules.sqlite.query.runSelection'),
        cancel: t('modules.sqlite.query.cancel'),
        format: t('modules.sqlite.query.format'),
        compress: t('modules.sqlite.query.format'),
        copy: t('modules.sqlite.query.run'),
        paste: t('modules.sqlite.query.run'),
        explain: t('modules.sqlite.query.explain'),
        explainAnalyze: t('modules.sqlite.query.explain'),
        exportCsv: t('modules.sqlite.query.exportCsv'),
        fetchMore: t('modules.sqlite.query.loadMore'),
        fetchAll: t('modules.sqlite.query.fetchAll'),
      },
      running: running.value,
      cancelling: cancelling.value,
      hasSelection: editor.hasSelection.value,
      sqlEmpty: !sqlText.value.trim(),
      hasResultRows: Boolean(activeGrid.value?.rows.length),
      hasMore: hasMore.value,
      loadingMore: loadingMore.value,
      showAskAi: false,
    }),
  )

  function formatEditor(): void {
    void editor.formatSql()
  }

  function onContextMenuSelect(key: string): void {
    switch (key) {
      case 'run': void runSql(); break
      case 'explain': void runExplain(); break
      case 'format': formatEditor(); break
      default: break
    }
  }

  async function syncTxState(): Promise<void> {
    if (!props.sessionId) return
    try {
      const state = await sqliteApi.txGetState({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
    } catch {
      // 静默
    }
  }

  async function setAutoCommit(val: boolean): Promise<void> {
    if (!props.sessionId || txBusy.value) return
    txBusy.value = true
    try {
      const state = await sqliteApi.txSetAutoCommit({ sessionId: props.sessionId, autoCommit: val })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      txBusy.value = false
    }
  }

  async function commitTx(): Promise<void> {
    if (!props.sessionId || txBusy.value) return
    txBusy.value = true
    try {
      const state = await sqliteApi.txCommit({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
      toast.success(t('modules.sqlite.query.commitDone'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      txBusy.value = false
    }
  }

  async function rollbackTx(): Promise<void> {
    if (!props.sessionId || txBusy.value) return
    txBusy.value = true
    try {
      const state = await sqliteApi.txRollback({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
      toast.success(t('modules.sqlite.query.rollbackDone'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      txBusy.value = false
    }
  }

  const toolbarLabels = computed((): SqlQueryToolbarLabels => ({
    toolbarAria: 'SQLite',
    run: t('modules.sqlite.query.run'),
    runSelection: t('modules.sqlite.query.runSelection'),
    runTooltip: t('modules.sqlite.query.runHint'),
    cancel: t('modules.sqlite.query.cancel'),
    cancelTooltip: t('modules.sqlite.query.cancel'),
    format: t('modules.sqlite.query.format'),
    formatTooltip: t('modules.sqlite.query.formatTooltip'),
    explain: t('modules.sqlite.query.explain'),
    explainTooltip: t('modules.sqlite.query.explainHint'),
    explainAnalyze: t('modules.sqlite.query.explain'),
    explainAnalyzeTooltip: t('modules.sqlite.query.explainHint'),
    history: t('modules.sqlite.query.history'),
    historyEmpty: t('modules.sqlite.query.historyEmpty'),
    historyClear: t('modules.sqlite.query.historyClear'),
    autoCommit: t('modules.sqlite.query.autoCommit'),
    autoCommitTooltip: t('modules.sqlite.query.autoCommitTooltip'),
    commit: t('modules.sqlite.query.commit'),
    commitTooltip: t('modules.sqlite.query.commitTooltip'),
    rollback: t('modules.sqlite.query.rollback'),
    rollbackTooltip: t('modules.sqlite.query.rollbackTooltip'),
    inTransaction: t('modules.sqlite.query.inTransaction'),
  }))

  const resultPanelLabels = computed((): QueryResultPanelLabels => ({
    messages: t('modules.sqlite.query.messages'),
    messagesEmpty: t('modules.sqlite.query.messagesEmpty'),
    filterPlaceholder: t('modules.sqlite.query.filterPlaceholder'),
    loadMore: t('modules.sqlite.query.loadMore'),
    fetchAll: t('modules.sqlite.query.fetchAll'),
    exportCsv: t('modules.sqlite.query.exportCsv'),
    emptyResult: t('modules.sqlite.query.emptyResult'),
    resultEmpty: t('modules.sqlite.query.resultEmpty'),
    closeResultTab: t('modules.sqlite.query.closeResultTab'),
    batchResultTab: (n: number) => t('modules.sqlite.query.batchResultTab', { n }),
    tabRowCount: (n: number, hasMore: boolean) =>
      hasMore ? t('modules.sqlite.query.rows', { n }) + '+' : t('modules.sqlite.query.rows', { n }),
    batchStmtLabel: (n: number) => t('modules.sqlite.query.batchStmtLabel', { n }),
    batchStmtSkipped: t('modules.sqlite.query.batchStmtSkipped'),
    batchStmtRunning: t('modules.sqlite.query.batchStmtRunning'),
    batchStmtPending: t('modules.sqlite.query.batchStmtPending'),
    batchOpenResult: t('modules.sqlite.query.batchOpenResult'),
    logColStatus: t('modules.sqlite.query.logColStatus'),
    logColTime: t('modules.sqlite.query.logColTime'),
    logColRows: t('modules.sqlite.query.logColRows'),
    msgOk: t('modules.sqlite.query.msgOk'),
    msgError: t('modules.sqlite.query.msgError'),
    cancelled: t('modules.sqlite.query.cancelled'),
    copyMessage: t('modules.sqlite.query.copyMessage'),
    copiedHint: t('modules.sqlite.query.copiedHint'),
  }))

  onMounted(() => {
    void syncTxState()
    if (props.autoRunInitialSql && props.initialSql?.trim()) {
      void runSql()
    }
  })

  watch(
    () => props.sessionId,
    (sid) => {
      if (sid) void syncTxState()
    },
  )

  onUnmounted(() => {
    // 释放仍打开的游标
    if (props.sessionId) {
      for (const tab of gridTabs.value) {
        if (tab.resultSetId) {
          void sqliteApi.queryClose({ sessionId: props.sessionId, resultSetId: tab.resultSetId })
        }
      }
    }
  })

  return {
    t,
    sqlText,
    running,
    cancelling,
    loadingMore,
    filterText,
    activePaneTab,
    lastError,
    gridTabs,
    batchItems,
    batchActive,
    identityTitle,
    resultColumns,
    resultRows,
    filterKeys,
    hasMore,
    resultSummaryText,
    messageItems,
    hasMessages,
    resultPanelLabels,
    monacoLanguage,
    languageReady: editor.languageReady,
    editorRef: editor.editorRef,
    hasSelection: editor.hasSelection,
    historyOpen,
    historyEntries,
    toolbarLabels,
    contextMenuItems,
    autoCommit,
    inTransaction,
    txBusy,
    formatEditor,
    selectResultTab,
    closeResultGridTab,
    openBatchGrid,
    runSql,
    runExplain,
    cancelRun,
    fetchMore,
    fetchAll,
    exportCsv,
    onHistoryPick,
    onContextMenuSelect,
    setAutoCommit,
    commitTx,
    rollbackTx,
  }
}
