/**
 * Vastbase 查询面板状态：执行 / Explain / 历史 / 结果 / 右键菜单。
 */
import type { RsContextMenuItem, RsTableColumn } from '@niuma/ui'
import { useRsToast } from '@niuma/ui'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'

import { useI18n } from 'vue-i18n'
import { vastbaseApi } from '@/api'
import type { VastQueryColumn, VastQueryExecResult, VastColumnInfo } from '@/api/types/vastbase'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor'
import {
  Cap,
  defaultVastbaseProfile,
  hasCapability,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { useVastSqlEditor } from '@/modules/vastbase/composables/useVastSqlEditor'
import { seedSqlForFeature, type VastSessionTab } from '@/modules/vastbase/sql-seed'
import {
  alignForValueType,
  resolveSqlValueType,
} from '@/modules/vastbase/utils/column-value-type'
import { exportQueryResultAsCsv } from '@/modules/vastbase/utils/export-csv'
import { prepareDialectExecSql } from '@/modules/vastbase/utils/oracle-terminator'
import { parsePrimaryFromRelation, type ParsedFromRelation } from '@/modules/vastbase/utils/parse-query-from'
import {
  buildSqlQueryContextMenuItems,
  type QueryResultPanelLabels,
  type SqlQueryToolbarLabels,
} from '@/modules/database'
import { useSessionRegistry } from '@/stores/session-registry'
import {
  MAX_BATCH_STATEMENTS,
  MAX_OPEN_RESULT_CURSORS,
  MAX_RESULT_GRID_TABS,
  previewSql,
  resultHasGrid,
  yieldToEventLoop,
  type BatchStatementItem,
} from '@/modules/vastbase/utils/query-batch'
import {
  countOpenCursors,
  createGridTabId,
  type VastGridTab,
  type VastQueryResultRow,
  type VastResultPaneTabId,
} from '@/modules/vastbase/utils/query-result-tabs'
import {
  clearSqlHistory,
  loadSqlHistory,
  pushSqlHistory,
  type VastSqlHistoryEntry,
} from '@/modules/vastbase/utils/sql-history'
import { createMemoryMonitor } from '@/utils/memory-monitor'
import {
  clearDiagnostic,
  publishDiagnostic,
} from '@/shell/panels/ai/workspace-context'
import { useTabStore } from '@/stores/tab'

export type { VastQueryResultRow, VastGridTab, VastResultPaneTabId }

export type VastMessageItem = import('@/modules/database/types/query-result').QueryResultMessageItem

export interface VastQueryPaneProps {
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  table?: string
  routine?: string
  routineKind?: 'function' | 'procedure'
  args?: string
  oid?: number
  feature: VastSessionTab
  initialSql?: string
  /** 打开时若带 initialSql，是否自动执行（生成 SELECT/COUNT 等） */
  autoRunInitialSql?: boolean
  sessionLabel?: string
  active: boolean
}

/** 无结果集语句（INSERT/UPDATE/DELETE/DDL…）的消息摘要 */
type VastExecSummary = {
  durationMs: number
  rowCount: number
  fetchedCount?: number
  rowsAffected?: number
  commandTag?: string
  notices?: string[]
  columnCount: number
  truncated?: boolean
  hasMore?: boolean
}

export function useVastQueryPane(props: VastQueryPaneProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const mem = createMemoryMonitor('VastQuery')

  const sqlText = ref('SELECT 1')
  const running = ref(false)
  const cancelling = ref(false)
  /** 用户主动终止：用于区分取消与真正执行失败。 */
  const cancelled = ref(false)
  const activeRequestId = ref<string | null>(null)
  /** 多结果集 Tab（批跑每个 SELECT 一页） */
  const gridTabs = shallowRef<VastGridTab[]>([])
  /**
   * 最近一次执行摘要。DML/DDL 无 columns 时不会建网格 Tab，
   * 消息页必须靠此字段展示 commandTag / 耗时，否则会空白。
   */
  const lastExecSummary = ref<VastExecSummary | null>(null)
  /** 'messages' | gridTab.id */
  const activePaneTab = ref<VastResultPaneTabId>('messages')
  const loadingMore = ref(false)
  const lastError = ref<string | null>(null)
  /** 批跑摘要（无 rows）；单句执行时为空 */
  const batchItems = shallowRef<BatchStatementItem[]>([])
  const batchTotalMs = ref(0)
  const history = ref<VastSqlHistoryEntry[]>([])
  const historyOpen = ref(false)
  /** @deprecated 兼容模板：非 messages 即视为 grid */
  const resultTab = computed({
    get: (): 'grid' | 'messages' =>
      activePaneTab.value === 'messages' ? 'messages' : 'grid',
    set: (v: 'grid' | 'messages') => {
      if (v === 'messages') {
        activePaneTab.value = 'messages'
        return
      }
      const last = gridTabs.value[gridTabs.value.length - 1]
      if (last) activePaneTab.value = last.id
    },
  })
  const filterText = ref('')
  /** 当前表上下文下的主键列名（无 schema/table 时为空）。 */
  const pkColumns = ref<string[]>([])
  /** 是否已成功拉取主键元数据（用于决定是否展示「是否主键」）。 */
  const pkMetaReady = ref(false)

  const activeGrid = computed(
    (): VastGridTab | null => {
      const id = activePaneTab.value
      if (id === 'messages') return null
      return gridTabs.value.find((g) => g.id === id) ?? null
    },
  )

  /** 消息/工具栏摘要：在消息页签时回退到最近结果 Tab，避免 activeGrid 为空 */
  const summaryGrid = computed(
    (): VastGridTab | null => activeGrid.value ?? gridTabs.value[gridTabs.value.length - 1] ?? null,
  )

  function gridToExecResult(g: VastGridTab): VastQueryExecResult {
    return {
      columns: g.columns,
      rows: [],
      rowCount: g.rowCount,
      fetchedCount: g.fetchedCount,
      hasMore: g.hasMore,
      resultSetId: g.resultSetId ?? undefined,
      truncated: g.truncated,
      durationMs: g.durationMs,
      commandTag: g.commandTag,
      notices: g.notices,
      requestId: g.requestId ?? '',
    }
  }

  /** DML 无结果集时用 rowsAffected；SELECT 用已取行数 */
  function displayRowCount(res: {
    rowCount?: number
    fetchedCount?: number
    rowsAffected?: number
  }): number {
    if (res.rowsAffected != null && res.rowsAffected >= 0 && (res.rowCount ?? 0) === 0) {
      return res.rowsAffected
    }
    return res.fetchedCount ?? res.rowCount ?? 0
  }

  const lastResult = computed((): VastQueryExecResult | null => {
    const g = activeGrid.value
    if (!g) return null
    return gridToExecResult(g)
  })

  const summaryResult = computed((): VastQueryExecResult | null => {
    const g = summaryGrid.value
    if (g) return gridToExecResult(g)
    const s = lastExecSummary.value
    if (!s) return null
    return {
      requestId: '',
      columns: [],
      rows: [],
      rowCount: s.rowCount,
      fetchedCount: s.fetchedCount,
      rowsAffected: s.rowsAffected,
      hasMore: s.hasMore,
      truncated: s.truncated,
      durationMs: s.durationMs,
      commandTag: s.commandTag,
      notices: s.notices,
    }
  })

  const resultRows = computed(() => activeGrid.value?.rows ?? [])
  const hasMore = computed(() =>
    Boolean(activeGrid.value?.hasMore && activeGrid.value?.resultSetId),
  )
  const summaryHasMore = computed(() =>
    Boolean(summaryGrid.value?.hasMore && summaryGrid.value?.resultSetId),
  )
  const resultSetId = computed(() => activeGrid.value?.resultSetId ?? null)

  const sessionRegistry = useSessionRegistry()

  function dialectProfile() {
    return (
      sessionRegistry.getDialectForSession(props.sessionId) ?? defaultVastbaseProfile()
    )
  }

  const editor = useVastSqlEditor({
    sqlText,
    active: () => props.active,
    onRun: () => {
      void runQuery()
    },
    getDialect: () => dialectProfile(),
    getSuggestScope: () => {
      if (!props.sessionId) return null
      return {
        sessionId: props.sessionId,
        database: props.database,
        schema: props.schema || 'public',
        table: props.table,
      }
    },
  })

  const scopeLabel = computed(() => {
    if (props.feature === 'query') {
      return props.database || t('modules.vastbase.session.connectionRoot')
    }
    const leaf = props.table ?? props.routine
    const parts = [props.database, props.schema, leaf].filter(Boolean)
    return parts.length ? parts.join('.') : t('modules.vastbase.session.connectionRoot')
  })

  const identityTitle = computed(() =>
    [props.sessionLabel, scopeLabel.value].filter(Boolean).join(' · '),
  )

  const featureIcon = computed(() => (props.feature === 'call' ? 'play' : 'code-2'))
  const featureLabelKey = computed(() =>
    props.feature === 'call'
      ? 'modules.vastbase.session.tabCall'
      : 'modules.vastbase.session.tabQuery',
  )

  const notices = computed(() => summaryResult.value?.notices ?? [])

  const batchActive = computed(() => batchItems.value.length > 1)

  const messageItems = computed((): VastMessageItem[] => {
    const items: VastMessageItem[] = []

    if (batchActive.value) {
      // 大批量句明细走 RsVirtualList(batchItems)，此处只放摘要，避免 computed 生成上万 DOM 模型
      const list = batchItems.value
      const ok = list.filter((x) => x.status === 'ok').length
      const fail = list.filter((x) => x.status === 'error').length
      const done = list.filter(
        (x) => x.status === 'ok' || x.status === 'error' || x.status === 'cancelled',
      ).length
      items.push({
        key: 'batch-summary',
        label: t('modules.vastbase.session.batchLabel'),
        value: running.value
          ? t('modules.vastbase.session.batchProgress', { done, total: list.length })
          : t('modules.vastbase.session.batchSummary', {
              ok,
              fail,
              total: list.length,
              ms: batchTotalMs.value,
            }),
        tone: fail > 0 ? 'error' : cancelled.value ? 'warning' : 'success',
      })
    }

    if (cancelled.value && !batchActive.value) {
      items.push({
        key: 'status',
        label: t('modules.vastbase.session.msgStatus'),
        value: t('modules.vastbase.session.msgStatusCancelled'),
        tone: 'warning',
      })
      return items
    }

    if (lastError.value && !batchActive.value) {
      items.push(
        {
          key: 'status',
          label: t('modules.vastbase.session.msgStatus'),
          value: t('modules.vastbase.session.msgStatusError'),
          tone: 'error',
        },
        {
          key: 'error',
          label: t('modules.vastbase.session.msgError'),
          value: lastError.value,
          tone: 'error',
        },
      )
      return items
    }

    if (lastError.value && batchActive.value) {
      items.push({
        key: 'error',
        label: t('modules.vastbase.session.msgError'),
        value: lastError.value,
        tone: 'error',
      })
    }

    const res = summaryResult.value
    if (!batchActive.value && res) {
      items.push(
        {
          key: 'status',
          label: t('modules.vastbase.session.msgStatus'),
          value: t('modules.vastbase.session.msgStatusOk'),
          tone: 'success',
        },
        {
          key: 'duration',
          label: t('modules.vastbase.session.msgDuration'),
          value: t('modules.vastbase.session.msgDurationValue', { ms: res.durationMs }),
        },
        {
          key: 'rows',
          label: t('modules.vastbase.session.msgRows'),
          value: String(displayRowCount(res)),
        },
      )
      if (res.columns.length > 0) {
        items.push({
          key: 'cols',
          label: t('modules.vastbase.session.msgCols'),
          value: String(res.columns.length),
        })
      }
      if (res.commandTag?.trim()) {
        items.push({
          key: 'command',
          label: t('modules.vastbase.session.msgCommand'),
          value: res.commandTag.trim(),
        })
      }
      if (summaryHasMore.value) {
        items.push({
          key: 'hasMore',
          label: t('modules.vastbase.session.msgHasMore'),
          value: t('modules.vastbase.session.msgHasMoreYes'),
          tone: 'warning',
        })
      } else if (res.truncated) {
        items.push({
          key: 'truncated',
          label: t('modules.vastbase.session.msgTruncated'),
          value: t('modules.vastbase.session.msgTruncatedYes', {
            count: res.fetchedCount ?? res.rowCount,
          }),
          tone: 'warning',
        })
      }
    }

    notices.value.forEach((notice, index) => {
      items.push({
        key: `notice-${index}`,
        label: t('modules.vastbase.session.msgNotice'),
        value: notice,
      })
    })
    return items
  })
  const hasMessages = computed(() => messageItems.value.length > 0)
  const historyEntries = computed(() => history.value.slice(0, 20))

  /** 结果工具栏简要统计：行数 · 列数 · 耗时；批跑附加句数/结果页数 */
  const resultSummaryText = computed(() => {
    const res = summaryResult.value
    if (!res && !batchActive.value && gridTabs.value.length === 0) return ''
    if (batchActive.value && !res) {
      return t('modules.vastbase.session.batchProgress', {
        done: batchItems.value.filter((x) => x.status === 'ok' || x.status === 'error').length,
        total: batchItems.value.length,
      })
    }
    if (!res) return ''
    const n = displayRowCount(res)
    const rows = summaryHasMore.value ? `${n}+` : String(n)
    const base = t('modules.vastbase.session.resultSummary', {
      rows,
      cols: res.columns.length,
      ms: res.durationMs,
    })
    if (!batchActive.value && gridTabs.value.length <= 1) return base
    return `${t('modules.vastbase.session.batchResultHint', {
      n: batchItems.value.length || gridTabs.value.length,
      tabs: gridTabs.value.length,
    })} · ${base}`
  })

  const contextMenuItems = computed((): RsContextMenuItem[] =>
    buildSqlQueryContextMenuItems({
      labels: {
        run: t('modules.vastbase.session.run'),
        runSelection: t('modules.vastbase.session.runSelection'),
        cancel: t('modules.vastbase.session.cancel'),
        format: t('modules.vastbase.session.format'),
        compress: t('modules.vastbase.session.compress'),
        copy: t('modules.vastbase.session.copy'),
        paste: t('modules.vastbase.session.paste'),
        explain: t('modules.vastbase.session.explain'),
        explainAnalyze: t('modules.vastbase.session.explainAnalyze'),
        askAi: t('modules.vastbase.session.askAi'),
        exportCsv: t('modules.vastbase.session.exportCsv'),
        fetchMore: t('modules.vastbase.session.fetchMore'),
        fetchAll: t('modules.vastbase.session.fetchAll'),
      },
      running: running.value,
      cancelling: cancelling.value,
      hasSelection: editor.hasSelection.value,
      sqlEmpty: !sqlText.value.trim(),
      hasResultRows: resultRows.value.length > 0,
      hasMore: hasMore.value,
      loadingMore: loadingMore.value,
      showAskAi: true,
      showExplain: true,
    }),
  )

  const toolbarLabels = computed((): SqlQueryToolbarLabels => ({
    toolbarAria: t('modules.vastbase.session.sqlEditor'),
    format: t('modules.vastbase.session.format'),
    formatTooltip: t('modules.vastbase.session.formatTooltip'),
    explain: t('modules.vastbase.session.explain'),
    explainTooltip: t('modules.vastbase.session.explainTooltip'),
    explainAnalyze: t('modules.vastbase.session.explainAnalyze'),
    explainAnalyzeTooltip: t('modules.vastbase.session.explainAnalyzeTooltip'),
    run: t('modules.vastbase.session.run'),
    runSelection: t('modules.vastbase.session.runSelection'),
    runTooltip: t('modules.vastbase.session.runTooltip'),
    cancel: t('modules.vastbase.session.cancel'),
    cancelTooltip: t('modules.vastbase.session.cancelTooltip'),
    history: t('modules.vastbase.session.history'),
    historyEmpty: t('modules.vastbase.session.historyEmpty'),
    historyClear: t('modules.vastbase.session.historyClear'),
  }))

  function onContextMenuSelect(key: string): void {
    if (key === 'run') void runQuery()
    else if (key === 'cancel') void cancelQuery()
    else if (key === 'format') editor.formatSql()
    else if (key === 'compress') editor.compressSql()
    else if (key === 'copy') editor.copyEditor()
    else if (key === 'paste') void editor.pasteEditor()
    else if (key === 'explain') void runExplain(false)
    else if (key === 'explainAnalyze') void runExplain(true)
    else if (key === 'askAi') void askAiAboutSelection()
    else if (key === 'exportCsv') exportCsv()
    else if (key === 'fetchMore') void fetchMore()
    else if (key === 'fetchAll') void fetchAll()
  }

  async function askAiAboutSelection(): Promise<void> {
    const { executeCommand } = await import('@/extensions/contributions/command-registry')
    // 确保选区已同步进注册表（无选区时用整段 SQL）
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

  function pageLimit(): number {
    return props.feature === 'browse' ? 100 : 1000
  }

  async function closeResultSetQuiet(rsId: string | null | undefined): Promise<void> {
    const sid = props.sessionId
    if (!sid || !rsId) return
    try {
      await vastbaseApi.queryClose({ sessionId: sid, resultSetId: rsId })
    } catch {
      /* 会话已断等场景忽略 */
    }
  }

  async function closeOpenResultSet(): Promise<void> {
    const tab = activeGrid.value
    if (tab?.resultSetId) {
      await closeGridCursor(tab)
      return
    }
    await closeAllGridCursors()
  }

  function createRequestId(): string {
    return `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }

  function beginRun(): string {
    const requestId = createRequestId()
    activeRequestId.value = requestId
    running.value = true
    cancelling.value = false
    cancelled.value = false
    lastError.value = null
    clearDiagnostic(`diag:vast-explain:${props.profileId || 'session'}`)
    return requestId
  }

  /** 将 Explain 结果压成可 @ 的诊断文本（须在 pushGrid 清空 rows 前调用）。 */
  function summarizeExplainResult(
    result: VastQueryExecResult,
    sql: string,
    analyze: boolean,
  ): string {
    const header = `EXPLAIN${analyze ? ' ANALYZE' : ''}\nSQL:\n${sql.slice(0, 800)}\n\nPlan:`
    const colNames = result.columns.map((c) => c.name)
    const maxRows = 40
    const lines: string[] = []
    for (let i = 0; i < Math.min(result.rows.length, maxRows); i += 1) {
      const row = result.rows[i]
      if (!Array.isArray(row)) {
        lines.push(String(row))
        continue
      }
      if (colNames.length === 1) {
        lines.push(String(row[0] ?? ''))
        continue
      }
      lines.push(colNames.map((name, idx) => `${name}=${String(row[idx] ?? '')}`).join(' | '))
    }
    if (result.rows.length > maxRows) {
      lines.push(`… (${result.rows.length - maxRows} more rows)`)
    }
    if (result.durationMs != null) {
      lines.push(`\ndurationMs=${result.durationMs}`)
    }
    return `${header}\n${lines.join('\n')}`.slice(0, 4000)
  }

  function endRun(): void {
    running.value = false
    cancelling.value = false
    activeRequestId.value = null
  }

  function isCancelError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err ?? '')
    return /cancel|canceled|cancelled|context canceled|context cancelled|query_canceled|57014/i.test(
      msg,
    )
  }

  /** 共享 formatter，避免每列一个闭包 */
  function formatQueryCell(value: unknown): string {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  const resultColumns = computed((): RsTableColumn<VastQueryResultRow>[] => {
    const cols = activeGrid.value?.columns ?? []
    // 依赖主键 meta，PK tip 就绪后刷新 headerTip
    const pkReady = pkMetaReady.value
    const pkSet = pkReady ? new Set(pkColumns.value) : null
    if (cols.length === 0) {
      return [
        {
          key: 'value',
          title: t('modules.vastbase.session.colValue'),
          minWidth: 120,
          ellipsis: true,
        },
      ]
    }
    // 列头筛选/排序为结果表标配（筛选 Popover 默认 lazyMount，未打开时不挂载面板）
    return cols.map((c: VastQueryColumn) => {
      const tipLines = [t('modules.vastbase.session.colTipField', { name: c.name })]
      if (c.dataType) {
        tipLines.push(t('modules.vastbase.session.colTipType', { type: c.dataType }))
      }
      const isPk =
        typeof c.primaryKey === 'boolean'
          ? c.primaryKey
          : pkSet
            ? pkSet.has(c.name.toLowerCase())
            : undefined
      if (typeof isPk === 'boolean') {
        tipLines.push(
          t('modules.vastbase.session.colTipPrimary', {
            value: isPk
              ? t('modules.vastbase.session.colTipYes')
              : t('modules.vastbase.session.colTipNo'),
          }),
        )
      }
      if (typeof c.nullable === 'boolean') {
        tipLines.push(
          t('modules.vastbase.session.colTipNullable', {
            value: c.nullable
              ? t('modules.vastbase.session.colTipYes')
              : t('modules.vastbase.session.colTipNo'),
          }),
        )
      }
      const valueType = resolveSqlValueType(c.dataType)
      return {
        key: c.name,
        title: c.name,
        width: 120,
        minWidth: 96,
        ellipsis: true,
        sortable: true,
        filterable: true,
        align: alignForValueType(valueType),
        valueType,
        headerTip: tipLines.join('\n'),
        formatter: valueType === 'boolean' ? undefined : formatQueryCell,
      }
    })
  })

  const filterKeys = computed(() => resultColumns.value.map((c) => c.key))

  /** 粗略估算结果集字符串体量（仅日志用，不做 JSON.stringify 整包）。 */
  function estimateResultChars(result: VastQueryExecResult): number {
    let n = 0
    for (const row of result.rows) {
      for (const cell of row) {
        if (typeof cell === 'string') n += cell.length
        else if (cell !== null && cell !== undefined) n += 8
      }
    }
    return n
  }

  function mapResultRows(
    columns: readonly VastQueryColumn[],
    rows: unknown[][],
    startIndex: number,
  ): VastQueryResultRow[] {
    return rows.map((row, rowIdx) => {
      const obj: VastQueryResultRow = { __rowKey: String(startIndex + rowIdx) }
      columns.forEach((col, colIdx) => {
        obj[col.name] = row[colIdx]
      })
      return obj
    })
  }

  type PendingGridPush = {
    result: VastQueryExecResult
    stmtIndex: number
    sqlPreview: string
    sql?: string
  }

  /** Tab 失活期间返回的结果：切回后再映射挂表，避免后台同步重算卡 UI */
  const pendingRawResult = shallowRef<PendingGridPush | null>(null)

  function replaceGridTab(id: string, next: VastGridTab): void {
    const tabs = gridTabs.value.slice()
    const idx = tabs.findIndex((g) => g.id === id)
    if (idx < 0) return
    tabs[idx] = next
    gridTabs.value = tabs
  }

  async function closeGridCursor(tab: VastGridTab): Promise<void> {
    if (!tab.resultSetId) return
    await closeResultSetQuiet(tab.resultSetId)
    replaceGridTab(tab.id, { ...tab, resultSetId: null, hasMore: false })
  }

  async function closeAllGridCursors(): Promise<void> {
    const tabs = gridTabs.value
    if (tabs.length === 0) return
    await Promise.all(tabs.map((tab) => closeResultSetQuiet(tab.resultSetId)))
  }

  /** 打开游标过多时关闭最旧的（保留当前 active） */
  async function enforceOpenCursorBudget(keepId?: string): Promise<void> {
    let tabs = gridTabs.value
    while (countOpenCursors(tabs) >= MAX_OPEN_RESULT_CURSORS) {
      const victim = tabs.find(
        (g) => g.id !== keepId && g.resultSetId && g.hasMore,
      )
      if (!victim) break
      await closeResultSetQuiet(victim.resultSetId)
      tabs = tabs.map((g) =>
        g.id === victim.id ? { ...g, resultSetId: null, hasMore: false } : g,
      )
      gridTabs.value = tabs
    }
  }

  /** 结果 Tab 过多时丢掉最旧网格行（消息摘要仍在 batchItems） */
  async function enforceGridTabBudget(): Promise<void> {
    let tabs = gridTabs.value
    let dropped = 0
    const droppedIds: string[] = []
    while (tabs.length >= MAX_RESULT_GRID_TABS) {
      const victim = tabs[0]
      if (!victim) break
      await closeResultSetQuiet(victim.resultSetId)
      droppedIds.push(victim.id)
      tabs = tabs.slice(1)
      dropped += 1
      if (activePaneTab.value === victim.id) {
        activePaneTab.value = tabs[tabs.length - 1]?.id ?? 'messages'
      }
    }
    if (dropped > 0) {
      gridTabs.value = tabs
      if (batchItems.value.length > 0 && droppedIds.length > 0) {
        const gone = new Set(droppedIds)
        batchItems.value = batchItems.value.map((item) =>
          item.gridTabId && gone.has(item.gridTabId)
            ? { ...item, gridTabId: undefined, hasMore: false }
            : item,
        )
      }
      toast.info(t('modules.vastbase.session.batchTabsTrimmed', { n: dropped, max: MAX_RESULT_GRID_TABS }))
    }
  }

  function clearResultData(): void {
    void closeAllGridCursors()
    pendingRawResult.value = null
    gridTabs.value = []
    lastExecSummary.value = null
    activePaneTab.value = 'messages'
    loadingMore.value = false
    batchItems.value = []
    batchTotalMs.value = 0
  }

  function rememberExecSummary(result: VastQueryExecResult): void {
    lastExecSummary.value = {
      durationMs: result.durationMs,
      rowCount: result.rowCount,
      fetchedCount: result.fetchedCount,
      rowsAffected: result.rowsAffected,
      commandTag: result.commandTag,
      notices: result.notices,
      columnCount: result.columns?.length ?? 0,
      truncated: result.truncated,
      hasMore: result.hasMore,
    }
  }

  async function enrichGridColumnsFromMeta(tabId: string, sql: string): Promise<void> {
    if (!props.sessionId) return
    const ref = resolveMetaRelation(sql)
    if (!ref) return
    const tab = gridTabs.value.find((g) => g.id === tabId)
    if (!tab || tab.columns.length === 0) return

    try {
      const { columns: metaCols, pkColumns: pkCols } = await loadRelationColumnMeta(ref)
      const metaByName = new Map(metaCols.map((c) => [c.name.toLowerCase(), c]))
      const pkSet = new Set(pkCols.map((c) => c.toLowerCase()))

      const latest = gridTabs.value.find((g) => g.id === tabId)
      if (!latest) return

      const merged = latest.columns.map((col): VastQueryColumn => {
        const meta = metaByName.get(col.name.toLowerCase())
        if (!meta) return col
        return {
          ...col,
          dataType: meta.dataType || col.dataType,
          nullable: meta.nullable,
          primaryKey: pkSet.has(col.name.toLowerCase()),
        }
      })

      replaceGridTab(tabId, { ...latest, columns: merged })
      pkColumns.value = pkCols
      pkMetaReady.value = true
    } catch (e) {
      if (import.meta.env.DEV) {
        console.warn('[VastQuery] column meta enrich failed', ref, e)
      }
    }
  }

  function resolveMetaRelation(sql: string): ParsedFromRelation | null {
    const defaultSchema = props.schema?.trim() || 'public'
    const parsed = parsePrimaryFromRelation(sql, props.database, defaultSchema)
    if (parsed) return parsed
    const table = props.table?.trim()
    if (table) return { schema: defaultSchema, table }
    return null
  }

  async function loadRelationColumnMeta(ref: ParsedFromRelation): Promise<{
    columns: VastColumnInfo[]
    pkColumns: string[]
  }> {
    const schemas = [
      ...new Set(
        [ref.schema, props.schema?.trim(), 'public'].filter(
          (s): s is string => typeof s === 'string' && s.length > 0,
        ),
      ),
    ]
    let lastErr: unknown
    for (const schema of schemas) {
      try {
        const params = {
          sessionId: props.sessionId!,
          database: props.database,
          schema,
          name: ref.table,
          table: ref.table,
        }
        const colsRes = await vastbaseApi.metaColumns(params)
        const columns = colsRes.columns ?? []
        if (columns.length === 0) continue

        let pkColumns: string[] = []
        try {
          const pkRes = await vastbaseApi.metaPrimaryKey(params)
          pkColumns = pkRes.columns ?? []
        } catch (pkErr) {
          if (import.meta.env.DEV) {
            console.warn('[VastQuery] primary key meta failed', { schema, table: ref.table }, pkErr)
          }
        }
        return { columns, pkColumns }
      } catch (e) {
        lastErr = e
      }
    }
    throw lastErr ?? new Error('column meta not found')
  }

  async function pushGridFromResult(
    result: VastQueryExecResult,
    opts: { stmtIndex: number; sqlPreview: string; sql?: string; activate?: boolean },
  ): Promise<VastGridTab | null> {
    if (!props.active) {
      pendingRawResult.value = {
        result,
        stmtIndex: opts.stmtIndex,
        sqlPreview: opts.sqlPreview,
        sql: opts.sql,
      }
      return null
    }
    pendingRawResult.value = null

    const approxChars = mem.enabled ? estimateResultChars(result) : undefined
    const mapped = mapResultRows(result.columns, result.rows, 0)
    result.rows = []
    const fetchedCount = result.fetchedCount ?? mapped.length
    const keepCursor = Boolean(result.hasMore && result.resultSetId)

    await enforceGridTabBudget()
    await enforceOpenCursorBudget()

    const tab: VastGridTab = {
      id: createGridTabId(opts.stmtIndex),
      stmtIndex: opts.stmtIndex,
      ordinal: gridTabs.value.length + 1,
      sqlPreview: opts.sqlPreview,
      columns: result.columns,
      rows: mapped,
      resultSetId: keepCursor ? result.resultSetId! : null,
      hasMore: keepCursor,
      truncated: result.truncated,
      durationMs: result.durationMs,
      fetchedCount,
      rowCount: mapped.length,
      commandTag: result.commandTag,
      notices: result.notices,
      requestId: result.requestId,
    }

    if (!keepCursor && result.resultSetId) {
      await closeResultSetQuiet(result.resultSetId)
    }

    await nextTick()
    gridTabs.value = [...gridTabs.value, tab]
    if (opts.activate !== false) {
      activePaneTab.value = tab.id
    }

    mem.log('result', {
      rows: mapped.length,
      cols: result.columns.length,
      approxChars,
      virtualScroll: mapped.length >= 40,
      hasMore: tab.hasMore,
      requestId: result.requestId,
      durationMs: result.durationMs,
      gridTabs: gridTabs.value.length,
      stmtIndex: opts.stmtIndex,
    })
    const enrichSql = opts.sql?.trim()
    if (enrichSql) {
      await enrichGridColumnsFromMeta(tab.id, enrichSql)
    }
    return gridTabs.value.find((g) => g.id === tab.id) ?? tab
  }

  /** 单结果路径兼容：清空后推一个 Tab */
  async function applyQueryResult(result: VastQueryExecResult): Promise<void> {
    await closeAllGridCursors()
    gridTabs.value = []
    await pushGridFromResult(result, {
      stmtIndex: 0,
      sqlPreview: previewSql(editor.resolveSql() || 'SQL'),
      sql: editor.resolveSql() || undefined,
    })
  }

  function appendFetchRows(
    rows: unknown[][],
    meta: {
      fetchedCount: number
      hasMore: boolean
      resultSetId?: string
      truncated?: boolean
      commandTag?: string
    },
  ): void {
    const tab = activeGrid.value
    if (!tab || tab.columns.length === 0) return
    const startIndex = tab.rows.length
    const mapped = mapResultRows(tab.columns, rows, startIndex)
    const keepCursor = Boolean(meta.hasMore && meta.resultSetId)
    replaceGridTab(tab.id, {
      ...tab,
      rows: tab.rows.concat(mapped),
      rowCount: startIndex + mapped.length,
      fetchedCount: meta.fetchedCount,
      hasMore: keepCursor,
      resultSetId: keepCursor ? meta.resultSetId! : null,
      truncated: meta.truncated,
      commandTag: meta.commandTag ?? tab.commandTag,
    })
  }

  async function refreshPrimaryKeys(): Promise<void> {
    if (!props.sessionId || !props.schema || !props.table) {
      pkColumns.value = []
      pkMetaReady.value = false
      return
    }
    try {
      const pk = await vastbaseApi.metaPrimaryKey({
        sessionId: props.sessionId,
        database: props.database,
        schema: props.schema,
        name: props.table,
      })
      pkColumns.value = pk.columns ?? []
      pkMetaReady.value = true
    } catch {
      pkColumns.value = []
      pkMetaReady.value = false
    }
  }

  function historyPreview(sql: string): string {
    const preview = sql.replace(/\s+/g, ' ').slice(0, 72)
    return sql.length > 72 ? `${preview}…` : preview
  }

  function refreshHistory(): void {
    history.value = props.profileId ? loadSqlHistory(props.profileId) : []
  }

  function onHistoryPick(id: string): void {
    historyOpen.value = false
    if (id === '__clear') {
      if (props.profileId) clearSqlHistory(props.profileId)
      refreshHistory()
      return
    }
    const entry = history.value.find((e) => e.id === id)
    if (entry) sqlText.value = entry.sql
  }

  function applySeed(): boolean {
    if (props.initialSql?.trim()) {
      sqlText.value = props.initialSql
      return Boolean(props.autoRunInitialSql)
    }
    const seed = seedSqlForFeature(props.feature, {
      database: props.database,
      schema: props.schema,
      table: props.table,
      routine: props.routine,
      routineKind: props.routineKind,
      args: props.args,
      oid: props.oid,
    })
    sqlText.value = seed.sql
    return seed.autoRun
  }

  async function runQuery(): Promise<void> {
    // 禁止并发：执行中忽略重入（快捷键 / 连点）；批跑句间亦严格 await 顺序 exec
    if (running.value) return
    if (!props.sessionId) {
      lastError.value = t('modules.vastbase.session.notConnected')
      cancelled.value = false
      activePaneTab.value = 'messages'
      return
    }
    const sql = editor.resolveSql()
    if (!sql) {
      lastError.value = t('modules.vastbase.session.emptySql')
      cancelled.value = false
      activePaneTab.value = 'messages'
      return
    }

    const slices = splitSqlStatementsWithFeatures(
      sql,
      resolveSplitFeaturesFromProfile(dialectProfile()),
    )
    if (slices.length === 0) {
      lastError.value = t('modules.vastbase.session.emptySql')
      activePaneTab.value = 'messages'
      return
    }
    if (slices.length > MAX_BATCH_STATEMENTS) {
      lastError.value = t('modules.vastbase.session.batchTooMany', {
        max: MAX_BATCH_STATEMENTS,
        count: slices.length,
      })
      activePaneTab.value = 'messages'
      return
    }

    await closeAllGridCursors()
    gridTabs.value = []
    batchItems.value = []
    batchTotalMs.value = 0
    activePaneTab.value = 'messages'
    const batchId = beginRun()
    const startedAt = performance.now()
    const isBatch = slices.length > 1

    if (isBatch) {
      batchItems.value = slices.map((s, index) => ({
        index,
        sqlPreview: previewSql(s.sql),
        status: 'pending' as const,
      }))
    }

    let lastGridTab: VastGridTab | null = null
    let stopReason: 'ok' | 'error' | 'cancel' = 'ok'

    try {
      for (let i = 0; i < slices.length; i++) {
        if (cancelled.value) {
          stopReason = 'cancel'
          for (let j = i; j < slices.length; j++) {
            const cur = batchItems.value[j]
            if (cur) cur.status = j === i ? 'cancelled' : 'skipped'
          }
          batchItems.value = batchItems.value.slice()
          break
        }

        const slice = slices[i]!
        const execSql = prepareDialectExecSql(slice.sql, {
          stripOracleSlash: hasCapability(dialectProfile(), Cap.ScriptOracleSlash),
        })
        if (!execSql) {
          if (isBatch) {
            const cur = batchItems.value[i]
            if (cur) {
              cur.status = 'skipped'
              cur.error = t('modules.vastbase.session.emptySql')
            }
            batchItems.value = batchItems.value.slice()
          }
          continue
        }
        const requestId = isBatch ? `${batchId}-${i}` : batchId
        activeRequestId.value = requestId

        if (isBatch) {
          const cur = batchItems.value[i]
          if (cur) cur.status = 'running'
          batchItems.value = batchItems.value.slice()
        }

        try {
          const result = await vastbaseApi.queryExec({
            sessionId: props.sessionId,
            database: props.database,
            sql: execSql,
            limit: pageLimit(),
            requestId,
          })

          if (cancelled.value) {
            await closeResultSetQuiet(result.resultSetId)
            stopReason = 'cancel'
            if (isBatch) {
              const cur = batchItems.value[i]
              if (cur) cur.status = 'cancelled'
              for (let j = i + 1; j < slices.length; j++) {
                const next = batchItems.value[j]
                if (next) next.status = 'skipped'
              }
              batchItems.value = batchItems.value.slice()
            } else {
              clearResultData()
              activePaneTab.value = 'messages'
            }
            break
          }

          const hasGrid = resultHasGrid(result.columns)
          let gridTabId: string | undefined
          rememberExecSummary(result)

          if (hasGrid) {
            const tab = await pushGridFromResult(result, {
              stmtIndex: i,
              sqlPreview: previewSql(slice.sql),
              sql: slice.sql,
              // 批跑过程中留在消息页看进度，结束后再切到结果 Tab
              activate: !isBatch,
            })
            if (tab) {
              lastGridTab = tab
              gridTabId = tab.id
              if (!isBatch) filterText.value = ''
            }
          } else {
            await closeResultSetQuiet(result.resultSetId)
            if (!isBatch) {
              activePaneTab.value = 'messages'
            }
          }

          if (isBatch) {
            const live = gridTabId
              ? gridTabs.value.find((g) => g.id === gridTabId)
              : undefined
            batchItems.value[i] = {
              index: i,
              sqlPreview: previewSql(slice.sql),
              status: 'ok',
              durationMs: result.durationMs,
              rowCount: result.fetchedCount ?? result.rowCount,
              hasMore: Boolean(live?.hasMore),
              commandTag: result.commandTag,
              hasGrid,
              gridTabId: live?.id,
            }
            batchItems.value = batchItems.value.slice()
          }

          if (!isBatch) {
            if (props.profileId) {
              history.value = pushSqlHistory(props.profileId, sql, {
                durationMs: result.durationMs,
                rowCount: result.fetchedCount ?? result.rowCount,
              })
            }
            if (lastGridTab?.hasMore) {
              toast.info(
                t('modules.vastbase.session.hasMoreHint', {
                  count: lastGridTab.fetchedCount,
                }),
              )
            } else if (result.truncated) {
              toast.info(
                t('modules.vastbase.session.truncatedCap', {
                  count: result.fetchedCount ?? result.rowCount,
                }),
              )
            } else if (!hasGrid) {
              // INSERT/UPDATE/DELETE/DDL：无结果网格，用 commandTag 给明确反馈
              const tag = result.commandTag?.trim()
              toast.success(
                tag
                  ? t('modules.vastbase.session.resultMeta', {
                      rows: displayRowCount(result),
                      ms: result.durationMs,
                      tag,
                    })
                  : t('modules.vastbase.session.msgStatusOk'),
              )
            }
          }
        } catch (e) {
          if (cancelled.value || isCancelError(e)) {
            stopReason = 'cancel'
            cancelled.value = true
            if (isBatch) {
              const cur = batchItems.value[i]
              if (cur) cur.status = 'cancelled'
              for (let j = i + 1; j < slices.length; j++) {
                const next = batchItems.value[j]
                if (next) next.status = 'skipped'
              }
              batchItems.value = batchItems.value.slice()
            } else {
              clearResultData()
              lastError.value = null
              activePaneTab.value = 'messages'
            }
            break
          }

          const errMsg =
            e instanceof Error ? e.message : t('modules.vastbase.session.runError')
          stopReason = 'error'
          lastError.value = errMsg
          if (isBatch) {
            batchItems.value[i] = {
              index: i,
              sqlPreview: previewSql(slice.sql),
              status: 'error',
              error: errMsg,
            }
            for (let j = i + 1; j < slices.length; j++) {
              const next = batchItems.value[j]
              if (next) next.status = 'skipped'
            }
            batchItems.value = batchItems.value.slice()
            activePaneTab.value = 'messages'
          } else {
            clearResultData()
            activePaneTab.value = 'messages'
          }
          break
        }

        if (isBatch) await yieldToEventLoop()
      }

      batchTotalMs.value = Math.round(performance.now() - startedAt)

      if (isBatch && stopReason !== 'cancel') {
        if (props.profileId) {
          const okItems = batchItems.value.filter((x) => x.status === 'ok')
          const lastOk = okItems[okItems.length - 1]
          history.value = pushSqlHistory(props.profileId, sql, {
            durationMs: batchTotalMs.value,
            rowCount: lastOk?.rowCount,
          })
        }
        if (lastGridTab) {
          activePaneTab.value = lastGridTab.id
          filterText.value = ''
        } else {
          activePaneTab.value = 'messages'
        }
        mem.log('batch', {
          statements: slices.length,
          ok: batchItems.value.filter((x) => x.status === 'ok').length,
          fail: batchItems.value.filter((x) => x.status === 'error').length,
          totalMs: batchTotalMs.value,
          gridTabs: gridTabs.value.length,
        })
      }
    } finally {
      endRun()
    }
  }

  async function fetchMore(): Promise<void> {
    const tab = activeGrid.value
    if (!props.sessionId || !tab?.resultSetId || !tab.hasMore || loadingMore.value || running.value) {
      return
    }
    loadingMore.value = true
    const tabId = tab.id
    try {
      const page = await vastbaseApi.queryFetch({
        sessionId: props.sessionId,
        resultSetId: tab.resultSetId,
        limit: pageLimit(),
      })
      if (activePaneTab.value !== tabId) {
        // 用户已切走：仍更新对应 Tab
        const target = gridTabs.value.find((g) => g.id === tabId)
        if (target) {
          const mapped = mapResultRows(target.columns, page.rows, target.rows.length)
          const keepCursor = Boolean(page.hasMore && page.resultSetId)
          replaceGridTab(tabId, {
            ...target,
            rows: target.rows.concat(mapped),
            rowCount: target.rows.length + mapped.length,
            fetchedCount: page.fetchedCount,
            hasMore: keepCursor,
            resultSetId: keepCursor ? page.resultSetId! : null,
            truncated: page.truncated,
            commandTag: page.commandTag ?? target.commandTag,
          })
        }
      } else {
        appendFetchRows(page.rows, {
          fetchedCount: page.fetchedCount,
          hasMore: page.hasMore,
          resultSetId: page.resultSetId,
          truncated: page.truncated,
          commandTag: page.commandTag,
        })
      }
      if (page.truncated) {
        toast.info(
          t('modules.vastbase.session.truncatedCap', { count: page.fetchedCount }),
        )
      }
    } catch (e) {
      const cur = gridTabs.value.find((g) => g.id === tabId)
      if (cur) replaceGridTab(tabId, { ...cur, hasMore: false, resultSetId: null })
      toast.error(e instanceof Error ? e.message : t('modules.vastbase.session.fetchError'))
    } finally {
      loadingMore.value = false
    }
  }

  /** 连续续取直至耗尽或触达软上限（对标 DBeaver Fetch all）。 */
  async function fetchAll(): Promise<void> {
    const tab = activeGrid.value
    if (!props.sessionId || !tab?.resultSetId || !tab.hasMore || loadingMore.value || running.value) {
      return
    }
    loadingMore.value = true
    const tabId = tab.id
    try {
      while (props.sessionId) {
        const cur = gridTabs.value.find((g) => g.id === tabId)
        if (!cur?.hasMore || !cur.resultSetId) break
        const page = await vastbaseApi.queryFetch({
          sessionId: props.sessionId,
          resultSetId: cur.resultSetId,
          limit: pageLimit(),
        })
        const mapped = mapResultRows(cur.columns, page.rows, cur.rows.length)
        const keepCursor = Boolean(page.hasMore && page.resultSetId)
        replaceGridTab(tabId, {
          ...cur,
          rows: cur.rows.concat(mapped),
          rowCount: cur.rows.length + mapped.length,
          fetchedCount: page.fetchedCount,
          hasMore: keepCursor,
          resultSetId: keepCursor ? page.resultSetId! : null,
          truncated: page.truncated,
          commandTag: page.commandTag ?? cur.commandTag,
        })
        if (page.truncated) {
          toast.info(
            t('modules.vastbase.session.truncatedCap', { count: page.fetchedCount }),
          )
          break
        }
        if (!page.hasMore) break
      }
    } catch (e) {
      const cur = gridTabs.value.find((g) => g.id === tabId)
      if (cur) replaceGridTab(tabId, { ...cur, hasMore: false, resultSetId: null })
      toast.error(e instanceof Error ? e.message : t('modules.vastbase.session.fetchError'))
    } finally {
      loadingMore.value = false
    }
  }

  async function runExplain(analyze: boolean): Promise<void> {
    if (running.value) return
    if (!props.sessionId) {
      lastError.value = t('modules.vastbase.session.notConnected')
      cancelled.value = false
      activePaneTab.value = 'messages'
      return
    }
    const sql = prepareDialectExecSql(editor.resolveSql(), {
      stripOracleSlash: hasCapability(dialectProfile(), Cap.ScriptOracleSlash),
    })
    if (!sql) {
      lastError.value = t('modules.vastbase.session.emptySql')
      cancelled.value = false
      activePaneTab.value = 'messages'
      return
    }
    await closeAllGridCursors()
    gridTabs.value = []
    const requestId = beginRun()
    try {
      const result = await vastbaseApi.queryExplain({
        sessionId: props.sessionId,
        database: props.database,
        sql,
        analyze,
        requestId,
      })
      if (cancelled.value) {
        clearResultData()
        activePaneTab.value = 'messages'
        return
      }
      const explainText = summarizeExplainResult(result, sql, analyze)
      publishDiagnostic({
        id: `diag:vast-explain:${props.profileId || 'session'}`,
        label: analyze ? 'EXPLAIN ANALYZE' : 'EXPLAIN',
        detail: previewSql(sql),
        text: explainText,
        tabId: useTabStore().activeTabId || undefined,
        kind: analyze ? 'explain_analyze' : 'explain',
      })
      await pushGridFromResult(result, {
        stmtIndex: 0,
        sqlPreview: previewSql(sql),
        sql,
      })
      filterText.value = ''
    } catch (e) {
      clearResultData()
      activePaneTab.value = 'messages'
      if (cancelled.value || isCancelError(e)) {
        cancelled.value = true
        lastError.value = null
        return
      }
      lastError.value =
        e instanceof Error ? e.message : t('modules.vastbase.session.explainError')
    } finally {
      endRun()
    }
  }

  function selectResultTab(id: VastResultPaneTabId): void {
    activePaneTab.value = id
  }

  /**
   * 关闭结果 Tab：同步 `query.close` 释放服务端游标（含「加载更多」未取完的），无需手动关。
   */
  async function closeResultGridTab(id: string): Promise<void> {
    const idx = gridTabs.value.findIndex((g) => g.id === id)
    if (idx < 0) return
    const tab = gridTabs.value[idx]!
    await closeResultSetQuiet(tab.resultSetId)

    const nextTabs = gridTabs.value.filter((g) => g.id !== id)
    // 重排展示序号
    gridTabs.value = nextTabs.map((g, i) => ({ ...g, ordinal: i + 1 }))

    if (batchItems.value.length > 0) {
      batchItems.value = batchItems.value.map((item) =>
        item.gridTabId === id ? { ...item, gridTabId: undefined, hasMore: false } : item,
      )
    }

    if (activePaneTab.value === id) {
      const neighbor = nextTabs[idx] ?? nextTabs[idx - 1] ?? null
      activePaneTab.value = neighbor?.id ?? 'messages'
    }
  }

  function resolveGridTabForBatchItem(stmt: BatchStatementItem): VastGridTab | null {
    if (stmt.gridTabId) {
      const byId = gridTabs.value.find((g) => g.id === stmt.gridTabId)
      if (byId) return byId
    }
    return gridTabs.value.find((g) => g.stmtIndex === stmt.index) ?? null
  }

  function batchItemOpenable(stmt: BatchStatementItem): boolean {
    return Boolean(resolveGridTabForBatchItem(stmt))
  }

  function openBatchGrid(stmt: BatchStatementItem): void {
    const tab = resolveGridTabForBatchItem(stmt)
    if (!tab) return
    if (stmt.gridTabId !== tab.id) {
      const idx = batchItems.value.findIndex((x) => x.index === stmt.index)
      if (idx >= 0) {
        batchItems.value[idx] = { ...batchItems.value[idx]!, gridTabId: tab.id }
        batchItems.value = batchItems.value.slice()
      }
    }
    activePaneTab.value = tab.id
  }

  async function cancelQuery(): Promise<void> {
    if (!props.sessionId || !running.value || cancelling.value) return
    cancelling.value = true
    cancelled.value = true
    try {
      await vastbaseApi.queryCancel({
        sessionId: props.sessionId,
        requestId: activeRequestId.value ?? undefined,
      })
    } catch (e) {
      cancelled.value = false
      toast.error(e instanceof Error ? e.message : t('modules.vastbase.session.cancelError'))
      cancelling.value = false
    }
  }

  function exportCsv(): void {
    const grid = activeGrid.value
    if (!grid || grid.rows.length === 0) {
      toast.info(t('modules.vastbase.session.noResult'))
      return
    }
    const base = props.database || 'query'
    const jagged = grid.rows.map((row) => grid.columns.map((c) => row[c.name]))
    exportQueryResultAsCsv(grid.columns, jagged, `${base}-${Date.now()}`)
  }

  watch(
    () =>
      [
        props.sessionId,
        props.feature,
        props.database,
        props.schema,
        props.table,
        props.routine,
        props.routineKind,
        props.initialSql,
        props.autoRunInitialSql,
        props.profileId,
      ] as const,
    async () => {
      // 勿把 active 放进依赖：切 Shell Tab 失活/激活不应清空结果或 autoRun
      if (!props.sessionId) return
      refreshHistory()
      void refreshPrimaryKeys()
      editor.refreshSuggestScope()
      clearResultData()
      lastError.value = null
      cancelled.value = false
      filterText.value = ''
      activePaneTab.value = 'messages'
      const shouldAutoRun = applySeed()
      if (shouldAutoRun) {
        await runQuery()
      }
    },
    { immediate: true },
  )

  watch(
    lastError,
    (err) => {
      const diagId = `diag:vast-query:${props.profileId || 'session'}`
      if (!err?.trim()) {
        clearDiagnostic(diagId)
        return
      }
      publishDiagnostic({
        id: diagId,
        label: err.length > 48 ? `${err.slice(0, 48)}…` : err,
        detail: 'query error',
        text: err,
        tabId: useTabStore().activeTabId || undefined,
        kind: 'query_error',
      })
    },
  )

  watch(
    () => props.active,
    (active) => {
      void editor.onActiveChange(active)
      if (active && pendingRawResult.value) {
        const pending = pendingRawResult.value
        pendingRawResult.value = null
        void pushGridFromResult(pending.result, {
          stmtIndex: pending.stmtIndex,
          sqlPreview: pending.sqlPreview,
          sql: pending.sql,
        })
      }
    },
    { immediate: true },
  )

  const resultPanelLabels = computed((): QueryResultPanelLabels => ({
    batchResultTab: (n) => t('modules.vastbase.session.batchResultTab', { n }),
    tabRowCount: (n, hasMore) =>
      `${t('modules.vastbase.session.tabRows', { n })}${hasMore ? '+' : ''}`,
    messages: t('modules.vastbase.session.messages'),
    closeResultTab: t('modules.vastbase.session.closeResultTab'),
    filterPlaceholder: t('modules.vastbase.session.filterPlaceholder'),
    loadMore: t('modules.vastbase.session.fetchMore'),
    fetchAll: t('modules.vastbase.session.fetchAll'),
    exportCsv: t('modules.vastbase.session.exportCsv'),
    messagesEmpty: t('modules.vastbase.session.messagesEmpty'),
    emptyResult: t('modules.vastbase.session.noResult'),
    resultEmpty: t('modules.vastbase.session.resultEmpty'),
    batchStmtLabel: (n) => t('modules.vastbase.session.batchStmtLabel', { n }),
    batchStmtSkipped: t('modules.vastbase.session.batchStmtSkipped'),
    batchStmtRunning: t('modules.vastbase.session.batchStmtRunning'),
    batchStmtPending: t('modules.vastbase.session.batchStmtPending'),
    batchOpenResult: t('modules.vastbase.session.batchOpenResult'),
    msgOk: t('modules.vastbase.session.msgStatusOk'),
    msgError: t('modules.vastbase.session.msgStatusError'),
    cancelled: t('modules.vastbase.session.msgStatusCancelled'),
    logColStatus: t('modules.vastbase.session.logColStatus'),
    logColTime: t('modules.vastbase.session.logColTime'),
    logColRows: t('modules.vastbase.session.logColRows'),
    copyMessage: t('modules.vastbase.session.copyMessage'),
    copiedHint: t('modules.vastbase.session.copiedHint'),
  }))

  return {
    t,
    sqlText,
    running,
    cancelling,
    lastResult,
    lastError,
    historyOpen,
    resultTab,
    activePaneTab,
    gridTabs,
    batchItems,
    batchActive,
    batchTotalMs,
    filterText,
    scopeLabel,
    identityTitle,
    featureIcon,
    featureLabelKey,
    messageItems,
    hasMessages,
    resultSummaryText,
    resultPanelLabels,
    historyEntries,
    contextMenuItems,
    toolbarLabels,
    resultColumns,
    resultRows,
    filterKeys,
    hasMore,
    loadingMore,
    editorRef: editor.editorRef,
    hasSelection: editor.hasSelection,
    languageReady: editor.languageReady,
    sqlLanguage: editor.sqlLanguage,
    formatSql: editor.formatSql,
    compressSql: editor.compressSql,
    historyPreview,
    onHistoryPick,
    onContextMenuSelect,
    selectResultTab,
    closeResultGridTab,
    openBatchGrid,
    batchItemOpenable,
    runQuery,
    runExplain,
    cancelQuery,
    fetchMore,
    fetchAll,
    exportCsv,
  }
}

/** 供模板 toRefs / 解构时保持 Ref 类型提示 */
export type VastQueryPaneApi = ReturnType<typeof useVastQueryPane>
