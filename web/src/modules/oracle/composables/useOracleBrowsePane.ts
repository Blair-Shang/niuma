/**
 * Oracle表/视图数据浏览：Oracle OFFSET/FETCH 分页，突变严格以主键定位。
 */
import {
  copyTextToClipboard, readClipboardText, useRsToast,
  type RsCodeEditorSqlConfig, type RsContextMenuItem, type RsTableColumn,
} from '@niuma/ui'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi, dialogApi, fsApi } from '@/api'
import { oracleApi } from '@/api/oracle'
import type { OracleColumnInfo, OracleQueryExecResult } from '@/api/types/oracle'
import {
  buildBrowseResultColumn, formatRowsAsTsv, isBrowseFilterCompletionOpen,
  mapPasteToColumnRecords, parseClipboardMatrix, parseEditValue,
  type BrowseDataRow, type BrowseDataShellLabels,
} from '@/modules/database'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { qualifiedName, quoteIdent } from '@/modules/oracle/sql-seed'
import {
  acceptExtensionsForFormat, buildBrowseExportPayload, buildDeleteSqlText, buildInsertSqlText,
  buildUpdateSqlText, looksLikeOfficeZip, parseBrowseImport,
  type BrowseDataFormat,
} from '@/modules/oracle/utils/browse-io'
import {
  buildBrowseLobSelectSql,
  isTruncatedLobCell,
  loadOracleLobFull,
} from '@/modules/oracle/utils/load-lob'
import { isBinCell, sqlWhereEquals, toSqlLiteral } from '@/modules/oracle/utils/sql-literal'
import { isSqlBinaryLobType, isSqlTextLobType } from '@/modules/database/utils/column-value-type'

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const
const IO_FORMATS: BrowseDataFormat[] = ['csv', 'sql', 'xls', 'json']
const BROWSE_GUTTER_WIDTH = 40

export interface OracleBrowsePaneProps {
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
function parseCount(result: OracleQueryExecResult): number {
  const value = result.rows?.[0]?.[0]
  const count = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
}
function empty(value: unknown): boolean {
  return value == null || (typeof value === 'string' && !value.trim())
}

export function useOracleBrowsePane(props: OracleBrowsePaneProps) {
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
  const lastResult = shallowRef<OracleQueryExecResult | null>(null)
  const rawRows = shallowRef<unknown[][]>([])
  const queryColumns = shallowRef<{ name: string; dataType?: string }[]>([])
  const tableColumns = shallowRef<OracleColumnInfo[]>([])
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
    toolbarLabel: t('modules.oracle.browse.toolbarLabel'),
    featureLabel: t(isView.value ? 'modules.oracle.browse.featureView' : 'modules.oracle.browse.featureTable'),
    insert: t('modules.oracle.browse.insert'), insertTooltip: t('modules.oracle.browse.insertTooltip'),
    delete: t('modules.oracle.browse.delete'), deleteTooltip: t('modules.oracle.browse.deleteTooltip'),
    import: t('modules.oracle.browse.import'), importTooltip: t('modules.oracle.browse.importTooltip'),
    export: t('modules.oracle.browse.export'), exportTooltip: t('modules.oracle.browse.exportTooltip'),
    filter: t('modules.oracle.browse.filter'), filterToggle: t('modules.oracle.browse.filterToggle'),
    refresh: t('modules.oracle.browse.refresh'), needTable: t('modules.oracle.browse.needTable'),
    empty: t('modules.oracle.browse.empty'),
  }))
  const statusMeta = computed(() => !lastResult.value ? '' : t('modules.oracle.browse.statusRowsTotal', {
    n: resultRows.value.filter((row) => !row.__isNew).length, page: page.value, total: totalRows.value,
  }))
  const statusHint = computed(() => {
    if (isView.value) return t('modules.oracle.browse.viewReadonly')
    return pkColumns.value.length ? t('modules.oracle.browse.editHint') : t('modules.oracle.browse.noPk')
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
  function columnDataType(name: string): string | undefined {
    const meta = columnMeta.value.get(name.toLowerCase())
    const queryType = queryColumns.value.find((column) => column.name === name)?.dataType
    // 元数据含长度（VARCHAR2(50 CHAR)）；查询结果多为驱动裸类型名
    return (meta?.dataType || queryType || '').trim() || undefined
  }
  const resultColumns = computed((): RsTableColumn<BrowseDataRow>[] => {
    const pk = new Set(pkColumns.value.map((n) => n.toLowerCase()))
    return displayColumnNames.value.map((name) => {
      const meta = columnMeta.value.get(name.toLowerCase())
      const typeLabel = columnDataType(name) ?? ''
      const isPk = pk.has(name.toLowerCase())
      const nullable = meta?.nullable
      const tipLines = [t('modules.oracle.browse.colTipField', { name })]
      if (typeLabel) tipLines.push(t('modules.oracle.browse.colTipType', { type: typeLabel }))
      tipLines.push(
        t('modules.oracle.browse.colTipPrimary', {
          value: isPk ? t('modules.oracle.browse.colTipYes') : t('modules.oracle.browse.colTipNo'),
        }),
      )
      if (typeof nullable === 'boolean') {
        tipLines.push(
          t('modules.oracle.browse.colTipNullable', {
            value: nullable
              ? t('modules.oracle.browse.colTipYes')
              : t('modules.oracle.browse.colTipNo'),
          }),
        )
      }
      return buildBrowseResultColumn({
        name,
        dataType: typeLabel || undefined,
        dialect: 'oracle',
        headerTip: tipLines.join('\n'),
        width: 120,
        minWidth: 80,
        nullable: nullable !== false,
        canEdit: canEdit.value,
        isBinCell,
      })
    })
  })

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
  function locateWhere(index: number, opts?: { forMutate?: boolean }): string | null {
    if (opts?.forMutate !== false && !canEdit.value) return null
    const raw = rawRows.value[index]
    if (!raw) return null
    const keys =
      pkColumns.value.length > 0
        ? pkColumns.value
        : queryColumns.value
            .map((c) => c.name)
            .filter((name) => {
              const dt = queryColumns.value.find((c) => c.name === name)?.dataType
              return !isSqlBinaryLobType(dt) && !isSqlTextLobType(dt)
            })
    if (!keys.length) return null
    const parts = keys.map((key) => {
      const columnIndex = queryColumns.value.findIndex((column) => column.name === key)
      return columnIndex < 0 ? null : sqlWhereEquals(key, raw[columnIndex], columnDataType(key))
    })
    return parts.some((part) => !part) ? null : parts.join(' AND ')
  }

  async function resolveFullCellValue(ctx: {
    row: BrowseDataRow
    column: RsTableColumn<BrowseDataRow>
    index: number
    raw: unknown
  }): Promise<unknown | null> {
    if (!props.sessionId || !schemaName.value || !props.table) return null
    if (!isTruncatedLobCell(ctx.raw)) return null
    const index = Number(ctx.row.__rowIndex ?? ctx.index)
    const where = locateWhere(index, { forMutate: false })
    if (!where) {
      toast.warning(t('modules.oracle.browse.lobNeedKey'))
      return null
    }
    try {
      const loaded = await loadOracleLobFull({
        sessionId: props.sessionId,
        schema: schemaName.value,
        sql: buildBrowseLobSelectSql(
          schemaName.value,
          props.table,
          String(ctx.column.key),
          where,
        ),
      })
      // 同步 rawRows，便于后续编辑/保存用全量
      if (Number.isFinite(index) && index >= 0 && rawRows.value[index]) {
        const colIndex = queryColumns.value.findIndex((c) => c.name === String(ctx.column.key))
        if (colIndex >= 0) {
          const next = [...rawRows.value]
          const row = [...(next[index] ?? [])]
          row[colIndex] = loaded.value
          next[index] = row
          rawRows.value = next
        }
      }
      return loaded.value
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.oracle.browse.lobLoadFailed'))
      return null
    }
  }
  async function ensureMeta(): Promise<void> {
    if (!scopeOk.value || metaReady.value) return
    const base = { sessionId: props.sessionId!, schema: schemaName.value, table: props.table! }
    // Oracle 单连接不可并发；元数据查询必须串行。
    const columns = await oracleApi.metaColumns(base)
    const primaryKey = await oracleApi.metaPrimaryKey(base).catch(() => ({ columns: [] as string[] }))
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
      // Oracle ODPI 同一 session 不可并行执行；并行 SELECT + COUNT 会触发 ORA-01013。
      const result = await oracleApi.queryExec({
        sessionId: props.sessionId!,
        schema: schemaName.value,
        sql: lastDataSql.value,
        limit,
      })
      const counted = await oracleApi.queryExec({
        sessionId: props.sessionId!,
        schema: schemaName.value,
        sql: `SELECT COUNT(*) AS cnt\nFROM ${from}${where}`,
      })
      lastResult.value = result
      queryColumns.value = result.columns ?? []
      rawRows.value = (result.rows ?? []).map((row) => [...row])
      totalRows.value = parseCount(counted)
      rebuildRows()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.oracle.browse.dataError'))
    } finally { if (!options?.silent) loading.value = false }
  }
  function applyFilters(): void { appliedWhereSql.value = normalizeWhere(filterDraft.value); page.value = 1; void loadData() }
  function onFilterKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    // 补全打开时 Enter 交给编辑器接受选项，勿应用过滤/刷新
    if (isBrowseFilterCompletionOpen(event)) return
    event.preventDefault()
    event.stopPropagation()
    applyFilters()
  }
  function refresh(): void { metaReady.value = false; page.value = 1; void loadData() }

  async function onCellEditCommit(row: BrowseDataRow, column: RsTableColumn<BrowseDataRow>, _index: number, value: unknown): Promise<void> {
    const name = String(column.key)
    if (row.__isNew) { row[name] = parseEditValue(value, row[name]) }
  }

  async function applyRowChanges(
    row: BrowseDataRow,
    changes: Array<{ colKey: string; value: unknown; previous: unknown }>,
  ): Promise<void> {
    if (!changes.length) return
    if (row.__isNew) {
      const idx = resultRows.value.findIndex((r) => r.__rowKey === row.__rowKey)
      if (idx >= 0) {
        const nextRow: BrowseDataRow = { ...resultRows.value[idx]! }
        for (const ch of changes) {
          nextRow[ch.colKey] = parseEditValue(ch.value, ch.previous)
        }
        const copy = [...resultRows.value]
        copy[idx] = nextRow
        resultRows.value = copy
        void flushNewRow(nextRow)
      }
      return
    }
    const index = row.__rowIndex
    const where = locateWhere(index)
    if (!where || !props.table || !props.sessionId) {
      toast.error(t('modules.oracle.browse.locateFailed'))
      return
    }
    const setParts: string[] = []
    const applied: Array<{ columnIndex: number; after: unknown; before: unknown }> = []
    for (const ch of changes) {
      const columnIndex = queryColumns.value.findIndex((item) => item.name === ch.colKey)
      if (columnIndex < 0) continue
      const before = rawRows.value[index]?.[columnIndex]
      const after = parseEditValue(ch.value, before)
      const dataType = columnDataType(ch.colKey)
      if (toSqlLiteral(before, dataType) === toSqlLiteral(after, dataType)) continue
      setParts.push(`${quoteIdent(ch.colKey)} = ${toSqlLiteral(after, dataType)}`)
      applied.push({ columnIndex, after, before })
    }
    if (!setParts.length) return

    // 与 MySQL 一致：先乐观写回再请求。RsTable row-commit 会先清草稿回到 props，
    // 若等 queryExec 成功才改 rawRows，中间会闪回旧值。
    const next = [...rawRows.value]
    const nextRow = [...(next[index] ?? [])]
    for (const item of applied) nextRow[item.columnIndex] = item.after
    next[index] = nextRow
    rawRows.value = next
    rebuildRows()

    saving.value = true
    try {
      await oracleApi.queryExec({
        sessionId: props.sessionId,
        schema: schemaName.value,
        sql: `UPDATE ${qualifiedName(schemaName.value, props.table)}\nSET ${setParts.join(', ')}\nWHERE ${where}`,
      })
      toast.success(t('modules.oracle.browse.cellSaved'))
    } catch (error) {
      const rollback = [...rawRows.value]
      const rollbackRow = [...(rollback[index] ?? [])]
      for (const item of applied) rollbackRow[item.columnIndex] = item.before
      rollback[index] = rollbackRow
      rawRows.value = rollback
      rebuildRows()
      toast.error(error instanceof Error ? error.message : t('modules.oracle.browse.cellSaveError'))
    } finally {
      saving.value = false
    }
  }

  function createDraft(): BrowseDataRow {
    newRowSeq += 1
    return Object.fromEntries([['__rowKey', `new-${newRowSeq}`], ['__rowIndex', -1], ['__isNew', true], ...displayColumnNames.value.map((name) => [name, null])]) as BrowseDataRow
  }
  async function flushNewRow(row: BrowseDataRow): Promise<boolean> {
    if (!row.__isNew || !props.table || !props.sessionId) return true
    const filled = tableColumns.value.filter((column) => !empty(row[column.name]))
    if (!filled.length) { discardNewRow(row.__rowKey); return true }
    const missing = tableColumns.value.find((column) => column.nullable === false && !column.default && empty(row[column.name]))
    if (missing) { toast.error(t('modules.oracle.browse.insertRequired', { name: missing.name })); return false }
    saving.value = true
    try {
      await oracleApi.queryExec({
        sessionId: props.sessionId,
        schema: schemaName.value,
        sql: `INSERT INTO ${qualifiedName(schemaName.value, props.table)} (${filled.map((column) => quoteIdent(column.name)).join(', ')}) VALUES (${filled.map((column) => toSqlLiteral(parseEditValue(row[column.name]), column.dataType || columnDataType(column.name))).join(', ')})`,
      })
      toast.success(t('modules.oracle.browse.insertDone')); await loadData(); return true
    } catch (error) { toast.error(error instanceof Error ? error.message : t('modules.oracle.browse.insertError')); return false }
    finally { saving.value = false }
  }
  async function openInsert(): Promise<void> {
    if (!canInsert.value) return
    if (!lastResult.value) await loadData()
    if (!resultRows.value.some((row) => row.__isNew)) resultRows.value = [createDraft(), ...resultRows.value]
  }
  function discardNewRow(key: string): void { resultRows.value = resultRows.value.filter((row) => row.__rowKey !== key) }
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
        if (where) await oracleApi.queryExec({ sessionId: props.sessionId!, schema: schemaName.value, sql: `DELETE FROM ${qualifiedName(schemaName.value, props.table)}\nWHERE ${where}` })
      }
      const deleted = indexes.length
      deleteConfirm.value = false
      selectedRowKeys.value = []
      toast.success(t('modules.oracle.browse.deleteDone', { count: deleted }))
      await loadData()
    } catch (error) { toast.error(error instanceof Error ? error.message : t('modules.oracle.browse.deleteError')) }
    finally { saving.value = false }
  }
  function isBrowseRowPending(row: BrowseDataRow): boolean { return Boolean(row.__isNew) }
  function onBrowseRowEditCommit(
    row: BrowseDataRow,
    _index: number,
    changes: Array<{ colKey: string; value: unknown; previous: unknown }> = [],
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
    return (lastResult.value?.columns ?? []).map((c) => c.name)
  }

  function selectedRowsForCopy(): BrowseDataRow[] {
    const selected = new Set(selectedRowKeys.value)
    return resultRows.value.filter((r) => selected.has(r.__rowKey))
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
      toast.error(t('modules.oracle.browse.copyError'))
      return
    }
    toast.success(t('modules.oracle.browse.copyDone', { count }))
  }

  async function copySelectedRows(
    row: BrowseDataRow | null = null,
    selected: BrowseDataRow[] = [],
  ): Promise<void> {
    const cols = columnNamesForClipboard()
    const rows =
      row || selected.length > 0 ? resolveRowsForCopy(row, selected) : selectedRowsForCopy()
    if (cols.length === 0 || rows.length === 0) {
      toast.info(t('modules.oracle.browse.copyEmpty'))
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
      toast.info(t('modules.oracle.browse.copyEmpty'))
      return
    }
    const matrix = rows.map((item) => cols.map((name) => item[name]))
    await writeClipboardRows(
      buildInsertSqlText(schemaName.value, props.table, cols.map((name) => ({ name })), matrix),
      rows.length,
    )
  }

  async function copySelectedAsUpdate(
    row: BrowseDataRow | null,
    selected: BrowseDataRow[],
  ): Promise<void> {
    if (!schemaName.value || !props.table) return
    const cols = columnNamesForClipboard()
    const rows = resolveRowsForCopy(row, selected)
    if (cols.length === 0 || rows.length === 0) {
      toast.info(t('modules.oracle.browse.copyEmpty'))
      return
    }
    // 无主键时用全列 WHERE（对齐 MySQL / DBeaver）
    await writeClipboardRows(
      buildUpdateSqlText(schemaName.value, props.table, cols, pkColumns.value, rows, cols),
      rows.length,
    )
  }

  async function copySelectedAsDelete(
    row: BrowseDataRow | null,
    selected: BrowseDataRow[],
  ): Promise<void> {
    if (!schemaName.value || !props.table) return
    const rows = resolveRowsForCopy(row, selected)
    if (rows.length === 0) {
      toast.info(t('modules.oracle.browse.copyEmpty'))
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
      toast.info(t('modules.oracle.browse.pasteEmpty'))
      return
    }
    const cols = columnNamesForClipboard()
    const records = mapPasteToColumnRecords(cols, parseClipboardMatrix(text))
    if (records.length === 0) {
      toast.info(t('modules.oracle.browse.pasteEmpty'))
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
    toast.success(t('modules.oracle.browse.pasteDone', { count: filled.length }))
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
    if (format === 'csv') return t('modules.oracle.browse.formatCsv')
    if (format === 'sql') return t('modules.oracle.browse.formatSql')
    if (format === 'json') return t('modules.oracle.browse.formatJson')
    return t('modules.oracle.browse.formatXls')
  }

  function formatIcon(format: BrowseDataFormat): string {
    if (format === 'csv') return 'file-text'
    if (format === 'sql') return 'file-code'
    if (format === 'json') return 'braces'
    return 'file-spreadsheet'
  }

  function openBrowseIo(kind: 'export_csv' | 'import_csv'): void {
    if (!props.profileId) {
      toast.error(t(kind === 'export_csv' ? 'modules.oracle.browse.exportNeedProfile' : 'modules.oracle.browse.importNeedProfile'))
      return
    }
    if (!schemaName.value || !props.table) {
      toast.error(t('modules.oracle.browse.needTable'))
      return
    }
    const scope = `${schemaName.value}.${props.table}`
    void import('@/modules/oracle/data-tasks').then(({ openOracleDataTask }) => {
      openOracleDataTask({
        kind,
        title: `${scope} · ${t(kind === 'export_csv' ? 'modules.oracle.io.exportTitle' : 'modules.oracle.io.importTitle')}`,
        description: t(kind === 'export_csv' ? 'modules.oracle.io.exportDesc' : 'modules.oracle.io.importDesc', { name: scope }),
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
      disabled: rawRows.value.length === 0 || saving.value,
    })),
    {
      key: 'fullCsv',
      label: t('modules.oracle.browse.formatCsvFull'),
      icon: 'database',
      disabled: !props.profileId || !schemaName.value || !props.table || saving.value,
    },
  ])

  async function exportPage(format: BrowseDataFormat): Promise<void> {
    exportMenuOpen.value = false
    if (!schemaName.value || !props.table) {
      toast.error(t('modules.oracle.browse.needTable'))
      return
    }
    if (rawRows.value.length === 0 || !lastResult.value) {
      toast.info(t('modules.oracle.browse.empty'))
      return
    }
    const payload = buildBrowseExportPayload(format, {
      schema: schemaName.value,
      table: props.table,
      columns: queryColumns.value,
      rows: rawRows.value,
      baseName: `${schemaName.value}_${props.table}`,
    })
    await nextTick()
    try {
      const picked = await dialogApi.saveFile({
        title: t('modules.oracle.browse.export'),
        defaultPath: payload.filename,
        accept: payload.accept,
      })
      if (picked.canceled || !picked.filePaths[0]) return
      await fsApi.writeText({ path: picked.filePaths[0], content: payload.content })
      const formatName = formatLabel(format)
      const pageCount = rawRows.value.length
      if (totalRows.value > pageCount) {
        toast.success(t('modules.oracle.browse.exportPagePartialDone', { page: pageCount, format: formatName }))
      } else {
        toast.success(t('modules.oracle.browse.exportDone', { count: pageCount, format: formatName }))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.oracle.browse.exportError'))
    }
  }

  async function triggerImport(format: BrowseDataFormat): Promise<void> {
    importMenuOpen.value = false
    if (!canInsert.value || !props.sessionId || !schemaName.value || !props.table) return
    await nextTick()
    try {
      const picked = await dialogApi.openFile({
        title: t('modules.oracle.browse.import'),
        accept: acceptExtensionsForFormat(format),
      })
      if (picked.canceled || !picked.filePaths[0]) return
      const file = await fsApi.readText({ path: picked.filePaths[0] })
      await importFromText(format, file.content ?? '')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.oracle.browse.importError'))
    }
  }

  async function importFromText(format: BrowseDataFormat, text: string): Promise<void> {
    if (!props.sessionId || !schemaName.value || !props.table) return
    if (!text.trim()) {
      toast.error(t('modules.oracle.browse.importEmpty'))
      return
    }
    if (format === 'xls' && looksLikeOfficeZip(text)) {
      toast.error(t('modules.oracle.browse.importNeedSpreadsheetMl'))
      return
    }
    const parsed = parseBrowseImport(format, text)
    if (parsed.columns.length === 0) {
      toast.error(t('modules.oracle.browse.importParseError', { format: formatLabel(format) }))
      return
    }
    if (parsed.rows.length === 0) {
      toast.error(t('modules.oracle.browse.importEmpty'))
      return
    }
    // Oracle 未加引号标识符通常为大写；导入表头做大小写不敏感匹配
    const colMap = new Map(tableColumns.value.map((c) => [c.name.toLowerCase(), c.name]))
    const mapped = parsed.columns
      .map((h, i) => {
        const name = colMap.get(h.toLowerCase())
        return name ? { name, index: i } : null
      })
      .filter((c): c is { name: string; index: number } => Boolean(c))
    if (mapped.length === 0) {
      toast.error(t('modules.oracle.browse.importNoColumns'))
      return
    }

    saving.value = true
    let inserted = 0
    try {
      // Oracle 经典语法不支持多行 VALUES；逐条 INSERT（同会话串行）
      for (const row of parsed.rows) {
        const names = mapped.map((m) => quoteIdent(m.name)).join(', ')
        const values = mapped.map((m) => {
          const cell = row[m.index]
          if (cell === undefined || cell === '') return 'NULL'
          return toSqlLiteral(cell, columnDataType(m.name))
        }).join(', ')
        await oracleApi.queryExec({
          sessionId: props.sessionId,
          schema: schemaName.value,
          sql: `INSERT INTO ${qualifiedName(schemaName.value, props.table)} (${names}) VALUES (${values})`,
        })
        inserted += 1
      }
      toast.success(t('modules.oracle.browse.importDone', { count: inserted }))
      await loadData()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `${error.message} (${t('modules.oracle.browse.importPartial', { count: inserted })})`
          : t('modules.oracle.browse.importError'),
      )
      if (inserted > 0) await loadData()
    } finally {
      saving.value = false
    }
  }

  function onImportMenuSelect(key: string): void {
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
      label: t('modules.oracle.browse.copy'),
      icon: 'copy',
      disabled: !canCopy,
      children: [
        {
          key: 'copy:tsv',
          label: t('modules.oracle.browse.copyRows'),
          icon: 'copy',
          shortcut: 'Ctrl+C',
          disabled: !canCopy,
        },
        {
          key: 'copy:insert',
          label: t('modules.oracle.browse.copyAsInsert'),
          icon: 'square-plus',
          disabled: !canCopy || !schemaName.value || !props.table,
        },
        {
          key: 'copy:update',
          label: t('modules.oracle.browse.copyAsUpdate'),
          icon: 'pencil',
          disabled: !canCopy || !schemaName.value || !props.table,
        },
        {
          key: 'copy:delete',
          label: t('modules.oracle.browse.copyAsDelete'),
          icon: 'trash-2',
          disabled: !canCopy || !schemaName.value || !props.table,
        },
      ],
    })

    if (canInsert.value) {
      items.push({
        key: 'paste',
        label: t('modules.oracle.browse.pasteRows'),
        icon: 'clipboard-paste',
        shortcut: 'Ctrl+V',
      })
      items.push({ key: 'sep-io', label: '', separator: true })
      items.push({
        key: 'import',
        label: t('modules.oracle.browse.import'),
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
      label: t('modules.oracle.browse.export'),
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
          label: t('modules.oracle.browse.formatCsvFull'),
          icon: 'database',
          disabled: !props.profileId || !schemaName.value || !props.table || saving.value,
        },
      ],
    })

    const hasDraft = Boolean(row?.__isNew) || selected.some((item) => item.__isNew)
    // 写库删除仍需主键；草稿可直接丢弃
    const canCtxDelete =
      hasDraft || (canEdit.value && (selected.length > 0 || Boolean(row)))
    if (canCtxDelete) {
      items.push({ key: 'sep-delete', label: '', separator: true })
      items.push({
        key: 'delete',
        label: t('modules.oracle.browse.deleteRows'),
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

  async function loadBrowseDdl(): Promise<void> {
    if (!scopeOk.value) return
    ddlLoading.value = true
    try {
      const result = await oracleApi.metaDDL({
        sessionId: props.sessionId!,
        schema: schemaName.value,
        table: props.table!,
        objectType: isView.value ? 'view' : 'table',
      })
      ddlText.value = result.ddl; objectType.value = result.objectType ?? (isView.value ? 'view' : 'table')
    } catch (error) { toast.error(error instanceof Error ? error.message : t('modules.oracle.ddl.loadError')) }
    finally { ddlLoading.value = false }
  }
  async function copyBrowseDdl(): Promise<void> {
    if (!ddlText.value) return
    await writeClipboardRows(ddlText.value, 1)
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
    return { ...result.profile, kind: 'oracle' }
  }
  function openDesignTable(): void {
    const path = currentTablePath()
    if (!path || isView.value) return
    void resolveConnItem().then((item) => {
      if (!item) {
        toast.error(t('modules.oracle.browse.openDesignFailed'))
        return
      }
      nav.connect(item, { resourcePath: path, initialTab: 'design', designMode: 'alter' })
    })
  }
  async function openDdlTab(): Promise<void> {
    ddlMenuOpen.value = false
    const path = currentTablePath()
    if (!path) return
    try {
      const item = await resolveConnItem()
      if (!item) throw new Error(t('modules.oracle.browse.openDdlFailed'))
      nav.connect(item, { resourcePath: path, initialTab: 'ddl' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.oracle.browse.openDdlFailed'))
    }
  }
  const canOpenDesign = computed(() => !isView.value && Boolean(schemaName.value && props.table))
  const scopeKey = computed(() => [props.sessionId, schemaName.value, props.table, props.isView].join('\0'))
  watch(scopeKey, () => {
    page.value = 1; metaReady.value = false; rawRows.value = []; queryColumns.value = []; resultRows.value = []; tableColumns.value = []; pkColumns.value = []; lastResult.value = null; totalRows.value = 0
  })
  watch(ddlMenuOpen, (open) => { if (open) void loadBrowseDdl() })
  watch(() => [scopeKey.value, page.value, pageSize.value, props.active] as const, () => { if (props.active && scopeOk.value) void loadData() }, { immediate: true })
  watch(selectedRowKeys, async (keys, previous) => {
    if (flushingNewRow || saving.value) return
    const prior = previous?.find((key) => key.startsWith('new-'))
    if (prior && !keys.includes(prior)) { const row = resultRows.value.find((item) => item.__rowKey === prior); if (row) await flushNewRow(row) }
  })
  return {
    t, BROWSE_GUTTER_WIDTH, loading, saving, page, pageSize, pageSizeOptions: PAGE_SIZE_OPTIONS, totalRows, filterOpen, filterDraft, appliedWhereSql, importMenuOpen, exportMenuOpen, lastDataSql, lastResult, selectedRowKeys, resultRows, resultColumns, deleteConfirm, scopeOk, isView, scopeLabel, shellLabels, statusMeta, statusHint, filterSqlConfig, canInsert, canEdit, canDeleteSelection, tableEditable, loadData, applyFilters, onFilterKeydown, refresh, importMenuItems, exportMenuItems, onImportMenuSelect, onExportMenuSelect, openBrowseIo, openInsert, requestDelete, confirmDelete, onCellEditCommit, isBrowseRowPending, onBrowseRowEditCommit, onBrowseRowEditRollback, onBrowseKeydown, contextMenuItems, onContextMenuSelect, ddlMenuOpen, ddlLoading, ddlText, objectType, canOpenDesign, copyBrowseDdl, openDesignTable, openDdlTab, resolveFullCellValue,
  }
}
