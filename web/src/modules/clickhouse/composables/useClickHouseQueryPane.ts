/**
 * ClickHouse 查询面板：走 clickhouse.query.* RPC。
 * 无事务 UI（ClickHouse 无对应模型）；专业化 EXPLAIN（PLAN/ESTIMATE/PIPELINE/ANALYZE）见 P4。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRsToast, type RsContextMenuItem, type RsSelectOptions, type RsTableColumn } from '@niuma/ui'
import { clickhouseApi } from '@/api/clickhouse'
import type { ClickHouseQueryColumn, ClickHouseQueryExecResult } from '@/api/types/clickhouse'
import {
  Cap,
  defaultClickHouseProfile,
  hasCapability,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import { useClickHouseSqlEditor } from '@/modules/clickhouse/composables/useClickHouseSqlEditor'
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
import {
  clearDiagnostic,
  publishDiagnostic,
} from '@/shell/panels/ai/workspace-context'
import { useSessionRegistry } from '@/stores/session-registry'
import { useTabStore } from '@/stores/tab'

export type ClickHouseExplainMode =
  | 'plan'
  | 'estimate'
  | 'pipeline'
  | 'ast'
  | 'syntax'
  | 'queryTree'

function summarizeExplainResult(
  result: ClickHouseQueryExecResult,
  sql: string,
  mode: string,
): string {
  const header = `EXPLAIN ${mode.toUpperCase()}\nSQL:\n${sql.slice(0, 800)}\n\nPlan:`
  const colNames = (result.columns ?? []).map((c) => c.name)
  const rows = result.rows ?? []
  const maxRows = 40
  const lines: string[] = []
  for (let i = 0; i < Math.min(rows.length, maxRows); i += 1) {
    const row = rows[i]
    if (!Array.isArray(row)) {
      lines.push(String(row))
      continue
    }
    if (colNames.length === 1) {
      lines.push(formatExplainCell(row[0]))
      continue
    }
    lines.push(colNames.map((name, idx) => `${name}=${formatExplainCell(row[idx])}`).join(' | '))
  }
  if (rows.length > maxRows) {
    lines.push(`… (${rows.length - maxRows} more rows)`)
  }
  if (result.durationMs != null) {
    lines.push(`\ndurationMs=${result.durationMs}`)
  }
  return `${header}\n${lines.join('\n')}`.slice(0, 4000)
}

function formatExplainCell(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

export type ClickHouseQueryPaneProps = {
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

type ClickHouseGridTab = {
  id: string
  sqlPreview: string
  columns: ClickHouseQueryColumn[]
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

export function useClickHouseQueryPane(props: ClickHouseQueryPaneProps) {
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
  const gridTabs = shallowRef<ClickHouseGridTab[]>([])
  const batchItems = shallowRef<BatchStatementItem[]>([])
  const batchTotalMs = ref(0)
  const cancelled = ref(false)
  const explainMode = ref<ClickHouseExplainMode>('plan')

  function dialectProfile() {
    if (!props.sessionId) return defaultClickHouseProfile()
    return sessions.getDialectForSession(props.sessionId) ?? defaultClickHouseProfile()
  }

  const supportExplainEstimate = computed(() =>
    hasCapability(dialectProfile(), Cap.ClickHouseExplainEstimate),
  )
  const supportExplainAnalyze = computed(() =>
    hasCapability(dialectProfile(), Cap.ClickHouseExplainAnalyze),
  )
  const supportExplainQueryTree = computed(() =>
    hasCapability(dialectProfile(), Cap.ClickHouseExplainQueryTree),
  )

  const explainModeOptions = computed((): RsSelectOptions => {
    const opts: { value: string; label: string }[] = [
      { value: 'plan', label: t('modules.clickhouse.query.explainModePlan') },
    ]
    if (supportExplainEstimate.value) {
      opts.push({
        value: 'estimate',
        label: t('modules.clickhouse.query.explainModeEstimate'),
      })
    }
    opts.push(
      { value: 'pipeline', label: t('modules.clickhouse.query.explainModePipeline') },
      { value: 'ast', label: t('modules.clickhouse.query.explainModeAst') },
      { value: 'syntax', label: t('modules.clickhouse.query.explainModeSyntax') },
    )
    if (supportExplainQueryTree.value) {
      opts.push({
        value: 'queryTree',
        label: t('modules.clickhouse.query.explainModeQueryTree'),
      })
    }
    return opts
  })

  const explainDiagId = computed(
    () => `diag:clickhouse-explain:${props.profileId || props.sessionId || 'session'}`,
  )

  const editor = useClickHouseSqlEditor({
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
        schema: props.database?.trim() || undefined,
        database: props.database?.trim() || undefined,
      }
    },
  })

  const { historyOpen, historyEntries, rememberSql, onHistoryPick } = useSqlQueryHistory({
    profileId: () => props.profileId,
    storagePrefix: 'niuma.clickhouse.sqlHistory.',
    sqlText,
  })

  const identityTitle = computed(() =>
    [props.sessionLabel || 'ClickHouse', props.database?.trim()].filter(Boolean).join(' · '),
  )

  const batchActive = computed(() => batchItems.value.length > 1)

  const activeGrid = computed(
    (): ClickHouseGridTab | null => gridTabs.value.find((g) => g.id === activePaneTab.value) ?? null,
  )

  const summaryGrid = computed(
    (): ClickHouseGridTab | null =>
      activeGrid.value ?? gridTabs.value[gridTabs.value.length - 1] ?? null,
  )

  const resultColumns = computed((): RsTableColumn[] =>
    (activeGrid.value?.columns ?? []).map((c, i) => {
      const name = c.name || `col${i + 1}`
      const tipLines = [t('modules.clickhouse.query.colTipField', { name })]
      if (c.dataType?.trim()) {
        tipLines.push(t('modules.clickhouse.query.colTipType', { type: c.dataType.trim() }))
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
      return t('modules.clickhouse.query.batchProgress', { done, total: batchItems.value.length })
    }
    if (batchActive.value && !running.value) {
      return t('modules.clickhouse.query.batchResultHint', {
        n: batchItems.value.length,
        tabs: gridTabs.value.length,
      })
    }
    const grid = summaryGrid.value
    if (grid) {
      return t('modules.clickhouse.query.resultSummary', {
        rows: grid.rowCount,
        cols: grid.columns.length,
        ms: grid.durationMs,
      })
    }
    if (lastError.value) return t('modules.clickhouse.query.execFailed')
    return lastExecSummary.value
  })

  const messageItems = computed((): QueryResultMessageItem[] => {
    const items: QueryResultMessageItem[] = []
    if (lastError.value) {
      items.push({ key: 'error', label: t('modules.clickhouse.query.msgError'), value: lastError.value, tone: 'error' })
    }
    if (batchActive.value) {
      const ok = batchItems.value.filter((x) => x.status === 'ok').length
      const fail = batchItems.value.filter((x) => x.status === 'error').length
      items.push({
        key: 'batch-summary',
        label: t('modules.clickhouse.query.batchLabel'),
        value: t('modules.clickhouse.query.batchSummary', {
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
      items.push({ key: 'summary', label: t('modules.clickhouse.query.msgOk'), value: lastExecSummary.value, tone: 'success' })
    }
    const grid = summaryGrid.value
    if (grid) {
      items.push({
        key: 'grid',
        label: t('modules.clickhouse.query.resultTab'),
        value: t('modules.clickhouse.query.resultSummary', { rows: grid.rowCount, cols: grid.columns.length, ms: grid.durationMs }),
        tone: 'default',
      })
      if (grid.hasMore) {
        items.push({ key: 'has-more', label: t('modules.clickhouse.query.hasMore'), value: '', tone: 'warning' })
      }
      if (grid.truncated) {
        items.push({
          key: 'truncated',
          label: t('modules.clickhouse.query.truncated'),
          value: t('modules.clickhouse.query.truncatedCap', { count: grid.fetchedCount }),
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
      await clickhouseApi.queryClose({ sessionId: props.sessionId, resultSetId: rsId })
    } catch {
      // 静默
    }
  }

  async function closeAllGridCursors(): Promise<void> {
    await Promise.all(gridTabs.value.map((tab) => closeResultSetQuiet(tab.resultSetId)))
  }

  /** 批跑下一句前释放已打开游标，保留已拉取数据。 */
  async function releaseHeldCursors(): Promise<void> {
    const tabs = gridTabs.value
    const held = tabs.filter((t) => t.resultSetId)
    if (held.length === 0) return
    await Promise.all(held.map((t) => closeResultSetQuiet(t.resultSetId)))
    gridTabs.value = tabs.map((t) =>
      t.resultSetId ? { ...t, resultSetId: undefined, hasMore: false } : t,
    )
  }

  function addGridTab(result: ClickHouseQueryExecResult, stmtIndex: number, stmtSql: string): ClickHouseGridTab {
    const cols = result.columns ?? []
    const rows = result.rows ? mapResultRowsByName(cols, result.rows, 0) : []
    const keepCursor = Boolean(result.hasMore && result.resultSetId)
    const tab: ClickHouseGridTab = {
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
      label: t('modules.clickhouse.query.batchResultTab', { n: stmtIndex + 1 }),
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
      toast.warning(t('modules.clickhouse.query.batchTabsTrimmed', { n: trimCount, max: MAX_RESULT_GRID_TABS }))
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
      return { ok: false, error: t('modules.clickhouse.query.noSession'), durationMs: 0 }
    }
    try {
      const result = await clickhouseApi.queryExec({
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
          ? t('modules.clickhouse.query.affected', { n })
          : t('modules.clickhouse.query.rows', { n: 0 })
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
      toast.warning(t('modules.clickhouse.query.empty'))
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
      toast.error(t('modules.clickhouse.query.batchTooMany', {
        count: statements.length,
        max: MAX_BATCH_STATEMENTS,
      }))
      running.value = false
      return
    }

    const requestId = `clickhouse-${Date.now()}`
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
            toast.error(t('modules.clickhouse.query.batchStopped', { n: i + 1, message: r.error }))
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

  async function cancelRun(): Promise<void> {
    if (!running.value || !props.sessionId) return
    cancelling.value = true
    cancelled.value = true
    try {
      await clickhouseApi.queryCancel({
        sessionId: props.sessionId,
        requestId: activeRequestId.value ?? undefined,
      })
    } catch {
      // 静默
    }
  }

  async function runExplain(analyze: boolean, modeOverride?: ClickHouseExplainMode): Promise<void> {
    if (running.value) return
    if (!props.sessionId) {
      lastError.value = t('modules.clickhouse.query.noSession')
      activePaneTab.value = 'messages'
      return
    }
    if (analyze && !supportExplainAnalyze.value) {
      lastError.value = t('modules.clickhouse.query.explainAnalyzeUnsupported')
      activePaneTab.value = 'messages'
      toast.warning(lastError.value)
      return
    }
    const sql = editor.resolveSql()
    if (!sql.trim()) {
      toast.warning(t('modules.clickhouse.query.empty'))
      return
    }
    const mode = analyze ? 'analyze' : (modeOverride ?? explainMode.value)
    running.value = true
    cancelling.value = false
    cancelled.value = false
    lastError.value = null
    lastExecSummary.value = ''
    clearDiagnostic(explainDiagId.value)
    await closeAllGridCursors()
    gridTabs.value = []
    batchItems.value = []
    activePaneTab.value = 'messages'
    const requestId = `explain-${Date.now()}`
    activeRequestId.value = requestId
    try {
      const statements = splitSqlStatementsWithFeatures(sql, resolveSplitFeaturesFromProfile(dialectProfile()))
        .filter((s) => s.sql.trim())
      const target = statements[0]?.sql ?? sql
      const result = await clickhouseApi.queryExplain({
        sessionId: props.sessionId,
        database: props.database?.trim() || undefined,
        sql: target,
        mode: analyze ? undefined : mode,
        analyze,
        limit: PAGE_LIMIT,
        requestId,
      })
      lastExecSummary.value = [
        analyze
          ? t('modules.clickhouse.query.explainAnalyzeDone')
          : t('modules.clickhouse.query.explainDone'),
        t('modules.clickhouse.query.resultSummary', {
          rows: result.rowCount,
          cols: result.columns?.length ?? 0,
          ms: result.durationMs,
        }),
      ].join(' · ')
      const explainText = summarizeExplainResult(result, target, mode)
      publishDiagnostic({
        id: explainDiagId.value,
        label: analyze ? 'EXPLAIN ANALYZE' : `EXPLAIN ${mode.toUpperCase()}`,
        detail: previewSql(target),
        text: explainText,
        tabId: useTabStore().activeTabId || undefined,
        kind: analyze ? 'explain_analyze' : 'explain',
      })
      if (resultHasGrid(result.columns)) {
        const tab = addGridTab(result, 0, target)
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

  async function fetchMore(): Promise<void> {
    const grid = activeGrid.value
    if (!grid?.hasMore || !grid.resultSetId || !props.sessionId) return
    loadingMore.value = true
    try {
      const result = await clickhouseApi.queryFetch({
        sessionId: props.sessionId,
        resultSetId: grid.resultSetId,
        limit: PAGE_LIMIT,
      })
      const newRows = result.rows ? mapResultRowsByName(grid.columns, result.rows, grid.rows.length) : []
      const updated: ClickHouseGridTab = {
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
      toast.error(t('modules.clickhouse.query.fetchError'))
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
      toast.warning(t('modules.clickhouse.query.noResult'))
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
    a.download = 'clickhouse-export.csv'
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

  const contextMenuItems = computed((): RsContextMenuItem[] => {
    const base = buildSqlQueryContextMenuItems({
      labels: {
        run: t('modules.clickhouse.query.run'),
        runSelection: t('modules.clickhouse.query.runSelection'),
        cancel: t('modules.clickhouse.query.cancel'),
        format: t('modules.clickhouse.query.format'),
        compress: t('modules.clickhouse.query.compress'),
        copy: t('modules.clickhouse.query.copy'),
        paste: t('modules.clickhouse.query.paste'),
        explain: t('modules.clickhouse.query.explain'),
        explainAnalyze: t('modules.clickhouse.query.explainAnalyze'),
        askAi: t('modules.clickhouse.query.askAi'),
        exportCsv: t('modules.clickhouse.query.exportCsv'),
        fetchMore: t('modules.clickhouse.query.loadMore'),
        fetchAll: t('modules.clickhouse.query.fetchAll'),
      },
      running: running.value,
      cancelling: cancelling.value,
      hasSelection: editor.hasSelection.value,
      sqlEmpty: !sqlText.value.trim(),
      hasResultRows: Boolean(resultRows.value.length),
      hasMore: hasMore.value,
      loadingMore: loadingMore.value,
      showAskAi: true,
      showExplain: false,
    })
    const explainChildren: RsContextMenuItem[] = [
      {
        key: 'explainPlan',
        label: t('modules.clickhouse.query.explainModePlan'),
        disabled: running.value,
      },
    ]
    if (supportExplainEstimate.value) {
      explainChildren.push({
        key: 'explainEstimate',
        label: t('modules.clickhouse.query.explainModeEstimate'),
        disabled: running.value,
      })
    }
    explainChildren.push(
      {
        key: 'explainPipeline',
        label: t('modules.clickhouse.query.explainModePipeline'),
        disabled: running.value,
      },
      {
        key: 'explainAst',
        label: t('modules.clickhouse.query.explainModeAst'),
        disabled: running.value,
      },
      {
        key: 'explainSyntax',
        label: t('modules.clickhouse.query.explainModeSyntax'),
        disabled: running.value,
      },
    )
    if (supportExplainQueryTree.value) {
      explainChildren.push({
        key: 'explainQueryTree',
        label: t('modules.clickhouse.query.explainModeQueryTree'),
        disabled: running.value,
      })
    }
    if (supportExplainAnalyze.value) {
      explainChildren.push(
        { key: 'sep-explain-analyze', label: '', separator: true },
        {
          key: 'explainAnalyze',
          label: t('modules.clickhouse.query.explainAnalyze'),
          icon: 'activity',
          disabled: running.value,
        },
      )
    }
    const explainItems: RsContextMenuItem[] = [
      { key: 'sep-explain', label: '', separator: true },
      {
        key: 'explainMenu',
        label: t('modules.clickhouse.query.explain'),
        icon: 'git-compare',
        disabled: running.value,
        children: explainChildren,
      },
    ]
    const askAiIdx = base.findIndex((item) => item.key === 'askAi' || item.key === 'sep-ai')
    if (askAiIdx >= 0) {
      return [...base.slice(0, askAiIdx), ...explainItems, ...base.slice(askAiIdx)]
    }
    const exportIdx = base.findIndex((item) => item.key === 'sep-export' || item.key === 'exportCsv')
    if (exportIdx >= 0) {
      return [...base.slice(0, exportIdx), ...explainItems, ...base.slice(exportIdx)]
    }
    return [...base, ...explainItems]
  })

  function onContextMenuSelect(key: string): void {
    const explainModes: Record<string, ClickHouseExplainMode | 'analyze'> = {
      explainPlan: 'plan',
      explainEstimate: 'estimate',
      explainPipeline: 'pipeline',
      explainAst: 'ast',
      explainSyntax: 'syntax',
      explainQueryTree: 'queryTree',
      explainAnalyze: 'analyze',
    }
    if (key === 'run') void runSql()
    else if (key === 'cancel') void cancelRun()
    else if (key === 'format') void editor.formatSql()
    else if (key === 'compress') void editor.compressSql()
    else if (key === 'copy') editor.copyEditor()
    else if (key === 'paste') void editor.pasteEditor()
    else if (key in explainModes) {
      const mode = explainModes[key]!
      if (mode !== 'analyze') {
        explainMode.value = mode
      }
      void runExplain(mode === 'analyze', mode === 'analyze' ? undefined : mode)
    } else if (key === 'askAi') void askAiAboutSelection()
    else if (key === 'exportCsv') exportCsv()
    else if (key === 'fetchMore') void fetchMore()
    else if (key === 'fetchAll') void fetchAll()
  }

  const toolbarLabels = computed((): SqlQueryToolbarLabels => ({
    toolbarAria: 'ClickHouse',
    run: t('modules.clickhouse.query.run'),
    runSelection: t('modules.clickhouse.query.runSelection'),
    runTooltip: t('modules.clickhouse.query.runHint'),
    cancel: t('modules.clickhouse.query.cancel'),
    cancelTooltip: t('modules.clickhouse.query.cancel'),
    format: t('modules.clickhouse.query.format'),
    formatTooltip: t('modules.clickhouse.query.formatTooltip'),
    explain: t('modules.clickhouse.query.explain'),
    explainTooltip: t('modules.clickhouse.query.explainHint'),
    explainAnalyze: t('modules.clickhouse.query.explainAnalyze'),
    explainAnalyzeTooltip: t('modules.clickhouse.query.explainAnalyzeHint'),
    history: t('modules.clickhouse.query.history'),
    historyEmpty: t('modules.clickhouse.query.historyEmpty'),
    historyClear: t('modules.clickhouse.query.historyClear'),
    autoCommit: '',
    autoCommitTooltip: '',
    commit: '',
    commitTooltip: '',
    rollback: '',
    rollbackTooltip: '',
    inTransaction: '',
  }))

  const resultPanelLabels = computed((): QueryResultPanelLabels => ({
    messages: t('modules.clickhouse.query.messages'),
    messagesEmpty: t('modules.clickhouse.query.messagesEmpty'),
    filterPlaceholder: t('modules.clickhouse.query.filterPlaceholder'),
    loadMore: t('modules.clickhouse.query.loadMore'),
    fetchAll: t('modules.clickhouse.query.fetchAll'),
    exportCsv: t('modules.clickhouse.query.exportCsv'),
    emptyResult: t('modules.clickhouse.query.emptyResult'),
    resultEmpty: t('modules.clickhouse.query.resultEmpty'),
    closeResultTab: t('modules.clickhouse.query.closeResultTab'),
    batchResultTab: (n: number) => t('modules.clickhouse.query.batchResultTab', { n }),
    tabRowCount: (n: number, more: boolean) =>
      more ? t('modules.clickhouse.query.rows', { n }) + '+' : t('modules.clickhouse.query.rows', { n }),
    batchStmtLabel: (n: number) => t('modules.clickhouse.query.batchStmtLabel', { n }),
    batchStmtSkipped: t('modules.clickhouse.query.batchStmtSkipped'),
    batchStmtRunning: t('modules.clickhouse.query.batchStmtRunning'),
    batchStmtPending: t('modules.clickhouse.query.batchStmtPending'),
    batchOpenResult: t('modules.clickhouse.query.batchOpenResult'),
    logColStatus: t('modules.clickhouse.query.logColStatus'),
    logColTime: t('modules.clickhouse.query.logColTime'),
    logColRows: t('modules.clickhouse.query.logColRows'),
    msgOk: t('modules.clickhouse.query.msgOk'),
    msgError: t('modules.clickhouse.query.msgError'),
    cancelled: t('modules.clickhouse.query.cancelled'),
    copyMessage: t('modules.clickhouse.query.copyMessage'),
    copiedHint: t('modules.clickhouse.query.copiedHint'),
  }))

  onMounted(() => {
    if (!restoredFromDraft && props.autoRunInitialSql && props.initialSql?.trim()) {
      void runSql()
    }
  })

  onUnmounted(() => {
    clearDiagnostic(explainDiagId.value)
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
    explainMode,
    explainModeOptions,
    supportExplainAnalyze,
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
