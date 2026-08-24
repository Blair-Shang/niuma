/**
 * Postgres 表 / 视图数据浏览：分页 · WHERE 过滤 · 行编辑提交 · 导入导出。
 * 对齐 MySQL 浏览页：无主键按全列定位；网格右键复制 INSERT/UPDATE/DELETE；草稿行切换提交。
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
import { connectionApi, dialogApi, fsApi } from '@/api'
import { postgresApi } from '@/api/postgres'
import type {
  PostgresColumnInfo,
  PostgresQueryColumn,
  PostgresQueryExecResult,
} from '@/api/types/postgres'
import {
  buildBrowseResultColumn,
  formatRowsAsTsv,
  isBrowseBinCell,
  isBrowseFilterCompletionOpen,
  mapPasteToColumnRecords,
  parseClipboardMatrix,
  parseEditValue,
  type BrowseDataRow,
  type BrowseDataShellLabels,
  type BrowseRowChange,
} from '@/modules/database'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { openPostgresDataTask } from '@/modules/postgres/data-tasks'
import { qualifiedName, quoteIdent } from '@/modules/postgres/sql-seed'
import { toSqlLiteral } from '@/modules/postgres/utils/sql-literal'
import {
  acceptExtensionsForFormat,
  buildBrowseExportPayload,
  buildDeleteSqlText,
  buildInsertSqlText,
  buildUpdateSqlText,
  looksLikeOfficeZip,
  parseBrowseImport,
  sqlWhereEquals,
  type BrowseDataFormat,
} from '@/modules/postgres/utils/browse-io'

export interface PostgresBrowsePaneProps {
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  table?: string
  isView?: boolean
  sessionLabel?: string
  active: boolean
}

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 1000] as const
const IO_FORMATS: BrowseDataFormat[] = ['csv', 'sql', 'xls', 'json']

function isIdentityColumn(col: PostgresColumnInfo): boolean {
  return col.identity === 'always' || col.identity === 'by_default'
}

function hasColumnDefault(col: PostgresColumnInfo): boolean {
  return Boolean(col.default && String(col.default).trim())
}

export function usePostgresBrowsePane(props: PostgresBrowsePaneProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const nav = useConnectionNavigation()

  const page = ref(1)
  const pageSize = ref(100)
  const totalRows = ref(0)
  const filterOpen = ref(false)
  const filterDraft = ref('')
  const appliedWhereSql = ref('')
  const lastDataSql = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const metaReady = ref(false)
  const lastResult = shallowRef<PostgresQueryExecResult | null>(null)
  const pkColumns = ref<string[]>([])
  const tableColumns = ref<PostgresColumnInfo[]>([])
  const objectType = ref('')
  const rawRows = shallowRef<unknown[][]>([])
  const selectedRowKeys = ref<string[]>([])
  const resultRows = ref<BrowseDataRow[]>([])
  const deleteConfirm = ref(false)
  const importMenuOpen = ref(false)
  const exportMenuOpen = ref(false)
  const ddlMenuOpen = ref(false)
  const ddlLoading = ref(false)
  const ddlText = ref('')

  let flushingNewRow = false
  let newRowSeq = 0

  const isView = computed(() => {
    if (props.isView === true) return true
    const ot = objectType.value.trim().toLowerCase()
    return ot.includes('view')
  })

  const databaseName = computed(() => props.database?.trim() ?? '')
  const schemaName = computed(() => props.schema?.trim() || 'public')
  const tableName = computed(() => props.table?.trim() ?? '')

  /** 有主键用 PK 定位；无主键用全列 WHERE（对齐 DBeaver / Navicat / MySQL 浏览页）。 */
  const canEdit = computed(() => !isView.value && tableColumns.value.length > 0)
  const canInsert = computed(() => tableColumns.value.length > 0 && !isView.value)

  const scopeLabel = computed(() => {
    if (!tableName.value) return ''
    return `${databaseName.value}.${schemaName.value}.${tableName.value}`
  })

  const scopeOk = computed(() =>
    Boolean(props.sessionId && databaseName.value && schemaName.value && tableName.value),
  )

  const shellLabels = computed(
    (): BrowseDataShellLabels => ({
      toolbarLabel: t('modules.postgres.browse.toolbarLabel'),
      featureLabel: isView.value
        ? t('modules.postgres.browse.featureView')
        : t('modules.postgres.browse.featureTable'),
      insert: t('modules.postgres.browse.insertRow'),
      insertTooltip: t('modules.postgres.browse.insertRowTooltip'),
      delete: t('modules.postgres.browse.deleteRows'),
      deleteTooltip: t('modules.postgres.browse.deleteRows'),
      import: t('modules.postgres.browse.import'),
      importTooltip: t('modules.postgres.browse.importTooltip'),
      export: t('modules.postgres.browse.export'),
      exportTooltip: t('modules.postgres.browse.exportTooltip'),
      filter: t('modules.postgres.browse.filter'),
      filterToggle: t('modules.postgres.browse.filterToggle'),
      refresh: t('modules.postgres.browse.refresh'),
      needTable: t('modules.postgres.browse.needTable'),
      empty: t('modules.postgres.browse.empty'),
    }),
  )

  const hasNewRow = computed(() => resultRows.value.some((r) => r.__isNew))
  const tableEditable = computed(() => canEdit.value || hasNewRow.value)
  const canDeleteSelection = computed(() => {
    if (selectedRowKeys.value.length === 0) return false
    if (selectedRowKeys.value.some((k) => String(k).startsWith('new-'))) return true
    return !isView.value && tableColumns.value.length > 0
  })

  const statusMeta = computed(() => {
    if (!lastResult.value) return ''
    const parts: string[] = []
    if (lastResult.value.durationMs != null) parts.push(`${lastResult.value.durationMs} ms`)
    if (selectedRowKeys.value.length > 0) {
      parts.push(t('modules.postgres.browse.statusSelected', { count: selectedRowKeys.value.length }))
    }
    return parts.join(' · ')
  })

  const statusHint = computed(() => {
    if (!lastResult.value) return ''
    if (isView.value) return t('modules.postgres.browse.viewReadonly')
    if (pkColumns.value.length === 0 && (canEdit.value || hasNewRow.value)) {
      return t('modules.postgres.browse.noPk')
    }
    return canEdit.value || hasNewRow.value ? t('modules.postgres.browse.editHint') : ''
  })

  const columnMetaByName = computed(() => {
    const map = new Map<string, PostgresColumnInfo>()
    for (const col of tableColumns.value) {
      map.set(col.name, col)
      map.set(col.name.toLowerCase(), col)
    }
    return map
  })

  const resultColumns = computed((): RsTableColumn<BrowseDataRow>[] => {
    const cols = lastResult.value?.columns ?? []
    const pk = new Set(pkColumns.value.map((n) => n.toLowerCase()))
    if (cols.length === 0) {
      return [{ key: 'value', title: t('modules.postgres.browse.colValue'), minWidth: 120 }]
    }
    return cols.map((c: PostgresQueryColumn) => {
      const meta =
        columnMetaByName.value.get(c.name) ?? columnMetaByName.value.get(c.name.toLowerCase())
      const isPk = pk.has(c.name.toLowerCase())
      const typeLabel = (meta?.dataType || c.dataType || '').trim()
      const dataType = typeLabel || undefined
      const nullable = typeof c.nullable === 'boolean' ? c.nullable : meta?.nullable
      const tipLines = [t('modules.postgres.browse.colTipField', { name: c.name })]
      if (typeLabel) tipLines.push(t('modules.postgres.browse.colTipType', { type: typeLabel }))
      tipLines.push(
        t('modules.postgres.browse.colTipPrimary', {
          value: isPk ? t('modules.postgres.browse.colTipYes') : t('modules.postgres.browse.colTipNo'),
        }),
      )
      if (typeof nullable === 'boolean') {
        tipLines.push(
          t('modules.postgres.browse.colTipNullable', {
            value: nullable
              ? t('modules.postgres.browse.colTipYes')
              : t('modules.postgres.browse.colTipNo'),
          }),
        )
      }
      return buildBrowseResultColumn({
        name: c.name,
        dataType,
        headerTip: tipLines.join('\n'),
        width: 120,
        minWidth: 96,
        nullable: nullable !== false,
        canEdit: canEdit.value,
        isBinCell: isBrowseBinCell,
      })
    })
  })

  const filterSqlConfig = computed((): RsCodeEditorSqlConfig | undefined => {
    const table = tableName.value
    if (!table || tableColumns.value.length === 0) return undefined
    const columns = tableColumns.value.map((c) => ({
      label: c.name,
      detail: c.dataType || undefined,
      type: 'property' as const,
      boost: 99,
    }))
    return {
      dialect: 'standard',
      schema: { [schemaName.value]: { [table]: columns } },
      defaultSchema: schemaName.value,
      defaultTable: table,
    }
  })

  /** 有主键时用 PK 作稳定 rowKey，删行时其它行不整表重挂载。 */
  function stableRowKey(row: unknown[], rowIdx: number): string {
    const res = lastResult.value
    if (!res || pkColumns.value.length === 0) return String(rowIdx)
    const parts: string[] = []
    for (const pk of pkColumns.value) {
      const i = (res.columns ?? []).findIndex((c) => c.name === pk)
      if (i < 0) return String(rowIdx)
      const cell = row[i]
      if (cell === null || cell === undefined || cell === '') return String(rowIdx)
      parts.push(String(cell))
    }
    return `pk:${parts.join('\0')}`
  }

  function rebuildDisplayRows(): void {
    const res = lastResult.value
    const draft = resultRows.value.find((r) => r.__isNew)
    if (!res) {
      resultRows.value = draft ? [draft] : []
      return
    }
    const cols = res.columns ?? []
    const rows = rawRows.value.map((row, rowIdx) => {
      const obj: BrowseDataRow = {
        __rowKey: stableRowKey(row, rowIdx),
        __rowIndex: rowIdx,
      }
      cols.forEach((col, colIdx) => {
        obj[col.name] = row[colIdx]
      })
      return obj
    })
    resultRows.value = draft ? [draft, ...rows] : rows
  }

  function normalizeWhere(raw: string): string {
    return raw.trim().replace(/^where\s+/i, '').trim()
  }

  function orderByClause(): string {
    if (pkColumns.value.length > 0) {
      return pkColumns.value.map((c) => quoteIdent(c)).join(', ')
    }
    const first = tableColumns.value[0]?.name
    if (first) return quoteIdent(first)
    return '1'
  }

  function parseCount(result: PostgresQueryExecResult): number {
    const cell = result.rows?.[0]?.[0]
    const n = typeof cell === 'number' ? cell : Number(cell)
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
  }

  async function ensureMeta(): Promise<void> {
    if (!props.sessionId || !databaseName.value || !tableName.value) return
    if (metaReady.value && tableColumns.value.length > 0) return
    const base = {
      sessionId: props.sessionId,
      database: databaseName.value,
      schema: schemaName.value,
      table: tableName.value,
    }
    const [pk, cols, ddl] = await Promise.all([
      postgresApi.metaPrimaryKey(base).catch(() => ({ columns: [] as string[] })),
      postgresApi.metaColumns(base),
      postgresApi.metaDDL(base).catch(() => ({ objectType: '', ddl: '' })),
    ])
    pkColumns.value = pk.columns ?? []
    tableColumns.value = cols.columns ?? []
    objectType.value = ddl.objectType ?? objectType.value
    metaReady.value = true
  }

  async function loadData(options?: { silent?: boolean }): Promise<void> {
    if (!props.sessionId || !databaseName.value || !tableName.value) return
    const silent = Boolean(options?.silent)
    if (!silent) loading.value = true
    flushingNewRow = true
    if (!silent) {
      resultRows.value = resultRows.value.filter((r) => !r.__isNew)
      selectedRowKeys.value = []
    }
    flushingNewRow = false
    try {
      await ensureMeta()
      const n = pageSize.value || 100
      const offset = Math.max(0, (page.value - 1) * n)
      const from = qualifiedName(schemaName.value, tableName.value)
      const where = appliedWhereSql.value.trim()
      const whereSql = where ? `\nWHERE ${where}` : ''
      const orderSql = `\nORDER BY ${orderByClause()}`
      const dataSql = `SELECT *\nFROM ${from}${whereSql}${orderSql}\nLIMIT ${n} OFFSET ${offset}`
      const [countResult, result] = await Promise.all([
        postgresApi.queryExec({
          sessionId: props.sessionId,
          database: databaseName.value,
          sql: `SELECT COUNT(*)::bigint AS cnt\nFROM ${from}${whereSql}`,
          limit: 1,
        }),
        postgresApi.queryExec({
          sessionId: props.sessionId,
          database: databaseName.value,
          sql: dataSql,
          limit: n,
        }),
      ])
      lastDataSql.value = dataSql
      totalRows.value = parseCount(countResult)
      lastResult.value = result
      rawRows.value = (result.rows ?? []).map((r) => [...r])
      rebuildDisplayRows()
      const maxPage = Math.max(1, Math.ceil(totalRows.value / n) || 1)
      if (page.value > maxPage) {
        page.value = maxPage
        return
      }
      if (result.truncated) {
        toast.info(t('modules.postgres.query.truncatedCap', { count: result.rowCount }))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.postgres.browse.dataError'))
    } finally {
      if (!silent) loading.value = false
    }
  }

  function applyFilters(): void {
    appliedWhereSql.value = normalizeWhere(filterDraft.value)
    page.value = 1
    void loadData()
  }

  function refresh(): void {
    const next = normalizeWhere(filterDraft.value)
    if (next !== appliedWhereSql.value) {
      appliedWhereSql.value = next
      page.value = 1
    }
    void loadData()
  }

  function onFilterKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return
    if (isBrowseFilterCompletionOpen(ev)) return
    ev.preventDefault()
    ev.stopPropagation()
    applyFilters()
  }

  function displayColumns(): PostgresQueryColumn[] {
    return lastResult.value?.columns ?? []
  }

  /** 行定位列：主键优先，否则全列。 */
  function deleteKeyColumns(): string[] {
    if (pkColumns.value.length > 0) return pkColumns.value
    return displayColumns().map((c) => c.name)
  }

  /** 更新/删除定位 WHERE：有 PK 用主键，无 PK 用全列（含 IS NULL）。 */
  function locateWhereForRow(rowIdx: number): string | null {
    const res = lastResult.value
    if (!res || isView.value) return null
    const keys = deleteKeyColumns()
    if (keys.length === 0) return null
    const cols = res.columns ?? []
    const parts = keys.map((col) => {
      const i = cols.findIndex((c) => c.name === col)
      const raw = i >= 0 ? rawRows.value[rowIdx]?.[i] : null
      return sqlWhereEquals(col, raw)
    })
    return parts.join(' AND ')
  }

  function coerceBrowseEditValue(draft: unknown, previousRaw?: unknown): unknown {
    return parseEditValue(draft, previousRaw)
  }

  async function onCellEditCommit(
    row: BrowseDataRow,
    column: RsTableColumn<BrowseDataRow>,
    _index: number,
    value: unknown,
  ): Promise<void> {
    if (!row.__isNew) return
    const idx = resultRows.value.findIndex((r) => r.__rowKey === row.__rowKey)
    if (idx < 0) return
    const colName = String(column.key)
    const previousRaw = resultRows.value[idx]![colName]
    const nextRaw = coerceBrowseEditValue(value, previousRaw)
    const nextRow: BrowseDataRow = { ...resultRows.value[idx]!, [colName]: nextRaw }
    const copy = [...resultRows.value]
    copy[idx] = nextRow
    resultRows.value = copy
  }

  async function applyRowChanges(row: BrowseDataRow, changes: BrowseRowChange[]): Promise<void> {
    if (!props.sessionId || !tableName.value || !changes.length) return

    if (row.__isNew) {
      const idx = resultRows.value.findIndex((r) => r.__rowKey === row.__rowKey)
      if (idx >= 0) {
        const nextRow: BrowseDataRow = { ...resultRows.value[idx]! }
        for (const ch of changes) {
          nextRow[ch.colKey] = coerceBrowseEditValue(ch.value, ch.previous)
        }
        const copy = [...resultRows.value]
        copy[idx] = nextRow
        resultRows.value = copy
        void flushNewRow(nextRow)
      }
      return
    }

    if (!canEdit.value) return
    const rowIdx = row.__rowIndex
    const res = lastResult.value
    const cols = res?.columns ?? []
    if (!res || rowIdx < 0 || rowIdx >= rawRows.value.length) return

    const where = locateWhereForRow(rowIdx)
    if (!where) return

    const setParts: string[] = []
    const applied: Array<{ colIdx: number; nextRaw: unknown; previousRaw: unknown }> = []
    for (const ch of changes) {
      const colIdx = cols.findIndex((c) => c.name === ch.colKey)
      if (colIdx < 0) continue
      const previousRaw = rawRows.value[rowIdx]![colIdx]
      const nextRaw = coerceBrowseEditValue(ch.value, previousRaw)
      if (toSqlLiteral(previousRaw) === toSqlLiteral(nextRaw)) continue
      setParts.push(`${quoteIdent(ch.colKey)} = ${toSqlLiteral(nextRaw)}`)
      applied.push({ colIdx, nextRaw, previousRaw })
    }
    if (!setParts.length) return

    const sql =
      `UPDATE ${qualifiedName(schemaName.value, tableName.value)}\n` +
      `SET ${setParts.join(', ')}\nWHERE ${where}`

    const next = [...rawRows.value]
    const nextRow = [...next[rowIdx]!]
    for (const item of applied) nextRow[item.colIdx] = item.nextRaw
    next[rowIdx] = nextRow
    rawRows.value = next
    rebuildDisplayRows()

    saving.value = true
    try {
      await postgresApi.queryExec({
        sessionId: props.sessionId,
        database: databaseName.value,
        sql,
      })
      toast.success(t('modules.postgres.browse.cellSaved'))
    } catch (e) {
      const rollback = [...rawRows.value]
      const rollbackRow = [...rollback[rowIdx]!]
      for (const item of applied) rollbackRow[item.colIdx] = item.previousRaw
      rollback[rowIdx] = rollbackRow
      rawRows.value = rollback
      rebuildDisplayRows()
      toast.error(e instanceof Error ? e.message : t('modules.postgres.browse.cellSaveError'))
    } finally {
      saving.value = false
    }
  }

  function discardNewRow(rowKey?: string): void {
    const key = rowKey ?? resultRows.value.find((r) => r.__isNew)?.__rowKey
    if (!key) return
    resultRows.value = resultRows.value.filter((r) => r.__rowKey !== key)
    selectedRowKeys.value = selectedRowKeys.value.filter((k) => k !== key)
  }

  function isEmptyCell(value: unknown): boolean {
    if (value === null || value === undefined) return true
    if (typeof value === 'string' && value.trim() === '') return true
    return false
  }

  function createDraftRow(): BrowseDataRow {
    const cols = displayColumns()
    newRowSeq += 1
    const row: BrowseDataRow = {
      __rowKey: `new-${newRowSeq}`,
      __rowIndex: -1,
      __isNew: true,
    }
    for (const col of cols) {
      row[col.name] = null
    }
    return row
  }

  function mapResultRowToDisplay(
    result: PostgresQueryExecResult,
    displayCols: PostgresQueryColumn[],
  ): unknown[] | null {
    const row = result.rows?.[0]
    const srcCols = result.columns ?? []
    if (!row || srcCols.length === 0 || displayCols.length === 0) return null
    const byName = new Map<string, unknown>()
    srcCols.forEach((col, i) => {
      byName.set(col.name, row[i])
      byName.set(col.name.toLowerCase(), row[i])
    })
    return displayCols.map(
      (col) => byName.get(col.name) ?? byName.get(col.name.toLowerCase()) ?? null,
    )
  }

  /** 插入成功后就地晋升为正式行，避免整表刷新闪烁。 */
  function promoteInsertedRow(draft: BrowseDataRow, insertedRaw: unknown[] | null): void {
    const displayCols = displayColumns()
    if (!lastResult.value) {
      lastResult.value = {
        requestId: `insert-${Date.now()}`,
        columns: displayCols,
        rows: [],
        rowCount: 0,
        durationMs: 0,
      }
    }

    const raw =
      insertedRaw && insertedRaw.length === displayCols.length
        ? [...insertedRaw]
        : displayCols.map((col) => {
            const v = draft[col.name]
            return v === undefined ? null : coerceBrowseEditValue(v)
          })

    flushingNewRow = true
    const draftKey = draft.__rowKey
    resultRows.value = resultRows.value.filter((r) => r.__rowKey !== draftKey)

    const nextRaw = [raw, ...rawRows.value]
    const limit = pageSize.value || 100
    rawRows.value = nextRaw.length > limit ? nextRaw.slice(0, limit) : nextRaw
    totalRows.value += 1
    rebuildDisplayRows()
    selectedRowKeys.value = rawRows.value.length > 0 ? [stableRowKey(rawRows.value[0]!, 0)] : []
    void nextTick(() => {
      flushingNewRow = false
    })
  }

  async function flushNewRow(row: BrowseDataRow): Promise<boolean> {
    if (!row.__isNew || !props.sessionId || !tableName.value) return true

    const cols = tableColumns.value
    const names: string[] = []
    const values: string[] = []
    let anyFilled = false
    let needOverriding = false

    for (const col of cols) {
      const raw = row[col.name]
      if (isEmptyCell(raw)) continue
      anyFilled = true
      if (col.identity === 'always') needOverriding = true
      names.push(quoteIdent(col.name))
      values.push(toSqlLiteral(coerceBrowseEditValue(raw)))
    }

    if (!anyFilled) {
      discardNewRow(row.__rowKey)
      return true
    }

    for (const col of cols) {
      if (col.nullable || hasColumnDefault(col) || isIdentityColumn(col)) continue
      if (isEmptyCell(row[col.name])) {
        toast.error(t('modules.postgres.browse.insertRequired', { name: col.name }))
        flushingNewRow = true
        selectedRowKeys.value = [row.__rowKey]
        await nextTick()
        flushingNewRow = false
        return false
      }
    }

    const target = qualifiedName(schemaName.value, tableName.value)
    const overriding = needOverriding ? ' OVERRIDING SYSTEM VALUE' : ''
    const sql =
      `INSERT INTO ${target}${overriding} (${names.join(', ')})\n` +
      `VALUES (${values.join(', ')})\nRETURNING *`
    saving.value = true
    try {
      const result = await postgresApi.queryExec({
        sessionId: props.sessionId,
        database: databaseName.value,
        sql,
        limit: 1,
      })
      toast.success(t('modules.postgres.browse.insertDone'))
      promoteInsertedRow(row, mapResultRowToDisplay(result, displayColumns()))
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.postgres.browse.insertError'))
      flushingNewRow = true
      selectedRowKeys.value = [row.__rowKey]
      await nextTick()
      flushingNewRow = false
      return false
    } finally {
      saving.value = false
    }
  }

  async function openInsert(): Promise<void> {
    if (!canInsert.value || !props.sessionId || !tableName.value) return
    if (!lastResult.value) await loadData()
    if (!lastResult.value) return

    const existing = resultRows.value.find((r) => r.__isNew)
    if (existing) {
      selectedRowKeys.value = [existing.__rowKey]
      return
    }

    const row = createDraftRow()
    resultRows.value = [row, ...resultRows.value]
    selectedRowKeys.value = [row.__rowKey]
  }

  function requestDelete(): void {
    if (!canDeleteSelection.value) return
    const onlyDrafts = selectedRowKeys.value.every((k) => String(k).startsWith('new-'))
    if (onlyDrafts) {
      for (const key of selectedRowKeys.value) discardNewRow(key)
      return
    }
    deleteConfirm.value = true
  }

  async function confirmDelete(): Promise<void> {
    if (!props.sessionId || !tableName.value) return

    const draftKeys = selectedRowKeys.value.filter((k) => String(k).startsWith('new-'))
    for (const key of draftKeys) discardNewRow(key)

    const selected = new Set(selectedRowKeys.value.map(String))
    const indexes: number[] = []
    for (let i = 0; i < rawRows.value.length; i++) {
      const key = stableRowKey(rawRows.value[i]!, i)
      if (selected.has(key) || selected.has(String(i))) indexes.push(i)
    }
    if (indexes.length === 0) {
      deleteConfirm.value = false
      return
    }
    if (isView.value || deleteKeyColumns().length === 0) return

    const uniqueIndexes = [...new Set(indexes)].sort((a, b) => a - b)
    saving.value = true
    try {
      for (const rowIdx of uniqueIndexes) {
        const where = locateWhereForRow(rowIdx)
        if (!where) continue
        await postgresApi.queryExec({
          sessionId: props.sessionId,
          database: databaseName.value,
          sql: `DELETE FROM ${qualifiedName(schemaName.value, tableName.value)}\nWHERE ${where}`,
        })
      }
      const removed = new Set(uniqueIndexes)
      rawRows.value = rawRows.value.filter((_, i) => !removed.has(i))
      totalRows.value = Math.max(0, totalRows.value - uniqueIndexes.length)
      selectedRowKeys.value = []
      rebuildDisplayRows()
      toast.success(t('modules.postgres.browse.deleteDone', { count: uniqueIndexes.length }))
      deleteConfirm.value = false
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.postgres.browse.deleteError'))
      await loadData({ silent: true })
    } finally {
      saving.value = false
    }
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

  function columnNamesForClipboard(): string[] {
    return displayColumns().map((c) => c.name)
  }

  function selectedRowsForCopy(): BrowseDataRow[] {
    const selected = new Set(selectedRowKeys.value)
    return resultRows.value.filter((r) => selected.has(r.__rowKey))
  }

  function resolveRowsForCopy(
    row: BrowseDataRow | null,
    selected: BrowseDataRow[],
  ): BrowseDataRow[] {
    const fromSelected = (selected.length > 0 ? selected : selectedRowsForCopy()).filter(
      (r) => !r.__isNew,
    )
    if (fromSelected.length > 0) return fromSelected
    if (row && !row.__isNew) return [row]
    return []
  }

  async function writeClipboardRows(text: string, count: number): Promise<void> {
    const ok = await copyTextToClipboard(text)
    if (!ok) {
      toast.error(t('modules.postgres.browse.copyError'))
      return
    }
    toast.success(t('modules.postgres.browse.copyDone', { count }))
  }

  async function copySelectedRows(
    row: BrowseDataRow | null = null,
    selected: BrowseDataRow[] = [],
  ): Promise<void> {
    const cols = columnNamesForClipboard()
    const rows =
      row || selected.length > 0 ? resolveRowsForCopy(row, selected) : selectedRowsForCopy()
    if (cols.length === 0 || rows.length === 0) {
      toast.info(t('modules.postgres.browse.copyEmpty'))
      return
    }
    const matrix = rows.map((r) => cols.map((name) => r[name]))
    await writeClipboardRows(formatRowsAsTsv(cols, matrix), rows.length)
  }

  async function copySelectedAsInsert(
    row: BrowseDataRow | null,
    selected: BrowseDataRow[],
  ): Promise<void> {
    if (!tableName.value) return
    const cols = columnNamesForClipboard()
    const rows = resolveRowsForCopy(row, selected)
    if (cols.length === 0 || rows.length === 0) {
      toast.info(t('modules.postgres.browse.copyEmpty'))
      return
    }
    const matrix = rows.map((r) => cols.map((name) => r[name]))
    const text = buildInsertSqlText(
      schemaName.value,
      tableName.value,
      cols.map((name) => ({ name })),
      matrix,
    )
    await writeClipboardRows(text, rows.length)
  }

  async function copySelectedAsUpdate(
    row: BrowseDataRow | null,
    selected: BrowseDataRow[],
  ): Promise<void> {
    if (!tableName.value) return
    const cols = columnNamesForClipboard()
    const rows = resolveRowsForCopy(row, selected)
    if (cols.length === 0 || rows.length === 0) {
      toast.info(t('modules.postgres.browse.copyEmpty'))
      return
    }
    const text = buildUpdateSqlText(
      schemaName.value,
      tableName.value,
      cols,
      pkColumns.value,
      rows,
      cols,
    )
    await writeClipboardRows(text, rows.length)
  }

  async function copySelectedAsDelete(
    row: BrowseDataRow | null,
    selected: BrowseDataRow[],
  ): Promise<void> {
    if (!tableName.value) return
    const rows = resolveRowsForCopy(row, selected)
    if (rows.length === 0) {
      toast.info(t('modules.postgres.browse.copyEmpty'))
      return
    }
    const text = buildDeleteSqlText(
      schemaName.value,
      tableName.value,
      pkColumns.value,
      rows,
      columnNamesForClipboard(),
    )
    await writeClipboardRows(text, rows.length)
  }

  async function pasteIntoInsertRows(): Promise<void> {
    if (!canInsert.value || !lastResult.value) return
    const text = await readClipboardText()
    if (!text?.trim()) {
      toast.info(t('modules.postgres.browse.pasteEmpty'))
      return
    }
    const cols = columnNamesForClipboard()
    const records = mapPasteToColumnRecords(cols, parseClipboardMatrix(text))
    if (records.length === 0) {
      toast.info(t('modules.postgres.browse.pasteEmpty'))
      return
    }

    flushingNewRow = true
    const existingDrafts = resultRows.value.filter((r) => r.__isNew)
    const rest = resultRows.value.filter((r) => !r.__isNew)
    const filled: BrowseDataRow[] = []

    for (let i = 0; i < records.length; i++) {
      const base = existingDrafts[i] ?? createDraftRow()
      const next: BrowseDataRow = { ...base, __isNew: true }
      for (const [name, raw] of Object.entries(records[i]!)) {
        next[name] = raw.trim() === '' ? null : coerceBrowseEditValue(raw)
      }
      filled.push(next)
    }

    resultRows.value = [...filled, ...rest]
    selectedRowKeys.value = filled.map((r) => r.__rowKey)
    await nextTick()
    flushingNewRow = false
    toast.success(t('modules.postgres.browse.pasteDone', { count: filled.length }))
  }

  function onBrowseKeydown(ev: KeyboardEvent): void {
    if (!props.active || isTypingTarget(ev.target)) return
    const mod = ev.ctrlKey || ev.metaKey
    if (!mod || ev.altKey || ev.shiftKey) return
    const key = ev.key.toLowerCase()
    if (key === 'c') {
      if (selectedRowKeys.value.length === 0) return
      ev.preventDefault()
      void copySelectedRows()
      return
    }
    if (key === 'v') {
      if (!canInsert.value) return
      ev.preventDefault()
      void pasteIntoInsertRows()
    }
  }

  function isBrowseRowPending(row: BrowseDataRow): boolean {
    return Boolean(row.__isNew)
  }

  function onBrowseRowEditCommit(
    row: BrowseDataRow,
    _index: number,
    changes: BrowseRowChange[] = [],
  ): void {
    void applyRowChanges(row, changes)
  }

  function onBrowseRowEditRollback(row: BrowseDataRow): void {
    if (row.__isNew) discardNewRow(row.__rowKey)
  }

  function formatLabel(format: BrowseDataFormat): string {
    if (format === 'csv') return t('modules.postgres.browse.formatCsv')
    if (format === 'sql') return t('modules.postgres.browse.formatSql')
    if (format === 'json') return t('modules.postgres.browse.formatJson')
    if (format === 'tsv') return t('modules.postgres.browse.formatTsv')
    return t('modules.postgres.browse.formatXls')
  }

  function formatIcon(format: BrowseDataFormat): string {
    if (format === 'csv') return 'file-text'
    if (format === 'sql') return 'file-code'
    if (format === 'json') return 'braces'
    if (format === 'tsv') return 'file-text'
    return 'file-spreadsheet'
  }

  const importMenuItems = computed(() =>
    IO_FORMATS.map((fmt) => ({
      key: fmt,
      label: formatLabel(fmt),
      icon: formatIcon(fmt),
      disabled: !canInsert.value || saving.value,
    })),
  )

  const exportMenuItems = computed(() => [
    ...IO_FORMATS.map((fmt) => ({
      key: fmt,
      label: formatLabel(fmt),
      icon: formatIcon(fmt),
      disabled: rawRows.value.length === 0 || saving.value,
    })),
    {
      key: 'fullCsv',
      label: t('modules.postgres.browse.formatCsvFull'),
      icon: 'database',
      disabled: !props.profileId || !databaseName.value || !tableName.value || saving.value,
    },
  ])

  function openBrowseIo(kind: 'export_csv' | 'import_csv'): void {
    if (!props.profileId) {
      toast.error(
        t(
          kind === 'export_csv'
            ? 'modules.postgres.browse.exportNeedProfile'
            : 'modules.postgres.browse.importNeedProfile',
        ),
      )
      return
    }
    if (!databaseName.value || !tableName.value) {
      toast.error(t('modules.postgres.browse.needTable'))
      return
    }
    const scope = `${schemaName.value}.${tableName.value}`
    const titleKey =
      kind === 'export_csv' ? 'modules.postgres.io.exportTitle' : 'modules.postgres.io.importTitle'
    const descKey =
      kind === 'export_csv' ? 'modules.postgres.io.exportDesc' : 'modules.postgres.io.importDesc'
    openPostgresDataTask({
      kind,
      title: `${scope} · ${t(titleKey)}`,
      description: t(descKey, { name: scope }),
      context: {
        conn: { profileId: props.profileId, kind: 'postgres' } as ConnItem,
        profileId: props.profileId,
        sessionId: props.sessionId,
        database: databaseName.value,
        schema: schemaName.value,
        table: tableName.value,
      },
    })
  }

  async function exportPage(format: BrowseDataFormat): Promise<void> {
    exportMenuOpen.value = false
    if (!tableName.value) {
      toast.error(t('modules.postgres.browse.needTable'))
      return
    }
    if (rawRows.value.length === 0 || !lastResult.value) {
      toast.info(t('modules.postgres.browse.empty'))
      return
    }

    const columns = (lastResult.value.columns ?? []).map((c) => ({ name: c.name }))
    const payload = buildBrowseExportPayload(format, {
      schema: schemaName.value,
      table: tableName.value,
      columns,
      rows: rawRows.value,
      baseName: `${schemaName.value}_${tableName.value}`,
    })

    await nextTick()
    try {
      const picked = await dialogApi.saveFile({
        title: t('modules.postgres.browse.export'),
        defaultPath: payload.filename,
        accept: payload.accept,
      })
      if (picked.canceled || !picked.filePaths[0]) return
      await fsApi.writeText({ path: picked.filePaths[0], content: payload.content })
      const formatName = formatLabel(format)
      const pageCount = rawRows.value.length
      if (totalRows.value > pageCount) {
        toast.success(
          t('modules.postgres.browse.exportPagePartialDone', {
            page: pageCount,
            format: formatName,
          }),
        )
      } else {
        toast.success(
          t('modules.postgres.browse.exportDone', {
            count: pageCount,
            format: formatName,
          }),
        )
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.postgres.browse.exportError'))
    }
  }

  async function triggerImport(format: BrowseDataFormat): Promise<void> {
    importMenuOpen.value = false
    if (!canInsert.value || !props.sessionId || !tableName.value) return
    await nextTick()
    try {
      const picked = await dialogApi.openFile({
        title: t('modules.postgres.browse.import'),
        accept: acceptExtensionsForFormat(format),
      })
      if (picked.canceled || !picked.filePaths[0]) return
      const file = await fsApi.readText({ path: picked.filePaths[0] })
      await importFromText(format, file.content ?? '')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.postgres.browse.importError'))
    }
  }

  async function importFromText(format: BrowseDataFormat, text: string): Promise<void> {
    if (!props.sessionId || !tableName.value) return

    if (!text.trim()) {
      toast.error(t('modules.postgres.browse.importEmpty'))
      return
    }
    if (format === 'xls' && looksLikeOfficeZip(text)) {
      toast.error(t('modules.postgres.browse.importNeedSpreadsheetMl'))
      return
    }

    const parsed = parseBrowseImport(format, text)
    if (parsed.headers.length === 0) {
      toast.error(t('modules.postgres.browse.importParseError', { format: formatLabel(format) }))
      return
    }
    if (parsed.rows.length === 0) {
      toast.error(t('modules.postgres.browse.importEmpty'))
      return
    }

    const colSet = new Set(tableColumns.value.map((c) => c.name))
    const mapped = parsed.headers
      .map((h, i) => ({ name: h, index: i }))
      .filter((c) => colSet.has(c.name))
    if (mapped.length === 0) {
      toast.error(t('modules.postgres.browse.importNoColumns'))
      return
    }

    const batchSize = 40
    saving.value = true
    let inserted = 0
    try {
      for (let offset = 0; offset < parsed.rows.length; offset += batchSize) {
        const chunk = parsed.rows.slice(offset, offset + batchSize)
        const valueTuples = chunk.map((row) => {
          const vals = mapped.map((m) => {
            const cell = row[m.index]
            if (cell === undefined || cell === '') return 'NULL'
            return toSqlLiteral(cell)
          })
          return `(${vals.join(', ')})`
        })
        const sql =
          `INSERT INTO ${qualifiedName(schemaName.value, tableName.value)} ` +
          `(${mapped.map((m) => quoteIdent(m.name)).join(', ')})\nVALUES\n` +
          valueTuples.join(',\n')
        await postgresApi.queryExec({
          sessionId: props.sessionId,
          database: databaseName.value,
          sql,
        })
        inserted += chunk.length
      }
      toast.success(t('modules.postgres.browse.importDone', { count: inserted }))
      await loadData()
    } catch (e) {
      toast.error(
        e instanceof Error
          ? `${e.message} (${t('modules.postgres.browse.importPartial', { count: inserted })})`
          : t('modules.postgres.browse.importError'),
      )
      if (inserted > 0) await loadData()
    } finally {
      saving.value = false
    }
  }

  function onImportMenuSelect(key: string): void {
    if (key === 'taskCsv') {
      importMenuOpen.value = false
      openBrowseIo('import_csv')
      return
    }
    if (IO_FORMATS.includes(key as BrowseDataFormat)) {
      void triggerImport(key as BrowseDataFormat)
    }
  }

  function onExportMenuSelect(key: string): void {
    if (key === 'fullCsv') {
      exportMenuOpen.value = false
      openBrowseIo('export_csv')
      return
    }
    if (IO_FORMATS.includes(key as BrowseDataFormat)) {
      void exportPage(key as BrowseDataFormat)
    }
  }

  function contextMenuItems(
    row: BrowseDataRow | null,
    selected: BrowseDataRow[],
  ): RsContextMenuItem[] {
    const items: RsContextMenuItem[] = []
    const canExport = Boolean(lastResult.value && rawRows.value.length > 0)
    const copyTargets = resolveRowsForCopy(row, selected)
    const canCopy = copyTargets.length > 0 || selected.length > 0 || Boolean(row && !row.__isNew)

    items.push({
      key: 'copy',
      label: t('modules.postgres.browse.copy'),
      icon: 'copy',
      disabled: !canCopy,
      children: [
        {
          key: 'copy:tsv',
          label: t('modules.postgres.browse.copyRows'),
          icon: 'copy',
          shortcut: 'Ctrl+C',
          disabled: !canCopy,
        },
        {
          key: 'copy:insert',
          label: t('modules.postgres.browse.copyAsInsert'),
          icon: 'square-plus',
          disabled: !canCopy || !tableName.value,
        },
        {
          key: 'copy:update',
          label: t('modules.postgres.browse.copyAsUpdate'),
          icon: 'pencil',
          disabled: !canCopy || !tableName.value,
        },
        {
          key: 'copy:delete',
          label: t('modules.postgres.browse.copyAsDelete'),
          icon: 'trash-2',
          disabled: !canCopy || !tableName.value,
        },
      ],
    })

    if (canInsert.value) {
      items.push({
        key: 'paste',
        label: t('modules.postgres.browse.pasteRows'),
        icon: 'clipboard-paste',
        shortcut: 'Ctrl+V',
      })
      items.push({ key: 'sep-io', label: '', separator: true })
      items.push({
        key: 'import',
        label: t('modules.postgres.browse.import'),
        icon: 'upload',
        children: IO_FORMATS.map((fmt) => ({
          key: `import:${fmt}`,
          label: formatLabel(fmt),
          icon: formatIcon(fmt),
          disabled: saving.value,
        })),
      })
    } else {
      items.push({ key: 'sep-io', label: '', separator: true })
    }

    items.push({
      key: 'export',
      label: t('modules.postgres.browse.export'),
      icon: 'download',
      disabled: !canExport,
      children: [
        ...IO_FORMATS.map((fmt) => ({
          key: `export:${fmt}`,
          label: formatLabel(fmt),
          icon: formatIcon(fmt),
          disabled: !canExport || saving.value,
        })),
        {
          key: 'export:fullCsv',
          label: t('modules.postgres.browse.formatCsvFull'),
          icon: 'database',
          disabled: !props.profileId || !databaseName.value || !tableName.value || saving.value,
        },
      ],
    })

    const hasDraft = Boolean(row?.__isNew) || selected.some((r) => r.__isNew)
    const canCtxDelete =
      hasDraft ||
      (!isView.value && tableColumns.value.length > 0 && (selected.length > 0 || Boolean(row)))
    if (canCtxDelete) {
      items.push({ key: 'sep-delete', label: '', separator: true })
      items.push({
        key: 'delete',
        label: t('modules.postgres.browse.deleteRows'),
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
      void copySelectedRows(row, selected)
      return
    }
    if (key === 'copy:insert') {
      void copySelectedAsInsert(row, selected)
      return
    }
    if (key === 'copy:update') {
      void copySelectedAsUpdate(row, selected)
      return
    }
    if (key === 'copy:delete') {
      void copySelectedAsDelete(row, selected)
      return
    }
    if (key === 'paste') {
      void pasteIntoInsertRows()
      return
    }
    if (key === 'delete') {
      if (selected.length === 0 && row) selectedRowKeys.value = [row.__rowKey]
      requestDelete()
      return
    }
    if (key.startsWith('import:')) {
      const format = key.slice('import:'.length) as BrowseDataFormat
      if (IO_FORMATS.includes(format)) void triggerImport(format)
      return
    }
    if (key === 'export:fullCsv') {
      openBrowseIo('export_csv')
      return
    }
    if (key.startsWith('export:')) {
      const format = key.slice('export:'.length) as BrowseDataFormat
      if (IO_FORMATS.includes(format)) void exportPage(format)
    }
  }

  const scopeKey = computed(() =>
    [props.sessionId, props.database, props.schema, props.table].filter(Boolean).join('\0'),
  )

  const canOpenDesign = computed(
    () => !isView.value && Boolean(schemaName.value && tableName.value),
  )

  function currentTablePath(): ConnResourcePath | null {
    if (!databaseName.value || !tableName.value) return null
    return {
      segments: [
        { kind: 'database', name: databaseName.value },
        { kind: 'schema', name: schemaName.value },
        { kind: 'category', name: isView.value ? 'views' : 'tables' },
        { kind: 'table', name: tableName.value },
      ],
    }
  }

  async function resolveConnItem(): Promise<ConnItem | null> {
    if (!props.profileId) return null
    const result = await connectionApi.get({ profileId: props.profileId })
    if (!result.profile) return null
    return { ...result.profile, kind: 'postgres' }
  }

  async function loadBrowseDdl(): Promise<void> {
    if (!props.sessionId || !databaseName.value || !tableName.value) return
    ddlLoading.value = true
    try {
      const result = await postgresApi.metaDDL({
        sessionId: props.sessionId,
        database: databaseName.value,
        schema: schemaName.value,
        table: tableName.value,
      })
      objectType.value = result.objectType ?? objectType.value
      try {
        const { formatSql } = await import('@/modules/sql-editor/format')
        ddlText.value = formatSql(result.ddl, { dialect: 'postgresql' })
      } catch {
        ddlText.value = result.ddl
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.postgres.ddl.loadError'))
    } finally {
      ddlLoading.value = false
    }
  }

  async function copyBrowseDdl(): Promise<void> {
    if (!ddlText.value) return
    try {
      await copyTextToClipboard(ddlText.value)
      toast.success(t('modules.postgres.ddl.copied'))
    } catch {
      toast.error(t('modules.postgres.ddl.copyFailed'))
    }
  }

  async function openDesignTable(): Promise<void> {
    ddlMenuOpen.value = false
    if (!canOpenDesign.value) return
    const path = currentTablePath()
    if (!path) return
    try {
      const item = await resolveConnItem()
      if (!item) throw new Error(t('modules.postgres.browse.openDesignFailed'))
      nav.connect(item, {
        resourcePath: path,
        initialTab: 'design',
        designMode: 'alter',
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.postgres.browse.openDesignFailed'))
    }
  }

  async function openDdlTab(): Promise<void> {
    ddlMenuOpen.value = false
    const path = currentTablePath()
    if (!path) return
    try {
      const item = await resolveConnItem()
      if (!item) throw new Error(t('modules.postgres.browse.openDdlFailed'))
      nav.connect(item, {
        resourcePath: path,
        initialTab: 'ddl',
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.postgres.browse.openDdlFailed'))
    }
  }

  watch(
    () => scopeKey.value,
    () => {
      flushingNewRow = true
      page.value = 1
      appliedWhereSql.value = ''
      filterDraft.value = ''
      lastResult.value = null
      rawRows.value = []
      resultRows.value = []
      tableColumns.value = []
      pkColumns.value = []
      objectType.value = ''
      metaReady.value = false
      totalRows.value = 0
      lastDataSql.value = ''
      selectedRowKeys.value = []
      ddlText.value = ''
      ddlMenuOpen.value = false
      flushingNewRow = false
    },
  )

  watch(ddlMenuOpen, (open) => {
    if (open) void loadBrowseDdl()
  })

  watch(
    () => [scopeKey.value, page.value] as const,
    () => {
      if (props.active && scopeOk.value) void loadData()
    },
    { immediate: true },
  )

  watch(
    () => props.active,
    (active) => {
      if (active && scopeOk.value && !lastResult.value && !loading.value) {
        void loadData()
      }
    },
  )

  watch(pageSize, () => {
    if (page.value !== 1) {
      page.value = 1
      return
    }
    if (props.active && scopeOk.value) void loadData()
  })

  watch(selectedRowKeys, async (keys, prev) => {
    if (flushingNewRow || saving.value) return
    const prevDraft = (prev ?? []).find((k) => String(k).startsWith('new-'))
    if (!prevDraft) return
    if (keys.includes(prevDraft)) return
    const draft = resultRows.value.find((r) => r.__rowKey === prevDraft)
    if (draft?.__isNew) await flushNewRow(draft)
  })

  return {
    t,
    page,
    pageSize,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    totalRows,
    filterOpen,
    filterDraft,
    appliedWhereSql,
    lastDataSql,
    loading,
    saving,
    lastResult,
    selectedRowKeys,
    resultRows,
    resultColumns,
    deleteConfirm,
    importMenuOpen,
    exportMenuOpen,
    importMenuItems,
    exportMenuItems,
    shellLabels,
    scopeLabel,
    scopeOk,
    canInsert,
    canEdit,
    canDeleteSelection,
    tableEditable,
    statusMeta,
    statusHint,
    isView,
    filterSqlConfig,
    loadData,
    refresh,
    applyFilters,
    onFilterKeydown,
    openInsert,
    requestDelete,
    confirmDelete,
    onBrowseKeydown,
    onCellEditCommit,
    isBrowseRowPending,
    onBrowseRowEditCommit,
    onBrowseRowEditRollback,
    contextMenuItems,
    onContextMenuSelect,
    onImportMenuSelect,
    onExportMenuSelect,
    openBrowseIo,
    ddlMenuOpen,
    ddlLoading,
    ddlText,
    objectType,
    canOpenDesign,
    copyBrowseDdl,
    openDesignTable,
    openDdlTab,
  }
}

export type UsePostgresBrowsePaneReturn = ReturnType<typeof usePostgresBrowsePane>
