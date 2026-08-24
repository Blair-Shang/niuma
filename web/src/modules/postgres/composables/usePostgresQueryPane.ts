/**
 * Postgres 查询面板：走 Postgres.query.* RPC。
 * 事务 / EXPLAIN 可用；对象树见 P1；EXPLAIN / EXPLAIN ANALYZE 见 P4。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRsToast, type RsContextMenuItem, type RsTableColumn } from '@niuma/ui'
import { postgresApi } from '@/api/postgres'
import type { PostgresQueryColumn, PostgresQueryExecResult } from '@/api/types/postgres'
import {
  defaultPostgreSQLProfile,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import { usePostgresSqlEditor } from '@/modules/postgres/composables/usePostgresSqlEditor'
import {
  alignForValueType,
  buildSqlQueryContextMenuItems,
  countOpenCursors,
  formatBrowseCellValue,
  MAX_OPEN_RESULT_CURSORS,
  MAX_RESULT_GRID_TABS,
  resolveSqlValueType,
  resultHasGrid,
  useQueryDraftPersist,
  useSqlQueryHistory,
  yieldToEventLoop,
  type QueryResultMessageItem,
  type QueryResultPanelLabels,
  type SqlQueryToolbarLabels,
} from '@/modules/database'
import { mapResultRowsByName, type QueryResultRow } from '@/modules/database/utils/query-result-tabs'
import { resolveQueryExecMode, type PostgresQueryExecMode } from '@/modules/postgres/utils/query-exec-mode'
import { useSessionRegistry } from '@/stores/session-registry'

export type PostgresQueryPaneProps = {
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  initialSql?: string
  draftSql?: string
  tabId?: string
  autoRunInitialSql?: boolean
  /** 产品入口传入的执行模式；与 SQL 标识共同决定本次运行路径 */
  queryExecMode?: PostgresQueryExecMode
  sessionLabel?: string
  active?: boolean
}

type PostgresGridTab = {
  id: string
  sqlPreview: string
  columns: PostgresQueryColumn[]
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

export function usePostgresQueryPane(props: PostgresQueryPaneProps) {
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
  const lastNotices = ref<string[]>([])
  const activeRequestId = ref<string | null>(null)
  const gridTabs = shallowRef<PostgresGridTab[]>([])
  const autoCommit = ref(true)
  const inTransaction = ref(false)
  const txBusy = ref(false)

  function dialectProfile() {
    if (!props.sessionId) return defaultPostgreSQLProfile()
    return sessions.getDialectForSession(props.sessionId) ?? defaultPostgreSQLProfile()
  }

  const editor = usePostgresSqlEditor({
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
        // 未显式选 schema 时回落 public，与 LSP SuggestDatabase / PG 默认命名空间一致
        schema: props.schema?.trim() || 'public',
        database: props.database?.trim() || undefined,
      }
    },
  })

  const { historyOpen, historyEntries, rememberSql, onHistoryPick } = useSqlQueryHistory({
    profileId: () => props.profileId,
    storagePrefix: 'niuma.postgresql.sqlHistory.',
    sqlText,
  })

  const identityTitle = computed(() =>
    [
      props.sessionLabel || 'Postgres',
      props.database?.trim(),
      props.schema?.trim(),
    ]
      .filter(Boolean)
      .join(' · '),
  )

  const activeGrid = computed(
    (): PostgresGridTab | null => gridTabs.value.find((g) => g.id === activePaneTab.value) ?? null,
  )

  const resultColumns = computed((): RsTableColumn[] =>
    (activeGrid.value?.columns ?? []).map((c, i) => {
      const name = c.name || `col${i + 1}`
      const tipLines = [t('modules.postgres.query.colTipField', { name })]
      if (c.dataType?.trim()) {
        tipLines.push(t('modules.postgres.query.colTipType', { type: c.dataType.trim() }))
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
    const grid = activeGrid.value ?? gridTabs.value[gridTabs.value.length - 1]
    if (grid) {
      return t('modules.postgres.query.resultSummary', {
        rows: grid.rowCount,
        cols: grid.columns.length,
        ms: grid.durationMs,
      })
    }
    if (lastError.value) return t('modules.postgres.query.execFailed')
    return lastExecSummary.value
  })

  const messageItems = computed((): QueryResultMessageItem[] => {
    const items: QueryResultMessageItem[] = []
    if (lastError.value) {
      items.push({ key: 'error', label: t('modules.postgres.query.msgError'), value: lastError.value, tone: 'error' })
      return items
    }
    if (lastExecSummary.value) {
      items.push({ key: 'summary', label: t('modules.postgres.query.msgOk'), value: lastExecSummary.value, tone: 'success' })
    }
    lastNotices.value.forEach((notice, index) => {
      items.push({
        key: `notice-${index}`,
        label: t('modules.postgres.query.msgNotice'),
        value: notice,
        tone: 'default',
      })
    })
    const grid = activeGrid.value ?? gridTabs.value[gridTabs.value.length - 1]
    if (grid) {
      items.push({
        key: 'grid',
        label: t('modules.postgres.query.resultTab'),
        value: t('modules.postgres.query.resultSummary', { rows: grid.rowCount, cols: grid.columns.length, ms: grid.durationMs }),
        tone: 'default',
      })
      if (grid.hasMore) {
        items.push({ key: 'has-more', label: t('modules.postgres.query.hasMore'), value: '', tone: 'warning' })
      }
      if (grid.truncated) {
        items.push({
          key: 'truncated',
          label: t('modules.postgres.query.truncated'),
          value: t('modules.postgres.query.truncatedCap', { count: grid.fetchedCount }),
          tone: 'warning',
        })
      }
    }
    return items
  })

  const hasMessages = computed(() => messageItems.value.length > 0)
  const monacoLanguage = computed(() => editor.sqlLanguage.value)

  async function refreshTxState(): Promise<void> {
    if (!props.sessionId) {
      autoCommit.value = true
      inTransaction.value = false
      return
    }
    try {
      const state = await postgresApi.txGetState({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
    } catch {
      /* 旧服务无 tx API 时保持默认 Auto-commit */
    }
  }

  async function setAutoCommit(enabled: boolean): Promise<void> {
    if (!props.sessionId || txBusy.value) return
    txBusy.value = true
    try {
      const state = await postgresApi.txSetAutoCommit({
        sessionId: props.sessionId,
        autoCommit: enabled,
      })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
      if (enabled) {
        toast.info(t('modules.postgres.query.autoCommitOnHint'))
      } else {
        toast.info(t('modules.postgres.query.autoCommitOffHint'))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      await refreshTxState()
    } finally {
      txBusy.value = false
    }
  }

  async function commitTx(): Promise<void> {
    if (!props.sessionId || txBusy.value) return
    txBusy.value = true
    try {
      const state = await postgresApi.txCommit({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
      toast.success(t('modules.postgres.query.commitDone'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      await refreshTxState()
    } finally {
      txBusy.value = false
    }
  }

  async function rollbackTx(): Promise<void> {
    if (!props.sessionId || txBusy.value) return
    txBusy.value = true
    try {
      const state = await postgresApi.txRollback({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
      toast.success(t('modules.postgres.query.rollbackDone'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      await refreshTxState()
    } finally {
      txBusy.value = false
    }
  }

  watch(
    () => props.sessionId,
    () => {
      void refreshTxState()
    },
    { immediate: true },
  )

  async function closeResultSetQuiet(rsId: string | null | undefined): Promise<void> {
    if (!rsId || !props.sessionId) return
    try {
      await postgresApi.queryClose({ sessionId: props.sessionId, resultSetId: rsId })
    } catch {
      // 静默
    }
  }

  async function closeAllGridCursors(): Promise<void> {
    const tabs = gridTabs.value
    await Promise.all(tabs.map((tab) => closeResultSetQuiet(tab.resultSetId)))
  }

  function addGridTab(result: PostgresQueryExecResult, stmtIndex: number, stmtSql: string): PostgresGridTab {
    const cols = result.columns ?? []
    const rows = result.rows ? mapResultRowsByName(cols, result.rows, 0) : []
    // 映射后释放原始二维数组，减轻大结果页内存压力
    if (result.rows) result.rows = []
    const keepCursor = Boolean(result.hasMore && result.resultSetId)
    const tab: PostgresGridTab = {
      id: `result-${Date.now()}-${stmtIndex}`,
      sqlPreview: stmtSql.slice(0, 80),
      columns: cols,
      rows,
      rowCount: result.rowCount,
      fetchedCount: result.fetchedCount ?? result.rowCount,
      hasMore: keepCursor,
      truncated: result.truncated,
      resultSetId: keepCursor ? result.resultSetId : undefined,
      durationMs: result.durationMs,
      label: t('modules.postgres.query.resultTabIndexed', { n: stmtIndex + 1 }),
      stmtIndex,
    }

    let tabs = [...gridTabs.value]
    const openCount = countOpenCursors(
      tabs.map((g) => ({ resultSetId: g.resultSetId ?? null, hasMore: g.hasMore })),
    )
    if (openCount >= MAX_OPEN_RESULT_CURSORS) {
      const oldest = tabs.find((g) => g.hasMore && g.resultSetId)
      if (oldest?.resultSetId) {
        void closeResultSetQuiet(oldest.resultSetId)
        oldest.hasMore = false
        oldest.resultSetId = undefined
      }
    }
    if (tabs.length >= MAX_RESULT_GRID_TABS) {
      const trimCount = tabs.length - MAX_RESULT_GRID_TABS + 1
      const trimmed = tabs.splice(0, trimCount)
      toast.warning(
        t('modules.postgres.query.batchTabsTrimmed', { n: trimCount, max: MAX_RESULT_GRID_TABS }),
      )
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

  function ingestResult(
    result: PostgresQueryExecResult,
    stmtIndex: number,
    stmtSql: string,
  ): void {
    if (result.notices?.length) {
      lastNotices.value = [...lastNotices.value, ...result.notices]
    }
    if (resultHasGrid(result.columns)) {
      const tab = addGridTab(result, stmtIndex, stmtSql)
      activePaneTab.value = tab.id
      return
    }
    const n = result.rowsAffected ?? result.rowCount
    lastExecSummary.value =
      n > 0
        ? t('modules.postgres.query.affected', { n })
        : t('modules.postgres.query.rows', { n: 0 })
    if (lastNotices.value.length > 0 && !gridTabs.value.length) {
      activePaneTab.value = 'messages'
    }
  }

  /** 默认：逐条分页 query.exec（可 hasMore / 加载更多）。 */
  async function runPagedStatements(
    stmtSqls: string[],
    requestId: string,
    database: string | undefined,
  ): Promise<void> {
    for (let i = 0; i < stmtSqls.length; i++) {
      await yieldToEventLoop()
      const result = await postgresApi.queryExec({
        sessionId: props.sessionId!,
        database,
        sql: stmtSqls[i]!,
        limit: PAGE_LIMIT,
        requestId: stmtSqls.length > 1 ? `${requestId}-${i}` : requestId,
      })
      ingestResult(result, i, stmtSqls[i]!)
    }
  }

  /**
   * 显式批跑：同连接顺序执行（临时表 / SET 可见）。
   * 由 `-- niuma:exec=batch` 触发；不保留跨语句游标。
   */
  async function runBatchStatements(
    stmtSqls: string[],
    requestId: string,
    database: string | undefined,
  ): Promise<void> {
    try {
      const batch = await postgresApi.queryExecBatch({
        sessionId: props.sessionId!,
        database,
        statements: stmtSqls,
        limit: PAGE_LIMIT,
        requestId,
      })
      if (batch.notices?.length) {
        lastNotices.value = [...batch.notices]
      }
      for (const [index, result] of (batch.results ?? []).entries()) {
        ingestResult(result, index, stmtSqls[index] ?? '')
      }
    } catch (batchErr) {
      const msg = batchErr instanceof Error ? batchErr.message : String(batchErr)
      if (stmtSqls.length === 1) {
        const result = await postgresApi.queryExec({
          sessionId: props.sessionId!,
          database,
          sql: stmtSqls[0]!,
          limit: PAGE_LIMIT,
          requestId,
        })
        ingestResult(result, 0, stmtSqls[0]!)
        return
      }
      if (/unknown method|not found|execBatch/i.test(msg)) {
        throw new Error(
          '需要重启 NiuMa 以加载 postgres.query.execBatch（含 -- niuma:exec=batch 的脚本须同连接执行）',
        )
      }
      throw batchErr
    }
  }

  async function runSql(): Promise<void> {
    if (!props.sessionId || running.value) return
    const sql = editor.resolveSql()
    if (!sql.trim()) {
      toast.warning(t('modules.postgres.query.empty'))
      return
    }
    running.value = true
    cancelling.value = false
    lastError.value = null
    lastExecSummary.value = ''
    lastNotices.value = []
    await closeAllGridCursors()
    gridTabs.value = []
    activePaneTab.value = 'messages'

    const requestId = `Postgres-${Date.now()}`
    activeRequestId.value = requestId

    const statements = splitSqlStatementsWithFeatures(sql, resolveSplitFeaturesFromProfile(dialectProfile()))
      .filter((s) => s.sql.trim())

    try {
      const stmtSqls = statements.map((s) => s.sql)
      const db = props.database?.trim() || undefined
      // 默认分页；入口 queryExecMode=batch 或脚本带 `-- niuma:exec=batch` 时同连接批跑
      if (resolveQueryExecMode(props.queryExecMode, sql) === 'batch') {
        await runBatchStatements(stmtSqls, requestId, db)
      } else {
        await runPagedStatements(stmtSqls, requestId, db)
      }
      rememberSql(sql)
      await refreshTxState()
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
    try {
      await postgresApi.queryCancel({
        sessionId: props.sessionId,
        requestId: activeRequestId.value ?? undefined,
      })
    } catch {
      // 静默
    }
  }

  async function runExplain(analyze: boolean): Promise<void> {
    if (running.value) return
    if (!props.sessionId) {
      lastError.value = t('modules.postgres.query.noSession')
      activePaneTab.value = 'messages'
      return
    }
    const sql = editor.resolveSql()
    if (!sql.trim()) {
      toast.warning(t('modules.postgres.query.empty'))
      return
    }
    running.value = true
    cancelling.value = false
    lastError.value = null
    lastExecSummary.value = ''
    lastNotices.value = []
    gridTabs.value = []
    activePaneTab.value = 'messages'
    const requestId = `explain-${Date.now()}`
    activeRequestId.value = requestId
    try {
      const statements = splitSqlStatementsWithFeatures(sql, resolveSplitFeaturesFromProfile(dialectProfile()))
        .filter((s) => s.sql.trim())
      const target = statements[0]?.sql ?? sql
      const result = await postgresApi.queryExplain({
        sessionId: props.sessionId,
        database: props.database?.trim() || undefined,
        sql: target,
        analyze,
        limit: PAGE_LIMIT,
        requestId,
      })
      lastExecSummary.value = [
        analyze
          ? t('modules.postgres.query.explainAnalyzeDone')
          : t('modules.postgres.query.explainDone'),
        t('modules.postgres.query.resultSummary', {
          rows: result.rowCount,
          cols: result.columns?.length ?? 0,
          ms: result.durationMs,
        }),
      ].join(' · ')
      if (result.columns?.length) {
        const tab = addGridTab(result, 0, target)
        activePaneTab.value = tab.id
      } else {
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

  async function fetchMore(): Promise<void> {
    const grid = activeGrid.value
    if (!grid?.hasMore || !grid.resultSetId || !props.sessionId) return
    loadingMore.value = true
    try {
      const result = await postgresApi.queryFetch({
        sessionId: props.sessionId,
        resultSetId: grid.resultSetId,
        limit: PAGE_LIMIT,
      })
      const newRows = result.rows ? mapResultRowsByName(grid.columns, result.rows, grid.rows.length) : []
      const updated: PostgresGridTab = {
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
      toast.error(t('modules.postgres.query.fetchError'))
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
      toast.warning(t('modules.postgres.query.noResult'))
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
    a.download = 'Postgres-export.csv'
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

  const contextMenuItems = computed((): RsContextMenuItem[] =>
    buildSqlQueryContextMenuItems({
      labels: {
        run: t('modules.postgres.query.run'),
        runSelection: t('modules.postgres.query.runSelection'),
        cancel: t('modules.postgres.query.cancel'),
        format: t('modules.postgres.query.format'),
        compress: t('modules.postgres.query.format'),
        copy: t('modules.postgres.query.run'),
        paste: t('modules.postgres.query.run'),
        explain: t('modules.postgres.query.explain'),
        explainAnalyze: t('modules.postgres.query.explainAnalyze'),
        exportCsv: t('modules.postgres.query.exportCsv'),
        fetchMore: t('modules.postgres.query.loadMore'),
        fetchAll: t('modules.postgres.query.fetchAll'),
      },
      running: running.value,
      cancelling: cancelling.value,
      hasSelection: editor.hasSelection.value,
      sqlEmpty: !sqlText.value.trim(),
      hasResultRows: Boolean(resultRows.value.length),
      hasMore: hasMore.value,
      loadingMore: loadingMore.value,
      showAskAi: false,
      showExplain: true,
    }),
  )

  function formatEditor(): void {
    void editor.formatSql()
  }

  function onContextMenuSelect(key: string): void {
    if (key === 'run') void runSql()
    else if (key === 'format') formatEditor()
    else if (key === 'explain') void runExplain(false)
    else if (key === 'explainAnalyze') void runExplain(true)
    else if (key === 'exportCsv') exportCsv()
    else if (key === 'fetchMore') void fetchMore()
    else if (key === 'fetchAll') void fetchAll()
  }

  const toolbarLabels = computed((): SqlQueryToolbarLabels => ({
    toolbarAria: 'Postgres',
    run: t('modules.postgres.query.run'),
    runSelection: t('modules.postgres.query.runSelection'),
    runTooltip: t('modules.postgres.query.runHint'),
    cancel: t('modules.postgres.query.cancel'),
    cancelTooltip: t('modules.postgres.query.cancel'),
    format: t('modules.postgres.query.format'),
    formatTooltip: t('modules.postgres.query.formatTooltip'),
    explain: t('modules.postgres.query.explain'),
    explainTooltip: t('modules.postgres.query.explainHint'),
    explainAnalyze: t('modules.postgres.query.explainAnalyze'),
    explainAnalyzeTooltip: t('modules.postgres.query.explainAnalyzeHint'),
    history: t('modules.postgres.query.history'),
    historyEmpty: t('modules.postgres.query.historyEmpty'),
    historyClear: t('modules.postgres.query.historyClear'),
    autoCommit: t('modules.postgres.query.autoCommit'),
    autoCommitTooltip: t('modules.postgres.query.autoCommitTooltip'),
    commit: t('modules.postgres.query.commit'),
    commitTooltip: t('modules.postgres.query.commitTooltip'),
    rollback: t('modules.postgres.query.rollback'),
    rollbackTooltip: t('modules.postgres.query.rollbackTooltip'),
    inTransaction: t('modules.postgres.query.inTransaction'),
  }))

  const resultPanelLabels = computed((): QueryResultPanelLabels => ({
    messages: t('modules.postgres.query.messages'),
    messagesEmpty: t('modules.postgres.query.messagesEmpty'),
    filterPlaceholder: t('modules.postgres.query.filterPlaceholder'),
    loadMore: t('modules.postgres.query.loadMore'),
    fetchAll: t('modules.postgres.query.fetchAll'),
    exportCsv: t('modules.postgres.query.exportCsv'),
    emptyResult: t('modules.postgres.query.emptyResult'),
    resultEmpty: t('modules.postgres.query.resultEmpty'),
    closeResultTab: t('modules.postgres.query.closeResultTab'),
    batchResultTab: (n: number) => t('modules.postgres.query.resultTabIndexed', { n }),
    tabRowCount: (n: number, more: boolean) =>
      more ? t('modules.postgres.query.rows', { n }) + '+' : t('modules.postgres.query.rows', { n }),
    batchStmtLabel: (n: number) => t('modules.postgres.query.resultTabIndexed', { n }),
    batchStmtSkipped: '',
    batchStmtRunning: '',
    batchStmtPending: '',
    batchOpenResult: '',
    logColStatus: '',
    logColTime: '',
    logColRows: '',
    msgOk: t('modules.postgres.query.msgOk'),
    msgError: t('modules.postgres.query.msgError'),
    cancelled: t('modules.postgres.query.cancelled'),
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
    runSql,
    runExplain,
    cancelRun,
    fetchMore,
    fetchAll,
    exportCsv,
    onHistoryPick,
    onContextMenuSelect,
    autoCommit,
    inTransaction,
    txBusy,
    setAutoCommit,
    commitTx,
    rollbackTx,
  }
}
