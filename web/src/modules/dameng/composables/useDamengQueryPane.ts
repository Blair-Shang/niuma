/**
 * Dameng 查询面板：复用公共 database 模块工具，走 dameng.query.* RPC。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRsToast, type RsContextMenuItem, type RsTableColumn } from '@niuma/ui'
import { damengApi } from '@/api/dameng'
import type { DamengQueryColumn, DamengQueryExecResult } from '@/api/types/dameng'
import {
  defaultDamengProfile,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import { useDamengSqlEditor } from '@/modules/dameng/composables/useDamengSqlEditor'
import {
  alignForValueType,
  buildSqlQueryContextMenuItems,
  formatBrowseCellValue,
  resolveSqlValueType,
  useQueryDraftPersist,
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

export type DamengQueryPaneProps = {
  sessionId: string | null
  profileId?: string
  schema?: string
  initialSql?: string
  draftSql?: string
  tabId?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
  active?: boolean
}

type DamengGridTab = {
  id: string
  sqlPreview: string
  columns: DamengQueryColumn[]
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

type DamengResultPaneTabId = 'messages' | string

const PAGE_LIMIT = 1000

export function useDamengQueryPane(props: DamengQueryPaneProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const sessionRegistry = useSessionRegistry()

  const { sqlText, restoredFromDraft } = useQueryDraftPersist({
    tabId: () => props.tabId,
    draftSql: () => props.draftSql,
    initialSql: () => props.initialSql,
    defaultSql: 'SELECT 1;\n',
  })
  const running = ref(false)
  const cancelling = ref(false)
  const cancelled = ref(false)
  const loadingMore = ref(false)
  const filterText = ref('')
  const activePaneTab = ref<DamengResultPaneTabId>('messages')
  const lastError = ref<string | null>(null)
  const lastExecSummary = ref('')
  const activeRequestId = ref<string | null>(null)
  const gridTabs = shallowRef<DamengGridTab[]>([])
  const batchItems = shallowRef<BatchStatementItem[]>([])
  const batchTotalMs = ref(0)
  const autoCommit = ref(true)
  const inTransaction = ref(false)
  const txBusy = ref(false)

  function dialectProfile() {
    if (!props.sessionId) return defaultDamengProfile()
    return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultDamengProfile()
  }

  const editor = useDamengSqlEditor({
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
    storagePrefix: 'niuma.dameng.sqlHistory.',
    sqlText,
  })

  const identityTitle = computed(() => {
    const parts = [props.sessionLabel || 'Dameng']
    if (props.schema?.trim()) parts.push(props.schema.trim())
    return parts.join(' · ')
  })

  const batchActive = computed(() => batchItems.value.length > 1)

  const activeGrid = computed((): DamengGridTab | null => {
    const id = activePaneTab.value
    if (id === 'messages') return null
    return gridTabs.value.find((g) => g.id === id) ?? null
  })

  const summaryGrid = computed(
    (): DamengGridTab | null =>
      activeGrid.value ?? gridTabs.value[gridTabs.value.length - 1] ?? null,
  )

  const resultColumns = computed((): RsTableColumn[] => {
    const cols = activeGrid.value?.columns ?? []
    return cols.map((c, i) => {
      const name = c.name || `col${i + 1}`
      const tipLines = [t('modules.dameng.query.colTipField', { name })]
      if (c.dataType?.trim()) {
        tipLines.push(t('modules.dameng.query.colTipType', { type: c.dataType.trim() }))
      }
      const valueType = resolveSqlValueType(c.dataType, { dialect: 'dameng' })
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
      return t('modules.dameng.query.batchProgress', { done, total: batchItems.value.length })
    }
    if (batchActive.value && !running.value) {
      return t('modules.dameng.query.batchResultHint', {
        n: batchItems.value.length,
        tabs: gridTabs.value.length,
      })
    }
    const grid = summaryGrid.value
    if (grid) {
      return t('modules.dameng.query.resultSummary', {
        rows: grid.rowCount,
        cols: grid.columns.length,
        ms: grid.durationMs,
      })
    }
    if (lastError.value) return t('modules.dameng.query.execFailed')
    if (lastExecSummary.value) return lastExecSummary.value
    return ''
  })

  const messageItems = computed((): QueryResultMessageItem[] => {
    const items: QueryResultMessageItem[] = []
    if (lastError.value) {
      items.push({ key: 'error', label: t('modules.dameng.query.msgError'), value: lastError.value, tone: 'error' })
    }
    if (batchActive.value) {
      const ok = batchItems.value.filter((x) => x.status === 'ok').length
      const fail = batchItems.value.filter((x) => x.status === 'error').length
      items.push({
        key: 'batch-summary',
        label: t('modules.dameng.query.batchLabel'),
        value: t('modules.dameng.query.batchSummary', {
          ok, fail, total: batchItems.value.length, ms: batchTotalMs.value, tabs: gridTabs.value.length,
        }),
        tone: fail > 0 ? 'warning' : 'success',
      })
      return items
    }
    if (lastExecSummary.value) {
      items.push({ key: 'summary', label: t('modules.dameng.query.msgOk'), value: lastExecSummary.value, tone: 'success' })
    }
    const grid = summaryGrid.value
    if (grid) {
      items.push({
        key: 'grid',
        label: t('modules.dameng.query.resultTab'),
        value: t('modules.dameng.query.resultSummary', { rows: grid.rowCount, cols: grid.columns.length, ms: grid.durationMs }),
        tone: 'default',
      })
      if (grid.hasMore) {
        items.push({ key: 'has-more', label: t('modules.dameng.query.hasMore'), value: '', tone: 'warning' })
      }
      if (grid.truncated) {
        items.push({ key: 'truncated', label: t('modules.dameng.query.truncated'), value: t('modules.dameng.query.truncatedCap', { count: grid.fetchedCount }), tone: 'warning' })
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
      await damengApi.queryClose({ sessionId: props.sessionId, resultSetId: rsId })
    } catch {
      // 静默：会话已关 / 游标已释放
    }
  }

  /** 关闭结果页仍占用的服务端游标（手动事务下会占用钉住的 txConn）。 */
  async function closeAllGridCursors(): Promise<void> {
    const tabs = gridTabs.value
    await Promise.all(tabs.map((tab) => closeResultSetQuiet(tab.resultSetId)))
    // 兜底关会话全部游标：避免 Tab 已清空但服务端仍 txBusy（connection busy）
    if (props.sessionId) {
      try {
        await damengApi.queryClose({ sessionId: props.sessionId })
      } catch {
        // 静默
      }
    }
  }

  /**
   * 批跑下一句前释放已打开游标：同一 txConn 上不能边挂结果集边 Exec。
   * 保留已拉取的首屏数据，仅放弃「加载更多」。
   */
  async function releaseHeldTxCursors(): Promise<void> {
    const tabs = gridTabs.value
    const held = tabs.filter((t) => t.resultSetId)
    if (held.length === 0) return
    await Promise.all(held.map((t) => closeResultSetQuiet(t.resultSetId)))
    gridTabs.value = tabs.map((t) =>
      t.resultSetId ? { ...t, resultSetId: undefined, hasMore: false } : t,
    )
  }

  function addGridTab(result: DamengQueryExecResult, stmtIndex: number, stmtSql: string): DamengGridTab {
    const id = createGridTabId(stmtIndex)
    const cols = result.columns ?? []
    const rows = result.rows ? mapResultRowsByName(cols, result.rows, 0) : []
    const keepCursor = Boolean(result.hasMore && result.resultSetId)
    const tab: DamengGridTab = {
      id,
      sqlPreview: previewSql(stmtSql),
      columns: cols,
      rows,
      rowCount: result.rowCount,
      fetchedCount: result.fetchedCount ?? result.rowCount,
      hasMore: keepCursor,
      truncated: result.truncated,
      resultSetId: keepCursor ? result.resultSetId : undefined,
      durationMs: result.durationMs,
      label: t('modules.dameng.query.batchResultTab', { n: stmtIndex + 1 }),
      stmtIndex,
    }

    let tabs = [...gridTabs.value]

    // 释放超出上限的旧游标
    const openCount = countOpenCursors(tabs.map((t) => ({ resultSetId: t.resultSetId ?? null, hasMore: t.hasMore })))
    if (openCount >= MAX_OPEN_RESULT_CURSORS) {
      const oldest = tabs.find((t) => t.hasMore && t.resultSetId)
      if (oldest?.resultSetId) {
        void closeResultSetQuiet(oldest.resultSetId)
        oldest.hasMore = false
        oldest.resultSetId = undefined
      }
    }
    if (tabs.length >= MAX_RESULT_GRID_TABS) {
      const trimCount = tabs.length - MAX_RESULT_GRID_TABS + 1
      const trimmed = tabs.splice(0, trimCount)
      toast.warning(t('modules.dameng.query.batchTabsTrimmed', { n: trimCount, max: MAX_RESULT_GRID_TABS }))
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
  ): Promise<{ ok: boolean; affectedRows?: number; error?: string; durationMs: number }> {
    if (!props.sessionId) return { ok: false, error: t('modules.dameng.query.noSession'), durationMs: 0 }
    try {
      const result = await damengApi.queryExec({
        sessionId: props.sessionId!,
        schema: props.schema?.trim() || undefined,
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
          ? t('modules.dameng.query.affected', { n })
          : t('modules.dameng.query.rows', { n: 0 })
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
      toast.warning(t('modules.dameng.query.empty'))
      return
    }
    running.value = true
    cancelling.value = false
    cancelled.value = false
    lastError.value = null
    lastExecSummary.value = ''
    // 必须先关游标再清空 Tab：否则手动事务下 txBusy 残留，下一句报 connection busy
    await closeAllGridCursors()
    gridTabs.value = []
    batchItems.value = []
    batchTotalMs.value = 0
    activePaneTab.value = 'messages'

    const profile = dialectProfile()
    const features = resolveSplitFeaturesFromProfile(profile)
    const stmts = splitSqlStatementsWithFeatures(sql, features).filter((s) => s.sql.trim())

    if (stmts.length > MAX_BATCH_STATEMENTS) {
      toast.error(t('modules.dameng.query.batchTooMany', { count: stmts.length, max: MAX_BATCH_STATEMENTS }))
      running.value = false
      return
    }

    const requestId = `dameng-${Date.now()}`
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

    try {
      for (let i = 0; i < stmts.length; i++) {
        if (cancelled.value) break
        // 同连接批跑：上一句若仍挂着分页游标，必须先释放才能执行下一句
        if (i > 0) await releaseHeldTxCursors()
        if (stmts.length > 1) {
          batchItems.value = batchItems.value.map((b, j) =>
            j === i ? { ...b, status: 'running' as const } : b,
          )
        }
        await yieldToEventLoop()
        const r = await execStatement(stmts[i]!.sql, requestId, i)
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
            toast.error(t('modules.dameng.query.batchStopped', { n: i + 1, message: r.error }))
          }
          activePaneTab.value = 'messages'
          break
        }
      }
    } finally {
      running.value = false
      cancelling.value = false
      activeRequestId.value = null
      await syncTxState()
    }
  }

  async function runExplain(): Promise<void> {
    if (!props.sessionId || running.value) return
    const sql = editor.resolveSql()
    if (!sql.trim()) return
    running.value = true
    lastError.value = null
    await closeAllGridCursors()
    gridTabs.value = []
    activePaneTab.value = 'messages'
    try {
      const result = await damengApi.queryExplain({
        sessionId: props.sessionId,
        schema: props.schema?.trim() || undefined,
        sql: sql.trim(),
        limit: PAGE_LIMIT,
      })
      if (resultHasGrid(result.columns)) {
        const tab = addGridTab(result, 0, sql.trim())
        activePaneTab.value = tab.id
      } else {
        await closeResultSetQuiet(result.resultSetId)
      }
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      activePaneTab.value = 'messages'
    } finally {
      running.value = false
      await syncTxState()
    }
  }

  async function cancelRun(): Promise<void> {
    if (!running.value || !props.sessionId) return
    cancelling.value = true
    cancelled.value = true
    try {
      await damengApi.queryCancel({
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
      const result = await damengApi.queryFetch({
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
      toast.error(t('modules.dameng.query.fetchError'))
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
      toast.warning(t('modules.dameng.query.noResult'))
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

  async function askAiAboutSelection(): Promise<void> {
    const { executeCommand } = await import('@/extensions/contributions/command-registry')
    editor.syncSelectionFlag()
    const sql = editor.resolveSql()
    if (sql) {
      const { publishEditorSelection } = await import('@/shell/panels/ai/workspace-context')
      const { useTabStore } = await import('@/stores/tab')
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
        run: t('modules.dameng.query.run'),
        runSelection: t('modules.dameng.query.runSelection'),
        cancel: t('modules.dameng.query.cancel'),
        format: t('modules.dameng.query.format'),
        compress: t('modules.dameng.query.compress'),
        copy: t('modules.dameng.query.copy'),
        paste: t('modules.dameng.query.paste'),
        explain: t('modules.dameng.query.explain'),
        explainAnalyze: t('modules.dameng.query.explain'),
        askAi: t('modules.dameng.query.askAi'),
        exportCsv: t('modules.dameng.query.exportCsv'),
        fetchMore: t('modules.dameng.query.loadMore'),
        fetchAll: t('modules.dameng.query.fetchAll'),
      },
      running: running.value,
      cancelling: cancelling.value,
      hasSelection: editor.hasSelection.value,
      sqlEmpty: !sqlText.value.trim(),
      hasResultRows: Boolean(activeGrid.value?.rows.length),
      hasMore: hasMore.value,
      loadingMore: loadingMore.value,
      showAskAi: true,
      showExplain: true,
    }),
  )

  function formatEditor(): void {
    void editor.formatSql()
  }

  function onContextMenuSelect(key: string): void {
    if (key === 'run') void runSql()
    else if (key === 'cancel') void cancelRun()
    else if (key === 'format') void editor.formatSql()
    else if (key === 'compress') void editor.compressSql()
    else if (key === 'copy') editor.copyEditor()
    else if (key === 'paste') void editor.pasteEditor()
    else if (key === 'explain' || key === 'explainAnalyze') void runExplain()
    else if (key === 'askAi') void askAiAboutSelection()
    else if (key === 'exportCsv') exportCsv()
    else if (key === 'fetchMore') void fetchMore()
    else if (key === 'fetchAll') void fetchAll()
  }

  async function syncTxState(): Promise<void> {
    if (!props.sessionId) return
    try {
      const state = await damengApi.txGetState({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
    } catch {
      // 静默：旧会话或不支持时保持本地默认
    }
  }

  async function setAutoCommit(val: boolean): Promise<void> {
    if (!props.sessionId || txBusy.value) return
    txBusy.value = true
    try {
      // 切自动提交前先关游标，避免服务端因 txBusy 拒绝
      await closeAllGridCursors()
      gridTabs.value = gridTabs.value.map((t) =>
        t.resultSetId ? { ...t, resultSetId: undefined, hasMore: false } : t,
      )
      const state = await damengApi.txSetAutoCommit({ sessionId: props.sessionId, autoCommit: val })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      await syncTxState()
    } finally {
      txBusy.value = false
    }
  }

  async function commitTx(): Promise<void> {
    if (!props.sessionId || txBusy.value) return
    txBusy.value = true
    try {
      await closeAllGridCursors()
      gridTabs.value = gridTabs.value.map((t) =>
        t.resultSetId ? { ...t, resultSetId: undefined, hasMore: false } : t,
      )
      const state = await damengApi.txCommit({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
      toast.success(t('modules.dameng.query.commitDone'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      await syncTxState()
    } finally {
      txBusy.value = false
    }
  }

  async function rollbackTx(): Promise<void> {
    if (!props.sessionId || txBusy.value) return
    txBusy.value = true
    try {
      await closeAllGridCursors()
      gridTabs.value = gridTabs.value.map((t) =>
        t.resultSetId ? { ...t, resultSetId: undefined, hasMore: false } : t,
      )
      const state = await damengApi.txRollback({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
      toast.success(t('modules.dameng.query.rollbackDone'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      await syncTxState()
    } finally {
      txBusy.value = false
    }
  }

  const toolbarLabels = computed((): SqlQueryToolbarLabels => ({
    toolbarAria: 'Dameng',
    run: t('modules.dameng.query.run'),
    runSelection: t('modules.dameng.query.runSelection'),
    runTooltip: t('modules.dameng.query.runHint'),
    cancel: t('modules.dameng.query.cancel'),
    cancelTooltip: t('modules.dameng.query.cancel'),
    format: t('modules.dameng.query.format'),
    formatTooltip: t('modules.dameng.query.formatTooltip'),
    explain: t('modules.dameng.query.explain'),
    explainTooltip: t('modules.dameng.query.explainHint'),
    explainAnalyze: t('modules.dameng.query.explain'),
    explainAnalyzeTooltip: t('modules.dameng.query.explainHint'),
    history: t('modules.dameng.query.history'),
    historyEmpty: t('modules.dameng.query.historyEmpty'),
    historyClear: t('modules.dameng.query.historyClear'),
    autoCommit: t('modules.dameng.query.autoCommit'),
    autoCommitTooltip: t('modules.dameng.query.autoCommitTooltip'),
    commit: t('modules.dameng.query.commit'),
    commitTooltip: t('modules.dameng.query.commitTooltip'),
    rollback: t('modules.dameng.query.rollback'),
    rollbackTooltip: t('modules.dameng.query.rollbackTooltip'),
    inTransaction: t('modules.dameng.query.inTransaction'),
  }))

  const resultPanelLabels = computed((): QueryResultPanelLabels => ({
    messages: t('modules.dameng.query.messages'),
    messagesEmpty: t('modules.dameng.query.messagesEmpty'),
    filterPlaceholder: t('modules.dameng.query.filterPlaceholder'),
    loadMore: t('modules.dameng.query.loadMore'),
    fetchAll: t('modules.dameng.query.fetchAll'),
    exportCsv: t('modules.dameng.query.exportCsv'),
    emptyResult: t('modules.dameng.query.emptyResult'),
    resultEmpty: t('modules.dameng.query.resultEmpty'),
    closeResultTab: t('modules.dameng.query.closeResultTab'),
    batchResultTab: (n: number) => t('modules.dameng.query.batchResultTab', { n }),
    tabRowCount: (n: number, hasMore: boolean) =>
      hasMore ? t('modules.dameng.query.rows', { n }) + '+' : t('modules.dameng.query.rows', { n }),
    batchStmtLabel: (n: number) => t('modules.dameng.query.batchStmtLabel', { n }),
    batchStmtSkipped: t('modules.dameng.query.batchStmtSkipped'),
    batchStmtRunning: t('modules.dameng.query.batchStmtRunning'),
    batchStmtPending: t('modules.dameng.query.batchStmtPending'),
    batchOpenResult: t('modules.dameng.query.batchOpenResult'),
    logColStatus: t('modules.dameng.query.logColStatus'),
    logColTime: t('modules.dameng.query.logColTime'),
    logColRows: t('modules.dameng.query.logColRows'),
    msgOk: t('modules.dameng.query.msgOk'),
    msgError: t('modules.dameng.query.msgError'),
    cancelled: t('modules.dameng.query.cancelled'),
    copyMessage: t('modules.dameng.query.copyMessage'),
    copiedHint: t('modules.dameng.query.copiedHint'),
  }))

  onMounted(() => {
    void syncTxState()
    if (!restoredFromDraft && props.autoRunInitialSql && props.initialSql?.trim()) {
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
