/**
 * SQL Server 查询面板：走 sqlserver.query.* RPC。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRsToast, type RsContextMenuItem, type RsTableColumn } from '@niuma/ui'
import { sqlserverApi } from '@/api/sqlserver'
import type { SqlServerQueryColumn, SqlServerQueryExecResult } from '@/api/types/sqlserver'
import {
  defaultSqlServerProfile,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import { useSqlServerSqlEditor } from '@/modules/sqlserver/composables/useSqlServerSqlEditor'
import {
  alignForValueType,
  buildSqlQueryContextMenuItems,
  countOpenCursors,
  createGridTabId,
  formatBrowseCellValue,
  MAX_BATCH_STATEMENTS,
  MAX_OPEN_RESULT_CURSORS,
  MAX_RESULT_GRID_TABS,
  previewSql,
  resolveSqlValueType,
  resultHasGrid,
  useQueryDraftPersist,
  useSqlQueryHistory,
  yieldToEventLoop,
  type BatchStatementItem,
  type QueryResultMessageItem,
  type QueryResultPanelLabels,
  type SqlQueryToolbarLabels,
} from '@/modules/database'
import { mapResultRowsByName, type QueryResultRow } from '@/modules/database/utils/query-result-tabs'
import { useSessionRegistry } from '@/stores/session-registry'
import { useTabStore } from '@/stores/tab'

export type SqlServerQueryPaneProps = {
  sessionId: string | null
  profileId?: string
  database?: string
  initialSql?: string
  draftSql?: string
  tabId?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
  active?: boolean
}

type SqlServerGridTab = {
  id: string
  sqlPreview: string
  columns: SqlServerQueryColumn[]
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

export function useSqlServerQueryPane(props: SqlServerQueryPaneProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const sessions = useSessionRegistry()

  const { sqlText, restoredFromDraft } = useQueryDraftPersist({
    tabId: () => props.tabId,
    draftSql: () => props.draftSql,
    initialSql: () => props.initialSql,
    defaultSql: 'SELECT 1;\n',
  })
  const running = ref(false)
  const cancelling = ref(false)
  const loadingMore = ref(false)
  const filterText = ref('')
  const activePaneTab = ref<string>('messages')
  const lastError = ref<string | null>(null)
  const lastExecSummary = ref('')
  const activeRequestId = ref<string | null>(null)
  const gridTabs = shallowRef<SqlServerGridTab[]>([])
  const batchItems = shallowRef<BatchStatementItem[]>([])
  const batchTotalMs = ref(0)
  const cancelled = ref(false)

  function dialectProfile() {
    if (!props.sessionId) return defaultSqlServerProfile()
    return sessions.getDialectForSession(props.sessionId) ?? defaultSqlServerProfile()
  }

  const editor = useSqlServerSqlEditor({
    sqlText,
    active: () => props.active !== false,
    onRun: () => {
      void runSql()
    },
    getDialect: dialectProfile,
    getSuggestScope: () => {
      if (!props.sessionId) return null
      return {
        sessionId: props.sessionId,
        database: props.database?.trim() || undefined,
        schema: 'dbo',
      }
    },
  })

  const { historyOpen, historyEntries, rememberSql, onHistoryPick } = useSqlQueryHistory({
    profileId: () => props.profileId,
    storagePrefix: 'niuma.sqlserver.sqlHistory.',
    sqlText,
  })

  const identityTitle = computed(() =>
    [props.sessionLabel || 'SQL Server', props.database?.trim()].filter(Boolean).join(' · '),
  )

  const batchActive = computed(() => batchItems.value.length > 1)

  const activeGrid = computed(
    (): SqlServerGridTab | null => gridTabs.value.find((g) => g.id === activePaneTab.value) ?? null,
  )

  const summaryGrid = computed(
    (): SqlServerGridTab | null =>
      activeGrid.value ?? gridTabs.value[gridTabs.value.length - 1] ?? null,
  )

  const resultColumns = computed((): RsTableColumn[] =>
    (activeGrid.value?.columns ?? []).map((c, i) => {
      const name = c.name || `col${i + 1}`
      const tipLines = [t('modules.sqlserver.query.colTipField', { name })]
      if (c.dataType?.trim()) {
        tipLines.push(t('modules.sqlserver.query.colTipType', { type: c.dataType.trim() }))
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
          valueType === 'boolean' ? undefined : (value) => formatBrowseCellValue(value, valueType),
      }
    }),
  )

  const resultRows = computed((): QueryResultRow[] => activeGrid.value?.rows ?? [])
  const filterKeys = computed(() => resultColumns.value.map((c) => String(c.key)))
  const hasMore = computed(() => Boolean(activeGrid.value?.hasMore && activeGrid.value?.resultSetId))

  const resultSummaryText = computed(() => {
    if (running.value && batchActive.value) {
      const done = batchItems.value.filter(
        (x) => x.status === 'ok' || x.status === 'error',
      ).length
      return t('modules.sqlserver.query.batchProgress', { done, total: batchItems.value.length })
    }
    if (batchActive.value && !running.value) {
      return t('modules.sqlserver.query.batchResultHint', {
        n: batchItems.value.length,
        tabs: gridTabs.value.length,
      })
    }
    const grid = summaryGrid.value
    if (grid) {
      return t('modules.sqlserver.query.resultSummary', {
        rows: grid.rowCount,
        cols: grid.columns.length,
        ms: grid.durationMs,
      })
    }
    if (lastError.value) return t('modules.sqlserver.query.execFailed')
    return lastExecSummary.value
  })

  const messageItems = computed((): QueryResultMessageItem[] => {
    const items: QueryResultMessageItem[] = []
    if (lastError.value) {
      items.push({
        key: 'error',
        label: t('modules.sqlserver.query.msgError'),
        value: lastError.value,
        tone: 'error',
      })
    }
    if (batchActive.value) {
      const ok = batchItems.value.filter((x) => x.status === 'ok').length
      const fail = batchItems.value.filter((x) => x.status === 'error').length
      items.push({
        key: 'batch-summary',
        label: t('modules.sqlserver.query.batchLabel'),
        value: t('modules.sqlserver.query.batchSummary', {
          ok,
          fail,
          total: batchItems.value.length,
          ms: batchTotalMs.value,
          tabs: gridTabs.value.length,
        }),
        tone: fail > 0 ? 'warning' : 'success',
      })
      return items
    }
    if (lastExecSummary.value) {
      items.push({
        key: 'summary',
        label: t('modules.sqlserver.query.msgOk'),
        value: lastExecSummary.value,
        tone: 'success',
      })
    }
    const grid = summaryGrid.value
    if (grid) {
      items.push({
        key: 'grid',
        label: t('modules.sqlserver.query.resultTab'),
        value: t('modules.sqlserver.query.resultSummary', {
          rows: grid.rowCount,
          cols: grid.columns.length,
          ms: grid.durationMs,
        }),
        tone: 'default',
      })
      if (grid.hasMore) {
        items.push({
          key: 'has-more',
          label: t('modules.sqlserver.query.hasMore'),
          value: '',
          tone: 'warning',
        })
      }
      if (grid.truncated) {
        items.push({
          key: 'truncated',
          label: t('modules.sqlserver.query.truncated'),
          value: t('modules.sqlserver.query.truncatedCap', { count: grid.fetchedCount }),
          tone: 'warning',
        })
      }
    }
    return items
  })

  const hasMessages = computed(
    () => messageItems.value.length > 0 || batchActive.value || Boolean(lastError.value),
  )
  const monacoLanguage = computed(() => editor.sqlLanguage.value)

  async function closeResultSetQuiet(rsId: string | null | undefined): Promise<void> {
    if (!rsId || !props.sessionId) return
    try {
      await sqlserverApi.queryClose({ sessionId: props.sessionId, resultSetId: rsId })
    } catch {
      // 静默
    }
  }

  async function closeAllGridCursors(): Promise<void> {
    await Promise.all(gridTabs.value.map((tab) => closeResultSetQuiet(tab.resultSetId)))
  }

  async function releaseHeldCursors(): Promise<void> {
    const tabs = gridTabs.value
    const held = tabs.filter((t) => t.resultSetId)
    if (held.length === 0) return
    await Promise.all(held.map((t) => closeResultSetQuiet(t.resultSetId)))
    gridTabs.value = tabs.map((t) =>
      t.resultSetId ? { ...t, resultSetId: undefined, hasMore: false } : t,
    )
  }

  function addGridTab(result: SqlServerQueryExecResult, stmtIndex: number, stmtSql: string): SqlServerGridTab {
    const cols = result.columns ?? []
    const rows = result.rows ? mapResultRowsByName(cols, result.rows, 0) : []
    const keepCursor = Boolean(result.hasMore && result.resultSetId)
    const tab: SqlServerGridTab = {
      id: createGridTabId(stmtIndex),
      sqlPreview: previewSql(stmtSql),
      columns: cols,
      rows,
      rowCount: result.rowCount,
      fetchedCount: result.fetchedCount ?? result.rowCount,
      hasMore: keepCursor,
      truncated: result.truncated,
      resultSetId: keepCursor ? result.resultSetId : undefined,
      durationMs: result.durationMs,
      label: t('modules.sqlserver.query.batchResultTab', { n: stmtIndex + 1 }),
      stmtIndex,
    }

    let tabs = [...gridTabs.value]
    const openCount = countOpenCursors(
      tabs.map((item) => ({ resultSetId: item.resultSetId ?? null, hasMore: item.hasMore })),
    )
    if (openCount >= MAX_OPEN_RESULT_CURSORS) {
      const oldest = tabs.find((item) => item.hasMore && item.resultSetId)
      if (oldest?.resultSetId) {
        void closeResultSetQuiet(oldest.resultSetId)
        oldest.hasMore = false
        oldest.resultSetId = undefined
      }
    }
    if (tabs.length >= MAX_RESULT_GRID_TABS) {
      const trimCount = tabs.length - MAX_RESULT_GRID_TABS + 1
      const trimmed = tabs.splice(0, trimCount)
      toast.warning(t('modules.sqlserver.query.batchTabsTrimmed', { n: trimCount, max: MAX_RESULT_GRID_TABS }))
      for (const old of trimmed) {
        void closeResultSetQuiet(old.resultSetId)
      }
    }
    tabs.push(tab)
    gridTabs.value = tabs

    if (!keepCursor && result.resultSetId) {
      void closeResultSetQuiet(result.resultSetId)
    }
    return tab
  }

  async function execStatement(
    stmt: string,
    requestId: string,
    stmtIndex: number,
  ): Promise<{ ok: boolean; error?: string; durationMs: number }> {
    if (!props.sessionId) {
      return { ok: false, error: t('modules.sqlserver.query.noSession'), durationMs: 0 }
    }
    try {
      const result = await sqlserverApi.queryExec({
        sessionId: props.sessionId,
        database: props.database?.trim() || undefined,
        sql: stmt,
        limit: PAGE_LIMIT,
        requestId,
      })
      if (cancelled.value) {
        await closeResultSetQuiet(result.resultSetId)
        return { ok: true, durationMs: result.durationMs }
      }
      if (resultHasGrid(result.columns)) {
        const tab = addGridTab(result, stmtIndex, stmt)
        activePaneTab.value = tab.id
      } else {
        await closeResultSetQuiet(result.resultSetId)
        const n = result.rowsAffected ?? result.rowCount
        lastExecSummary.value = n > 0
          ? t('modules.sqlserver.query.affected', { n })
          : t('modules.sqlserver.query.rows', { n: 0 })
      }
      return { ok: true, durationMs: result.durationMs }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: 0,
      }
    }
  }

  async function runSql(): Promise<void> {
    if (!props.sessionId || running.value) return
    const sql = editor.resolveSql()
    if (!sql.trim()) {
      toast.warning(t('modules.sqlserver.query.empty'))
      return
    }
    running.value = true
    cancelling.value = false
    cancelled.value = false
    lastError.value = null
    lastExecSummary.value = ''
    await closeAllGridCursors()
    gridTabs.value = []
    batchItems.value = []
    batchTotalMs.value = 0
    activePaneTab.value = 'messages'

    const statements = splitSqlStatementsWithFeatures(sql, resolveSplitFeaturesFromProfile(dialectProfile()))
      .filter((s) => s.sql.trim())

    if (statements.length > MAX_BATCH_STATEMENTS) {
      toast.error(t('modules.sqlserver.query.batchTooMany', {
        count: statements.length,
        max: MAX_BATCH_STATEMENTS,
      }))
      running.value = false
      return
    }

    const requestId = `sqlserver-${Date.now()}`
    activeRequestId.value = requestId

    if (statements.length > 1) {
      batchItems.value = statements.map((s, i) => ({
        index: i,
        sqlPreview: previewSql(s.sql),
        status: 'pending' as const,
        durationMs: 0,
        rowCount: 0,
      }))
    }

    rememberSql(sql)

    try {
      for (let i = 0; i < statements.length; i++) {
        if (cancelled.value) break
        if (i > 0) await releaseHeldCursors()
        if (statements.length > 1) {
          batchItems.value = batchItems.value.map((b, j) =>
            j === i ? { ...b, status: 'running' as const } : b,
          )
        }
        await yieldToEventLoop()
        const r = await execStatement(statements[i]!.sql, requestId, i)
        batchTotalMs.value += r.durationMs
        if (statements.length > 1) {
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
          if (statements.length > 1) {
            toast.error(t('modules.sqlserver.query.batchStopped', { n: i + 1, message: r.error }))
          }
          activePaneTab.value = 'messages'
          break
        }
      }
    } finally {
      running.value = false
      cancelling.value = false
      activeRequestId.value = null
    }
  }

  async function runExplain(analyze: boolean): Promise<void> {
    if (!props.sessionId || running.value) return
    const raw = editor.resolveSql()
    const statements = splitSqlStatementsWithFeatures(
      raw,
      resolveSplitFeaturesFromProfile(dialectProfile()),
    ).filter((s) => s.sql.trim())
    const sql = statements[0]?.sql.trim() ?? ''
    if (!sql) {
      lastError.value = t('modules.sqlserver.query.empty')
      activePaneTab.value = 'messages'
      return
    }
    running.value = true
    cancelling.value = false
    cancelled.value = false
    lastError.value = null
    lastExecSummary.value = ''
    await closeAllGridCursors()
    gridTabs.value = []
    batchItems.value = []
    batchTotalMs.value = 0
    activePaneTab.value = 'messages'
    const requestId = `sqlserver-explain-${Date.now()}`
    activeRequestId.value = requestId
    try {
      const result = await sqlserverApi.queryExplain({
        sessionId: props.sessionId,
        database: props.database?.trim() || undefined,
        sql,
        analyze,
        limit: PAGE_LIMIT,
        requestId,
      })
      if (cancelled.value) {
        await closeResultSetQuiet(result.resultSetId)
        lastExecSummary.value = t('modules.sqlserver.query.cancelled')
        return
      }
      lastExecSummary.value = analyze
        ? t('modules.sqlserver.query.explainAnalyzeDone')
        : t('modules.sqlserver.query.explainDone')
      if (resultHasGrid(result.columns)) {
        const tab = addGridTab(result, 0, sql)
        activePaneTab.value = tab.id
      } else {
        await closeResultSetQuiet(result.resultSetId)
        activePaneTab.value = 'messages'
      }
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      activePaneTab.value = 'messages'
    } finally {
      running.value = false
      cancelling.value = false
      activeRequestId.value = null
    }
  }

  async function cancelRun(): Promise<void> {
    if (!running.value || !props.sessionId) return
    cancelling.value = true
    cancelled.value = true
    try {
      await sqlserverApi.queryCancel({
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
      const result = await sqlserverApi.queryFetch({
        sessionId: props.sessionId,
        resultSetId: grid.resultSetId,
        limit: PAGE_LIMIT,
      })
      const newRows = result.rows ? mapResultRowsByName(grid.columns, result.rows, grid.rows.length) : []
      const updated: SqlServerGridTab = {
        ...grid,
        rows: [...grid.rows, ...newRows],
        fetchedCount: grid.fetchedCount + result.rowCount,
        hasMore: result.hasMore,
        truncated: result.truncated,
        resultSetId: result.hasMore ? result.resultSetId : undefined,
        durationMs: grid.durationMs + result.durationMs,
      }
      gridTabs.value = gridTabs.value.map((g) => (g.id === grid.id ? updated : g))
    } catch {
      toast.error(t('modules.sqlserver.query.fetchError'))
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
      toast.warning(t('modules.sqlserver.query.noResult'))
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
    a.download = 'sqlserver-export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function selectResultTab(id: string): void {
    activePaneTab.value = id
  }

  function closeResultGridTab(id: string): void {
    const tab = gridTabs.value.find((g) => g.id === id)
    void closeResultSetQuiet(tab?.resultSetId)
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

  function formatEditor(): void {
    void editor.formatSql()
  }

  async function askAiAboutSelection(): Promise<void> {
    const { executeCommand } = await import('@/extensions/contributions/command-registry')
    editor.syncSelectionFlag()
    const sql = editor.resolveSql()
    if (sql) {
      const { publishEditorSelection } = await import('@/shell/panels/ai/workspace-context')
      publishEditorSelection({
        tabId: useTabStore().activeTabId || undefined,
        text: sql,
        language: 'sql',
        source: 'monaco',
      })
    }
    await executeCommand('workbench.ai.askSelection')
  }

  const contextMenuItems = computed((): RsContextMenuItem[] =>
    buildSqlQueryContextMenuItems({
      labels: {
        run: t('modules.sqlserver.query.run'),
        runSelection: t('modules.sqlserver.query.runSelection'),
        cancel: t('modules.sqlserver.query.cancel'),
        format: t('modules.sqlserver.query.format'),
        compress: t('modules.sqlserver.query.compress'),
        copy: t('modules.sqlserver.query.copy'),
        paste: t('modules.sqlserver.query.paste'),
        explain: t('modules.sqlserver.query.explain'),
        explainAnalyze: t('modules.sqlserver.query.explainAnalyze'),
        askAi: t('modules.sqlserver.query.askAi'),
        exportCsv: t('modules.sqlserver.query.exportCsv'),
        fetchMore: t('modules.sqlserver.query.loadMore'),
        fetchAll: t('modules.sqlserver.query.fetchAll'),
      },
      running: running.value,
      cancelling: cancelling.value,
      hasSelection: editor.hasSelection.value,
      sqlEmpty: !sqlText.value.trim(),
      hasResultRows: Boolean(resultRows.value.length),
      hasMore: hasMore.value,
      loadingMore: loadingMore.value,
      showAskAi: true,
      showExplain: true,
    }),
  )

  function onContextMenuSelect(key: string): void {
    if (key === 'run') void runSql()
    else if (key === 'cancel') void cancelRun()
    else if (key === 'format') void editor.formatSql()
    else if (key === 'compress') void editor.compressSql()
    else if (key === 'copy') editor.copyEditor()
    else if (key === 'paste') void editor.pasteEditor()
    else if (key === 'explain') void runExplain(false)
    else if (key === 'explainAnalyze') void runExplain(true)
    else if (key === 'askAi') void askAiAboutSelection()
    else if (key === 'exportCsv') exportCsv()
    else if (key === 'fetchMore') void fetchMore()
    else if (key === 'fetchAll') void fetchAll()
  }

  const toolbarLabels = computed((): SqlQueryToolbarLabels => ({
    toolbarAria: 'SQL Server',
    run: t('modules.sqlserver.query.run'),
    runSelection: t('modules.sqlserver.query.runSelection'),
    runTooltip: t('modules.sqlserver.query.runHint'),
    cancel: t('modules.sqlserver.query.cancel'),
    cancelTooltip: t('modules.sqlserver.query.cancel'),
    format: t('modules.sqlserver.query.format'),
    formatTooltip: t('modules.sqlserver.query.formatTooltip'),
    explain: t('modules.sqlserver.query.explain'),
    explainTooltip: t('modules.sqlserver.query.explainHint'),
    explainAnalyze: t('modules.sqlserver.query.explainAnalyze'),
    explainAnalyzeTooltip: t('modules.sqlserver.query.explainAnalyzeHint'),
    history: t('modules.sqlserver.query.history'),
    historyEmpty: t('modules.sqlserver.query.historyEmpty'),
    historyClear: t('modules.sqlserver.query.historyClear'),
    autoCommit: '',
    autoCommitTooltip: '',
    commit: '',
    commitTooltip: '',
    rollback: '',
    rollbackTooltip: '',
    inTransaction: '',
  }))

  const resultPanelLabels = computed((): QueryResultPanelLabels => ({
    messages: t('modules.sqlserver.query.messages'),
    messagesEmpty: t('modules.sqlserver.query.messagesEmpty'),
    filterPlaceholder: t('modules.sqlserver.query.filterPlaceholder'),
    loadMore: t('modules.sqlserver.query.loadMore'),
    fetchAll: t('modules.sqlserver.query.fetchAll'),
    exportCsv: t('modules.sqlserver.query.exportCsv'),
    emptyResult: t('modules.sqlserver.query.emptyResult'),
    resultEmpty: t('modules.sqlserver.query.resultEmpty'),
    closeResultTab: t('modules.sqlserver.query.closeResultTab'),
    batchResultTab: (n: number) => t('modules.sqlserver.query.batchResultTab', { n }),
    tabRowCount: (n: number, more: boolean) =>
      more ? t('modules.sqlserver.query.rows', { n }) + '+' : t('modules.sqlserver.query.rows', { n }),
    batchStmtLabel: (n: number) => t('modules.sqlserver.query.batchStmtLabel', { n }),
    batchStmtSkipped: t('modules.sqlserver.query.batchStmtSkipped'),
    batchStmtRunning: t('modules.sqlserver.query.batchStmtRunning'),
    batchStmtPending: t('modules.sqlserver.query.batchStmtPending'),
    batchOpenResult: t('modules.sqlserver.query.batchOpenResult'),
    logColStatus: t('modules.sqlserver.query.logColStatus'),
    logColTime: t('modules.sqlserver.query.logColTime'),
    logColRows: t('modules.sqlserver.query.logColRows'),
    msgOk: t('modules.sqlserver.query.msgOk'),
    msgError: t('modules.sqlserver.query.msgError'),
    cancelled: t('modules.sqlserver.query.cancelled'),
    copyMessage: t('modules.sqlserver.query.copyMessage'),
    copiedHint: t('modules.sqlserver.query.copiedHint'),
  }))

  onMounted(() => {
    if (!restoredFromDraft && props.autoRunInitialSql && props.initialSql?.trim()) {
      void runSql()
    }
  })

  onUnmounted(() => {
    void closeAllGridCursors()
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
  }
}
