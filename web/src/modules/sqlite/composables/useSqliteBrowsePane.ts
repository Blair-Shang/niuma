/**
 * SQLite 表/视图数据浏览：分页 · WHERE · 行编辑 · CSV IO。
 * UI 挂载公共 BrowseDataShell；突变仅走 sqliteApi.queryExec。
 * 禁止 import `@/modules/mysql/**` 或其它库业务实现。
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
import { connectionApi, dialogApi, fsApi, sqliteApi } from '@/api'
import type { SqliteColumnInfo, SqliteQueryExecResult } from '@/api/types/sqlite'
import {
  buildBrowseResultColumn,
  formatRowsAsTsv,
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
import { openSqliteDataTask } from '@/modules/sqlite/data-tasks'
import { quoteIdent, qualifiedName } from '@/modules/sqlite/sql-seed'
import {
  acceptExtensionsForFormat,
  buildBrowseExportPayload,
  buildDeleteSqlText,
  buildInsertSqlText,
  buildUpdateSqlText,
  looksLikeOfficeZip,
  parseBrowseImport,
  type BrowseDataFormat,
} from '@/modules/sqlite/utils/browse-io'
import { isBinCell, sqlWhereEquals, toSqlLiteral } from '@/modules/sqlite/utils/sql-literal'

const IO_FORMATS: BrowseDataFormat[] = ['csv', 'sql', 'xls', 'json']

export interface SqliteBrowsePaneProps {
  sessionId: string | null
  profileId?: string
  schema?: string
  table?: string
  /** 来自树「视图」分类时为 true，禁用突变与 CSV 导入 */
  isView?: boolean
  sessionLabel?: string
  active: boolean
}

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const
const BROWSE_GUTTER_WIDTH = 40
/** 内部定位列，不展示给用户 */
const ROWID_ALIAS = '__nm_rowid'

function normalizeWhere(raw: string): string {
  let s = raw.trim()
  if (!s) return ''
  return s.replace(/^where\s+/i, '').trim()
}

function parseCount(result: SqliteQueryExecResult): number {
  const cell = result.rows?.[0]?.[0]
  const n = typeof cell === 'number' ? cell : Number(cell)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

function isEmptyCell(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  return false
}

/** 单列 INTEGER PK ≈ SQLite 自增 rowid 别名。 */
function inferAutoIncrement(col: SqliteColumnInfo, pkCols: string[]): boolean {
  if (pkCols.length !== 1 || pkCols[0] !== col.name) return false
  const base = (col.dataType ?? '').trim().toUpperCase().replace(/\(.*\)$/, '')
  return base === 'INTEGER' || base === 'INT'
}

export function useSqliteBrowsePane(props: SqliteBrowsePaneProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const nav = useConnectionNavigation()

  const loading = ref(false)
  const saving = ref(false)
  const page = ref(1)
  const pageSize = ref(200)
  const totalRows = ref(0)
  const filterOpen = ref(false)
  const filterDraft = ref('')
  const appliedWhereSql = ref('')
  const importMenuOpen = ref(false)
  const exportMenuOpen = ref(false)
  const lastDataSql = ref('')
  const deleteConfirm = ref(false)
  const selectedRowKeys = ref<string[]>([])
  const resultRows = ref<BrowseDataRow[]>([])

  const lastResult = shallowRef<SqliteQueryExecResult | null>(null)
  const rawRows = shallowRef<unknown[][]>([])
  /** 含可选 __nm_rowid */
  const queryColumns = shallowRef<{ name: string; dataType?: string }[]>([])
  const tableColumns = shallowRef<SqliteColumnInfo[]>([])
  const pkColumns = shallowRef<string[]>([])
  const metaReady = ref(false)
  const useRowidLocate = ref(false)

  const ddlMenuOpen = ref(false)
  const ddlLoading = ref(false)
  const ddlText = ref('')
  const objectType = ref('')

  let flushingNewRow = false
  let newRowSeq = 0

  const isView = computed(() => props.isView === true)
  const scopeOk = computed(() => Boolean(props.sessionId && props.table))
  const schemaName = computed(() => props.schema?.trim() || 'main')

  const canEdit = computed(
    () => !isView.value && tableColumns.value.length > 0 && Boolean(props.sessionId && props.table),
  )
  const canInsert = computed(() => canEdit.value)
  const hasNewRow = computed(() => resultRows.value.some((r) => r.__isNew))
  const tableEditable = computed(() => canEdit.value || hasNewRow.value)
  const canDeleteSelection = computed(() => {
    if (selectedRowKeys.value.length === 0) return false
    if (selectedRowKeys.value.some((k) => String(k).startsWith('new-'))) return true
    return canEdit.value
  })

  const displayColumnNames = computed(() =>
    queryColumns.value.map((c) => c.name).filter((n) => n !== ROWID_ALIAS),
  )

  const scopeLabel = computed(() => {
    if (!props.table) return ''
    return qualifiedName(schemaName.value, props.table)
  })

  const shellLabels = computed(
    (): BrowseDataShellLabels => ({
      toolbarLabel: t('modules.sqlite.browse.toolbarLabel'),
      featureLabel: isView.value
        ? t('modules.sqlite.browse.featureView')
        : t('modules.sqlite.browse.featureTable'),
      insert: t('modules.sqlite.browse.insert'),
      insertTooltip: t('modules.sqlite.browse.insertTooltip'),
      delete: t('modules.sqlite.browse.delete'),
      deleteTooltip: t('modules.sqlite.browse.deleteTooltip'),
      import: t('modules.sqlite.browse.import'),
      importTooltip: t('modules.sqlite.browse.importTooltip'),
      export: t('modules.sqlite.browse.export'),
      exportTooltip: t('modules.sqlite.browse.exportTooltip'),
      filter: t('modules.sqlite.browse.filter'),
      filterToggle: t('modules.sqlite.browse.filterToggle'),
      refresh: t('modules.sqlite.browse.refresh'),
      needTable: t('modules.sqlite.browse.needTable'),
      empty: t('modules.sqlite.browse.empty'),
    }),
  )

  const statusMeta = computed(() => {
    if (!lastResult.value) return ''
    const parts: string[] = []
    const n = resultRows.value.filter((r) => !r.__isNew).length
    const total = totalRows.value
    if (total > 0) {
      parts.push(
        t('modules.sqlite.browse.statusRowsTotal', { n, page: page.value, total }),
      )
    } else {
      parts.push(t('modules.sqlite.browse.statusRows', { n, page: page.value }))
    }
    if (selectedRowKeys.value.length > 0) {
      parts.push(t('modules.sqlite.browse.statusSelected', { count: selectedRowKeys.value.length }))
    }
    return parts.join(' · ')
  })

  const statusHint = computed(() => {
    if (!lastResult.value) return ''
    if (isView.value) return t('modules.sqlite.browse.viewReadonly')
    if (!canEdit.value && !hasNewRow.value) return ''
    if (pkColumns.value.length === 0 && useRowidLocate.value) {
      return t('modules.sqlite.browse.rowidHint')
    }
    if (pkColumns.value.length === 0 && !useRowidLocate.value) {
      return t('modules.sqlite.browse.noPk')
    }
    return t('modules.sqlite.browse.editHint')
  })

  const columnMetaByName = computed(() => {
    const map = new Map<string, SqliteColumnInfo>()
    for (const col of tableColumns.value) {
      map.set(col.name, col)
      map.set(col.name.toLowerCase(), col)
    }
    return map
  })

  const resultColumns = computed((): RsTableColumn<BrowseDataRow>[] => {
    const cols = displayColumnNames.value
    const pk = new Set(pkColumns.value.map((n) => n.toLowerCase()))
    return cols.map((name) => {
      const meta = columnMetaByName.value.get(name) ?? columnMetaByName.value.get(name.toLowerCase())
      const qCol = queryColumns.value.find((c) => c.name === name)
      const dataType = qCol?.dataType || meta?.dataType
      const isPk = pk.has(name.toLowerCase())
      const tipLines = [t('modules.sqlite.browse.colTipField', { name })]
      if (dataType) tipLines.push(t('modules.sqlite.browse.colTipType', { type: dataType }))
      tipLines.push(
        t('modules.sqlite.browse.colTipPrimary', {
          value: isPk ? t('modules.sqlite.browse.colTipYes') : t('modules.sqlite.browse.colTipNo'),
        }),
      )
      if (typeof meta?.nullable === 'boolean') {
        tipLines.push(
          t('modules.sqlite.browse.colTipNullable', {
            value: meta.nullable
              ? t('modules.sqlite.browse.colTipYes')
              : t('modules.sqlite.browse.colTipNo'),
          }),
        )
      }
      return buildBrowseResultColumn({
        name,
        dataType,
        headerTip: tipLines.join('\n'),
        width: 120,
        minWidth: 80,
        nullable: meta?.nullable !== false,
        canEdit: canEdit.value,
        isBinCell,
      })
    })
  })

  const filterSqlConfig = computed((): RsCodeEditorSqlConfig | undefined => {
    const table = props.table?.trim()
    if (!table) return undefined
    const cols = tableColumns.value
    if (cols.length === 0) return undefined
    const columns = cols.map((c) => ({
      label: c.name,
      detail: c.dataType || undefined,
      type: 'property' as const,
      boost: 99,
    }))
    const schema = schemaName.value
    return {
      dialect: 'standard',
      schema: { [schema]: { [table]: columns } },
      defaultSchema: schema,
      defaultTable: table,
    }
  })

  const canOpenDesign = computed(() => !isView.value && Boolean(props.table))

  function coerceBrowseEditValue(draft: unknown, previousRaw?: unknown): unknown {
    return parseEditValue(draft, previousRaw)
  }

  function rowidColIndex(): number {
    return queryColumns.value.findIndex((c) => c.name === ROWID_ALIAS)
  }

  function stableRowKey(row: unknown[], rowIdx: number): string {
    const resCols = queryColumns.value
    if (pkColumns.value.length > 0) {
      const parts: string[] = []
      for (const pk of pkColumns.value) {
        const i = resCols.findIndex((c) => c.name === pk)
        if (i < 0) return String(rowIdx)
        const cell = row[i]
        if (cell === null || cell === undefined || cell === '') return String(rowIdx)
        parts.push(String(cell))
      }
      return `pk:${parts.join('\0')}`
    }
    const ri = rowidColIndex()
    if (ri >= 0 && row[ri] != null && row[ri] !== '') {
      return `rowid:${String(row[ri])}`
    }
    return String(rowIdx)
  }

  function rebuildDisplayRows(): void {
    const draft = resultRows.value.find((r) => r.__isNew)
    const cols = queryColumns.value
    if (cols.length === 0) {
      resultRows.value = draft ? [draft] : []
      return
    }
    const rows = rawRows.value.map((row, rowIdx) => {
      const obj: BrowseDataRow = {
        __rowKey: stableRowKey(row, rowIdx),
        __rowIndex: rowIdx,
      }
      cols.forEach((col, colIdx) => {
        if (col.name === ROWID_ALIAS) return
        obj[col.name] = row[colIdx]
      })
      return obj
    })
    resultRows.value = draft ? [draft, ...rows] : rows
  }

  function deleteKeyColumns(): string[] {
    if (pkColumns.value.length > 0) return pkColumns.value
    if (useRowidLocate.value) return ['rowid']
    return displayColumnNames.value
  }

  function locateWhereForRow(rowIdx: number): string | null {
    if (isView.value) return null
    const keys = deleteKeyColumns()
    if (keys.length === 0) return null
    const cols = queryColumns.value
    const row = rawRows.value[rowIdx]
    if (!row) return null

    if (keys.length === 1 && keys[0] === 'rowid') {
      const ri = rowidColIndex()
      if (ri < 0) return null
      const id = row[ri]
      if (id === null || id === undefined || id === '') return null
      return `rowid = ${toSqlLiteral(typeof id === 'number' ? id : Number(id))}`
    }

    const parts = keys.map((col) => {
      const i = cols.findIndex((c) => c.name === col)
      const raw = i >= 0 ? row[i] : null
      return sqlWhereEquals(col, raw)
    })
    return parts.join(' AND ')
  }

  async function ensureMeta(): Promise<void> {
    if (!props.sessionId || !props.table || metaReady.value) return
    try {
      const base = {
        sessionId: props.sessionId,
        schema: schemaName.value,
        table: props.table,
      }
      const [cols, pk] = await Promise.all([
        sqliteApi.metaColumns(base),
        sqliteApi.metaPrimaryKey(base).catch(() => ({ columns: [] as string[] })),
      ])
      tableColumns.value = cols.columns ?? []
      pkColumns.value = pk.columns ?? []
      metaReady.value = true
    } catch {
      toast.error(t('modules.sqlite.browse.metaError'))
    }
  }

  async function execDataQuery(
    selectList: string,
    orderSql: string,
  ): Promise<SqliteQueryExecResult> {
    const n = pageSize.value || 100
    const offset = Math.max(0, (page.value - 1) * n)
    const from = qualifiedName(schemaName.value, props.table!)
    const where = appliedWhereSql.value.trim()
    const whereSql = where ? `\nWHERE ${where}` : ''
    const dataSql = `SELECT ${selectList}\nFROM ${from}${whereSql}\nORDER BY ${orderSql}\nLIMIT ${n} OFFSET ${offset}`
    lastDataSql.value = dataSql
    return sqliteApi.queryExec({
      sessionId: props.sessionId!,
      schema: schemaName.value,
      sql: dataSql,
      limit: n,
    })
  }

  async function loadData(options?: { silent?: boolean }): Promise<void> {
    if (!props.sessionId || !props.table) return
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
      const from = qualifiedName(schemaName.value, props.table)
      const where = appliedWhereSql.value.trim()
      const whereSql = where ? `\nWHERE ${where}` : ''
      const countPromise = sqliteApi.queryExec({
        sessionId: props.sessionId,
        schema: schemaName.value,
        sql: `SELECT COUNT(*) AS cnt\nFROM ${from}${whereSql}`,
      })

      let result: SqliteQueryExecResult
      let withRowid = false
      if (!isView.value) {
        try {
          result = await execDataQuery(
            `${quoteIdent('rowid')} AS ${quoteIdent(ROWID_ALIAS)}, *`,
            'rowid',
          )
          withRowid = true
        } catch {
          // WITHOUT ROWID：无 rowid，回退 PK / 首列排序
          const orderFallback =
            pkColumns.value.length > 0
              ? pkColumns.value.map((c) => quoteIdent(c)).join(', ')
              : tableColumns.value[0]?.name
                ? quoteIdent(tableColumns.value[0].name)
                : '1'
          result = await execDataQuery('*', orderFallback)
          withRowid = false
        }
      } else {
        const orderView =
          pkColumns.value.length > 0
            ? pkColumns.value.map((c) => quoteIdent(c)).join(', ')
            : tableColumns.value[0]?.name
              ? quoteIdent(tableColumns.value[0].name)
              : '1'
        result = await execDataQuery('*', orderView)
        withRowid = false
      }

      const countResult = await countPromise
      useRowidLocate.value = withRowid
      totalRows.value = parseCount(countResult)
      lastResult.value = result
      queryColumns.value = result.columns ?? []
      rawRows.value = (result.rows ?? []).map((r) => [...r])
      rebuildDisplayRows()
      const n = pageSize.value || 100
      const maxPage = Math.max(1, Math.ceil(totalRows.value / n) || 1)
      if (page.value > maxPage) page.value = maxPage
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.sqlite.browse.dataError'))
    } finally {
      if (!silent) loading.value = false
    }
  }

  function applyFilters(): void {
    appliedWhereSql.value = normalizeWhere(filterDraft.value)
    page.value = 1
    void loadData()
  }

  function onFilterKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return
    if (document.querySelector('.cm-tooltip-autocomplete')) return
    ev.preventDefault()
    ev.stopPropagation()
    applyFilters()
  }

  function refresh(): void {
    metaReady.value = false
    page.value = 1
    void loadData()
  }

  async function onCellEditCommit(
    row: BrowseDataRow,
    column: RsTableColumn<BrowseDataRow>,
    _index: number,
    value: unknown,
  ): Promise<void> {
    if (!props.sessionId || !props.table) return
    const colName = String(column.key)
    if (colName === ROWID_ALIAS) return

    if (row.__isNew) {
      const idx = resultRows.value.findIndex((r) => r.__rowKey === row.__rowKey)
      if (idx < 0) return
      const previousRaw = resultRows.value[idx]![colName]
      const nextRaw = coerceBrowseEditValue(value, previousRaw)
      const nextRow: BrowseDataRow = { ...resultRows.value[idx]!, [colName]: nextRaw }
      const copy = [...resultRows.value]
      copy[idx] = nextRow
      resultRows.value = copy
    }
  }

  async function applyRowChanges(row: BrowseDataRow, changes: BrowseRowChange[]): Promise<void> {
    if (!props.sessionId || !props.table || !changes.length) return

    if (row.__isNew) {
      const idx = resultRows.value.findIndex((r) => r.__rowKey === row.__rowKey)
      if (idx >= 0) {
        const nextRow: BrowseDataRow = { ...resultRows.value[idx]! }
        for (const ch of changes) {
          if (ch.colKey === ROWID_ALIAS) continue
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
    if (rowIdx < 0 || rowIdx >= rawRows.value.length) return
    const where = locateWhereForRow(rowIdx)
    if (!where) {
      toast.error(t('modules.sqlite.browse.locateFailed'))
      return
    }

    const setParts: string[] = []
    const applied: Array<{ colIdx: number; nextRaw: unknown; previousRaw: unknown }> = []
    for (const ch of changes) {
      if (ch.colKey === ROWID_ALIAS) continue
      const colIdx = queryColumns.value.findIndex((c) => c.name === ch.colKey)
      if (colIdx < 0) continue
      const previousRaw = rawRows.value[rowIdx]![colIdx]
      if (isBinCell(previousRaw)) continue
      const nextRaw = coerceBrowseEditValue(ch.value, previousRaw)
      if (toSqlLiteral(previousRaw) === toSqlLiteral(nextRaw)) continue
      setParts.push(`${quoteIdent(ch.colKey)} = ${toSqlLiteral(nextRaw)}`)
      applied.push({ colIdx, nextRaw, previousRaw })
    }
    if (!setParts.length) return

    const sql =
      `UPDATE ${qualifiedName(schemaName.value, props.table)}\n` +
      `SET ${setParts.join(', ')}\n` +
      `WHERE ${where}`

    const next = [...rawRows.value]
    const nextRow = [...next[rowIdx]!]
    for (const item of applied) nextRow[item.colIdx] = item.nextRaw
    next[rowIdx] = nextRow
    rawRows.value = next
    rebuildDisplayRows()

    saving.value = true
    try {
      await sqliteApi.queryExec({
        sessionId: props.sessionId,
        schema: schemaName.value,
        sql,
      })
      toast.success(t('modules.sqlite.browse.cellSaved'))
    } catch (e) {
      const rollback = [...rawRows.value]
      const rollbackRow = [...rollback[rowIdx]!]
      for (const item of applied) rollbackRow[item.colIdx] = item.previousRaw
      rollback[rowIdx] = rollbackRow
      rawRows.value = rollback
      rebuildDisplayRows()
      toast.error(e instanceof Error ? e.message : t('modules.sqlite.browse.cellSaveError'))
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

  function createDraftRow(): BrowseDataRow {
    newRowSeq += 1
    const row: BrowseDataRow = {
      __rowKey: `new-${newRowSeq}`,
      __rowIndex: -1,
      __isNew: true,
    }
    for (const name of displayColumnNames.value) {
      row[name] = null
    }
    return row
  }

  async function fetchInsertedRawRow(draft: BrowseDataRow): Promise<unknown[] | null> {
    if (!props.sessionId || !props.table || queryColumns.value.length === 0) return null
    const from = qualifiedName(schemaName.value, props.table)
    const selectList = useRowidLocate.value
      ? `${quoteIdent('rowid')} AS ${quoteIdent(ROWID_ALIAS)}, *`
      : '*'
    const whereCandidates: string[] = []
    if (pkColumns.value.length > 0) {
      const parts: string[] = []
      let complete = true
      for (const pk of pkColumns.value) {
        const raw = draft[pk]
        if (isEmptyCell(raw)) {
          complete = false
          break
        }
        parts.push(sqlWhereEquals(pk, coerceBrowseEditValue(raw)))
      }
      if (complete && parts.length > 0) whereCandidates.push(parts.join(' AND '))
    }
    const ai = tableColumns.value.find((c) => inferAutoIncrement(c, pkColumns.value))
    if (ai || useRowidLocate.value) {
      whereCandidates.push(`rowid = last_insert_rowid()`)
    }
    if (whereCandidates.length === 0) return null

    for (const whereSql of whereCandidates) {
      try {
        const result = await sqliteApi.queryExec({
          sessionId: props.sessionId,
          schema: schemaName.value,
          sql: `SELECT ${selectList}\nFROM ${from}\nWHERE ${whereSql}\nLIMIT 1`,
          limit: 1,
        })
        const row = result.rows?.[0]
        if (row && row.length > 0) return [...row]
      } catch {
        /* try next */
      }
    }
    return null
  }

  function promoteInsertedRow(draft: BrowseDataRow, insertedRaw: unknown[] | null): void {
    const cols = queryColumns.value
    const raw =
      insertedRaw && insertedRaw.length === cols.length
        ? [...insertedRaw]
        : cols.map((col) => {
            if (col.name === ROWID_ALIAS) return null
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
    if (!row.__isNew || !props.sessionId || !props.table) return true
    const cols = tableColumns.value
    const names: string[] = []
    const values: string[] = []
    let anyFilled = false

    for (const col of cols) {
      const raw = row[col.name]
      if (isEmptyCell(raw)) continue
      anyFilled = true
      names.push(quoteIdent(col.name))
      values.push(toSqlLiteral(coerceBrowseEditValue(raw)))
    }

    if (!anyFilled) {
      discardNewRow(row.__rowKey)
      return true
    }

    for (const col of cols) {
      const ai = inferAutoIncrement(col, pkColumns.value)
      const hasDefault = Boolean(col.default && String(col.default).trim())
      if (col.nullable !== false || hasDefault || ai) continue
      if (isEmptyCell(row[col.name])) {
        toast.error(t('modules.sqlite.browse.insertRequired', { name: col.name }))
        flushingNewRow = true
        selectedRowKeys.value = [row.__rowKey]
        await nextTick()
        flushingNewRow = false
        return false
      }
    }

    const sql =
      `INSERT INTO ${qualifiedName(schemaName.value, props.table)} (${names.join(', ')})\n` +
      `VALUES (${values.join(', ')})`
    saving.value = true
    try {
      await sqliteApi.queryExec({
        sessionId: props.sessionId,
        schema: schemaName.value,
        sql,
      })
      toast.success(t('modules.sqlite.browse.insertDone'))
      const insertedRaw = await fetchInsertedRawRow(row)
      promoteInsertedRow(row, insertedRaw)
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.sqlite.browse.insertError'))
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
    if (!canInsert.value || !props.sessionId || !props.table) return
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
      for (const key of selectedRowKeys.value) discardNewRow(String(key))
      return
    }
    deleteConfirm.value = true
  }

  async function confirmDelete(): Promise<void> {
    if (!props.sessionId || !props.table) return
    const draftKeys = selectedRowKeys.value.filter((k) => String(k).startsWith('new-'))
    for (const key of draftKeys) discardNewRow(String(key))

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
    if (!canEdit.value || deleteKeyColumns().length === 0) return

    const uniqueIndexes = [...new Set(indexes)].sort((a, b) => a - b)
    saving.value = true
    try {
      for (const rowIdx of uniqueIndexes) {
        const where = locateWhereForRow(rowIdx)
        if (!where) continue
        await sqliteApi.queryExec({
          sessionId: props.sessionId,
          schema: schemaName.value,
          sql: `DELETE FROM ${qualifiedName(schemaName.value, props.table!)}\nWHERE ${where}`,
        })
      }
      const removed = new Set(uniqueIndexes)
      rawRows.value = rawRows.value.filter((_, i) => !removed.has(i))
      totalRows.value = Math.max(0, totalRows.value - uniqueIndexes.length)
      selectedRowKeys.value = []
      rebuildDisplayRows()
      toast.success(t('modules.sqlite.browse.deleteDone', { count: uniqueIndexes.length }))
      deleteConfirm.value = false
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.sqlite.browse.deleteError'))
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
      toast.error(t('modules.sqlite.browse.copyError'))
      return
    }
    toast.success(t('modules.sqlite.browse.copyDone', { count }))
  }

  async function copySelectedRows(
    row: BrowseDataRow | null = null,
    selected: BrowseDataRow[] = [],
  ): Promise<void> {
    const cols = displayColumnNames.value
    const rows =
      row || selected.length > 0 ? resolveRowsForCopy(row, selected) : selectedRowsForCopy()
    const clean = rows.filter((r) => !r.__isNew)
    if (cols.length === 0 || clean.length === 0) {
      toast.info(t('modules.sqlite.browse.copyEmpty'))
      return
    }
    const matrix = clean.map((r) => cols.map((name) => r[name]))
    await writeClipboardRows(formatRowsAsTsv(cols, matrix), clean.length)
  }

  async function copySelectedAsInsert(
    row: BrowseDataRow | null,
    selected: BrowseDataRow[],
  ): Promise<void> {
    if (!props.table) return
    const cols = displayColumnNames.value
    const rows = resolveRowsForCopy(row, selected)
    if (cols.length === 0 || rows.length === 0) {
      toast.info(t('modules.sqlite.browse.copyEmpty'))
      return
    }
    const matrix = rows.map((r) => cols.map((name) => r[name]))
    const text = buildInsertSqlText(
      schemaName.value,
      props.table,
      cols.map((name) => ({ name })),
      matrix,
    )
    await writeClipboardRows(text, rows.length)
  }

  async function copySelectedAsUpdate(
    row: BrowseDataRow | null,
    selected: BrowseDataRow[],
  ): Promise<void> {
    if (!props.table) return
    const cols = displayColumnNames.value
    const rows = resolveRowsForCopy(row, selected)
    if (cols.length === 0 || rows.length === 0) {
      toast.info(t('modules.sqlite.browse.copyEmpty'))
      return
    }
    const text = buildUpdateSqlText(
      schemaName.value,
      props.table,
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
    if (!props.table) return
    const rows = resolveRowsForCopy(row, selected)
    if (rows.length === 0) {
      toast.info(t('modules.sqlite.browse.copyEmpty'))
      return
    }
    const text = buildDeleteSqlText(
      schemaName.value,
      props.table,
      pkColumns.value,
      rows,
      displayColumnNames.value,
    )
    await writeClipboardRows(text, rows.length)
  }

  async function pasteIntoInsertRows(): Promise<void> {
    if (!canInsert.value || !lastResult.value) return
    const text = await readClipboardText()
    if (!text?.trim()) {
      toast.info(t('modules.sqlite.browse.pasteEmpty'))
      return
    }
    const cols = displayColumnNames.value
    const records = mapPasteToColumnRecords(cols, parseClipboardMatrix(text))
    if (records.length === 0) {
      toast.info(t('modules.sqlite.browse.pasteEmpty'))
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
    toast.success(t('modules.sqlite.browse.pasteDone', { count: filled.length }))
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
      label: t('modules.sqlite.browse.copy'),
      icon: 'copy',
      disabled: !canCopy,
      children: [
        {
          key: 'copy:tsv',
          label: t('modules.sqlite.browse.copyRows'),
          icon: 'copy',
          shortcut: 'Ctrl+C',
          disabled: !canCopy,
        },
        {
          key: 'copy:insert',
          label: t('modules.sqlite.browse.copyAsInsert'),
          icon: 'square-plus',
          disabled: !canCopy || isView.value,
        },
        {
          key: 'copy:update',
          label: t('modules.sqlite.browse.copyAsUpdate'),
          icon: 'pencil',
          disabled: !canCopy || isView.value,
        },
        {
          key: 'copy:delete',
          label: t('modules.sqlite.browse.copyAsDelete'),
          icon: 'trash-2',
          disabled: !canCopy || isView.value,
        },
      ],
    })

    if (!isView.value) {
      items.push({
        key: 'paste',
        label: t('modules.sqlite.browse.pasteRows'),
        icon: 'clipboard-paste',
        shortcut: 'Ctrl+V',
        disabled: !canInsert.value,
      })
    }

    items.push(
      {
        key: 'export',
        label: t('modules.sqlite.browse.export'),
        icon: 'download',
        disabled: !canExport,
        children: [
          ...IO_FORMATS.map((fmt) => ({
            key: `export:${fmt}`,
            label: formatLabel(fmt),
            icon: formatIcon(fmt),
            disabled: !canExport,
          })),
          {
            key: 'export:fullCsv',
            label: t('modules.sqlite.browse.formatCsvFull'),
            icon: 'database',
            disabled: !props.profileId || !props.table,
          },
        ],
      },
      {
        key: 'import',
        label: t('modules.sqlite.browse.import'),
        icon: 'upload',
        disabled: isView.value || !canInsert.value,
        children: [
          ...IO_FORMATS.map((fmt) => ({
            key: `import:${fmt}`,
            label: formatLabel(fmt),
            icon: formatIcon(fmt),
            disabled: !canInsert.value,
          })),
          {
            key: 'import:fullCsv',
            label: t('modules.sqlite.browse.formatCsvFull'),
            icon: 'database',
            disabled: !props.profileId || !props.table || isView.value,
          },
        ],
      },
    )

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
    if (key === 'export:fullCsv') {
      openBrowseIo('export_csv')
      return
    }
    if (key === 'import:fullCsv') {
      openBrowseIo('import_csv')
      return
    }
    if (key.startsWith('export:')) {
      const format = key.slice('export:'.length) as BrowseDataFormat
      if (IO_FORMATS.includes(format)) void exportPage(format)
      return
    }
    if (key.startsWith('import:')) {
      const format = key.slice('import:'.length) as BrowseDataFormat
      if (IO_FORMATS.includes(format)) void triggerImport(format)
    }
  }

  function formatLabel(format: BrowseDataFormat): string {
    if (format === 'csv') return t('modules.sqlite.browse.formatCsv')
    if (format === 'sql') return t('modules.sqlite.browse.formatSql')
    if (format === 'json') return t('modules.sqlite.browse.formatJson')
    return t('modules.sqlite.browse.formatXls')
  }

  function formatIcon(format: BrowseDataFormat): string {
    if (format === 'csv') return 'file-text'
    if (format === 'sql') return 'file-code'
    if (format === 'json') return 'braces'
    return 'file-spreadsheet'
  }

  const importMenuItems = computed(() => [
    ...IO_FORMATS.map((fmt) => ({
      key: fmt,
      label: formatLabel(fmt),
      icon: formatIcon(fmt),
      disabled: !canInsert.value || saving.value,
    })),
    {
      key: 'fullCsv',
      label: t('modules.sqlite.browse.formatCsvFull'),
      icon: 'database',
      disabled: !props.profileId || !props.table || isView.value || saving.value,
    },
  ])

  const exportMenuItems = computed(() => [
    ...IO_FORMATS.map((fmt) => ({
      key: fmt,
      label: formatLabel(fmt),
      icon: formatIcon(fmt),
      disabled: rawRows.value.length === 0 || saving.value,
    })),
    {
      key: 'fullCsv',
      label: t('modules.sqlite.browse.formatCsvFull'),
      icon: 'database',
      disabled: !props.profileId || !props.table || saving.value,
    },
  ])

  function displayRawMatrix(): { columns: Array<{ name: string }>; rows: unknown[][] } {
    const cols = queryColumns.value
    const keepIdx = cols
      .map((c, i) => (c.name === ROWID_ALIAS ? -1 : i))
      .filter((i) => i >= 0)
    return {
      columns: keepIdx.map((i) => ({ name: cols[i]!.name })),
      rows: rawRows.value.map((row) => keepIdx.map((i) => row[i])),
    }
  }

  function openBrowseIo(kind: 'export_csv' | 'import_csv'): void {
    importMenuOpen.value = false
    exportMenuOpen.value = false
    if (!props.profileId) {
      toast.error(
        t(
          kind === 'export_csv'
            ? 'modules.sqlite.browse.exportNeedProfile'
            : 'modules.sqlite.browse.importNeedProfile',
        ),
      )
      return
    }
    if (!props.table) {
      toast.error(t('modules.sqlite.browse.needTable'))
      return
    }
    if (kind === 'import_csv' && isView.value) {
      toast.error(t('modules.sqlite.io.viewImportUnsupported'))
      return
    }
    const schema = schemaName.value
    const scope = `${schema}.${props.table}`
    const titleKey =
      kind === 'export_csv' ? 'modules.sqlite.io.exportTitle' : 'modules.sqlite.io.importTitle'
    const descKey =
      kind === 'export_csv' ? 'modules.sqlite.io.exportDesc' : 'modules.sqlite.io.importDesc'
    openSqliteDataTask({
      kind,
      title: `${scope} · ${t(titleKey)}`,
      description: t(descKey, { name: scope }),
      context: {
        conn: { profileId: props.profileId } as ConnItem,
        profileId: props.profileId,
        sessionId: null,
        schema,
        table: props.table,
        dumpScope: 'table',
      },
    })
  }

  async function exportPage(format: BrowseDataFormat): Promise<void> {
    exportMenuOpen.value = false
    if (!props.table) {
      toast.error(t('modules.sqlite.browse.needTable'))
      return
    }
    const matrix = displayRawMatrix()
    if (matrix.rows.length === 0 || !lastResult.value) {
      toast.info(t('modules.sqlite.browse.empty'))
      return
    }

    const payload = buildBrowseExportPayload(format, {
      schema: schemaName.value,
      table: props.table,
      columns: matrix.columns,
      rows: matrix.rows,
      baseName: `${schemaName.value}_${props.table}`,
    })

    await nextTick()
    try {
      const picked = await dialogApi.saveFile({
        title: t('modules.sqlite.browse.export'),
        defaultPath: payload.filename,
        accept: payload.accept,
      })
      if (picked.canceled || !picked.filePaths[0]) return
      await fsApi.writeText({ path: picked.filePaths[0], content: payload.content })
      const formatName = formatLabel(format)
      const pageCount = matrix.rows.length
      if (totalRows.value > pageCount) {
        toast.success(
          t('modules.sqlite.browse.exportPagePartialDone', {
            page: pageCount,
            format: formatName,
          }),
        )
      } else {
        toast.success(
          t('modules.sqlite.browse.exportDone', { count: pageCount, format: formatName }),
        )
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.sqlite.browse.exportError'))
    }
  }

  async function triggerImport(format: BrowseDataFormat): Promise<void> {
    importMenuOpen.value = false
    if (!canInsert.value || !props.sessionId || !props.table) return
    await nextTick()
    try {
      const picked = await dialogApi.openFile({
        title: t('modules.sqlite.browse.import'),
        accept: acceptExtensionsForFormat(format),
      })
      if (picked.canceled || !picked.filePaths[0]) return
      const file = await fsApi.readText({ path: picked.filePaths[0] })
      await importFromText(format, file.content ?? '')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.sqlite.browse.importError'))
    }
  }

  async function importFromText(format: BrowseDataFormat, text: string): Promise<void> {
    if (!props.sessionId || !props.table) return

    if (!text.trim()) {
      toast.error(t('modules.sqlite.browse.importEmpty'))
      return
    }
    if (format === 'xls' && looksLikeOfficeZip(text)) {
      toast.error(t('modules.sqlite.browse.importNeedSpreadsheetMl'))
      return
    }

    const parsed = parseBrowseImport(format, text)
    if (parsed.columns.length === 0) {
      toast.error(t('modules.sqlite.browse.importParseError', { format: formatLabel(format) }))
      return
    }
    if (parsed.rows.length === 0) {
      toast.error(t('modules.sqlite.browse.importEmpty'))
      return
    }

    const colSet = new Set(tableColumns.value.map((c) => c.name))
    const mapped = parsed.columns
      .map((h, i) => ({ name: h, index: i }))
      .filter((c) => colSet.has(c.name))
    if (mapped.length === 0) {
      toast.error(t('modules.sqlite.browse.importNoColumns'))
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
          `INSERT INTO ${qualifiedName(schemaName.value, props.table)} ` +
          `(${mapped.map((m) => quoteIdent(m.name)).join(', ')})\nVALUES\n` +
          valueTuples.join(',\n')
        await sqliteApi.queryExec({
          sessionId: props.sessionId,
          schema: schemaName.value,
          sql,
        })
        inserted += chunk.length
      }
      toast.success(t('modules.sqlite.browse.importDone', { count: inserted }))
      await loadData()
    } catch (e) {
      toast.error(
        e instanceof Error
          ? `${e.message} (${t('modules.sqlite.browse.importPartial', { count: inserted })})`
          : t('modules.sqlite.browse.importError'),
      )
      if (inserted > 0) await loadData()
    } finally {
      saving.value = false
    }
  }

  function onImportMenuSelect(key: string): void {
    if (key === 'fullCsv') {
      openBrowseIo('import_csv')
      return
    }
    if (IO_FORMATS.includes(key as BrowseDataFormat)) {
      void triggerImport(key as BrowseDataFormat)
    }
  }

  function onExportMenuSelect(key: string): void {
    if (key === 'fullCsv') {
      openBrowseIo('export_csv')
      return
    }
    if (IO_FORMATS.includes(key as BrowseDataFormat)) {
      void exportPage(key as BrowseDataFormat)
    }
  }

  function currentTablePath(): ConnResourcePath | null {
    if (!props.table) return null
    return {
      segments: [
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
    return { ...result.profile, kind: 'sqlite' }
  }

  async function loadBrowseDdl(): Promise<void> {
    if (!props.sessionId || !props.table) return
    ddlLoading.value = true
    try {
      const result = await sqliteApi.metaDDL({
        sessionId: props.sessionId,
        schema: schemaName.value,
        table: props.table,
      })
      objectType.value = result.objectType ?? (isView.value ? 'view' : 'table')
      try {
        const { formatSql } = await import('@/modules/sql-editor/format')
        ddlText.value = formatSql(result.ddl, { dialect: 'sqlite' })
      } catch {
        ddlText.value = result.ddl
      }
    } catch (e) {
      ddlText.value = ''
      toast.error(e instanceof Error ? e.message : t('modules.sqlite.ddl.loadError'))
    } finally {
      ddlLoading.value = false
    }
  }

  async function copyBrowseDdl(): Promise<void> {
    if (!ddlText.value) return
    const ok = await copyTextToClipboard(ddlText.value)
    if (!ok) {
      toast.error(t('modules.sqlite.ddl.copyFailed'))
      return
    }
    toast.success(t('modules.sqlite.ddl.copied'))
  }

  async function openDesignTable(): Promise<void> {
    ddlMenuOpen.value = false
    if (!canOpenDesign.value) return
    const path = currentTablePath()
    if (!path) return
    try {
      const item = await resolveConnItem()
      if (!item) throw new Error(t('modules.sqlite.browse.openDesignFailed'))
      nav.connect(item, {
        resourcePath: path,
        initialTab: 'design',
        designMode: 'alter',
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.sqlite.browse.openDesignFailed'))
    }
  }

  async function openDdlTab(): Promise<void> {
    ddlMenuOpen.value = false
    const path = currentTablePath()
    if (!path) return
    try {
      const item = await resolveConnItem()
      if (!item) throw new Error(t('modules.sqlite.browse.openDdlFailed'))
      nav.connect(item, {
        resourcePath: path,
        initialTab: 'ddl',
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.sqlite.browse.openDdlFailed'))
    }
  }

  const scopeKey = computed(() =>
    [props.sessionId, schemaName.value, props.table, props.isView].filter(Boolean).join('\0'),
  )

  watch(
    () => scopeKey.value,
    () => {
      flushingNewRow = true
      page.value = 1
      appliedWhereSql.value = ''
      filterDraft.value = ''
      lastResult.value = null
      rawRows.value = []
      queryColumns.value = []
      resultRows.value = []
      tableColumns.value = []
      pkColumns.value = []
      metaReady.value = false
      useRowidLocate.value = false
      totalRows.value = 0
      lastDataSql.value = ''
      selectedRowKeys.value = []
      ddlText.value = ''
      ddlMenuOpen.value = false
      objectType.value = ''
      flushingNewRow = false
    },
  )

  watch(ddlMenuOpen, (open) => {
    if (open) void loadBrowseDdl()
  })

  watch(
    () => [scopeKey.value, page.value, pageSize.value] as const,
    () => {
      if (props.active && scopeOk.value) void loadData()
    },
    { immediate: true },
  )

  watch(
    () => props.active,
    (active) => {
      if (active && scopeOk.value && !lastResult.value) void loadData()
    },
  )

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
    BROWSE_GUTTER_WIDTH,
    loading,
    saving,
    page,
    pageSize,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    totalRows,
    filterOpen,
    filterDraft,
    appliedWhereSql,
    importMenuOpen,
    exportMenuOpen,
    lastDataSql,
    lastResult,
    selectedRowKeys,
    resultRows,
    resultColumns,
    deleteConfirm,
    scopeOk,
    isView,
    scopeLabel,
    shellLabels,
    statusMeta,
    statusHint,
    filterSqlConfig,
    canInsert,
    canDeleteSelection,
    tableEditable,
    loadData,
    applyFilters,
    onFilterKeydown,
    refresh,
    openBrowseIo,
    importMenuItems,
    exportMenuItems,
    onImportMenuSelect,
    onExportMenuSelect,
    openInsert,
    requestDelete,
    confirmDelete,
    onCellEditCommit,
    isBrowseRowPending,
    onBrowseRowEditCommit,
    onBrowseRowEditRollback,
    onBrowseKeydown,
    contextMenuItems,
    onContextMenuSelect,
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
