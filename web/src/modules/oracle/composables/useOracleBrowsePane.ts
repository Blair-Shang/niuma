/**
 * Oracle表/视图数据浏览：Oracle OFFSET/FETCH 分页，突变严格以主键定位。
 */
import {
  copyTextToClipboard, readClipboardText, useRsToast,
  type RsCodeEditorSqlConfig, type RsContextMenuItem, type RsTableColumn,
} from '@niuma/ui'
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi } from '@/api'
import { oracleApi } from '@/api/oracle'
import type { OracleColumnInfo, OracleQueryExecResult } from '@/api/types/oracle'
import {
  buildBrowseResultColumn, formatRowsAsTsv, mapPasteToColumnRecords,
  parseClipboardMatrix, parseEditValue,
  type BrowseDataRow, type BrowseDataShellLabels,
} from '@/modules/database'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { qualifiedName, quoteIdent } from '@/modules/oracle/sql-seed'
import {
  acceptExtensionsForFormat, buildBrowseExportPayload, buildDeleteSqlText, buildInsertSqlText,
  buildUpdateSqlText, parseBrowseImport,
  type BrowseDataFormat,
} from '@/modules/oracle/utils/browse-io'
import { isBinCell, sqlWhereEquals, toSqlLiteral } from '@/modules/oracle/utils/sql-literal'

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
  const resultColumns = computed((): RsTableColumn<BrowseDataRow>[] => displayColumnNames.value.map((name) => {
    const meta = columnMeta.value.get(name.toLowerCase())
    const dataType = queryColumns.value.find((column) => column.name === name)?.dataType ?? meta?.dataType
    return buildBrowseResultColumn({
      name,
      dataType,
      headerTip: `${t('modules.oracle.browse.colTipField', { name })}${dataType ? `\n${t('modules.oracle.browse.colTipType', { type: dataType })}` : ''}`,
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
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); applyFilters() }
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
      for (const ch of changes) row[ch.colKey] = parseEditValue(ch.value, ch.previous)
      void flushNewRow(row)
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
      if (toSqlLiteral(before) === toSqlLiteral(after)) continue
      setParts.push(`${quoteIdent(ch.colKey)} = ${toSqlLiteral(after)}`)
      applied.push({ columnIndex, after, before })
    }
    if (!setParts.length) return
    saving.value = true
    try {
      await oracleApi.queryExec({
        sessionId: props.sessionId,
        schema: schemaName.value,
        sql: `UPDATE ${qualifiedName(schemaName.value, props.table)}\nSET ${setParts.join(', ')}\nWHERE ${where}`,
      })
      for (const item of applied) rawRows.value[index]![item.columnIndex] = item.after
      rebuildRows()
      toast.success(t('modules.oracle.browse.cellSaved'))
    } catch (error) {
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
      await oracleApi.queryExec({ sessionId: props.sessionId, schema: schemaName.value, sql: `INSERT INTO ${qualifiedName(schemaName.value, props.table)} (${filled.map((column) => quoteIdent(column.name)).join(', ')}) VALUES (${filled.map((column) => toSqlLiteral(parseEditValue(row[column.name]))).join(', ')})` })
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
      deleteConfirm.value = false; selectedRowKeys.value = []; await loadData()
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
  function rowsForCopy(row: BrowseDataRow | null, selected: BrowseDataRow[]): BrowseDataRow[] {
    return (selected.length ? selected : row ? [row] : resultRows.value.filter((item) => selectedRowKeys.value.includes(item.__rowKey))).filter((item) => !item.__isNew)
  }
  async function copyText(text: string, count: number): Promise<void> {
    if (await copyTextToClipboard(text)) toast.success(t('modules.oracle.browse.copyDone', { count }))
    else toast.error(t('modules.oracle.browse.copyError'))
  }
  function contextMenuItems(row: BrowseDataRow | null, selected: BrowseDataRow[]): RsContextMenuItem[] {
    const rows = rowsForCopy(row, selected)
    const columns = displayColumnNames.value
    return [{ key: 'copy', label: t('modules.oracle.browse.copy'), icon: 'copy', disabled: !rows.length, children: [
      { key: 'copy:tsv', label: t('modules.oracle.browse.copyRows'), icon: 'copy' },
      { key: 'copy:insert', label: t('modules.oracle.browse.copyAsInsert'), icon: 'square-plus', disabled: isView.value },
      { key: 'copy:update', label: t('modules.oracle.browse.copyAsUpdate'), icon: 'pencil', disabled: isView.value || !pkColumns.value.length },
      { key: 'copy:delete', label: t('modules.oracle.browse.copyAsDelete'), icon: 'trash-2', disabled: isView.value || !pkColumns.value.length },
    ] }, { key: 'paste', label: t('modules.oracle.browse.pasteRows'), icon: 'clipboard-paste', disabled: !canInsert.value }]
  }
  function onContextMenuSelect(key: string, row: BrowseDataRow | null, selected: BrowseDataRow[]): void {
    if (key === 'paste') {
      void pasteIntoInsertRows()
      return
    }
    const rows = rowsForCopy(row, selected); const columns = displayColumnNames.value
    if (key === 'copy:tsv') void copyText(formatRowsAsTsv(columns, rows.map((item) => columns.map((name) => item[name]))), rows.length)
    if (key === 'copy:insert' && props.table) void copyText(buildInsertSqlText(schemaName.value, props.table, columns.map((name) => ({ name })), rows.map((item) => columns.map((name) => item[name]))), rows.length)
    if (key === 'copy:update' && props.table) void copyText(buildUpdateSqlText(schemaName.value, props.table, columns, pkColumns.value, rows, columns), rows.length)
    if (key === 'copy:delete' && props.table) void copyText(buildDeleteSqlText(schemaName.value, props.table, pkColumns.value, rows, columns), rows.length)
  }
  async function pasteIntoInsertRows(): Promise<void> {
    const text = await readClipboardText()
    if (!text?.trim()) return
    const records = mapPasteToColumnRecords(displayColumnNames.value, parseClipboardMatrix(text))
    resultRows.value = [...records.map((record) => ({ ...createDraft(), ...record })), ...resultRows.value.filter((row) => !row.__isNew)]
  }
  function onBrowseKeydown(event: KeyboardEvent): void {
    if (!props.active || !(event.ctrlKey || event.metaKey)) return
    if (event.key.toLowerCase() === 'v') { event.preventDefault(); void pasteIntoInsertRows() }
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
  const importMenuItems = computed(() => [
    { key: 'fullCsv', label: t('modules.oracle.browse.importFullCsv'), icon: 'upload', disabled: isView.value || saving.value },
    ...IO_FORMATS.map((format) => ({
      key: format, label: format.toUpperCase(), icon: 'upload', disabled: !canInsert.value || saving.value,
    })),
  ])
  const exportMenuItems = computed(() => [
    { key: 'fullCsv', label: t('modules.oracle.browse.exportFullCsv'), icon: 'download', disabled: !schemaName.value || !props.table },
    ...IO_FORMATS.map((format) => ({ key: format, label: format.toUpperCase(), icon: 'download', disabled: !rawRows.value.length })),
  ])
  function downloadPage(format: BrowseDataFormat): void {
    if (!props.table) return
    const payload = buildBrowseExportPayload(format, { schema: schemaName.value, table: props.table, columns: queryColumns.value, rows: rawRows.value, baseName: `${schemaName.value}_${props.table}` })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([payload.content], { type: 'text/plain;charset=utf-8' }))
    link.download = payload.filename; link.click(); URL.revokeObjectURL(link.href)
  }
  function onExportMenuSelect(key: string): void {
    if (key === 'fullCsv') {
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
      toast.error(t('modules.oracle.browse.importParseError', { format: format.toUpperCase() }))
      return
    }
    saving.value = true
    try {
      for (const row of parsed.rows) {
        const names = columns.map((column) => quoteIdent(column.name)).join(', ')
        const values = columns.map((column) => toSqlLiteral(row[column.index] || null)).join(', ')
        await oracleApi.queryExec({
          sessionId: props.sessionId, schema: schemaName.value,
          sql: `INSERT INTO ${qualifiedName(schemaName.value, props.table)} (${names}) VALUES (${values})`,
        })
      }
      toast.success(t('modules.oracle.browse.importDone', { count: parsed.rows.length }))
      await loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.oracle.browse.importError'))
    } finally { saving.value = false }
  }
  function onImportMenuSelect(key: string): void {
    if (key === 'fullCsv') {
      openBrowseIo('import_csv')
      return
    }
    if (!IO_FORMATS.includes(key as BrowseDataFormat) || !canInsert.value) return
    const format = key as BrowseDataFormat
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
  async function loadBrowseDdl(): Promise<void> {
    if (!scopeOk.value) return
    ddlLoading.value = true
    try {
      const result = await oracleApi.metaDDL({ sessionId: props.sessionId!, schema: schemaName.value, table: props.table! })
      ddlText.value = result.ddl; objectType.value = result.objectType ?? (isView.value ? 'view' : 'table')
    } catch (error) { toast.error(error instanceof Error ? error.message : t('modules.oracle.ddl.loadError')) }
    finally { ddlLoading.value = false }
  }
  async function copyBrowseDdl(): Promise<void> { if (ddlText.value) await copyText(ddlText.value, 1) }
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
    t, BROWSE_GUTTER_WIDTH, loading, saving, page, pageSize, pageSizeOptions: PAGE_SIZE_OPTIONS, totalRows, filterOpen, filterDraft, appliedWhereSql, importMenuOpen, exportMenuOpen, lastDataSql, lastResult, selectedRowKeys, resultRows, resultColumns, deleteConfirm, scopeOk, isView, scopeLabel, shellLabels, statusMeta, statusHint, filterSqlConfig, canInsert, canEdit, canDeleteSelection, tableEditable, loadData, applyFilters, onFilterKeydown, refresh, importMenuItems, exportMenuItems, onImportMenuSelect, onExportMenuSelect, openBrowseIo, openInsert, requestDelete, confirmDelete, onCellEditCommit, isBrowseRowPending, onBrowseRowEditCommit, onBrowseRowEditRollback, onBrowseKeydown, contextMenuItems, onContextMenuSelect, ddlMenuOpen, ddlLoading, ddlText, objectType, canOpenDesign, copyBrowseDdl, openDesignTable, openDdlTab,
  }
}
