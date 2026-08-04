/**
 * 达梦表/视图数据浏览：达梦 OFFSET/FETCH 分页，突变严格以主键定位。
 */
import {
  copyTextToClipboard, readClipboardText, useRsToast,
  type RsCodeEditorSqlConfig, type RsContextMenuItem, type RsTableColumn,
} from '@niuma/ui'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi } from '@/api'
import { damengApi } from '@/api/dameng'
import type { DamengColumnInfo, DamengQueryExecResult } from '@/api/types/dameng'
import {
  buildBrowseResultColumn, formatRowsAsTsv, isBrowseFilterCompletionOpen,
  mapPasteToColumnRecords, parseClipboardMatrix, parseEditValue,
  type BrowseDataRow, type BrowseDataShellLabels, type BrowseRowChange,
} from '@/modules/database'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { qualifiedName, quoteIdent } from '@/modules/dameng/sql-seed'
import {
  acceptExtensionsForFormat, buildBrowseExportPayload, buildDeleteSqlText, buildInsertSqlText,
  buildUpdateSqlText, parseBrowseImport,
  type BrowseDataFormat,
} from '@/modules/dameng/utils/browse-io'
import { isBinCell, sqlWhereEquals, toSqlLiteral } from '@/modules/dameng/utils/sql-literal'

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const
const IO_FORMATS: BrowseDataFormat[] = ['csv', 'sql', 'xls', 'json']
const BROWSE_GUTTER_WIDTH = 40

export interface DamengBrowsePaneProps {
  sessionId: string | null
  profileId?: string
  schema?: string
  table?: string
  isView?: boolean
  sessionLabel?: string
  active: boolean
}

function normalizeWhere(value: string): string {
  return value.trim().replace(/^where\s+/i, '').trim()
}
function parseCount(result: DamengQueryExecResult): number {
  const value = result.rows?.[0]?.[0]
  const count = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
}
function empty(value: unknown): boolean {
  return value == null || (typeof value === 'string' && !value.trim())
}

export function useDamengBrowsePane(props: DamengBrowsePaneProps) {
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
  const lastResult = shallowRef<DamengQueryExecResult | null>(null)
  const rawRows = shallowRef<unknown[][]>([])
  const queryColumns = shallowRef<{ name: string; dataType?: string }[]>([])
  const tableColumns = shallowRef<DamengColumnInfo[]>([])
  const pkColumns = shallowRef<string[]>([])
  const metaReady = ref(false)
  const ddlMenuOpen = ref(false)
  const ddlLoading = ref(false)
  const ddlText = ref('')
  const objectType = ref('')
  let newRowSeq = 0
  let flushingNewRow = false

  const isView = computed(() => props.isView === true)
  const schemaName = computed(() => props.schema?.trim() ?? '')
  const scopeOk = computed(() => Boolean(props.sessionId && props.table && schemaName.value))
  const canEdit = computed(() => !isView.value && pkColumns.value.length > 0 && scopeOk.value)
  const canInsert = computed(() => !isView.value && tableColumns.value.length > 0 && scopeOk.value)
  const tableEditable = computed(() => canEdit.value || resultRows.value.some((row) => row.__isNew))
  const canDeleteSelection = computed(() => selectedRowKeys.value.length > 0 && (canEdit.value || selectedRowKeys.value.every((key) => key.startsWith('new-'))))
  const scopeLabel = computed(() => props.table && schemaName.value ? qualifiedName(schemaName.value, props.table) : '')
  const displayColumnNames = computed(() => queryColumns.value.map((column) => column.name))

  const shellLabels = computed((): BrowseDataShellLabels => ({
    toolbarLabel: t('modules.dameng.browse.toolbarLabel'),
    featureLabel: t(isView.value ? 'modules.dameng.browse.featureView' : 'modules.dameng.browse.featureTable'),
    insert: t('modules.dameng.browse.insert'), insertTooltip: t('modules.dameng.browse.insertTooltip'),
    delete: t('modules.dameng.browse.delete'), deleteTooltip: t('modules.dameng.browse.deleteTooltip'),
    import: t('modules.dameng.browse.import'), importTooltip: t('modules.dameng.browse.importTooltip'),
    export: t('modules.dameng.browse.export'), exportTooltip: t('modules.dameng.browse.exportTooltip'),
    filter: t('modules.dameng.browse.filter'), filterToggle: t('modules.dameng.browse.filterToggle'),
    refresh: t('modules.dameng.browse.refresh'), needTable: t('modules.dameng.browse.needTable'),
    empty: t('modules.dameng.browse.empty'),
  }))
  const statusMeta = computed(() => !lastResult.value ? '' : t('modules.dameng.browse.statusRowsTotal', {
    n: resultRows.value.filter((row) => !row.__isNew).length, page: page.value, total: totalRows.value,
  }))
  const statusHint = computed(() => {
    if (isView.value) return t('modules.dameng.browse.viewReadonly')
    return pkColumns.value.length ? t('modules.dameng.browse.editHint') : t('modules.dameng.browse.noPk')
  })
  const filterSqlConfig = computed((): RsCodeEditorSqlConfig | undefined => {
    if (!props.table || !schemaName.value || !tableColumns.value.length) return undefined
    return {
      dialect: 'standard',
      schema: { [schemaName.value]: { [props.table]: tableColumns.value.map((column) => ({ label: column.name, detail: column.dataType, type: 'property' as const, boost: 99 })) } },
      defaultSchema: schemaName.value, defaultTable: props.table,
    }
  })
  const columnMeta = computed(() => new Map(tableColumns.value.map((column) => [column.name.toLowerCase(), column])))
  const resultColumns = computed((): RsTableColumn<BrowseDataRow>[] => displayColumnNames.value.map((name) => {
    const meta = columnMeta.value.get(name.toLowerCase())
    const dataType = queryColumns.value.find((column) => column.name === name)?.dataType ?? meta?.dataType
    return buildBrowseResultColumn({
      name,
      dataType,
      headerTip: `${t('modules.dameng.browse.colTipField', { name })}${dataType ? `\n${t('modules.dameng.browse.colTipType', { type: dataType })}` : ''}`,
      width: 120,
      minWidth: 80,
      nullable: meta?.nullable !== false,
      canEdit: canEdit.value,
      isBinCell,
    })
  }))

  function stableRowKey(row: unknown[], index: number): string {
    const values = pkColumns.value.map((key) => row[queryColumns.value.findIndex((column) => column.name === key)])
    return values.length && values.every((value) => !empty(value)) ? `pk:${values.join('\0')}` : String(index)
  }
  function rebuildRows(): void {
    const draft = resultRows.value.find((row) => row.__isNew)
    const rows = rawRows.value.map((raw, index) => {
      const row: BrowseDataRow = { __rowKey: stableRowKey(raw, index), __rowIndex: index }
      queryColumns.value.forEach((column, columnIndex) => { row[column.name] = raw[columnIndex] })
      return row
    })
    resultRows.value = draft ? [draft, ...rows] : rows
  }
  function locateWhere(index: number): string | null {
    if (!canEdit.value) return null
    const raw = rawRows.value[index]
    if (!raw) return null
    const parts = pkColumns.value.map((key) => {
      const columnIndex = queryColumns.value.findIndex((column) => column.name === key)
      return columnIndex < 0 ? null : sqlWhereEquals(key, raw[columnIndex])
    })
    return parts.some((part) => !part) ? null : parts.join(' AND ')
  }
  async function ensureMeta(): Promise<void> {
    if (!scopeOk.value || metaReady.value) return
    const base = { sessionId: props.sessionId!, schema: schemaName.value, table: props.table! }
    const [columns, primaryKey] = await Promise.all([
      damengApi.metaColumns(base), damengApi.metaPrimaryKey(base).catch(() => ({ columns: [] })),
    ])
    tableColumns.value = columns.columns ?? []
    pkColumns.value = primaryKey.columns ?? []
    metaReady.value = true
  }
  function orderSql(): string {
    return pkColumns.value.length ? pkColumns.value.map(quoteIdent).join(', ') : tableColumns.value[0] ? quoteIdent(tableColumns.value[0].name) : '1'
  }
  async function loadData(options?: { silent?: boolean }): Promise<void> {
    if (!scopeOk.value) return
    if (!options?.silent) loading.value = true
    try {
      await ensureMeta()
      const from = qualifiedName(schemaName.value, props.table!)
      const where = appliedWhereSql.value ? `\nWHERE ${appliedWhereSql.value}` : ''
      const limit = pageSize.value
      const offset = Math.max(0, (page.value - 1) * limit)
      lastDataSql.value = `SELECT *\nFROM ${from}${where}\nORDER BY ${orderSql()}\nOFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
      const [result, counted] = await Promise.all([
        damengApi.queryExec({ sessionId: props.sessionId!, schema: schemaName.value, sql: lastDataSql.value, limit }),
        damengApi.queryExec({ sessionId: props.sessionId!, schema: schemaName.value, sql: `SELECT COUNT(*) AS cnt\nFROM ${from}${where}` }),
      ])
      lastResult.value = result
      queryColumns.value = result.columns ?? []
      rawRows.value = (result.rows ?? []).map((row) => [...row])
      totalRows.value = parseCount(counted)
      rebuildRows()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.dameng.browse.dataError'))
    } finally { if (!options?.silent) loading.value = false }
  }
  function applyFilters(): void { appliedWhereSql.value = normalizeWhere(filterDraft.value); page.value = 1; void loadData() }
  function onFilterKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    if (isBrowseFilterCompletionOpen(event)) return
    event.preventDefault()
    event.stopPropagation()
    applyFilters()
  }
  function refresh(): void {
    const next = normalizeWhere(filterDraft.value)
    if (next !== appliedWhereSql.value) {
      appliedWhereSql.value = next
      page.value = 1
    }
    metaReady.value = false
    void loadData()
  }

  async function onCellEditCommit(
    row: BrowseDataRow,
    column: RsTableColumn<BrowseDataRow>,
    _index: number,
    value: unknown,
  ): Promise<void> {
    const name = String(column.key)
    if (row.__isNew) {
      const idx = resultRows.value.findIndex((item) => item.__rowKey === row.__rowKey)
      if (idx < 0) return
      const previousRaw = resultRows.value[idx]![name]
      const nextRaw = parseEditValue(value, previousRaw)
      const copy = [...resultRows.value]
      copy[idx] = { ...resultRows.value[idx]!, [name]: nextRaw }
      resultRows.value = copy
    }
  }

  async function applyRowChanges(row: BrowseDataRow, changes: BrowseRowChange[]): Promise<void> {
    if (!changes.length) return
    if (row.__isNew) {
      const idx = resultRows.value.findIndex((item) => item.__rowKey === row.__rowKey)
      if (idx >= 0) {
        const nextRow: BrowseDataRow = { ...resultRows.value[idx]! }
        for (const ch of changes) nextRow[ch.colKey] = parseEditValue(ch.value, ch.previous)
        const copy = [...resultRows.value]
        copy[idx] = nextRow
        resultRows.value = copy
        void flushNewRow(nextRow)
      }
      return
    }
    if (!canEdit.value || !props.table || !props.sessionId) return
    const index = row.__rowIndex
    if (index < 0 || index >= rawRows.value.length) return
    const where = locateWhere(index)
    if (!where) {
      toast.error(t('modules.dameng.browse.locateFailed'))
      return
    }
    const setParts: string[] = []
    const applied: Array<{ columnIndex: number; after: unknown; before: unknown }> = []
    for (const ch of changes) {
      const columnIndex = queryColumns.value.findIndex((item) => item.name === ch.colKey)
      if (columnIndex < 0) continue
      const before = rawRows.value[index]![columnIndex]
      const after = parseEditValue(ch.value, before)
      if (toSqlLiteral(before) === toSqlLiteral(after)) continue
      setParts.push(`${quoteIdent(ch.colKey)} = ${toSqlLiteral(after)}`)
      applied.push({ columnIndex, after, before })
    }
    if (!setParts.length) return

    const next = [...rawRows.value]
    const nextRow = [...next[index]!]
    for (const item of applied) nextRow[item.columnIndex] = item.after
    next[index] = nextRow
    rawRows.value = next
    rebuildRows()

    saving.value = true
    try {
      await damengApi.queryExec({
        sessionId: props.sessionId,
        schema: schemaName.value,
        sql:
          `UPDATE ${qualifiedName(schemaName.value, props.table)}\n` +
          `SET ${setParts.join(', ')}\n` +
          `WHERE ${where}`,
      })
      toast.success(t('modules.dameng.browse.cellSaved'))
    } catch (error) {
      const rollback = [...rawRows.value]
      const rollbackRow = [...rollback[index]!]
      for (const item of applied) rollbackRow[item.columnIndex] = item.before
      rollback[index] = rollbackRow
      rawRows.value = rollback
      rebuildRows()
      toast.error(error instanceof Error ? error.message : t('modules.dameng.browse.cellSaveError'))
    } finally {
      saving.value = false
    }
  }

  function createDraft(): BrowseDataRow {
    newRowSeq += 1
    return Object.fromEntries([['__rowKey', `new-${newRowSeq}`], ['__rowIndex', -1], ['__isNew', true], ...displayColumnNames.value.map((name) => [name, null])]) as BrowseDataRow
  }

  /**
   * 插入后回读整行（默认值 / 触发器 / IDENTITY）。
   * 优先用草稿主键（连接池下可靠）；自增列再试 @@IDENTITY（同连接时有效）。
   */
  async function fetchInsertedRawRow(draft: BrowseDataRow): Promise<unknown[] | null> {
    if (!props.sessionId || !props.table || !schemaName.value || displayColumnNames.value.length === 0) return null
    const from = qualifiedName(schemaName.value, props.table)
    const displayCols = queryColumns.value
    const whereCandidates: string[] = []

    if (pkColumns.value.length > 0) {
      const parts: string[] = []
      let pkComplete = true
      for (const pk of pkColumns.value) {
        const raw = draft[pk]
        if (empty(raw)) {
          pkComplete = false
          break
        }
        parts.push(sqlWhereEquals(pk, parseEditValue(raw)))
      }
      if (pkComplete && parts.length > 0) whereCandidates.push(parts.join(' AND '))
    }

    const ai = tableColumns.value.find((column) => column.autoIncrement)
    if (ai) {
      whereCandidates.push(`${quoteIdent(ai.name)} = @@IDENTITY`)
    }
    if (whereCandidates.length === 0) return null

    for (const whereSql of whereCandidates) {
      try {
        const result = await damengApi.queryExec({
          sessionId: props.sessionId,
          schema: schemaName.value,
          sql: `SELECT *\nFROM ${from}\nWHERE ${whereSql}\nFETCH FIRST 1 ROWS ONLY`,
          limit: 1,
        })
        const row = result.rows?.[0]
        if (!row || row.length === 0) continue
        const byName = new Map<string, unknown>()
        ;(result.columns ?? []).forEach((col, i) => {
          byName.set(col.name, row[i])
          byName.set(col.name.toLowerCase(), row[i])
        })
        return displayCols.map(
          (col) => byName.get(col.name) ?? byName.get(col.name.toLowerCase()) ?? null,
        )
      } catch {
        // 尝试下一候选
      }
    }
    return null
  }

  /** 插入成功后就地晋升为正式行，避免整表刷新闪烁。 */
  function promoteInsertedRow(draft: BrowseDataRow, insertedRaw: unknown[] | null): void {
    const displayCols = queryColumns.value
    const raw =
      insertedRaw && insertedRaw.length === displayCols.length
        ? [...insertedRaw]
        : displayCols.map((col) => {
            const value = draft[col.name]
            return value === undefined ? null : parseEditValue(value)
          })

    flushingNewRow = true
    const draftKey = draft.__rowKey
    resultRows.value = resultRows.value.filter((row) => row.__rowKey !== draftKey)
    selectedRowKeys.value = selectedRowKeys.value.filter((key) => key !== draftKey)

    const nextRaw = [raw, ...rawRows.value]
    const limit = pageSize.value || 200
    rawRows.value = nextRaw.length > limit ? nextRaw.slice(0, limit) : nextRaw
    totalRows.value += 1
    rebuildRows()
    selectedRowKeys.value = rawRows.value.length > 0 ? [stableRowKey(rawRows.value[0]!, 0)] : []
    void nextTick(() => {
      flushingNewRow = false
    })
  }

  async function flushNewRow(row: BrowseDataRow): Promise<boolean> {
    if (!row.__isNew || !props.table || !props.sessionId) return true
    const filled = tableColumns.value.filter((column) => !empty(row[column.name]))
    if (!filled.length) {
      discardNewRow(row.__rowKey)
      return true
    }
    const missing = tableColumns.value.find(
      (column) =>
        column.nullable === false &&
        !column.default &&
        !column.autoIncrement &&
        empty(row[column.name]),
    )
    if (missing) {
      toast.error(t('modules.dameng.browse.insertRequired', { name: missing.name }))
      flushingNewRow = true
      selectedRowKeys.value = [row.__rowKey]
      await nextTick()
      flushingNewRow = false
      return false
    }
    saving.value = true
    try {
      await damengApi.queryExec({
        sessionId: props.sessionId,
        schema: schemaName.value,
        sql:
          `INSERT INTO ${qualifiedName(schemaName.value, props.table)} ` +
          `(${filled.map((column) => quoteIdent(column.name)).join(', ')}) ` +
          `VALUES (${filled.map((column) => toSqlLiteral(parseEditValue(row[column.name]))).join(', ')})`,
      })
      toast.success(t('modules.dameng.browse.insertDone'))
      const insertedRaw = await fetchInsertedRawRow(row)
      promoteInsertedRow(row, insertedRaw)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.dameng.browse.insertError'))
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
    if (!canInsert.value) return
    if (!lastResult.value) await loadData()
    if (!lastResult.value) return

    const existing = resultRows.value.find((row) => row.__isNew)
    if (existing) {
      selectedRowKeys.value = [existing.__rowKey]
      return
    }
    const draft = createDraft()
    resultRows.value = [draft, ...resultRows.value]
    selectedRowKeys.value = [draft.__rowKey]
  }
  function discardNewRow(key: string): void {
    resultRows.value = resultRows.value.filter((row) => row.__rowKey !== key)
    selectedRowKeys.value = selectedRowKeys.value.filter((item) => item !== key)
  }
  function requestDelete(): void {
    if (selectedRowKeys.value.every((key) => key.startsWith('new-'))) { selectedRowKeys.value.forEach(discardNewRow); return }
    if (canDeleteSelection.value) deleteConfirm.value = true
  }
  async function confirmDelete(): Promise<void> {
    if (!props.table || !canEdit.value) return
    const selected = new Set(selectedRowKeys.value)
    const indexes = rawRows.value.map((row, index) => selected.has(stableRowKey(row, index)) ? index : -1).filter((index) => index >= 0)
    saving.value = true
    try {
      for (const index of indexes) {
        const where = locateWhere(index)
        if (where) await damengApi.queryExec({ sessionId: props.sessionId!, schema: schemaName.value, sql: `DELETE FROM ${qualifiedName(schemaName.value, props.table)}\nWHERE ${where}` })
      }
      deleteConfirm.value = false; selectedRowKeys.value = []; await loadData()
    } catch (error) { toast.error(error instanceof Error ? error.message : t('modules.dameng.browse.deleteError')) }
    finally { saving.value = false }
  }
  function isBrowseRowPending(row: BrowseDataRow): boolean { return Boolean(row.__isNew) }
  function onBrowseRowEditCommit(
    row: BrowseDataRow,
    _index: number,
    changes: BrowseRowChange[] = [],
  ): void {
    void applyRowChanges(row, changes)
  }
  function onBrowseRowEditRollback(row: BrowseDataRow): void { if (row.__isNew) discardNewRow(row.__rowKey) }

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
    return displayColumnNames.value
  }

  function selectedRowsForCopy(): BrowseDataRow[] {
    const selected = new Set(selectedRowKeys.value)
    return resultRows.value.filter((row) => selected.has(row.__rowKey))
  }

  /** 右键菜单：优先选中行，否则用当前行；排除未提交草稿。 */
  function resolveRowsForCopy(
    row: BrowseDataRow | null,
    selected: BrowseDataRow[],
  ): BrowseDataRow[] {
    const fromSelected = (selected.length > 0 ? selected : selectedRowsForCopy()).filter(
      (item) => !item.__isNew,
    )
    if (fromSelected.length > 0) return fromSelected
    if (row && !row.__isNew) return [row]
    return []
  }

  async function writeClipboardRows(text: string, count: number): Promise<void> {
    const ok = await copyTextToClipboard(text)
    if (!ok) {
      toast.error(t('modules.dameng.browse.copyError'))
      return
    }
    toast.success(t('modules.dameng.browse.copyDone', { count }))
  }

  async function copySelectedRows(
    row: BrowseDataRow | null = null,
    selected: BrowseDataRow[] = [],
  ): Promise<void> {
    const cols = columnNamesForClipboard()
    const rows =
      row || selected.length > 0 ? resolveRowsForCopy(row, selected) : selectedRowsForCopy()
    if (cols.length === 0 || rows.length === 0) {
      toast.info(t('modules.dameng.browse.copyEmpty'))
      return
    }
    const matrix = rows.map((item) => cols.map((name) => item[name]))
    await writeClipboardRows(formatRowsAsTsv(cols, matrix), rows.length)
  }

  async function copySelectedAsInsert(
    row: BrowseDataRow | null,
    selected: BrowseDataRow[],
  ): Promise<void> {
    if (!schemaName.value || !props.table) return
    const cols = columnNamesForClipboard()
    const rows = resolveRowsForCopy(row, selected)
    if (cols.length === 0 || rows.length === 0) {
      toast.info(t('modules.dameng.browse.copyEmpty'))
      return
    }
    const matrix = rows.map((item) => cols.map((name) => item[name]))
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
    if (!schemaName.value || !props.table) return
    const cols = columnNamesForClipboard()
    const rows = resolveRowsForCopy(row, selected)
    if (cols.length === 0 || rows.length === 0) {
      toast.info(t('modules.dameng.browse.copyEmpty'))
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
    if (!schemaName.value || !props.table) return
    const rows = resolveRowsForCopy(row, selected)
    if (rows.length === 0) {
      toast.info(t('modules.dameng.browse.copyEmpty'))
      return
    }
    const text = buildDeleteSqlText(
      schemaName.value,
      props.table,
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
      toast.info(t('modules.dameng.browse.pasteEmpty'))
      return
    }
    const cols = columnNamesForClipboard()
    const records = mapPasteToColumnRecords(cols, parseClipboardMatrix(text))
    if (records.length === 0) {
      toast.info(t('modules.dameng.browse.pasteEmpty'))
      return
    }

    flushingNewRow = true
    const existingDrafts = resultRows.value.filter((row) => row.__isNew)
    const rest = resultRows.value.filter((row) => !row.__isNew)
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
    flushingNewRow = false
    toast.success(t('modules.dameng.browse.pasteDone', { count: filled.length }))
  }

  function onBrowseKeydown(event: KeyboardEvent): void {
    if (!props.active || isTypingTarget(event.target)) return
    const mod = event.ctrlKey || event.metaKey
    if (!mod || event.altKey || event.shiftKey) return
    const key = event.key.toLowerCase()
    if (key === 'c') {
      if (selectedRowKeys.value.length === 0) return
      event.preventDefault()
      void copySelectedRows()
      return
    }
    if (key === 'v') {
      if (!canInsert.value) return
      event.preventDefault()
      void pasteIntoInsertRows()
    }
  }

  function formatLabel(format: BrowseDataFormat): string {
    if (format === 'csv') return t('modules.dameng.browse.formatCsv')
    if (format === 'sql') return t('modules.dameng.browse.formatSql')
    if (format === 'json') return t('modules.dameng.browse.formatJson')
    return t('modules.dameng.browse.formatXls')
  }

  function formatIcon(format: BrowseDataFormat): string {
    if (format === 'csv') return 'file-text'
    if (format === 'sql') return 'file-code'
    if (format === 'json') return 'braces'
    return 'file-spreadsheet'
  }

  function openBrowseIo(kind: 'export_csv' | 'import_csv'): void {
    if (!props.profileId) {
      toast.error(t(kind === 'export_csv' ? 'modules.dameng.browse.exportNeedProfile' : 'modules.dameng.browse.importNeedProfile'))
      return
    }
    if (!schemaName.value || !props.table) {
      toast.error(t('modules.dameng.browse.needTable'))
      return
    }
    const scope = `${schemaName.value}.${props.table}`
    void import('@/modules/dameng/data-tasks').then(({ openDamengDataTask }) => {
      openDamengDataTask({
        kind,
        title: `${scope} · ${t(kind === 'export_csv' ? 'modules.dameng.io.exportTitle' : 'modules.dameng.io.importTitle')}`,
        description: t(kind === 'export_csv' ? 'modules.dameng.io.exportDesc' : 'modules.dameng.io.importDesc', { name: scope }),
        context: {
          conn: { profileId: props.profileId } as ConnItem,
          profileId: props.profileId!,
          sessionId: null,
          schema: schemaName.value,
          table: props.table,
          dumpScope: 'table',
        },
      })
    })
  }

  const importMenuItems = computed(() =>
    IO_FORMATS.map((format) => ({
      key: format,
      label: formatLabel(format),
      icon: formatIcon(format),
      disabled: !canInsert.value || saving.value,
    })),
  )
  const exportMenuItems = computed(() => [
    ...IO_FORMATS.map((format) => ({
      key: format,
      label: formatLabel(format),
      icon: formatIcon(format),
      disabled: !rawRows.value.length || saving.value,
    })),
    {
      key: 'fullCsv',
      label: t('modules.dameng.browse.formatCsvFull'),
      icon: 'database',
      disabled: !props.profileId || !schemaName.value || !props.table || saving.value,
    },
  ])

  function downloadPage(format: BrowseDataFormat): void {
    if (!props.table) return
    if (rawRows.value.length === 0 || !lastResult.value) {
      toast.info(t('modules.dameng.browse.empty'))
      return
    }
    const payload = buildBrowseExportPayload(format, {
      schema: schemaName.value,
      table: props.table,
      columns: queryColumns.value,
      rows: rawRows.value,
      baseName: `${schemaName.value}_${props.table}`,
    })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([payload.content], { type: 'text/plain;charset=utf-8' }))
    link.download = payload.filename
    link.click()
    URL.revokeObjectURL(link.href)
    const formatName = formatLabel(format)
    const pageCount = rawRows.value.length
    if (totalRows.value > pageCount) {
      toast.success(t('modules.dameng.browse.exportPagePartialDone', { page: pageCount, format: formatName }))
    } else {
      toast.success(t('modules.dameng.browse.exportDone', { count: pageCount, format: formatName }))
    }
  }

  function onExportMenuSelect(key: string): void {
    if (key === 'fullCsv') {
      exportMenuOpen.value = false
      openBrowseIo('export_csv')
      return
    }
    if (IO_FORMATS.includes(key as BrowseDataFormat)) downloadPage(key as BrowseDataFormat)
  }

  async function importText(format: BrowseDataFormat, text: string): Promise<void> {
    if (!props.sessionId || !props.table) return
    const parsed = parseBrowseImport(format, text)
    const columns = parsed.columns
      .map((name, index) => ({ name, index }))
      .filter((column) => tableColumns.value.some((meta) => meta.name === column.name))
    if (!columns.length || !parsed.rows.length) {
      toast.error(t('modules.dameng.browse.importParseError', { format: formatLabel(format) }))
      return
    }
    saving.value = true
    try {
      for (const row of parsed.rows) {
        const names = columns.map((column) => quoteIdent(column.name)).join(', ')
        const values = columns.map((column) => toSqlLiteral(row[column.index] || null)).join(', ')
        await damengApi.queryExec({
          sessionId: props.sessionId, schema: schemaName.value,
          sql: `INSERT INTO ${qualifiedName(schemaName.value, props.table)} (${names}) VALUES (${values})`,
        })
      }
      toast.success(t('modules.dameng.browse.importDone', { count: parsed.rows.length }))
      await loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.dameng.browse.importError'))
    } finally { saving.value = false }
  }

  function triggerImport(format: BrowseDataFormat): void {
    importMenuOpen.value = false
    if (!IO_FORMATS.includes(format) || !canInsert.value) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = acceptExtensionsForFormat(format).join(',')
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => void importText(format, String(reader.result ?? ''))
      reader.readAsText(file, 'utf-8')
    }
    input.click()
  }

  function onImportMenuSelect(key: string): void {
    if (IO_FORMATS.includes(key as BrowseDataFormat)) {
      triggerImport(key as BrowseDataFormat)
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
      label: t('modules.dameng.browse.copy'),
      icon: 'copy',
      disabled: !canCopy,
      children: [
        {
          key: 'copy:tsv',
          label: t('modules.dameng.browse.copyRows'),
          icon: 'copy',
          shortcut: 'Ctrl+C',
          disabled: !canCopy,
        },
        {
          key: 'copy:insert',
          label: t('modules.dameng.browse.copyAsInsert'),
          icon: 'square-plus',
          disabled: !canCopy || !schemaName.value || !props.table,
        },
        {
          key: 'copy:update',
          label: t('modules.dameng.browse.copyAsUpdate'),
          icon: 'pencil',
          disabled: !canCopy || !schemaName.value || !props.table,
        },
        {
          key: 'copy:delete',
          label: t('modules.dameng.browse.copyAsDelete'),
          icon: 'trash-2',
          disabled: !canCopy || !schemaName.value || !props.table,
        },
      ],
    })

    if (canInsert.value) {
      items.push({
        key: 'paste',
        label: t('modules.dameng.browse.pasteRows'),
        icon: 'clipboard-paste',
        shortcut: 'Ctrl+V',
      })
      items.push({ key: 'sep-io', label: '', separator: true })
      items.push({
        key: 'import',
        label: t('modules.dameng.browse.import'),
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
      label: t('modules.dameng.browse.export'),
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
          label: t('modules.dameng.browse.formatCsvFull'),
          icon: 'database',
          disabled: !props.profileId || !schemaName.value || !props.table || saving.value,
        },
      ],
    })

    const hasDraft = Boolean(row?.__isNew) || selected.some((item) => item.__isNew)
    const canCtxDelete =
      hasDraft || (canEdit.value && (selected.length > 0 || Boolean(row)))
    if (canCtxDelete) {
      items.push({ key: 'sep-delete', label: '', separator: true })
      items.push({
        key: 'delete',
        label: t('modules.dameng.browse.delete'),
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
    if (key.startsWith('import:')) {
      const format = key.slice('import:'.length) as BrowseDataFormat
      if (IO_FORMATS.includes(format)) triggerImport(format)
      return
    }
    if (key === 'export:fullCsv') {
      openBrowseIo('export_csv')
      return
    }
    if (key.startsWith('export:')) {
      const format = key.slice('export:'.length) as BrowseDataFormat
      if (IO_FORMATS.includes(format)) downloadPage(format)
    }
  }
  async function loadBrowseDdl(): Promise<void> {
    if (!scopeOk.value) return
    ddlLoading.value = true
    try {
      const result = await damengApi.metaDDL({ sessionId: props.sessionId!, schema: schemaName.value, table: props.table! })
      ddlText.value = result.ddl; objectType.value = result.objectType ?? (isView.value ? 'view' : 'table')
    } catch (error) { toast.error(error instanceof Error ? error.message : t('modules.dameng.ddl.loadError')) }
    finally { ddlLoading.value = false }
  }
  async function copyBrowseDdl(): Promise<void> {
    if (!ddlText.value) return
    const ok = await copyTextToClipboard(ddlText.value)
    if (!ok) {
      toast.error(t('modules.dameng.ddl.copyFailed'))
      return
    }
    toast.success(t('modules.dameng.ddl.copied'))
  }
  function currentTablePath(): ConnResourcePath | null {
    if (!schemaName.value || !props.table) return null
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
    return { ...result.profile, kind: 'dameng' }
  }
  const canOpenDesign = computed(() => !isView.value && Boolean(schemaName.value && props.table))

  async function openDesignTable(): Promise<void> {
    ddlMenuOpen.value = false
    if (!canOpenDesign.value) return
    const path = currentTablePath()
    if (!path) return
    try {
      const item = await resolveConnItem()
      if (!item) throw new Error(t('modules.dameng.browse.openDesignFailed'))
      nav.connect(item, { resourcePath: path, initialTab: 'design', designMode: 'alter' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.dameng.browse.openDesignFailed'))
    }
  }
  async function openDdlTab(): Promise<void> {
    ddlMenuOpen.value = false
    const path = currentTablePath()
    if (!path) return
    try {
      const item = await resolveConnItem()
      if (!item) throw new Error(t('modules.dameng.browse.openDdlFailed'))
      nav.connect(item, { resourcePath: path, initialTab: 'ddl' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.dameng.browse.openDdlFailed'))
    }
  }
  const scopeKey = computed(() => [props.sessionId, schemaName.value, props.table, props.isView].join('\0'))
  watch(scopeKey, () => {
    page.value = 1; metaReady.value = false; rawRows.value = []; queryColumns.value = []; resultRows.value = []; tableColumns.value = []; pkColumns.value = []; lastResult.value = null; totalRows.value = 0
  })
  watch(ddlMenuOpen, (open) => { if (open) void loadBrowseDdl() })
  /** 仅作用域/分页变化时重拉；keep-alive 切回 Shell Tab 不重复请求。 */
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
      if (active && scopeOk.value && !lastResult.value && !loading.value) void loadData()
    },
  )
  watch(selectedRowKeys, async (keys, previous) => {
    if (flushingNewRow || saving.value) return
    const prior = previous?.find((key) => key.startsWith('new-'))
    if (prior && !keys.includes(prior)) { const row = resultRows.value.find((item) => item.__rowKey === prior); if (row) await flushNewRow(row) }
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
    canEdit,
    canDeleteSelection,
    tableEditable,
    loadData,
    applyFilters,
    onFilterKeydown,
    refresh,
    importMenuItems,
    exportMenuItems,
    onImportMenuSelect,
    onExportMenuSelect,
    openBrowseIo,
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
