/**
 * ClickHouse 表 Browse：分页 + WHERE；行编辑走 ALTER UPDATE / 轻量 DELETE / INSERT。
 * 行定位优先 PRIMARY KEY，其次 ORDER BY（sortingKey）；无键时不可编辑。
 */
import {
  copyTextToClipboard,
  readClipboardText,
  useRsToast,
  type RsCodeEditorSqlConfig,
  type RsContextMenuItem,
  type RsTableColumn,
} from '@niuma/ui'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi } from '@/api'
import { clickhouseApi } from '@/api/clickhouse'
import type { ClickHouseColumnInfo, ClickHouseQueryExecResult, ClickHouseTableMetaInfo } from '@/api/types/clickhouse'
import {
  alignForValueType,
  formatBrowseCellValue,
  formatRowsAsTsv,
  isBrowseFilterCompletionOpen,
  mapPasteToColumnRecords,
  parseClipboardMatrix,
  parseEditValue,
  resolveSqlValueType,
  type BrowseDataRow,
  type BrowseDataShellLabels,
} from '@/modules/database'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { useSessionRegistry } from '@/stores/session-registry'
import { Cap, hasCapability } from '@/modules/sql-editor/capabilities'
import { qualifiedName, quoteIdent } from '@/modules/clickhouse/sql-seed'
import {
  CLICKHOUSE_DATA_TASK_PROVIDER,
  openClickHouseDataTask,
  readClickHouseIoContext,
} from '@/modules/clickhouse/data-tasks'
import { useDataTaskHubStore } from '@/stores/data-task-hub'

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const
const BROWSE_GUTTER_WIDTH = 40

export interface ClickHouseBrowsePaneProps {
  sessionId: string | null
  profileId?: string
  database?: string
  table?: string
  isView?: boolean
  sessionLabel?: string
  active: boolean
}

function normalizeWhere(raw: string): string {
  return raw.trim().replace(/^where\s+/i, '').trim()
}

function parseCount(result: ClickHouseQueryExecResult): number {
  const cell = result.rows?.[0]?.[0]
  const n = typeof cell === 'number' ? cell : Number(cell)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

/** 无精确总数时，用本页是否「满页+1」估算分页 total（够点下一页即可）。 */
function estimateTotalFromPage(offset: number, limit: number, pageRowCount: number, hasMore: boolean): number {
  if (hasMore) return offset + limit + 1
  return offset + pageRowCount
}

/** 解析 PRIMARY KEY / ORDER BY 表达式为列名列表。 */
export function parseKeyColumns(raw: string | undefined | null): string[] {
  let s = (raw ?? '').trim()
  if (!s) return []
  s = s.replace(/^(tuple|order\s+by)\s*/i, '').trim()
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1)
  return s
    .split(',')
    .map((part) => part.trim().replace(/^`([^`]*)`$/, '$1').replace(/^"([^"]*)"$/, '$1'))
    .filter(Boolean)
}

function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "\\'")}'`
  }
  const s = String(value)
  if (s.toUpperCase() === 'NULL') return 'NULL'
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export function useClickHouseBrowsePane(props: ClickHouseBrowsePaneProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const nav = useConnectionNavigation()
  const sessions = useSessionRegistry()
  const dataTaskHub = useDataTaskHubStore()

  const loading = ref(false)
  const saving = ref(false)
  const page = ref(1)
  const pageSize = ref(200)
  const totalRows = ref(0)
  /** 总数是否来自精确 count / 末页推算；false 表示 LIMIT+1 估算或元数据约数 */
  const totalExact = ref(false)
  const filterOpen = ref(false)
  const filterDraft = ref('')
  const appliedWhereSql = ref('')
  const lastDataSql = ref('')
  const selectedRowKeys = ref<string[]>([])
  const resultRows = ref<BrowseDataRow[]>([])
  const lastResult = shallowRef<ClickHouseQueryExecResult | null>(null)
  const rawRows = shallowRef<unknown[][]>([])
  const queryColumns = shallowRef<{ name: string; dataType?: string }[]>([])
  const tableColumns = shallowRef<ClickHouseColumnInfo[]>([])
  const tableInfo = shallowRef<ClickHouseTableMetaInfo | null>(null)
  const keyColumns = ref<string[]>([])
  const metaReady = ref(false)
  const ddlMenuOpen = ref(false)
  const ddlLoading = ref(false)
  const ddlText = ref('')
  const objectType = ref('')
  const exportMenuOpen = ref(false)
  const importMenuOpen = ref(false)
  const deleteConfirm = ref(false)
  let draftSeq = 0
  /** 取消过期的后台 count 回调 */
  let loadSeq = 0

  const isView = computed(() => props.isView === true)
  const canImport = computed(() => !isView.value && tableInfo.value?.objectType?.toLowerCase() === 'table')
  const databaseName = computed(() => props.database?.trim() ?? '')
  const scopeOk = computed(() => Boolean(props.sessionId && props.table && databaseName.value))
  const scopeLabel = computed(() =>
    props.table && databaseName.value ? qualifiedName(databaseName.value, props.table) : '',
  )
  const displayColumnNames = computed(() => queryColumns.value.map((c) => c.name))

  const dialect = computed(() => sessions.getDialectForSession(props.sessionId))
  const lightweightDelete = computed(() =>
    hasCapability(dialect.value, Cap.ClickHouseLightweightDelete),
  )

  const canEdit = computed(() => !isView.value && keyColumns.value.length > 0)
  const canInsert = computed(() => !isView.value && tableColumns.value.length > 0)
  const canDelete = computed(() => {
    if (selectedRowKeys.value.length === 0) return false
    if (selectedRowKeys.value.every((key) => String(key).startsWith('new-'))) return true
    return canEdit.value
  })

  const shellLabels = computed(
    (): BrowseDataShellLabels => ({
      toolbarLabel: t('modules.clickhouse.browse.toolbarLabel'),
      featureLabel: isView.value
        ? t('modules.clickhouse.browse.featureView')
        : t('modules.clickhouse.browse.featureTable'),
      insert: t('modules.clickhouse.browse.insert'),
      insertTooltip: t('modules.clickhouse.browse.insertTooltip'),
      delete: t('modules.clickhouse.browse.delete'),
      deleteTooltip: t('modules.clickhouse.browse.deleteTooltip'),
      import: t('modules.clickhouse.browse.import'),
      importTooltip: t('modules.clickhouse.browse.importTooltip'),
      export: t('modules.clickhouse.browse.export'),
      exportTooltip: t('modules.clickhouse.browse.exportTooltip'),
      filter: t('modules.clickhouse.browse.filter'),
      filterToggle: t('modules.clickhouse.browse.filterToggle'),
      refresh: t('modules.clickhouse.browse.refresh'),
      needTable: t('modules.clickhouse.browse.needTable'),
      empty: t('modules.clickhouse.browse.empty'),
    }),
  )

  const statusMeta = computed(() => {
    if (!lastResult.value) return ''
    const key = totalExact.value
      ? 'modules.clickhouse.browse.statusRowsTotal'
      : 'modules.clickhouse.browse.statusRowsTotalApprox'
    return t(key, {
      n: resultRows.value.length,
      page: page.value,
      total: totalRows.value,
    })
  })

  const statusHint = computed(() => {
    if (isView.value) return t('modules.clickhouse.browse.viewReadonlyHint')
    if (!keyColumns.value.length) return t('modules.clickhouse.browse.noKeyHint')
    if (tableInfo.value?.engine) {
      return t('modules.clickhouse.browse.editHint', { engine: tableInfo.value.engine })
    }
    return t('modules.clickhouse.browse.editHintPlain')
  })

  const filterSqlConfig = computed((): RsCodeEditorSqlConfig | undefined => {
    if (!props.table || !tableColumns.value.length || !databaseName.value) return undefined
    return {
      dialect: 'mysql',
      schema: {
        [databaseName.value]: {
          [props.table]: tableColumns.value.map((column) => ({
            label: column.name,
            detail: column.dataType,
            type: 'property' as const,
            boost: 99,
          })),
        },
      },
      defaultSchema: databaseName.value,
      defaultTable: props.table,
    }
  })

  const columnMeta = computed(() => new Map(tableColumns.value.map((c) => [c.name.toLowerCase(), c])))

  const resultColumns = computed((): RsTableColumn<BrowseDataRow>[] =>
    displayColumnNames.value.map((name) => {
      const meta = columnMeta.value.get(name.toLowerCase())
      const typeLabel = (meta?.dataType || queryColumns.value.find((c) => c.name === name)?.dataType || '').trim()
      const dataType = typeLabel || undefined
      const valueType = resolveSqlValueType(dataType)
      const isKey = keyColumns.value.some((c) => c.toLowerCase() === name.toLowerCase())
      const tipLines = [t('modules.clickhouse.browse.colTipField', { name })]
      if (typeLabel) tipLines.push(t('modules.clickhouse.browse.colTipType', { type: typeLabel }))
      if (isKey) tipLines.push(t('modules.clickhouse.browse.colTipKey'))
      return {
        key: name,
        title: name,
        width: 120,
        minWidth: 80,
        ellipsis: true,
        sortable: true,
        filterable: true,
        align: alignForValueType(valueType),
        valueType,
        nullable: meta?.nullable !== false,
        emptyAsNull: true,
        headerTip: tipLines.join('\n'),
        editable: (row: BrowseDataRow) =>
          Boolean((row as BrowseDataRow & { __isNew?: boolean }).__isNew || canEdit.value),
        formatter: valueType === 'boolean' ? undefined : (value) => formatBrowseCellValue(value, valueType),
      }
    }),
  )

  function rebuildRows(): void {
    const drafts = resultRows.value.filter((row) => (row as BrowseDataRow & { __isNew?: boolean }).__isNew)
    const rows = rawRows.value.map((raw, index) => {
      const row: BrowseDataRow = { __rowKey: String(index), __rowIndex: index }
      queryColumns.value.forEach((column, columnIndex) => {
        row[column.name] = raw[columnIndex]
      })
      return row
    })
    resultRows.value = drafts.length ? [...drafts, ...rows] : rows
  }

  function createDraft(): BrowseDataRow {
    draftSeq += 1
    return Object.fromEntries([
      ['__rowKey', `new-${draftSeq}`],
      ['__rowIndex', -1],
      ['__isNew', true],
      ...displayColumnNames.value.map((name) => [name, null]),
    ]) as BrowseDataRow
  }

  function keyWhere(row: BrowseDataRow): string | null {
    if (!canEdit.value) return null
    const raw = rawRows.value[row.__rowIndex]
    if (!raw) return null
    const clauses = keyColumns.value.map((name) => {
      const index = queryColumns.value.findIndex((column) => column.name === name)
      return index < 0 ? '' : `${quoteIdent(name)} = ${toSqlLiteral(raw[index])}`
    }).filter(Boolean)
    return clauses.length === keyColumns.value.length ? clauses.join(' AND ') : null
  }

  async function onCellEditCommit(
    row: BrowseDataRow & { __isNew?: boolean },
    column: RsTableColumn<BrowseDataRow>,
    _index: number,
    value: unknown,
  ): Promise<void> {
    const name = String(column.key)
    if (row.__isNew) {
      row[name] = parseEditValue(value, row[name])
      return
    }
    if (!props.sessionId || !props.table || !canEdit.value) return
    const rowIndex = row.__rowIndex
    const colIndex = queryColumns.value.findIndex((item) => item.name === name)
    const previous = rawRows.value[rowIndex]?.[colIndex]
    const next = parseEditValue(value, previous)
    if (toSqlLiteral(previous) === toSqlLiteral(next)) return
    const where = keyWhere(row)
    if (!where) return
    const rows = rawRows.value.map((item) => [...item])
    rows[rowIndex]![colIndex] = next
    rawRows.value = rows
    rebuildRows()
    saving.value = true
    try {
      const sql =
        `ALTER TABLE ${qualifiedName(databaseName.value, props.table)} ` +
        `UPDATE ${quoteIdent(name)} = ${toSqlLiteral(next)} WHERE ${where}`
      await clickhouseApi.queryExec({
        sessionId: props.sessionId,
        database: databaseName.value,
        sql,
      })
      toast.success(t('modules.clickhouse.browse.cellSaved'))
    } catch (error) {
      const reverted = rawRows.value.map((item) => [...item])
      reverted[rowIndex]![colIndex] = previous
      rawRows.value = reverted
      rebuildRows()
      toast.error(error instanceof Error ? error.message : t('modules.clickhouse.browse.cellSaveError'))
    } finally {
      saving.value = false
    }
  }

  function openInsert(): void {
    if (!canInsert.value) return
    const draft = createDraft()
    resultRows.value = [draft, ...resultRows.value]
    selectedRowKeys.value = [draft.__rowKey]
  }

  function discardNewRow(key: string): void {
    resultRows.value = resultRows.value.filter((row) => row.__rowKey !== key)
    selectedRowKeys.value = selectedRowKeys.value.filter((item) => item !== key)
  }

  function requestDelete(): void {
    if (selectedRowKeys.value.every((key) => String(key).startsWith('new-'))) {
      selectedRowKeys.value.forEach(discardNewRow)
      return
    }
    if (canDelete.value) deleteConfirm.value = true
  }

  async function flushNewRow(row: BrowseDataRow & { __isNew?: boolean }): Promise<void> {
    if (!row.__isNew || !props.sessionId || !props.table) return
    const filled = tableColumns.value.filter(
      (column) => row[column.name] !== null && row[column.name] !== undefined && row[column.name] !== '',
    )
    if (!filled.length) {
      resultRows.value = resultRows.value.filter((item) => item.__rowKey !== row.__rowKey)
      return
    }
    const missing = tableColumns.value.find(
      (column) =>
        !column.nullable &&
        !column.default &&
        (row[column.name] === null || row[column.name] === undefined || row[column.name] === ''),
    )
    if (missing) {
      toast.error(t('modules.clickhouse.browse.insertRequired', { name: missing.name }))
      return
    }
    saving.value = true
    try {
      const sql =
        `INSERT INTO ${qualifiedName(databaseName.value, props.table)} ` +
        `(${filled.map((c) => quoteIdent(c.name)).join(', ')}) VALUES ` +
        `(${filled.map((c) => toSqlLiteral(parseEditValue(row[c.name]))).join(', ')})`
      await clickhouseApi.queryExec({
        sessionId: props.sessionId,
        database: databaseName.value,
        sql,
      })
      toast.success(t('modules.clickhouse.browse.insertDone'))
      await loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.clickhouse.browse.insertError'))
    } finally {
      saving.value = false
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!props.sessionId || !props.table || !canDelete.value) return
    const selectedCount = selectedRowKeys.value.length
    saving.value = true
    try {
      for (const row of resultRows.value.filter((item) => selectedRowKeys.value.includes(item.__rowKey))) {
        const where = keyWhere(row)
        if (!where) continue
        const sql = lightweightDelete.value
          ? `DELETE FROM ${qualifiedName(databaseName.value, props.table)} WHERE ${where}`
          : `ALTER TABLE ${qualifiedName(databaseName.value, props.table)} DELETE WHERE ${where}`
        await clickhouseApi.queryExec({
          sessionId: props.sessionId,
          database: databaseName.value,
          sql,
        })
      }
      selectedRowKeys.value = []
      toast.success(t('modules.clickhouse.browse.deleteDone', { count: selectedCount }))
      await loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.clickhouse.browse.deleteError'))
    } finally {
      saving.value = false
      deleteConfirm.value = false
    }
  }

  async function loadMeta(): Promise<void> {
    if (!props.sessionId || !databaseName.value || !props.table) {
      tableColumns.value = []
      tableInfo.value = null
      keyColumns.value = []
      metaReady.value = false
      return
    }
    try {
      const [cols, info] = await Promise.all([
        clickhouseApi.metaColumns({
          sessionId: props.sessionId,
          database: databaseName.value,
          table: props.table,
        }),
        clickhouseApi.metaTableInfo({
          sessionId: props.sessionId,
          database: databaseName.value,
          table: props.table,
        }).catch(() => null),
      ])
      tableColumns.value = cols.columns ?? []
      tableInfo.value = info
      if (info?.objectType) objectType.value = info.objectType
      const pk = parseKeyColumns(info?.primaryKey)
      const sk = parseKeyColumns(info?.sortingKey)
      keyColumns.value = pk.length ? pk : sk
      metaReady.value = true
    } catch (e) {
      metaReady.value = false
      toast.error(e instanceof Error ? e.message : t('modules.clickhouse.browse.metaError'))
    }
  }

  /**
   * 后台精确 count：不阻塞网格；失败（如 code 241）静默保留估算，避免打断浏览。
   * seq 用于丢弃过期请求的结果。
   */
  function scheduleExactCount(opts: {
    seq: number
    sessionId: string
    database: string
    from: string
    whereSql: string
  }): void {
    void (async () => {
      try {
        const countResult = await clickhouseApi.queryExec({
          sessionId: opts.sessionId,
          database: opts.database,
          sql: `SELECT count() FROM ${opts.from}${opts.whereSql}`,
          limit: 1,
        })
        if (opts.seq !== loadSeq) return
        totalRows.value = parseCount(countResult)
        totalExact.value = true
      } catch {
        // 保留 LIMIT+1 估算；不 toast，避免大表过滤时反复弹出内存错误
      }
    })()
  }

  async function loadData(resetPage = false): Promise<void> {
    if (!props.sessionId || !databaseName.value || !props.table) return
    if (resetPage) page.value = 1
    const seq = ++loadSeq
    loading.value = true
    try {
      const where = appliedWhereSql.value
      const from = qualifiedName(databaseName.value, props.table)
      const whereSql = where ? ` WHERE ${where}` : ''
      const limit = pageSize.value
      const offset = (page.value - 1) * limit
      const orderBy = keyColumns.value.length
        ? ` ORDER BY ${keyColumns.value.map((c) => quoteIdent(c)).join(', ')}`
        : ''

      // 多取 1 行探测是否还有下一页；数据先出，精确 count 放到后台（可选）。
      const fetchLimit = limit + 1
      const dataSql = `SELECT * FROM ${from}${whereSql}${orderBy} LIMIT ${limit} OFFSET ${offset}`
      const fetchSql = `SELECT * FROM ${from}${whereSql}${orderBy} LIMIT ${fetchLimit} OFFSET ${offset}`
      lastDataSql.value = dataSql
      const result = await clickhouseApi.queryExec({
        sessionId: props.sessionId,
        database: databaseName.value,
        sql: fetchSql,
        limit: fetchLimit,
      })
      if (seq !== loadSeq) return
      const fetched = result.rows ?? []
      const hasMore = fetched.length > limit
      const pageRows = hasMore ? fetched.slice(0, limit) : fetched
      lastResult.value = {
        ...result,
        rows: pageRows,
        rowCount: pageRows.length,
      }
      queryColumns.value = (result.columns ?? []).map((c) => ({ name: c.name, dataType: c.dataType }))
      rawRows.value = pageRows
      rebuildRows()

      const estimated = estimateTotalFromPage(offset, limit, pageRows.length, hasMore)

      // 偏移越界（删行 / 过滤后变少）：把 total 收到当前偏移，便于分页回退
      if (pageRows.length === 0 && page.value > 1) {
        totalRows.value = offset
        totalExact.value = true
        return
      }

      if (!hasMore) {
        // 末页：offset+行数即为精确总数，无需再 count
        totalRows.value = estimated
        totalExact.value = true
        return
      }

      if (!where && tableInfo.value?.totalRows != null) {
        totalRows.value = Number(tableInfo.value.totalRows)
        totalExact.value = false
        return
      }

      // 先用估算撑起分页，再后台精确 count（有/无 WHERE 都走这条，失败则保持估算）
      totalRows.value = estimated
      totalExact.value = false
      scheduleExactCount({
        seq,
        sessionId: props.sessionId,
        database: databaseName.value,
        from,
        whereSql,
      })
    } catch (e) {
      if (seq !== loadSeq) return
      toast.error(e instanceof Error ? e.message : t('modules.clickhouse.browse.loadError'))
    } finally {
      if (seq === loadSeq) loading.value = false
    }
  }

  function applyFilters(): void {
    appliedWhereSql.value = normalizeWhere(filterDraft.value)
    void loadData(true)
  }

  /** 工具栏刷新：过滤面板有未应用草稿时一并带上最新条件。 */
  function refresh(): void {
    const next = normalizeWhere(filterDraft.value)
    if (next !== appliedWhereSql.value) {
      appliedWhereSql.value = next
      void loadData(true)
      return
    }
    void loadData(false)
  }

  function onFilterKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return
    if (isBrowseFilterCompletionOpen(ev)) return
    ev.preventDefault()
    ev.stopPropagation()
    applyFilters()
  }

  async function loadBrowseDdl(): Promise<void> {
    if (!props.sessionId || !databaseName.value || !props.table) return
    ddlLoading.value = true
    try {
      const result = await clickhouseApi.metaDDL({
        sessionId: props.sessionId,
        database: databaseName.value,
        table: props.table,
      })
      ddlText.value = result.ddl
      objectType.value = result.objectType || result.type || objectType.value
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.clickhouse.ddl.loadError'))
    } finally {
      ddlLoading.value = false
    }
  }

  async function copyBrowseDdl(): Promise<void> {
    if (!ddlText.value) return
    try {
      await copyTextToClipboard(ddlText.value)
      toast.success(t('modules.clickhouse.ddl.copied'))
    } catch {
      toast.error(t('modules.clickhouse.ddl.copyFailed'))
    }
  }

  function currentTablePath(): ConnResourcePath | null {
    if (!databaseName.value || !props.table) return null
    return {
      segments: [
        { kind: 'database', name: databaseName.value },
        { kind: 'category', name: isView.value ? 'views' : 'tables' },
        { kind: 'table', name: props.table },
      ],
    }
  }

  async function resolveConnItem(): Promise<ConnItem | null> {
    if (!props.profileId) return null
    const result = await connectionApi.get({ profileId: props.profileId })
    if (!result.profile) return null
    return { ...result.profile, kind: 'clickhouse' }
  }

  async function openDdlTab(): Promise<void> {
    ddlMenuOpen.value = false
    const path = currentTablePath()
    if (!path) return
    try {
      const item = await resolveConnItem()
      if (!item) throw new Error(t('modules.clickhouse.browse.openDdlFailed'))
      nav.connect(item, { resourcePath: path, initialTab: 'ddl' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.clickhouse.browse.openDdlFailed'))
    }
  }

  async function copyTsv(
    row: BrowseDataRow | null = null,
    selected: BrowseDataRow[] = [],
  ): Promise<void> {
    const cols = displayColumnNames.value
    const selectedSet = new Set(selectedRowKeys.value)
    const fromSelected = (selected.length > 0 ? selected : resultRows.value.filter((item) => selectedSet.has(item.__rowKey)))
      .filter((item) => !(item as BrowseDataRow & { __isNew?: boolean }).__isNew)
    const rows =
      fromSelected.length > 0
        ? fromSelected
        : row && !(row as BrowseDataRow & { __isNew?: boolean }).__isNew
          ? [row]
          : []
    if (!cols.length || !rows.length) {
      toast.info(t('modules.clickhouse.browse.copyEmpty'))
      return
    }
    const text = formatRowsAsTsv(
      cols,
      rows.map((item) => cols.map((name) => item[name])),
    )
    try {
      await copyTextToClipboard(text)
      toast.success(t('modules.clickhouse.browse.copied'))
    } catch {
      toast.error(t('modules.clickhouse.browse.copyFailed'))
    }
  }

  async function pasteIntoInsertRows(): Promise<void> {
    if (!canInsert.value || !lastResult.value) return
    const text = await readClipboardText()
    if (!text?.trim()) {
      toast.info(t('modules.clickhouse.browse.pasteEmpty'))
      return
    }
    const cols = displayColumnNames.value
    const records = mapPasteToColumnRecords(cols, parseClipboardMatrix(text))
    if (records.length === 0) {
      toast.info(t('modules.clickhouse.browse.pasteEmpty'))
      return
    }

    const existingDrafts = resultRows.value.filter(
      (row) => (row as BrowseDataRow & { __isNew?: boolean }).__isNew,
    )
    const rest = resultRows.value.filter(
      (row) => !(row as BrowseDataRow & { __isNew?: boolean }).__isNew,
    )
    const filled: BrowseDataRow[] = []

    for (let i = 0; i < records.length; i++) {
      const base = existingDrafts[i] ?? createDraft()
      const next: BrowseDataRow = { ...base, __isNew: true }
      for (const [name, raw] of Object.entries(records[i]!)) {
        next[name] = raw.trim() === '' ? null : parseEditValue(raw)
      }
      filled.push(next)
    }

    resultRows.value = [...filled, ...rest]
    selectedRowKeys.value = filled.map((row) => row.__rowKey)
    await nextTick()
    toast.success(t('modules.clickhouse.browse.pasteDone', { count: filled.length }))
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (target.isContentEditable) return true
    return Boolean(
      target.closest(
        '.cm-editor, .rs-code-editor, .rs-table__td--editing, [contenteditable="true"]',
      ),
    )
  }

  function onBrowseKeydown(event: KeyboardEvent): void {
    if (!props.active || isTypingTarget(event.target)) return
    const mod = event.ctrlKey || event.metaKey
    if (!mod || event.altKey || event.shiftKey) return
    const key = event.key.toLowerCase()
    if (key === 'c') {
      if (selectedRowKeys.value.length === 0) return
      event.preventDefault()
      void copyTsv()
      return
    }
    if (key === 'v') {
      if (!canInsert.value) return
      event.preventDefault()
      void pasteIntoInsertRows()
    }
  }

  function contextMenuItems(
    row: BrowseDataRow | null,
    selected: BrowseDataRow[],
  ): RsContextMenuItem[] {
    const items: RsContextMenuItem[] = []
    const canCopy =
      selected.length > 0 ||
      selectedRowKeys.value.length > 0 ||
      Boolean(row && !(row as BrowseDataRow & { __isNew?: boolean }).__isNew)

    items.push({
      key: 'copy:tsv',
      label: t('modules.clickhouse.browse.copyRows'),
      icon: 'copy',
      shortcut: 'Ctrl+C',
      disabled: !canCopy,
    })

    if (canInsert.value) {
      items.push({
        key: 'paste',
        label: t('modules.clickhouse.browse.pasteRows'),
        icon: 'clipboard-paste',
        shortcut: 'Ctrl+V',
      })
    }

    const hasDraft =
      Boolean((row as BrowseDataRow & { __isNew?: boolean } | null)?.__isNew) ||
      selected.some((item) => (item as BrowseDataRow & { __isNew?: boolean }).__isNew)
    const canCtxDelete =
      hasDraft || (canEdit.value && (selected.length > 0 || Boolean(row)))
    if (canCtxDelete) {
      items.push({ key: 'sep-delete', label: '', separator: true })
      items.push({
        key: 'delete',
        label: t('modules.clickhouse.browse.delete'),
        icon: 'trash-2',
        danger: true,
        disabled: selected.length === 0 && !row,
      })
    }
    return items
  }

  function onContextMenuSelect(
    key: string,
    row: BrowseDataRow | null,
    selected: BrowseDataRow[],
  ): void {
    if (key === 'copy:tsv') {
      void copyTsv(row, selected)
      return
    }
    if (key === 'paste') {
      void pasteIntoInsertRows()
      return
    }
    if (key === 'delete') {
      if (selected.length === 0 && row) selectedRowKeys.value = [row.__rowKey]
      requestDelete()
    }
  }

  function openBrowseIo(kind: 'export_csv' | 'import_csv'): void {
    if (!props.profileId) {
      toast.error(t(kind === 'export_csv'
        ? 'modules.clickhouse.browse.exportNeedProfile'
        : 'modules.clickhouse.browse.importNeedProfile'))
      return
    }
    if (!props.database || !props.table) {
      toast.error(t('modules.clickhouse.browse.needTable'))
      return
    }
    const scope = `${props.database}.${props.table}`
    openClickHouseDataTask({
      kind,
      title: `${scope} · ${t(kind === 'export_csv'
        ? 'modules.clickhouse.io.exportTitle'
        : 'modules.clickhouse.io.importTitle')}`,
      description: t(kind === 'export_csv'
        ? 'modules.clickhouse.io.exportDesc'
        : 'modules.clickhouse.io.importDesc', { name: scope }),
      context: {
        conn: { profileId: props.profileId } as ConnItem,
        profileId: props.profileId,
        sessionId: null,
        database: props.database,
        table: props.table,
        dumpScope: 'table',
      },
    })
  }

  watch(
    () => [props.sessionId, props.database, props.table, props.active] as const,
    async ([, , , active]) => {
      if (!active) return
      selectedRowKeys.value = []
      await loadMeta()
      await loadData(true)
    },
    { immediate: true },
  )

  watch([page, pageSize], () => {
    if (props.active && scopeOk.value) void loadData(false)
  })

  /** 同源表 CSV 导入任务结束后自动刷新 Browse */
  watch(
    () =>
      dataTaskHub.tasks
        .filter((item) => item.provider === CLICKHOUSE_DATA_TASK_PROVIDER && item.kind === 'import_csv')
        .map((item) => `${item.id}:${item.busy ? 1 : 0}`)
        .join('|'),
    (signature, previous) => {
      if (!props.active || !scopeOk.value || !previous) return
      const prevBusy = new Set(
        previous
          .split('|')
          .filter((part) => part.endsWith(':1'))
          .map((part) => part.slice(0, part.lastIndexOf(':'))),
      )
      for (const part of signature.split('|')) {
        if (!part || !part.endsWith(':0')) continue
        const id = part.slice(0, part.lastIndexOf(':'))
        if (!prevBusy.has(id)) continue
        const task = dataTaskHub.getTask(id)
        if (!task) continue
        const ioCtx = readClickHouseIoContext(task.context)
        if (!ioCtx) continue
        if (ioCtx.database === props.database && ioCtx.table === props.table) {
          void loadData(true)
          break
        }
      }
    },
  )

  watch(ddlMenuOpen, (open) => {
    if (open && !ddlText.value) void loadBrowseDdl()
  })

  return {
    t,
    loading,
    saving,
    page,
    pageSize,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    totalRows,
    filterOpen,
    filterDraft,
    appliedWhereSql,
    lastDataSql,
    selectedRowKeys,
    resultRows,
    lastResult,
    resultColumns,
    shellLabels,
    statusMeta,
    statusHint,
    scopeOk,
    scopeLabel,
    isView,
    canEdit,
    canInsert,
    canDelete,
    filterSqlConfig,
    browseGutterWidth: BROWSE_GUTTER_WIDTH,
    ddlMenuOpen,
    ddlLoading,
    ddlText,
    objectType,
    exportMenuOpen,
    importMenuOpen,
    deleteConfirm,
    importMenuItems: computed(() => [
      {
        key: 'fullCsv',
        label: t('modules.clickhouse.browse.formatCsvFull'),
        disabled: !canImport.value || loading.value,
      },
    ]),
    exportMenuItems: computed(() => [
      { key: 'tsv', label: t('modules.clickhouse.browse.copyTsv') },
      {
        key: 'fullCsv',
        label: t('modules.clickhouse.browse.formatCsvFull'),
        disabled: !props.profileId || !props.database || !props.table || loading.value,
      },
    ]),
    quoteIdent,
    loadData,
    applyFilters,
    onFilterKeydown,
    refresh,
    copyBrowseDdl,
    openDdlTab,
    onImportMenuSelect: (key: string) => {
      if (key === 'fullCsv') {
        importMenuOpen.value = false
        openBrowseIo('import_csv')
      }
    },
    onExportMenuSelect: (key: string) => {
      if (key === 'tsv') void copyTsv()
      if (key === 'fullCsv') {
        exportMenuOpen.value = false
        openBrowseIo('export_csv')
      }
    },
    openInsert,
    requestDelete,
    deleteSelected,
    onCellEditCommit,
    flushNewRow,
    onBrowseKeydown,
    contextMenuItems,
    onContextMenuSelect,
  }
}
