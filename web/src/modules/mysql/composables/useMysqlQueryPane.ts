import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRsToast, type RsContextMenuItem, type RsTableColumn } from '@niuma/ui'
import { mysqlApi } from '@/api'
import type { MysqlColumnInfo, MysqlQueryColumn, MysqlQueryExecResult } from '@/api/types/mysql'
import {
  defaultMySQLProfile,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import { useMysqlSqlEditor } from '@/modules/mysql/composables/useMysqlSqlEditor'
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
  extractMysqlTypeLength,
  formatMysqlColumnTypeLabel,
} from '@/modules/mysql/utils/column-type-label'
import { exportQueryResultAsCsv } from '@/modules/mysql/utils/export-csv'
import { parsePrimaryMysqlRelation } from '@/modules/mysql/utils/parse-query-relation'
import {
  MAX_BATCH_STATEMENTS,
  MAX_OPEN_RESULT_CURSORS,
  MAX_RESULT_GRID_TABS,
  previewSql,
  resultHasGrid,
  yieldToEventLoop,
  type BatchStatementItem,
} from '@/modules/mysql/utils/query-batch'
import {
  countOpenCursors,
  createGridTabId,
  mapResultRows,
  type MysqlGridTab,
  type MysqlResultPaneTabId,
} from '@/modules/mysql/utils/query-result-tabs'
import { useSessionRegistry } from '@/stores/session-registry'

export type MysqlQueryPaneProps = {
  sessionId: string | null
  profileId?: string
  database?: string
  initialSql?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
  active?: boolean
}

export type MysqlQueryMessageItem = QueryResultMessageItem

const PAGE_LIMIT = 1000

export function useMysqlQueryPane(props: MysqlQueryPaneProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const sessionRegistry = useSessionRegistry()

  const sqlText = ref(props.initialSql?.trim() || 'SELECT 1;\n')
  const running = ref(false)
  const cancelling = ref(false)
  const cancelled = ref(false)
  const loadingMore = ref(false)
  const filterText = ref('')
  const activePaneTab = ref<MysqlResultPaneTabId>('messages')
  const lastError = ref<string | null>(null)
  const lastExecSummary = ref('')
  const activeRequestId = ref<string | null>(null)
  const gridTabs = shallowRef<MysqlGridTab[]>([])
  const batchItems = shallowRef<BatchStatementItem[]>([])
  const batchTotalMs = ref(0)
  const autoCommit = ref(true)
  const inTransaction = ref(false)
  const txBusy = ref(false)

  function dialectProfile() {
    if (!props.sessionId) return defaultMySQLProfile()
    return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultMySQLProfile()
  }

  const editor = useMysqlSqlEditor({
    sqlText,
    active: () => props.active !== false,
    onRun: () => {
      void runSql()
    },
    getDialect: () => dialectProfile(),
    getSuggestScope: () => {
      if (!props.sessionId) return null
      const db = props.database?.trim() || undefined
      return {
        sessionId: props.sessionId,
        database: db,
        schema: db,
      }
    },
  })

  const {
    historyOpen,
    historyEntries,
    rememberSql,
    onHistoryPick,
  } = useSqlQueryHistory({
    profileId: () => props.profileId,
    storagePrefix: 'niuma.mysql.sqlHistory.',
    sqlText,
  })

  const identityTitle = computed(() => {
    const parts = [props.sessionLabel || 'MySQL']
    if (props.database?.trim()) parts.push(props.database.trim())
    // tooltip 保留完整上下文；工具栏左侧只展示库名，避免与 Shell tab 标题重复
    return parts.join(' · ')
  })

  const batchActive = computed(() => batchItems.value.length > 1)

  const activeGrid = computed((): MysqlGridTab | null => {
    const id = activePaneTab.value
    if (id === 'messages') return null
    return gridTabs.value.find((g) => g.id === id) ?? null
  })

  const summaryGrid = computed(
    (): MysqlGridTab | null => activeGrid.value ?? gridTabs.value[gridTabs.value.length - 1] ?? null,
  )

  const yesNo = (v: boolean) =>
    v ? t('modules.mysql.query.colTipYes') : t('modules.mysql.query.colTipNo')

  const resultColumns = computed((): RsTableColumn[] => {
    const cols = activeGrid.value?.columns ?? []
    // 列头筛选/排序 + headerTip（字段/类型/主键/可空），对齐 Vastbase
    return cols.map((c, i) => {
      const name = c.name || `col${i + 1}`
      const tipLines = [t('modules.mysql.query.colTipField', { name })]
      {
        const typeLabel = formatMysqlColumnTypeLabel(c.dataType, undefined, {
          length: c.length,
          precision: c.precision,
          scale: c.scale,
        })
        if (typeLabel) {
          tipLines.push(t('modules.mysql.query.colTipType', { type: typeLabel }))
        }
      }
      if (typeof c.primaryKey === 'boolean') {
        tipLines.push(t('modules.mysql.query.colTipPrimary', { value: yesNo(c.primaryKey) }))
      }
      if (typeof c.nullable === 'boolean') {
        tipLines.push(t('modules.mysql.query.colTipNullable', { value: yesNo(c.nullable) }))
      }
      const valueType = resolveSqlValueType(c.dataType, {
        length:
          typeof c.length === 'number' ? c.length : extractMysqlTypeLength(c.dataType),
      })
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

  const resultRows = computed(() => activeGrid.value?.rows ?? [])

  const filterKeys = computed(() => resultColumns.value.map((c) => String(c.key)))

  const hasMore = computed(() =>
    Boolean(activeGrid.value?.hasMore && activeGrid.value?.resultSetId),
  )

  const resultSummaryText = computed(() => {
    if (running.value && batchActive.value) {
      const done = batchItems.value.filter((x) => x.status === 'ok' || x.status === 'error').length
      return t('modules.mysql.query.batchProgress', {
        done,
        total: batchItems.value.length,
      })
    }
    if (batchActive.value && !running.value) {
      return t('modules.mysql.query.batchResultHint', {
        n: batchItems.value.length,
        tabs: gridTabs.value.length,
      })
    }
    const grid = summaryGrid.value
    if (grid) {
      return t('modules.mysql.query.resultSummary', {
        rows: grid.rowCount,
        cols: grid.columns.length,
        ms: grid.durationMs,
      })
    }
    if (lastError.value) return t('modules.mysql.query.execFailed')
    if (lastExecSummary.value) return lastExecSummary.value
    return ''
  })

  const messageItems = computed((): MysqlQueryMessageItem[] => {
    const items: MysqlQueryMessageItem[] = []
    if (lastError.value) {
      items.push({
        key: 'error',
        label: t('modules.mysql.query.msgError'),
        value: lastError.value,
        tone: 'error',
      })
    }
    if (batchActive.value) {
      const ok = batchItems.value.filter((x) => x.status === 'ok').length
      const fail = batchItems.value.filter((x) => x.status === 'error').length
      items.push({
        key: 'batch-summary',
        label: t('modules.mysql.query.batchLabel'),
        value: t('modules.mysql.query.batchSummary', {
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
        label: t('modules.mysql.query.msgOk'),
        value: lastExecSummary.value,
        tone: 'success',
      })
    }
    const grid = summaryGrid.value
    if (grid) {
      items.push({
        key: 'grid',
        label: t('modules.mysql.query.resultTab'),
        value: t('modules.mysql.query.resultSummary', {
          rows: grid.rowCount,
          cols: grid.columns.length,
          ms: grid.durationMs,
        }),
        tone: 'default',
      })
      if (grid.hasMore) {
        items.push({
          key: 'has-more',
          label: t('modules.mysql.query.hasMore'),
          value: t('modules.mysql.query.hasMoreHint', { count: grid.fetchedCount }),
          tone: 'warning',
        })
      }
      if (grid.truncated) {
        items.push({
          key: 'truncated',
          label: t('modules.mysql.query.truncated'),
          value: t('modules.mysql.query.truncatedCap', { count: grid.fetchedCount }),
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

  const suggestScope = computed(() => {
    if (!props.sessionId) return null
    const db = props.database?.trim() || undefined
    return {
      sessionId: props.sessionId,
      database: db,
      schema: db,
    }
  })

  watch(
    () => props.sessionId,
    () => {
      void refreshTxState()
    },
    { immediate: true },
  )

  watch(
    () => props.active !== false,
    (active) => {
      void editor.onActiveChange(active)
    },
    { immediate: true },
  )

  watch(suggestScope, () => {
    editor.refreshSuggestScope()
  })

  async function refreshTxState(): Promise<void> {
    if (!props.sessionId) {
      autoCommit.value = true
      inTransaction.value = false
      return
    }
    try {
      const state = await mysqlApi.txGetState({ sessionId: props.sessionId })
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
      const state = await mysqlApi.txSetAutoCommit({
        sessionId: props.sessionId,
        autoCommit: enabled,
      })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
      if (enabled) {
        toast.info(t('modules.mysql.query.autoCommitOnHint'))
      } else {
        toast.info(t('modules.mysql.query.autoCommitOffHint'))
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
      const state = await mysqlApi.txCommit({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
      toast.success(t('modules.mysql.query.commitDone'))
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
      const state = await mysqlApi.txRollback({ sessionId: props.sessionId })
      autoCommit.value = state.autoCommit
      inTransaction.value = state.inTransaction
      toast.success(t('modules.mysql.query.rollbackDone'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      await refreshTxState()
    } finally {
      txBusy.value = false
    }
  }

  async function closeResultSetQuiet(rsId: string | null | undefined): Promise<void> {
    if (!props.sessionId || !rsId) return
    try {
      await mysqlApi.queryClose({ sessionId: props.sessionId, resultSetId: rsId })
    } catch {
      /* ignore */
    }
  }

  function replaceGridTab(id: string, next: MysqlGridTab): void {
    const tabs = gridTabs.value.slice()
    const idx = tabs.findIndex((g) => g.id === id)
    if (idx < 0) return
    tabs[idx] = next
    gridTabs.value = tabs
  }

  async function closeAllGridCursors(): Promise<void> {
    const tabs = gridTabs.value
    if (tabs.length === 0) return
    await Promise.all(tabs.map((tab) => closeResultSetQuiet(tab.resultSetId)))
  }

  async function enforceOpenCursorBudget(keepId?: string): Promise<void> {
    let tabs = gridTabs.value
    while (countOpenCursors(tabs) >= MAX_OPEN_RESULT_CURSORS) {
      const victim = tabs.find((g) => g.id !== keepId && g.resultSetId && g.hasMore)
      if (!victim) break
      await closeResultSetQuiet(victim.resultSetId)
      tabs = tabs.map((g) =>
        g.id === victim.id ? { ...g, resultSetId: null, hasMore: false } : g,
      )
      gridTabs.value = tabs
    }
  }

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
      toast.info(
        t('modules.mysql.query.batchTabsTrimmed', { n: dropped, max: MAX_RESULT_GRID_TABS }),
      )
    }
  }

  function clearResultData(): void {
    gridTabs.value = []
    batchItems.value = []
    batchTotalMs.value = 0
    lastExecSummary.value = ''
    filterText.value = ''
  }

  function rememberExecSummary(result: MysqlQueryExecResult): void {
    const parts: string[] = []
    if (result.rowsAffected != null && result.rowsAffected >= 0 && (result.rowCount ?? 0) === 0) {
      parts.push(t('modules.mysql.query.affected', { n: result.rowsAffected }))
    } else {
      parts.push(t('modules.mysql.query.rows', { n: result.fetchedCount ?? result.rowCount }))
    }
    parts.push(`${result.durationMs} ms`)
    if (result.commandTag?.trim()) parts.push(result.commandTag.trim())
    if (result.hasMore) parts.push(t('modules.mysql.query.hasMore'))
    if (result.truncated) parts.push(t('modules.mysql.query.truncated'))
    lastExecSummary.value = parts.join(' · ')
  }

  async function enrichGridColumnsFromMeta(tabId: string, sql: string): Promise<void> {
    if (!props.sessionId) return
    const ref = parsePrimaryMysqlRelation(sql, props.database)
    if (!ref) return
    const tab = gridTabs.value.find((g) => g.id === tabId)
    if (!tab || tab.columns.length === 0) return

    try {
      const params = {
        sessionId: props.sessionId,
        database: ref.database,
        table: ref.table,
        name: ref.table,
      }
      const [colsRes, pkRes] = await Promise.all([
        mysqlApi.metaColumns(params),
        mysqlApi.metaPrimaryKey(params).catch(() => ({ columns: [] as string[] })),
      ])
      const metaCols: MysqlColumnInfo[] = colsRes.columns ?? []
      if (metaCols.length === 0) return
      const metaByName = new Map(metaCols.map((c) => [c.name.toLowerCase(), c]))
      const pkSet = new Set((pkRes.columns ?? []).map((c) => c.toLowerCase()))

      const latest = gridTabs.value.find((g) => g.id === tabId)
      if (!latest) return

      const merged = latest.columns.map((col): MysqlQueryColumn => {
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
    } catch {
      // meta 失败不影响结果展示
    }
  }

  async function pushGridFromResult(
    result: MysqlQueryExecResult,
    opts: { stmtIndex: number; sqlPreview: string; sql?: string; activate?: boolean },
  ): Promise<MysqlGridTab | null> {
    const mapped = mapResultRows(result.columns, result.rows ?? [], 0)
    result.rows = []
    const fetchedCount = result.fetchedCount ?? mapped.length
    const keepCursor = Boolean(result.hasMore && result.resultSetId)

    await enforceGridTabBudget()
    await enforceOpenCursorBudget()

    const tab: MysqlGridTab = {
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
      rowsAffected: result.rowsAffected,
      commandTag: result.commandTag,
      requestId: result.requestId,
    }

    if (!keepCursor && result.resultSetId) {
      await closeResultSetQuiet(result.resultSetId)
    }

    gridTabs.value = [...gridTabs.value, tab]
    if (opts.activate !== false) {
      activePaneTab.value = tab.id
    }
    const enrichSql = opts.sql?.trim()
    if (enrichSql) {
      await enrichGridColumnsFromMeta(tab.id, enrichSql)
    }
    return gridTabs.value.find((g) => g.id === tab.id) ?? tab
  }

  function currentStatement(): string {
    const features = resolveSplitFeaturesFromProfile(dialectProfile())
    const statements = splitSqlStatementsWithFeatures(editor.resolveSql(), features)
      .map((s) => s.sql.trim())
      .filter(Boolean)
    return statements[0] ?? ''
  }

  async function runSql(): Promise<void> {
    if (running.value) return
    if (!props.sessionId) {
      lastError.value = t('modules.mysql.query.noSession')
      activePaneTab.value = 'messages'
      return
    }
    const sql = editor.resolveSql()
    if (!sql) {
      lastError.value = t('modules.mysql.query.empty')
      activePaneTab.value = 'messages'
      return
    }
    const features = resolveSplitFeaturesFromProfile(dialectProfile())
    const slices = splitSqlStatementsWithFeatures(sql, features)
      .map((s) => ({ sql: s.sql.trim() }))
      .filter((s) => Boolean(s.sql))
    if (slices.length === 0) {
      lastError.value = t('modules.mysql.query.empty')
      activePaneTab.value = 'messages'
      return
    }
    if (slices.length > MAX_BATCH_STATEMENTS) {
      lastError.value = t('modules.mysql.query.batchTooMany', {
        max: MAX_BATCH_STATEMENTS,
        count: slices.length,
      })
      activePaneTab.value = 'messages'
      return
    }

    await closeAllGridCursors()
    clearResultData()
    lastError.value = null
    cancelled.value = false
    activePaneTab.value = 'messages'

    const isBatch = slices.length > 1
    if (isBatch) {
      batchItems.value = slices.map((s, index) => ({
        index,
        sqlPreview: previewSql(s.sql),
        status: 'pending' as const,
      }))
    }

    running.value = true
    const batchId = `q-${Date.now()}`
    const startedAt = performance.now()
    let lastGridTab: MysqlGridTab | null = null
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
        const requestId = isBatch ? `${batchId}-${i}` : batchId
        activeRequestId.value = requestId

        if (isBatch) {
          const cur = batchItems.value[i]
          if (cur) cur.status = 'running'
          batchItems.value = batchItems.value.slice()
        }

        try {
          const result = await mysqlApi.queryExec({
            sessionId: props.sessionId,
            database: props.database,
            sql: slice.sql,
            limit: PAGE_LIMIT,
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
              activate: !isBatch,
            })
            if (tab) {
              lastGridTab = tab
              gridTabId = tab.id
              if (!isBatch) filterText.value = ''
            }
          } else {
            await closeResultSetQuiet(result.resultSetId)
            if (!isBatch) activePaneTab.value = 'messages'
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
          } else {
            rememberSql(sql, {
              durationMs: result.durationMs,
              rowCount: result.fetchedCount ?? result.rowCount,
            })
            if (lastGridTab?.hasMore) {
              toast.info(
                t('modules.mysql.query.hasMoreHint', { count: lastGridTab.fetchedCount }),
              )
            } else if (result.truncated) {
              toast.info(
                t('modules.mysql.query.truncatedCap', {
                  count: result.fetchedCount ?? result.rowCount,
                }),
              )
            }
          }

          await yieldToEventLoop()
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e)
          if (cancelled.value) {
            stopReason = 'cancel'
            if (isBatch) {
              const cur = batchItems.value[i]
              if (cur) cur.status = 'cancelled'
              for (let j = i + 1; j < slices.length; j++) {
                const next = batchItems.value[j]
                if (next) next.status = 'skipped'
              }
              batchItems.value = batchItems.value.slice()
            }
            break
          }
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
          } else {
            clearResultData()
          }
          activePaneTab.value = 'messages'
          break
        }
      }

      batchTotalMs.value = Math.round(performance.now() - startedAt)
      if (stopReason === 'ok') {
        void refreshTxState()
      }
      if (stopReason === 'ok' && isBatch) {
        rememberSql(sql, { durationMs: batchTotalMs.value })
        if (lastGridTab) {
          activePaneTab.value = lastGridTab.id
        }
      } else if (stopReason === 'cancel') {
        lastExecSummary.value = t('modules.mysql.query.cancelled')
        activePaneTab.value = 'messages'
      }
    } finally {
      running.value = false
      activeRequestId.value = null
      cancelling.value = false
    }
  }

  async function runExplain(analyze: boolean): Promise<void> {
    if (running.value) return
    if (!props.sessionId) {
      lastError.value = t('modules.mysql.query.noSession')
      activePaneTab.value = 'messages'
      return
    }
    const sql = currentStatement()
    if (!sql) {
      lastError.value = t('modules.mysql.query.empty')
      activePaneTab.value = 'messages'
      return
    }
    await closeAllGridCursors()
    clearResultData()
    lastError.value = null
    cancelled.value = false
    running.value = true
    activePaneTab.value = 'messages'
    const requestId = `explain-${Date.now()}`
    activeRequestId.value = requestId
    try {
      const result = await mysqlApi.queryExplain({
        sessionId: props.sessionId,
        database: props.database,
        sql,
        analyze,
        limit: PAGE_LIMIT,
        requestId,
      })
      if (cancelled.value) {
        await closeResultSetQuiet(result.resultSetId)
        lastExecSummary.value = t('modules.mysql.query.cancelled')
        return
      }
      rememberExecSummary(result)
      lastExecSummary.value = [
        analyze
          ? t('modules.mysql.query.explainAnalyzeDone')
          : t('modules.mysql.query.explainDone'),
        lastExecSummary.value,
      ].join(' · ')
      if (resultHasGrid(result.columns)) {
        await pushGridFromResult(result, {
          stmtIndex: 0,
          sqlPreview: previewSql(sql),
        })
      } else {
        await closeResultSetQuiet(result.resultSetId)
        activePaneTab.value = 'messages'
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      lastError.value = msg
      activePaneTab.value = 'messages'
    } finally {
      running.value = false
      activeRequestId.value = null
      cancelling.value = false
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
      const page = await mysqlApi.queryFetch({
        sessionId: props.sessionId,
        resultSetId: tab.resultSetId,
        limit: PAGE_LIMIT,
      })
      const target = gridTabs.value.find((g) => g.id === tabId)
      if (!target) return
      const mapped = mapResultRows(target.columns, page.rows ?? [], target.rows.length)
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
      if (!keepCursor && page.resultSetId) {
        await closeResultSetQuiet(page.resultSetId)
      }
      if (page.truncated) {
        toast.info(t('modules.mysql.query.truncatedCap', { count: page.fetchedCount }))
      }
    } catch (e) {
      const cur = gridTabs.value.find((g) => g.id === tabId)
      if (cur) replaceGridTab(tabId, { ...cur, hasMore: false, resultSetId: null })
      toast.error(e instanceof Error ? e.message : t('modules.mysql.query.fetchError'))
    } finally {
      loadingMore.value = false
    }
  }

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
        const page = await mysqlApi.queryFetch({
          sessionId: props.sessionId,
          resultSetId: cur.resultSetId,
          limit: PAGE_LIMIT,
        })
        const mapped = mapResultRows(cur.columns, page.rows ?? [], cur.rows.length)
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
        if (!keepCursor && page.resultSetId) {
          await closeResultSetQuiet(page.resultSetId)
        }
        if (page.truncated) {
          toast.info(t('modules.mysql.query.truncatedCap', { count: page.fetchedCount }))
          break
        }
        if (!page.hasMore) break
        await yieldToEventLoop()
      }
    } catch (e) {
      const cur = gridTabs.value.find((g) => g.id === tabId)
      if (cur) replaceGridTab(tabId, { ...cur, hasMore: false, resultSetId: null })
      toast.error(e instanceof Error ? e.message : t('modules.mysql.query.fetchError'))
    } finally {
      loadingMore.value = false
    }
  }

  async function cancelRun(): Promise<void> {
    if (!props.sessionId || !running.value) return
    cancelling.value = true
    cancelled.value = true
    try {
      await mysqlApi.queryCancel({
        sessionId: props.sessionId,
        requestId: activeRequestId.value ?? undefined,
      })
      lastExecSummary.value = t('modules.mysql.query.cancelled')
    } catch (e) {
      cancelled.value = false
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      cancelling.value = false
    }
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
        run: t('modules.mysql.query.run'),
        runSelection: t('modules.mysql.query.runSelection'),
        cancel: t('modules.mysql.query.cancel'),
        format: t('modules.mysql.query.format'),
        compress: t('modules.mysql.query.compress'),
        copy: t('modules.mysql.query.copy'),
        paste: t('modules.mysql.query.paste'),
        explain: t('modules.mysql.query.explain'),
        explainAnalyze: t('modules.mysql.query.explainAnalyze'),
        askAi: t('modules.mysql.query.askAi'),
        exportCsv: t('modules.mysql.query.exportCsv'),
        fetchMore: t('modules.mysql.query.loadMore'),
        fetchAll: t('modules.mysql.query.fetchAll'),
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
    toolbarAria: t('modules.mysql.query.editorLabel'),
    format: t('modules.mysql.query.format'),
    formatTooltip: t('modules.mysql.query.formatTooltip'),
    explain: t('modules.mysql.query.explain'),
    explainTooltip: t('modules.mysql.query.explainHint'),
    explainAnalyze: t('modules.mysql.query.explainAnalyze'),
    explainAnalyzeTooltip: t('modules.mysql.query.explainAnalyzeHint'),
    run: t('modules.mysql.query.run'),
    runSelection: t('modules.mysql.query.runSelection'),
    runTooltip: t('modules.mysql.query.runHint'),
    cancel: t('modules.mysql.query.cancel'),
    cancelTooltip: t('modules.mysql.query.cancel'),
    history: t('modules.mysql.query.history'),
    historyEmpty: t('modules.mysql.query.historyEmpty'),
    historyClear: t('modules.mysql.query.historyClear'),
    autoCommit: t('modules.mysql.query.autoCommit'),
    autoCommitTooltip: t('modules.mysql.query.autoCommitTooltip'),
    commit: t('modules.mysql.query.commit'),
    commitTooltip: t('modules.mysql.query.commitTooltip'),
    rollback: t('modules.mysql.query.rollback'),
    rollbackTooltip: t('modules.mysql.query.rollbackTooltip'),
    inTransaction: t('modules.mysql.query.inTransaction'),
  }))

  function selectResultTab(tab: MysqlResultPaneTabId): void {
    activePaneTab.value = tab
    if (tab !== 'messages') filterText.value = ''
  }

  async function closeResultGridTab(id: string): Promise<void> {
    const idx = gridTabs.value.findIndex((g) => g.id === id)
    if (idx < 0) return
    const tab = gridTabs.value[idx]!
    await closeResultSetQuiet(tab.resultSetId)
    const nextTabs = gridTabs.value.filter((g) => g.id !== id)
    gridTabs.value = nextTabs.map((g, i) => ({ ...g, ordinal: i + 1 }))
    if (batchItems.value.length > 0) {
      batchItems.value = batchItems.value.map((item) =>
        item.gridTabId === id ? { ...item, gridTabId: undefined, hasMore: false } : item,
      )
    }
    if (activePaneTab.value === id) {
      activePaneTab.value = nextTabs[Math.min(idx, nextTabs.length - 1)]?.id ?? 'messages'
    }
  }

  function batchItemOpenable(item: BatchStatementItem): boolean {
    return Boolean(item.hasGrid && item.gridTabId && gridTabs.value.some((g) => g.id === item.gridTabId))
  }

  function openBatchGrid(item: BatchStatementItem): void {
    if (!item.gridTabId) return
    if (!gridTabs.value.some((g) => g.id === item.gridTabId)) return
    activePaneTab.value = item.gridTabId
    filterText.value = ''
  }

  function exportCsv(): void {
    const grid = activeGrid.value
    if (!grid || grid.rows.length === 0) {
      toast.info(t('modules.mysql.query.noResult'))
      return
    }
    const base = props.database || 'query'
    const jagged = grid.rows.map((row) =>
      grid.columns.map((c, i) => row[c.name || `col${i + 1}`]),
    )
    exportQueryResultAsCsv(
      grid.columns.map((c, i) => ({ name: c.name || `col${i + 1}` })),
      jagged,
      `${base}-${Date.now()}`,
    )
  }

  watch(
    () => props.initialSql,
    (v) => {
      if (typeof v === 'string' && v.trim()) {
        sqlText.value = v
      }
    },
  )

  onMounted(() => {
    if (props.autoRunInitialSql && props.initialSql?.trim()) {
      void runSql()
    }
  })

  onUnmounted(() => {
    void closeAllGridCursors()
  })

  const resultPanelLabels = computed((): QueryResultPanelLabels => ({
    batchResultTab: (n) => t('modules.mysql.query.batchResultTab', { n }),
    tabRowCount: (n, hasMore) =>
      `${t('modules.mysql.query.tabRows', { n })}${hasMore ? '+' : ''}`,
    messages: t('modules.mysql.query.messages'),
    closeResultTab: t('modules.mysql.query.closeResultTab'),
    filterPlaceholder: t('modules.mysql.query.filterPlaceholder'),
    loadMore: t('modules.mysql.query.loadMore'),
    fetchAll: t('modules.mysql.query.fetchAll'),
    exportCsv: t('modules.mysql.query.exportCsv'),
    messagesEmpty: t('modules.mysql.query.messagesEmpty'),
    emptyResult: t('modules.mysql.query.emptyResult'),
    resultEmpty: t('modules.mysql.query.resultEmpty'),
    batchStmtLabel: (n) => t('modules.mysql.query.batchStmtLabel', { n }),
    batchStmtSkipped: t('modules.mysql.query.batchStmtSkipped'),
    batchStmtRunning: t('modules.mysql.query.batchStmtRunning'),
    batchStmtPending: t('modules.mysql.query.batchStmtPending'),
    batchOpenResult: t('modules.mysql.query.batchOpenResult'),
    msgOk: t('modules.mysql.query.msgOk'),
    msgError: t('modules.mysql.query.msgError'),
    cancelled: t('modules.mysql.query.cancelled'),
    logColStatus: t('modules.mysql.query.logColStatus'),
    logColTime: t('modules.mysql.query.logColTime'),
    logColRows: t('modules.mysql.query.logColRows'),
    copyMessage: t('modules.mysql.query.copyMessage'),
    copiedHint: t('modules.mysql.query.copiedHint'),
  }))

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
    onHistoryPick,
    onContextMenuSelect,
    setAutoCommit,
    commitTx,
    rollbackTx,
    selectResultTab,
    closeResultGridTab,
    batchItemOpenable,
    openBatchGrid,
    runSql,
    runExplain,
    cancelRun,
    fetchMore,
    fetchAll,
    exportCsv,
  }
}
