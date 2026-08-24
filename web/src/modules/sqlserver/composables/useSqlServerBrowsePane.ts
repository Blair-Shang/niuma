/**
 * SQL Server Browse：分页 · WHERE · 主键行编辑 · 插入 / 删除。
 * 视图 / 同义词只读。标识列与计算列不写。禁止 import 其它库业务模块。
 */
import {
  copyTextToClipboard,
  readClipboardText,
  useRsToast,
  type RsCodeEditorSqlConfig,
  type RsContextMenuItem,
  type RsTableColumn,
} from '@niuma/ui'
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi } from '@/api'
import { sqlserverApi } from '@/api/sqlserver'
import type { SqlServerColumnInfo, SqlServerQueryExecResult } from '@/api/types/sqlserver'
import {
  buildBrowseResultColumn,
  formatRowsAsTsv,
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
import { qualifiedName, quoteIdent } from '@/modules/sqlserver/sql-seed'
import {
  buildDeleteSqlText,
  buildInsertSqlText,
  buildUpdateSqlText,
} from '@/modules/sqlserver/utils/browse-io'
import { toSqlLiteral } from '@/modules/sqlserver/utils/sql-literal'

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 1000] as const
const BROWSE_GUTTER_WIDTH = 40

export interface SqlServerBrowsePaneProps {
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  table?: string
  isView?: boolean
  sessionLabel?: string
  active: boolean
}

type DraftRow = BrowseDataRow & { __isNew: true }

function normalizeWhere(raw: string): string {
  return raw.trim().replace(/^where\s+/i, '').trim()
}

function parseCount(result: SqlServerQueryExecResult): number {
  const cell = result.rows?.[0]?.[0]
  const n = typeof cell === 'number' ? cell : Number(cell)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

function cellText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function escapeCsv(value: unknown): string {
  const text = cellText(value)
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

function isNewRow(row: BrowseDataRow): row is DraftRow {
  return row.__isNew === true
}

function isWritableColumn(column: SqlServerColumnInfo): boolean {
  return !column.autoIncrement && !column.computed
}

function isRequiredColumn(column: SqlServerColumnInfo): boolean {
  return isWritableColumn(column) && !column.nullable && !column.default
}

export function useSqlServerBrowsePane(props: SqlServerBrowsePaneProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const nav = useConnectionNavigation()

  const loading = ref(false)
  const saving = ref(false)
  const page = ref(1)
  const pageSize = ref(100)
  const totalRows = ref(0)
  const filterOpen = ref(false)
  const filterDraft = ref('')
  const appliedWhereSql = ref('')
  const lastDataSql = ref('')
  const selectedRowKeys = ref<string[]>([])
  const resultRows = ref<BrowseDataRow[]>([])
  const lastResult = shallowRef<SqlServerQueryExecResult | null>(null)
  const rawRows = shallowRef<unknown[][]>([])
  const queryColumns = shallowRef<{ name: string; dataType?: string }[]>([])
  const tableColumns = shallowRef<SqlServerColumnInfo[]>([])
  const pkColumns = ref<string[]>([])
  const metaReady = ref(false)
  const ddlMenuOpen = ref(false)
  const ddlLoading = ref(false)
  const ddlText = ref('')
  const objectType = ref('')
  const exportMenuOpen = ref(false)
  const importMenuOpen = ref(false)
  const deleteConfirm = ref(false)
  let draftSeq = 0

  const isView = computed(() => props.isView === true)
  const databaseName = computed(() => props.database?.trim() ?? '')
  const schemaName = computed(() => props.schema?.trim() || 'dbo')
  const scopeOk = computed(() =>
    Boolean(props.sessionId && props.table && databaseName.value && schemaName.value),
  )
  const scopeLabel = computed(() =>
    props.table ? `${databaseName.value}.${schemaName.value}.${props.table}` : '',
  )
  const displayColumnNames = computed(() => queryColumns.value.map((column) => column.name))
  const fromSql = computed(() => qualifiedName(schemaName.value, props.table ?? ''))
  const canInsert = computed(() => !isView.value && tableColumns.value.length > 0)
  const canEdit = computed(() => canInsert.value)
  const canDelete = computed(() => {
    if (isView.value || selectedRowKeys.value.length === 0) return false
    return tableColumns.value.length > 0 || selectedRowKeys.value.some((key) => key.startsWith('new-'))
  })

  const shellLabels = computed(
    (): BrowseDataShellLabels => ({
      toolbarLabel: t('modules.sqlserver.browse.toolbarLabel'),
      featureLabel: isView.value
        ? t('modules.sqlserver.browse.featureView')
        : t('modules.sqlserver.browse.featureTable'),
      insert: t('modules.sqlserver.browse.insert'),
      insertTooltip: t('modules.sqlserver.browse.insertTooltip'),
      delete: t('modules.sqlserver.browse.delete'),
      deleteTooltip: t('modules.sqlserver.browse.deleteTooltip'),
      import: t('modules.sqlserver.browse.import'),
      importTooltip: t('modules.sqlserver.browse.importTooltip'),
      export: t('modules.sqlserver.browse.export'),
      exportTooltip: t('modules.sqlserver.browse.exportTooltip'),
      filter: t('modules.sqlserver.browse.filter'),
      filterToggle: t('modules.sqlserver.browse.filterToggle'),
      refresh: t('modules.sqlserver.browse.refresh'),
      needTable: t('modules.sqlserver.browse.needTable'),
      empty: t('modules.sqlserver.browse.empty'),
    }),
  )

  const statusMeta = computed(() => {
    if (!lastResult.value) return ''
    const parts = [
      t('modules.sqlserver.browse.statusRowsTotal', {
        n: resultRows.value.filter((row) => !isNewRow(row)).length,
        page: page.value,
        total: totalRows.value,
      }),
    ]
    if (selectedRowKeys.value.length > 0) {
      parts.push(t('modules.sqlserver.browse.statusSelected', { count: selectedRowKeys.value.length }))
    }
    return parts.join(' · ')
  })

  const statusHint = computed(() => {
    if (isView.value) return t('modules.sqlserver.browse.viewReadonlyHint')
    if (!pkColumns.value.length) return t('modules.sqlserver.browse.noPkHint')
    return t('modules.sqlserver.browse.editHint')
  })

  const filterSqlConfig = computed((): RsCodeEditorSqlConfig | undefined => {
    if (!props.table || !tableColumns.value.length) return undefined
    return {
      dialect: 'standard',
      schema: {
        [schemaName.value]: {
          [props.table]: tableColumns.value.map((column) => ({
            label: column.name,
            detail: column.dataType,
            type: 'property' as const,
            boost: 99,
          })),
        },
      },
      defaultSchema: schemaName.value,
      defaultTable: props.table,
    }
  })

  const columnMeta = computed(() => new Map(tableColumns.value.map((c) => [c.name.toLowerCase(), c])))

  const resultColumns = computed((): RsTableColumn<BrowseDataRow>[] =>
    displayColumnNames.value.map((name) => {
      const meta = columnMeta.value.get(name.toLowerCase())
      const typeLabel = (meta?.dataType || queryColumns.value.find((c) => c.name === name)?.dataType || '').trim()
      const isPk = pkColumns.value.some((column) => column.toLowerCase() === name.toLowerCase())
      const nullable = typeof meta?.nullable === 'boolean' ? meta.nullable : undefined
      const tipLines = [t('modules.sqlserver.browse.colTipField', { name })]
      if (typeLabel) tipLines.push(t('modules.sqlserver.browse.colTipType', { type: typeLabel }))
      tipLines.push(
        t('modules.sqlserver.browse.colTipPrimary', {
          value: isPk ? t('modules.sqlserver.browse.colTipYes') : t('modules.sqlserver.browse.colTipNo'),
        }),
      )
      if (typeof nullable === 'boolean') {
        tipLines.push(
          t('modules.sqlserver.browse.colTipNullable', {
            value: nullable
              ? t('modules.sqlserver.browse.colTipYes')
              : t('modules.sqlserver.browse.colTipNo'),
          }),
        )
      }
      const writable = Boolean(meta && isWritableColumn(meta))
      return buildBrowseResultColumn({
        name,
        dataType: typeLabel || undefined,
        headerTip: tipLines.join('\n'),
        width: 120,
        minWidth: 80,
        nullable: nullable !== false,
        canEdit: canEdit.value && writable,
      })
    }),
  )

  /** 有主键时用 PK 作稳定 rowKey，插入/删除时其它行不整表重挂载（对齐 MySQL）。 */
  function stableRowKey(raw: unknown[], rowIdx: number): string {
    if (pkColumns.value.length === 0) return String(rowIdx)
    const parts: string[] = []
    for (const pk of pkColumns.value) {
      const index = queryColumns.value.findIndex((column) => column.name === pk)
      if (index < 0) return String(rowIdx)
      const cell = raw[index]
      if (cell === null || cell === undefined || cell === '') return String(rowIdx)
      parts.push(String(cell))
    }
    return `pk:${parts.join('\0')}`
  }

  function rebuildRows(): void {
    const draft = resultRows.value.find(isNewRow)
    const rows = rawRows.value.map((raw, index) => {
      const row: BrowseDataRow = { __rowKey: stableRowKey(raw, index), __rowIndex: index }
      displayColumnNames.value.forEach((name, col) => {
        row[name] = raw[col]
      })
      return row
    })
    resultRows.value = draft ? [draft, ...rows] : rows
  }

  function rawFromRecord(record: BrowseDataRow): unknown[] {
    return displayColumnNames.value.map((name) => (record[name] === undefined ? null : record[name]))
  }

  function mapOutputToDisplay(result: SqlServerQueryExecResult): unknown[] | null {
    const raw = result.rows?.[0]
    if (!raw?.length || !result.columns?.length) return null
    const byName = new Map<string, unknown>()
    result.columns.forEach((column, index) => {
      byName.set(column.name, raw[index])
      byName.set(column.name.toLowerCase(), raw[index])
    })
    return displayColumnNames.value.map(
      (name) => byName.get(name) ?? byName.get(name.toLowerCase()) ?? null,
    )
  }

  function patchPersistedRow(rowIndex: number, nextRaw: unknown[]): void {
    const rows = rawRows.value.map((item) => [...item])
    if (rowIndex < 0 || rowIndex >= rows.length) return
    rows[rowIndex] = nextRaw
    rawRows.value = rows
    const idx = resultRows.value.findIndex((item) => !isNewRow(item) && item.__rowIndex === rowIndex)
    if (idx < 0) return
    const next: BrowseDataRow = {
      ...resultRows.value[idx]!,
      __rowKey: stableRowKey(nextRaw, rowIndex),
      __rowIndex: rowIndex,
    }
    displayColumnNames.value.forEach((name, col) => {
      next[name] = nextRaw[col]
    })
    delete next.__isNew
    const copy = [...resultRows.value]
    copy[idx] = next
    resultRows.value = copy
  }

  function promoteInsertedRow(draft: DraftRow, insertedRaw: unknown[] | null): void {
    const names = displayColumnNames.value
    const raw =
      insertedRaw && insertedRaw.length === names.length ? [...insertedRaw] : rawFromRecord(draft)
    const limit = pageSize.value
    const nextRaw = [raw, ...rawRows.value]
    rawRows.value = nextRaw.length > limit ? nextRaw.slice(0, limit) : nextRaw
    totalRows.value += 1

    const promoted: BrowseDataRow = { __rowKey: stableRowKey(raw, 0), __rowIndex: 0 }
    names.forEach((name, col) => {
      promoted[name] = raw[col]
    })
    const rest = resultRows.value
      .filter((item) => item.__rowKey !== draft.__rowKey)
      .map((item) => (isNewRow(item) ? item : { ...item, __rowIndex: item.__rowIndex + 1 }))
    const persisted = rest.filter((item) => !isNewRow(item))
    const drafts = rest.filter(isNewRow)
    resultRows.value = [promoted, ...drafts, ...persisted].slice(0, limit + drafts.length)
    selectedRowKeys.value = [promoted.__rowKey]
  }

  function removePersistedRows(rows: BrowseDataRow[]): void {
    const indexes = [...new Set(rows.map((row) => row.__rowIndex).filter((index) => index >= 0))].sort(
      (a, b) => b - a,
    )
    if (!indexes.length) return
    const nextRaw = [...rawRows.value]
    for (const index of indexes) {
      if (index < nextRaw.length) nextRaw.splice(index, 1)
    }
    rawRows.value = nextRaw
    const keys = new Set(rows.map((row) => row.__rowKey))
    resultRows.value = resultRows.value
      .filter((item) => !keys.has(item.__rowKey))
      .map((item) => {
        if (isNewRow(item)) return item
        const shift = indexes.filter((index) => index < item.__rowIndex).length
        return shift ? { ...item, __rowIndex: item.__rowIndex - shift } : item
      })
    totalRows.value = Math.max(0, totalRows.value - indexes.length)
  }

  function locateColumns(): string[] {
    if (pkColumns.value.length > 0) return pkColumns.value
    return displayColumnNames.value
  }

  function rowWhere(row: BrowseDataRow): string | null {
    if (isNewRow(row) || row.__rowIndex < 0) return null
    const raw = rawRows.value[row.__rowIndex]
    if (!raw) return null
    const keys = locateColumns()
    if (!keys.length) return null
    const clauses = keys.map((name) => {
      const index = queryColumns.value.findIndex((column) => column.name === name)
      if (index < 0) return ''
      const value = raw[index]
      if (value == null) return `${quoteIdent(name)} IS NULL`
      return `${quoteIdent(name)} = ${toSqlLiteral(value)}`
    })
    if (clauses.some((item) => !item)) return null
    return clauses.join(' AND ')
  }

  function orderByClause(): string {
    if (pkColumns.value.length > 0) {
      return ` ORDER BY ${pkColumns.value.map((name) => quoteIdent(name)).join(', ')}`
    }
    return ' ORDER BY (SELECT NULL)'
  }

  async function closeResult(result: SqlServerQueryExecResult | null): Promise<void> {
    const resultSetId = result?.resultSetId
    if (!props.sessionId || !resultSetId) return
    try {
      await sqlserverApi.queryClose({ sessionId: props.sessionId, resultSetId })
    } catch {
      // 页已取完时服务端可能已关游标
    }
  }

  async function execSql(sql: string): Promise<SqlServerQueryExecResult> {
    if (!props.sessionId) {
      throw new Error(t('modules.sqlserver.browse.needTable'))
    }
    const result = await sqlserverApi.queryExec({
      sessionId: props.sessionId,
      database: databaseName.value,
      sql,
      limit: 1,
    })
    await closeResult(result)
    return result
  }

  async function loadMeta(): Promise<void> {
    if (!props.sessionId || !databaseName.value || !props.table) {
      tableColumns.value = []
      pkColumns.value = []
      metaReady.value = false
      return
    }
    try {
      const base = {
        sessionId: props.sessionId,
        database: databaseName.value,
        schema: schemaName.value,
        table: props.table,
      }
      const [cols, pk] = await Promise.all([
        sqlserverApi.metaColumns(base),
        sqlserverApi.metaPrimaryKey(base).catch(() => ({ columns: [] as string[] })),
      ])
      tableColumns.value = cols.columns ?? []
      pkColumns.value = pk.columns ?? []
      metaReady.value = true
    } catch (error) {
      metaReady.value = false
      toast.error(error instanceof Error ? error.message : t('modules.sqlserver.browse.metaError'))
    }
  }

  async function loadData(resetPage = false): Promise<void> {
    if (!props.sessionId || !databaseName.value || !props.table) return
    if (resetPage) page.value = 1
    loading.value = true
    try {
      const where = appliedWhereSql.value
      const whereSql = where ? ` WHERE ${where}` : ''
      const offset = (page.value - 1) * pageSize.value

      const countSql = `SELECT COUNT_BIG(*) AS cnt FROM ${fromSql.value}${whereSql}`
      const countResult = await sqlserverApi.queryExec({
        sessionId: props.sessionId,
        database: databaseName.value,
        sql: countSql,
        limit: 1,
      })
      await closeResult(countResult)
      totalRows.value = parseCount(countResult)

      const dataSql = `SELECT * FROM ${fromSql.value}${whereSql}${orderByClause()} OFFSET ${offset} ROWS FETCH NEXT ${pageSize.value} ROWS ONLY`
      lastDataSql.value = dataSql
      const result = await sqlserverApi.queryExec({
        sessionId: props.sessionId,
        database: databaseName.value,
        sql: dataSql,
        limit: pageSize.value,
      })
      await closeResult(result)
      lastResult.value = result
      queryColumns.value = (result.columns ?? []).map((column) => ({
        name: column.name,
        dataType: column.dataType,
      }))
      rawRows.value = result.rows ?? []
      rebuildRows()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.sqlserver.browse.loadError'))
    } finally {
      loading.value = false
    }
  }

  function applyFilters(): void {
    appliedWhereSql.value = normalizeWhere(filterDraft.value)
    void loadData(true)
  }

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

  async function onCellEditCommit(
    row: BrowseDataRow,
    column: RsTableColumn<BrowseDataRow>,
    _index: number,
    value: unknown,
  ): Promise<void> {
    if (!isNewRow(row)) return
    const name = String(column.key)
    const idx = resultRows.value.findIndex((item) => item.__rowKey === row.__rowKey)
    if (idx < 0) return
    const previousRaw = resultRows.value[idx]![name]
    const nextRaw = parseEditValue(value, previousRaw)
    const nextRow: BrowseDataRow = { ...resultRows.value[idx]!, [name]: nextRaw }
    const copy = [...resultRows.value]
    copy[idx] = nextRow
    resultRows.value = copy
  }

  async function applyRowChanges(row: BrowseDataRow, changes: BrowseRowChange[]): Promise<void> {
    if (!props.sessionId || !props.table || !changes.length) return

    if (isNewRow(row)) {
      const idx = resultRows.value.findIndex((item) => item.__rowKey === row.__rowKey)
      if (idx < 0) return
      const nextRow: DraftRow = { ...resultRows.value[idx]!, __isNew: true }
      for (const change of changes) {
        nextRow[change.colKey] = parseEditValue(change.value, change.previous)
      }
      const copy = [...resultRows.value]
      copy[idx] = nextRow
      resultRows.value = copy
      void flushNewRow(nextRow)
      return
    }

    if (!canEdit.value) return
    const rowIndex = row.__rowIndex
    if (rowIndex < 0 || rowIndex >= rawRows.value.length) return
    const where = rowWhere(row)
    if (!where) {
      toast.error(t('modules.sqlserver.browse.locateError'))
      return
    }

    const setParts: string[] = []
    const applied: Array<{ colIdx: number; nextRaw: unknown; previousRaw: unknown }> = []
    for (const change of changes) {
      const meta = columnMeta.value.get(change.colKey.toLowerCase())
      if (meta && !isWritableColumn(meta)) continue
      const colIdx = queryColumns.value.findIndex((item) => item.name === change.colKey)
      if (colIdx < 0) continue
      const previousRaw = rawRows.value[rowIndex]![colIdx]
      const nextRaw = parseEditValue(change.value, previousRaw)
      if (toSqlLiteral(previousRaw) === toSqlLiteral(nextRaw)) continue
      setParts.push(`${quoteIdent(change.colKey)} = ${toSqlLiteral(nextRaw)}`)
      applied.push({ colIdx, nextRaw, previousRaw })
    }
    if (!setParts.length) return

    const sql = `UPDATE ${fromSql.value} SET ${setParts.join(', ')} WHERE ${where}`
    const previousRaw = [...rawRows.value[rowIndex]!]
    const nextRaw = [...previousRaw]
    for (const item of applied) nextRaw[item.colIdx] = item.nextRaw
    patchPersistedRow(rowIndex, nextRaw)

    saving.value = true
    try {
      await execSql(sql)
      toast.success(t('modules.sqlserver.browse.cellSaved'))
    } catch (error) {
      patchPersistedRow(rowIndex, previousRaw)
      toast.error(error instanceof Error ? error.message : t('modules.sqlserver.browse.cellSaveError'))
    } finally {
      saving.value = false
    }
  }

  function discardNewRow(key: string): void {
    resultRows.value = resultRows.value.filter((row) => row.__rowKey !== key)
    selectedRowKeys.value = selectedRowKeys.value.filter((item) => item !== key)
  }

  function isBrowseRowPending(row: BrowseDataRow): boolean {
    return isNewRow(row)
  }

  function onBrowseRowEditCommit(row: BrowseDataRow, _index: number, changes: BrowseRowChange[] = []): void {
    void applyRowChanges(row, changes)
  }

  function onBrowseRowEditRollback(row: BrowseDataRow): void {
    if (isNewRow(row)) discardNewRow(row.__rowKey)
  }

  function createDraftRow(): DraftRow {
    draftSeq += 1
    const draft = Object.fromEntries(displayColumnNames.value.map((name) => [name, null])) as DraftRow
    draft.__rowKey = `new-${draftSeq}`
    draft.__rowIndex = -1
    draft.__isNew = true
    return draft
  }

  function openInsert(): void {
    if (!canInsert.value) return
    const existing = resultRows.value.find(isNewRow)
    if (existing) {
      selectedRowKeys.value = [existing.__rowKey]
      return
    }
    const draft = createDraftRow()
    resultRows.value = [draft, ...resultRows.value]
    selectedRowKeys.value = [draft.__rowKey]
  }

  async function flushNewRow(row: DraftRow): Promise<void> {
    if (!row.__isNew || !props.sessionId || !props.table) return
    const writable = tableColumns.value.filter(isWritableColumn)
    const filled = writable.filter((column) => {
      const value = row[column.name]
      return value !== null && value !== undefined && value !== ''
    })
    const missing = writable.find((column) => isRequiredColumn(column) && !filled.includes(column))
    if (missing) {
      toast.error(t('modules.sqlserver.browse.insertRequired', { name: missing.name }))
      return
    }
    if (!filled.length && writable.some(isRequiredColumn)) {
      discardNewRow(row.__rowKey)
      return
    }

    const cols = filled.map((column) => quoteIdent(column.name)).join(', ')
    const vals = filled.map((column) => toSqlLiteral(parseEditValue(row[column.name]))).join(', ')
    const insertBody = filled.length
      ? `INSERT INTO ${fromSql.value} (${cols})`
      : `INSERT INTO ${fromSql.value}`
    const insertTail = filled.length ? ` VALUES (${vals})` : ' DEFAULT VALUES'

    saving.value = true
    try {
      let inserted: unknown[] | null = null
      try {
        inserted = mapOutputToDisplay(await execSql(`${insertBody} OUTPUT INSERTED.*${insertTail}`))
      } catch {
        await execSql(`${insertBody}${insertTail}`)
      }
      promoteInsertedRow(row, inserted)
      toast.success(t('modules.sqlserver.browse.insertDone'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.sqlserver.browse.insertError'))
    } finally {
      saving.value = false
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!props.sessionId || !props.table || !canDelete.value) return
    const selected = resultRows.value.filter((row) => selectedRowKeys.value.includes(row.__rowKey))
    const drafts = selected.filter(isNewRow)
    const persisted = selected.filter((row) => !isNewRow(row))
    for (const draft of drafts) discardNewRow(draft.__rowKey)
    if (!persisted.length) {
      deleteConfirm.value = false
      return
    }

    saving.value = true
    try {
      for (const row of persisted) {
        const where = rowWhere(row)
        if (!where) {
          toast.error(t('modules.sqlserver.browse.locateError'))
          return
        }
        await execSql(`DELETE FROM ${fromSql.value} WHERE ${where}`)
      }
      removePersistedRows(persisted)
      selectedRowKeys.value = []
      toast.success(t('modules.sqlserver.browse.deleteDone', { count: persisted.length }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.sqlserver.browse.deleteError'))
    } finally {
      saving.value = false
      deleteConfirm.value = false
    }
  }

  async function loadBrowseDdl(): Promise<void> {
    if (!props.sessionId || !databaseName.value || !props.table) return
    ddlLoading.value = true
    try {
      const result = await sqlserverApi.metaDDL({
        sessionId: props.sessionId,
        database: databaseName.value,
        schema: schemaName.value,
        table: props.table,
      })
      try {
        const { formatSql } = await import('@/modules/sql-editor/format')
        ddlText.value = formatSql(result.ddl, { dialect: 'sqlserver' })
      } catch {
        ddlText.value = result.ddl
      }
      objectType.value = result.objectType || objectType.value
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.sqlserver.ddl.loadError'))
    } finally {
      ddlLoading.value = false
    }
  }

  async function copyBrowseDdl(): Promise<void> {
    if (!ddlText.value) return
    try {
      await copyTextToClipboard(ddlText.value)
      toast.success(t('modules.sqlserver.ddl.copied'))
    } catch {
      toast.error(t('modules.sqlserver.ddl.copyFailed'))
    }
  }

  function currentTablePath(): ConnResourcePath | null {
    if (!databaseName.value || !props.table) return null
    return {
      segments: [
        { kind: 'database', name: databaseName.value },
        { kind: 'schema', name: schemaName.value },
        { kind: 'category', name: isView.value ? 'views' : 'tables' },
        { kind: 'table', name: props.table },
      ],
    }
  }

  async function resolveConnItem(): Promise<ConnItem | null> {
    if (!props.profileId) return null
    const result = await connectionApi.get({ profileId: props.profileId })
    if (!result.profile) return null
    return { ...result.profile, kind: 'sqlserver' }
  }

  async function openDdlTab(): Promise<void> {
    ddlMenuOpen.value = false
    const path = currentTablePath()
    if (!path) return
    try {
      const item = await resolveConnItem()
      if (!item) throw new Error(t('modules.sqlserver.browse.openDdlFailed'))
      nav.connect(item, { resourcePath: path, initialTab: 'ddl' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.sqlserver.browse.openDdlFailed'))
    }
  }

  async function copyTsv(): Promise<void> {
    const rows = resultRows.value.filter((row) => !isNewRow(row))
    if (!rows.length || !displayColumnNames.value.length) return
    const text = formatRowsAsTsv(
      displayColumnNames.value,
      rows.map((row) => displayColumnNames.value.map((name) => row[name])),
    )
    try {
      await copyTextToClipboard(text)
      toast.success(t('modules.sqlserver.browse.copied'))
    } catch {
      toast.error(t('modules.sqlserver.browse.copyFailed'))
    }
  }

  function openBrowseIo(kind: 'export_csv' | 'import_csv'): void {
    exportMenuOpen.value = false
    importMenuOpen.value = false
    if (!props.profileId || !databaseName.value || !schemaName.value || !props.table) {
      toast.error(t('modules.sqlserver.browse.openDdlFailed'))
      return
    }
    void (async () => {
      const item = await resolveConnItem()
      if (!item) {
        toast.error(t('modules.sqlserver.browse.openDdlFailed'))
        return
      }
      const { openSqlServerIoTask } = await import('@/modules/sqlserver/conn-tree-actions')
      openSqlServerIoTask(item, kind, {
        database: databaseName.value,
        schema: schemaName.value,
        table: props.table,
        dumpScope: 'table',
      })
    })()
  }

  function localExport(format: 'csv' | 'json' | 'tsv'): void {
    exportMenuOpen.value = false
    if (!props.table || !displayColumnNames.value.length) return
    const cols = displayColumnNames.value
    const rows = rawRows.value
    let body: string
    let mime = 'text/plain;charset=utf-8'
    if (format === 'json') {
      body = JSON.stringify(
        rows.map((row) => Object.fromEntries(cols.map((name, i) => [name, row[i] ?? null]))),
        null,
        2,
      )
      mime = 'application/json;charset=utf-8'
    } else if (format === 'tsv') {
      body = [cols.join('\t'), ...rows.map((row) => cols.map((_, i) => cellText(row[i])).join('\t'))].join('\n')
    } else {
      body = [cols.map(escapeCsv).join(','), ...rows.map((row) => cols.map((_, i) => escapeCsv(row[i])).join(','))].join(
        '\n',
      )
      mime = 'text/csv;charset=utf-8'
    }
    const blob = new Blob([`\uFEFF${body}`], { type: mime })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${schemaName.value}_${props.table}.${format}`
    link.click()
    URL.revokeObjectURL(url)
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (target.isContentEditable) return true
    return Boolean(
      target.closest('.cm-editor, .rs-code-editor, .rs-table__td--editing, [contenteditable="true"]'),
    )
  }

  function columnNamesForClipboard(): string[] {
    return displayColumnNames.value
  }

  function selectedRowsForCopy(): BrowseDataRow[] {
    const selected = new Set(selectedRowKeys.value)
    return resultRows.value.filter((row) => selected.has(row.__rowKey))
  }

  function resolveRowsForCopy(row: BrowseDataRow | null, selected: BrowseDataRow[]): BrowseDataRow[] {
    const fromSelected = (selected.length > 0 ? selected : selectedRowsForCopy()).filter((item) => !isNewRow(item))
    if (fromSelected.length > 0) return fromSelected
    if (row && !isNewRow(row)) return [row]
    return []
  }

  async function writeClipboardRows(text: string, count: number): Promise<void> {
    const ok = await copyTextToClipboard(text)
    if (!ok) {
      toast.error(t('modules.sqlserver.browse.copyError'))
      return
    }
    toast.success(t('modules.sqlserver.browse.copyDone', { count }))
  }

  async function copySelectedRows(
    row: BrowseDataRow | null = null,
    selected: BrowseDataRow[] = [],
  ): Promise<void> {
    const cols = columnNamesForClipboard()
    const rows =
      row || selected.length > 0 ? resolveRowsForCopy(row, selected) : selectedRowsForCopy()
    if (cols.length === 0 || rows.length === 0) {
      toast.info(t('modules.sqlserver.browse.copyEmpty'))
      return
    }
    await writeClipboardRows(
      formatRowsAsTsv(
        cols,
        rows.map((item) => cols.map((name) => item[name])),
      ),
      rows.length,
    )
  }

  async function copySelectedAsInsert(row: BrowseDataRow | null, selected: BrowseDataRow[]): Promise<void> {
    if (!props.table) return
    const cols = columnNamesForClipboard()
    const rows = resolveRowsForCopy(row, selected)
    if (cols.length === 0 || rows.length === 0) {
      toast.info(t('modules.sqlserver.browse.copyEmpty'))
      return
    }
    await writeClipboardRows(
      buildInsertSqlText(
        schemaName.value,
        props.table,
        cols.map((name) => ({ name })),
        rows.map((item) => cols.map((name) => item[name])),
      ),
      rows.length,
    )
  }

  async function copySelectedAsUpdate(row: BrowseDataRow | null, selected: BrowseDataRow[]): Promise<void> {
    if (!props.table) return
    const cols = columnNamesForClipboard()
    const rows = resolveRowsForCopy(row, selected)
    if (cols.length === 0 || rows.length === 0) {
      toast.info(t('modules.sqlserver.browse.copyEmpty'))
      return
    }
    await writeClipboardRows(
      buildUpdateSqlText(schemaName.value, props.table, cols, pkColumns.value, rows, cols),
      rows.length,
    )
  }

  async function copySelectedAsDelete(row: BrowseDataRow | null, selected: BrowseDataRow[]): Promise<void> {
    if (!props.table) return
    const rows = resolveRowsForCopy(row, selected)
    if (rows.length === 0) {
      toast.info(t('modules.sqlserver.browse.copyEmpty'))
      return
    }
    await writeClipboardRows(
      buildDeleteSqlText(schemaName.value, props.table, pkColumns.value, rows, columnNamesForClipboard()),
      rows.length,
    )
  }

  async function pasteIntoInsertRows(): Promise<void> {
    if (!canInsert.value || !lastResult.value) return
    const text = await readClipboardText()
    if (!text?.trim()) {
      toast.info(t('modules.sqlserver.browse.pasteEmpty'))
      return
    }
    const cols = columnNamesForClipboard()
    const records = mapPasteToColumnRecords(cols, parseClipboardMatrix(text))
    if (records.length === 0) {
      toast.info(t('modules.sqlserver.browse.pasteEmpty'))
      return
    }
    const existingDrafts = resultRows.value.filter(isNewRow)
    const rest = resultRows.value.filter((item) => !isNewRow(item))
    const filled: DraftRow[] = []
    for (let i = 0; i < records.length; i++) {
      const base = existingDrafts[i] ?? createDraftRow()
      const next: DraftRow = { ...base, __isNew: true }
      for (const [name, raw] of Object.entries(records[i]!)) {
        next[name] = raw.trim() === '' ? null : parseEditValue(raw)
      }
      filled.push(next)
    }
    resultRows.value = [...filled, ...rest]
    selectedRowKeys.value = filled.map((item) => item.__rowKey)
    toast.success(t('modules.sqlserver.browse.pasteDone', { count: filled.length }))
  }

  function requestDelete(): void {
    if (selectedRowKeys.value.length === 0) return
    const onlyDrafts = selectedRowKeys.value.every((key) => String(key).startsWith('new-'))
    if (onlyDrafts) {
      for (const key of selectedRowKeys.value) discardNewRow(key)
      return
    }
    if (!canDelete.value) return
    deleteConfirm.value = true
  }

  function contextMenuItems(row: BrowseDataRow | null, selected: BrowseDataRow[]): RsContextMenuItem[] {
    const items: RsContextMenuItem[] = []
    const canExport = Boolean(lastResult.value && rawRows.value.length > 0)
    const copyTargets = resolveRowsForCopy(row, selected)
    const canCopy = copyTargets.length > 0 || selected.length > 0 || Boolean(row && !isNewRow(row))

    items.push({
      key: 'copy',
      label: t('modules.sqlserver.browse.copy'),
      icon: 'copy',
      disabled: !canCopy,
      children: [
        {
          key: 'copy:tsv',
          label: t('modules.sqlserver.browse.copyRows'),
          icon: 'copy',
          shortcut: 'Ctrl+C',
          disabled: !canCopy,
        },
        {
          key: 'copy:insert',
          label: t('modules.sqlserver.browse.copyAsInsert'),
          icon: 'square-plus',
          disabled: !canCopy || !props.table,
        },
        {
          key: 'copy:update',
          label: t('modules.sqlserver.browse.copyAsUpdate'),
          icon: 'pencil',
          disabled: !canCopy || !props.table,
        },
        {
          key: 'copy:delete',
          label: t('modules.sqlserver.browse.copyAsDelete'),
          icon: 'trash-2',
          disabled: !canCopy || !props.table,
        },
      ],
    })

    if (canInsert.value) {
      items.push({
        key: 'paste',
        label: t('modules.sqlserver.browse.pasteRows'),
        icon: 'clipboard-paste',
        shortcut: 'Ctrl+V',
      })
      items.push({ key: 'sep-io', label: '', separator: true })
      items.push({
        key: 'import',
        label: t('modules.sqlserver.browse.import'),
        icon: 'upload',
        children: [
          {
            key: 'import:csv',
            label: t('modules.sqlserver.browse.formatCsv'),
            icon: 'file-text',
            disabled: saving.value,
          },
        ],
      })
    } else {
      items.push({ key: 'sep-io', label: '', separator: true })
    }

    items.push({
      key: 'export',
      label: t('modules.sqlserver.browse.export'),
      icon: 'download',
      disabled: !canExport,
      children: [
        { key: 'export:csv', label: t('modules.sqlserver.browse.formatCsv'), icon: 'file-text', disabled: !canExport },
        { key: 'export:json', label: t('modules.sqlserver.browse.formatJson'), icon: 'braces', disabled: !canExport },
        { key: 'export:tsv', label: t('modules.sqlserver.browse.formatTsv'), icon: 'file-text', disabled: !canExport },
        {
          key: 'export:fullCsv',
          label: t('modules.sqlserver.browse.exportTable'),
          icon: 'database',
          disabled: !props.profileId || !props.table || saving.value,
        },
      ],
    })

    const hasDraft = Boolean(row?.__isNew) || selected.some(isNewRow)
    const canCtxDelete =
      hasDraft || (!isView.value && tableColumns.value.length > 0 && (selected.length > 0 || Boolean(row)))
    if (canCtxDelete) {
      items.push({ key: 'sep-delete', label: '', separator: true })
      items.push({
        key: 'delete',
        label: t('modules.sqlserver.browse.delete'),
        icon: 'trash-2',
        danger: true,
        disabled: selected.length === 0 && !row,
      })
    }
    return items
  }

  function onContextMenuSelect(key: string, row: BrowseDataRow | null, selected: BrowseDataRow[]): void {
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
    if (key === 'import:csv') {
      openBrowseIo('import_csv')
      return
    }
    if (key === 'export:fullCsv') {
      openBrowseIo('export_csv')
      return
    }
    if (key === 'export:csv' || key === 'export:json' || key === 'export:tsv') {
      localExport(key.slice('export:'.length) as 'csv' | 'json' | 'tsv')
    }
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

  watch(
    () => [props.sessionId, props.database, props.schema, props.table] as const,
    async () => {
      selectedRowKeys.value = []
      lastResult.value = null
      metaReady.value = false
      ddlText.value = ''
      if (!props.active) return
      await loadMeta()
      await loadData(true)
    },
    { immediate: true },
  )

  watch(
    () => props.active,
    async (active) => {
      if (!active || !scopeOk.value) return
      if (lastResult.value || metaReady.value) return
      selectedRowKeys.value = []
      await loadMeta()
      await loadData(true)
    },
  )

  watch([page, pageSize], () => {
    if (props.active && scopeOk.value && lastResult.value) void loadData(false)
  })

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
    deleteConfirm,
    filterSqlConfig,
    browseGutterWidth: BROWSE_GUTTER_WIDTH,
    ddlMenuOpen,
    ddlLoading,
    ddlText,
    objectType,
    exportMenuOpen,
    importMenuOpen,
    refresh,
    onFilterKeydown,
    copyBrowseDdl,
    openDdlTab,
    copyTsv,
    localExport,
    openBrowseIo,
    openInsert,
    deleteSelected,
    requestDelete,
    onCellEditCommit,
    onBrowseRowEditCommit,
    onBrowseRowEditRollback,
    isBrowseRowPending,
    contextMenuItems,
    onContextMenuSelect,
    onBrowseKeydown,
  }
}
