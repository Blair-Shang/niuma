import {
  copyTextToClipboard,
  readClipboardText,
  useRsToast,
  type RsCodeEditorSqlConfig,
  type RsTableColumn,
} from '@niuma/ui'
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi, dialogApi, fsApi } from '@/api'
import { kingbaseApi } from '@/api/kingbase'
import type {
  KingbaseColumnInfo,
  KingbaseQueryExecResult,
} from '@/api/types/kingbase'
import {
  alignForValueType,
  formatBrowseCellValue,
  isBrowseFilterCompletionOpen,
  resolveSqlValueType,
  type BrowseDataRow,
  type BrowseDataShellLabels,
} from '@/modules/database'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { qualifiedName, quoteIdent } from '@/modules/kingbase/sql-seed'
import { parseEditValue, toSqlLiteral } from '@/modules/kingbase/utils/sql-literal'
import { parseBrowseImport, buildBrowseExportPayload, acceptExtensionsForFormat, type BrowseDataFormat } from '@/modules/kingbase/utils/browse-io'
import { formatRowsAsTsv, mapPasteToColumnRecords, parseClipboardMatrix } from '@/modules/kingbase/utils/browse-clipboard'
import { openKingbaseDataTask } from '@/modules/kingbase/data-tasks'

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 1000] as const
const BROWSE_GUTTER_WIDTH = 40

export interface KingbaseBrowsePaneProps {
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  table?: string
  isView?: boolean
  sessionLabel?: string
  active: boolean
}

function normalizeWhere(raw: string): string {
  return raw.trim().replace(/^where\s+/i, '').trim()
}

function parseCount(result: KingbaseQueryExecResult): number {
  const cell = result.rows?.[0]?.[0]
  const n = typeof cell === 'number' ? cell : Number(cell)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

export function useKingbaseBrowsePane(props: KingbaseBrowsePaneProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const nav = useConnectionNavigation()

  const loading = ref(false)
  const page = ref(1)
  const pageSize = ref(100)
  const totalRows = ref(0)
  const filterOpen = ref(false)
  const filterDraft = ref('')
  const appliedWhereSql = ref('')
  const lastDataSql = ref('')
  const selectedRowKeys = ref<string[]>([])
  const resultRows = ref<BrowseDataRow[]>([])
  const lastResult = shallowRef<KingbaseQueryExecResult | null>(null)
  const rawRows = shallowRef<unknown[][]>([])
  const queryColumns = shallowRef<{ name: string; dataType?: string }[]>([])
  const tableColumns = shallowRef<KingbaseColumnInfo[]>([])
  const pkColumns = ref<string[]>([])
  const metaReady = ref(false)
  const ddlMenuOpen = ref(false)
  const ddlLoading = ref(false)
  const ddlText = ref('')
  const objectType = ref('')
  const exportMenuOpen = ref(false)
  const importMenuOpen = ref(false)
  const saving = ref(false)
  const deleteConfirm = ref(false)
  let draftSeq = 0

  const isView = computed(() => props.isView === true)
  const databaseName = computed(() => props.database?.trim() ?? '')
  const schemaName = computed(() => props.schema?.trim() || 'public')
  const scopeOk = computed(() =>
    Boolean(props.sessionId && props.table && databaseName.value && schemaName.value),
  )
  const scopeLabel = computed(() =>
    props.table ? `${databaseName.value}.${schemaName.value}.${props.table}` : '',
  )
  const displayColumnNames = computed(() => queryColumns.value.map((c) => c.name))
  const canEdit = computed(() => !isView.value && pkColumns.value.length > 0)
  const canInsert = computed(() => !isView.value && tableColumns.value.length > 0)
  const canDelete = computed(() => canEdit.value && selectedRowKeys.value.length > 0)

  const shellLabels = computed(
    (): BrowseDataShellLabels => ({
      toolbarLabel: t('modules.kingbase.browse.toolbarLabel'),
      featureLabel: isView.value
        ? t('modules.kingbase.browse.featureView')
        : t('modules.kingbase.browse.featureTable'),
      insert: t('modules.kingbase.browse.insert'),
      insertTooltip: t('modules.kingbase.browse.insertTooltip'),
      delete: t('modules.kingbase.browse.delete'),
      deleteTooltip: t('modules.kingbase.browse.deleteTooltip'),
      import: t('modules.kingbase.browse.import'),
      importTooltip: t('modules.kingbase.browse.importTooltip'),
      export: t('modules.kingbase.browse.export'),
      exportTooltip: t('modules.kingbase.browse.exportTooltip'),
      filter: t('modules.kingbase.browse.filter'),
      filterToggle: t('modules.kingbase.browse.filterToggle'),
      refresh: t('modules.kingbase.browse.refresh'),
      needTable: t('modules.kingbase.browse.needTable'),
      empty: t('modules.kingbase.browse.empty'),
    }),
  )

  const statusMeta = computed(() => {
    if (!lastResult.value) return ''
    return t('modules.kingbase.browse.statusRowsTotal', {
      n: resultRows.value.length,
      page: page.value,
      total: totalRows.value,
    })
  })

  const statusHint = computed(() => {
    if (isView.value) return t('modules.kingbase.browse.viewReadonlyHint')
    if (!pkColumns.value.length) return t('modules.kingbase.browse.noPkHint')
    return t('modules.kingbase.browse.editHint')
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
      // 优先 catalog 元数据类型；查询结果多为驱动/format_type 裸名
      const typeLabel = (meta?.dataType || queryColumns.value.find((c) => c.name === name)?.dataType || '').trim()
      const dataType = typeLabel || undefined
      const valueType = resolveSqlValueType(dataType)
      const isPk = pkColumns.value.some((c) => c.toLowerCase() === name.toLowerCase())
      const nullable = typeof meta?.nullable === 'boolean' ? meta.nullable : undefined
      const tipLines = [t('modules.kingbase.browse.colTipField', { name })]
      if (typeLabel) tipLines.push(t('modules.kingbase.browse.colTipType', { type: typeLabel }))
      tipLines.push(
        t('modules.kingbase.browse.colTipPrimary', {
          value: isPk ? t('modules.kingbase.browse.colTipYes') : t('modules.kingbase.browse.colTipNo'),
        }),
      )
      if (typeof nullable === 'boolean') {
        tipLines.push(
          t('modules.kingbase.browse.colTipNullable', {
            value: nullable
              ? t('modules.kingbase.browse.colTipYes')
              : t('modules.kingbase.browse.colTipNo'),
          }),
        )
      }
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
        nullable: nullable !== false,
        emptyAsNull: true,
        headerTip: tipLines.join('\n'),
        editable: (row) => Boolean((row as BrowseDataRow & { __isNew?: boolean }).__isNew || canEdit.value),
        formatter: valueType === 'boolean' ? undefined : (value) => formatBrowseCellValue(value, valueType),
      }
    }),
  )

  function rebuildRows(): void {
    const draft = resultRows.value.find((row) => (row as BrowseDataRow & { __isNew?: boolean }).__isNew)
    const rows = rawRows.value.map((raw, index) => {
      const row: BrowseDataRow = { __rowKey: String(index), __rowIndex: index }
      queryColumns.value.forEach((column, columnIndex) => {
        row[column.name] = raw[columnIndex]
      })
      return row
    })
    resultRows.value = draft ? [draft, ...rows] : rows
  }

  function pkWhere(row: BrowseDataRow): string | null {
    if (!canEdit.value) return null
    const raw = rawRows.value[row.__rowIndex]
    if (!raw) return null
    const clauses = pkColumns.value.map((name) => {
      const index = queryColumns.value.findIndex((column) => column.name === name)
      return index < 0 ? '' : `${quoteIdent(name)} = ${toSqlLiteral(raw[index])}`
    }).filter(Boolean)
    return clauses.length === pkColumns.value.length ? clauses.join(' AND ') : null
  }

  async function onCellEditCommit(row: BrowseDataRow & { __isNew?: boolean }, column: RsTableColumn<BrowseDataRow>, _index: number, value: unknown): Promise<void> {
    const name = String(column.key)
    if (row.__isNew) { row[name] = parseEditValue(value, row[name]); return }
    if (!props.sessionId || !props.table || !canEdit.value) return
    const rowIndex = row.__rowIndex
    const colIndex = queryColumns.value.findIndex((item) => item.name === name)
    const previous = rawRows.value[rowIndex]?.[colIndex]
    const next = parseEditValue(value, previous)
    if (toSqlLiteral(previous) === toSqlLiteral(next)) return
    const where = pkWhere(row)
    if (!where) return
    const rows = rawRows.value.map((item) => [...item])
    rows[rowIndex]![colIndex] = next
    rawRows.value = rows
    rebuildRows()
    saving.value = true
    try {
      await kingbaseApi.queryExec({ sessionId: props.sessionId, database: databaseName.value, sql: `UPDATE ${qualifiedName(schemaName.value, props.table)} SET ${quoteIdent(name)} = ${toSqlLiteral(next)} WHERE ${where}` })
      toast.success(t('modules.kingbase.browse.cellSaved'))
    } catch (error) {
      const reverted = rawRows.value.map((item) => [...item])
      reverted[rowIndex]![colIndex] = previous
      rawRows.value = reverted
      rebuildRows()
      toast.error(error instanceof Error ? error.message : t('modules.kingbase.browse.cellSaveError'))
    }
    finally { saving.value = false }
  }

  function openInsert(): void {
    if (!canInsert.value || resultRows.value.some((row) => (row as BrowseDataRow & { __isNew?: boolean }).__isNew)) return
    draftSeq += 1
    const draft = Object.fromEntries(displayColumnNames.value.map((name) => [name, null])) as BrowseDataRow & { __isNew: boolean }
    draft.__rowKey = `new-${draftSeq}`; draft.__rowIndex = -1; draft.__isNew = true
    resultRows.value = [draft, ...resultRows.value]; selectedRowKeys.value = [draft.__rowKey]
  }

  async function flushNewRow(row: BrowseDataRow & { __isNew?: boolean }): Promise<void> {
    if (!row.__isNew || !props.sessionId || !props.table) return
    const filled = tableColumns.value.filter((column) => row[column.name] !== null && row[column.name] !== undefined && row[column.name] !== '')
    if (!filled.length) { resultRows.value = resultRows.value.filter((item) => item.__rowKey !== row.__rowKey); return }
    const missing = tableColumns.value.find((column) => !column.nullable && !column.default && (row[column.name] === null || row[column.name] === undefined || row[column.name] === ''))
    if (missing) { toast.error(t('modules.kingbase.browse.insertRequired', { name: missing.name })); return }
    saving.value = true
    try {
      const sql = `INSERT INTO ${qualifiedName(schemaName.value, props.table)} (${filled.map((c) => quoteIdent(c.name)).join(', ')}) VALUES (${filled.map((c) => toSqlLiteral(parseEditValue(row[c.name]))).join(', ')}) RETURNING *`
      await kingbaseApi.queryExec({ sessionId: props.sessionId, database: databaseName.value, sql })
      toast.success(t('modules.kingbase.browse.insertDone')); await loadData()
    } catch (error) { toast.error(error instanceof Error ? error.message : t('modules.kingbase.browse.insertError')) }
    finally { saving.value = false }
  }

  async function deleteSelected(): Promise<void> {
    if (!props.sessionId || !props.table || !canDelete.value) return
    const selectedCount = selectedRowKeys.value.length
    saving.value = true
    try {
      for (const row of resultRows.value.filter((item) => selectedRowKeys.value.includes(item.__rowKey))) {
        const where = pkWhere(row); if (where) await kingbaseApi.queryExec({ sessionId: props.sessionId, database: databaseName.value, sql: `DELETE FROM ${qualifiedName(schemaName.value, props.table)} WHERE ${where}` })
      }
      selectedRowKeys.value = []; toast.success(t('modules.kingbase.browse.deleteDone', { count: selectedCount })); await loadData()
    } catch (error) { toast.error(error instanceof Error ? error.message : t('modules.kingbase.browse.deleteError')) }
    finally { saving.value = false; deleteConfirm.value = false }
  }

  async function pasteTsv(): Promise<void> {
    if (!canInsert.value) return
    const matrix = parseClipboardMatrix((await readClipboardText()) ?? '')
    const records = mapPasteToColumnRecords(displayColumnNames.value, matrix)
    for (const record of records.reverse()) { openInsert(); const draft = resultRows.value[0]; if (draft) Object.assign(draft, record) }
  }

  async function localExport(format: BrowseDataFormat): Promise<void> {
    if (!props.table || !lastResult.value) return
    const payload = buildBrowseExportPayload(format, { schema: schemaName.value, table: props.table, columns: lastResult.value.columns ?? [], rows: rawRows.value, baseName: `${schemaName.value}_${props.table}` })
    const picked = await dialogApi.saveFile({ title: t('modules.kingbase.browse.export'), defaultPath: payload.filename, accept: payload.accept })
    if (!picked.canceled && picked.filePaths[0]) await fsApi.writeText({ path: picked.filePaths[0], content: payload.content })
  }

  async function localImport(format: BrowseDataFormat): Promise<void> {
    if (!canInsert.value) return
    const picked = await dialogApi.openFile({ title: t('modules.kingbase.browse.import'), accept: acceptExtensionsForFormat(format) })
    if (picked.canceled || !picked.filePaths[0]) return
    const text = await fsApi.readText({ path: picked.filePaths[0] }); const parsed = parseBrowseImport(format, text.content ?? '')
    for (const record of parsed.rows.map((cells) => Object.fromEntries(parsed.headers.map((header, index) => [header, cells[index] ?? null]))).reverse()) { openInsert(); const draft = resultRows.value[0]; if (draft) Object.assign(draft, record) }
  }

  function openFullCsv(kind: 'import_csv' | 'export_csv'): void {
    if (!props.profileId || !props.table) return
    openKingbaseDataTask({ kind, title: `${schemaName.value}.${props.table}`, context: { conn: { profileId: props.profileId, kind: 'kingbase' } as ConnItem, profileId: props.profileId, sessionId: props.sessionId, database: databaseName.value, schema: schemaName.value, table: props.table } })
  }

  function orderByClause(): string {
    if (pkColumns.value.length) {
      return ` ORDER BY ${pkColumns.value.map((c) => quoteIdent(c)).join(', ')}`
    }
    if (tableColumns.value[0]) {
      return ` ORDER BY ${quoteIdent(tableColumns.value[0].name)}`
    }
    return ''
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
        kingbaseApi.metaColumns(base),
        kingbaseApi.metaPrimaryKey(base).catch(() => ({ columns: [] as string[] })),
      ])
      tableColumns.value = cols.columns ?? []
      pkColumns.value = pk.columns ?? []
      metaReady.value = true
    } catch (e) {
      metaReady.value = false
      toast.error(e instanceof Error ? e.message : t('modules.kingbase.browse.metaError'))
    }
  }

  async function loadData(resetPage = false): Promise<void> {
    if (!props.sessionId || !databaseName.value || !props.table) return
    if (resetPage) page.value = 1
    loading.value = true
    try {
      const where = appliedWhereSql.value
      const from = qualifiedName(schemaName.value, props.table)
      const whereSql = where ? ` WHERE ${where}` : ''
      const offset = (page.value - 1) * pageSize.value

      const countSql = `SELECT COUNT(*)::bigint FROM ${from}${whereSql}`
      const countResult = await kingbaseApi.queryExec({
        sessionId: props.sessionId,
        database: databaseName.value,
        sql: countSql,
        limit: 1,
      })
      totalRows.value = parseCount(countResult)

      const dataSql = `SELECT * FROM ${from}${whereSql}${orderByClause()} LIMIT ${pageSize.value} OFFSET ${offset}`
      lastDataSql.value = dataSql
      const result = await kingbaseApi.queryExec({
        sessionId: props.sessionId,
        database: databaseName.value,
        sql: dataSql,
        limit: pageSize.value,
      })
      lastResult.value = result
      queryColumns.value = (result.columns ?? []).map((c) => ({ name: c.name, dataType: c.dataType }))
      rawRows.value = result.rows ?? []
      rebuildRows()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.kingbase.browse.loadError'))
    } finally {
      loading.value = false
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
      const result = await kingbaseApi.metaDDL({
        sessionId: props.sessionId,
        database: databaseName.value,
        schema: schemaName.value,
        table: props.table,
      })
      try {
        const { formatSql } = await import('@/modules/sql-editor/format')
        ddlText.value = formatSql(result.ddl, { dialect: 'kingbase' })
      } catch {
        ddlText.value = result.ddl
      }
      objectType.value = result.objectType || objectType.value
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.kingbase.ddl.loadError'))
    } finally {
      ddlLoading.value = false
    }
  }

  async function copyBrowseDdl(): Promise<void> {
    if (!ddlText.value) return
    try {
      await copyTextToClipboard(ddlText.value)
      toast.success(t('modules.kingbase.ddl.copied'))
    } catch {
      toast.error(t('modules.kingbase.ddl.copyFailed'))
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
    return { ...result.profile, kind: 'kingbase' }
  }

  const canOpenDesign = computed(() => !isView.value && Boolean(schemaName.value && props.table))

  async function openDesignTable(): Promise<void> {
    ddlMenuOpen.value = false
    if (!canOpenDesign.value) return
    const path = currentTablePath()
    if (!path) return
    try {
      const item = await resolveConnItem()
      if (!item) throw new Error(t('modules.kingbase.browse.openDesignFailed'))
      nav.connect(item, { resourcePath: path, initialTab: 'design', designMode: 'alter' })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('modules.kingbase.browse.openDesignFailed'),
      )
    }
  }

  async function openDdlTab(): Promise<void> {
    ddlMenuOpen.value = false
    const path = currentTablePath()
    if (!path) return
    try {
      const item = await resolveConnItem()
      if (!item) throw new Error(t('modules.kingbase.browse.openDdlFailed'))
      nav.connect(item, { resourcePath: path, initialTab: 'ddl' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modules.kingbase.browse.openDdlFailed'))
    }
  }

  async function copyTsv(): Promise<void> {
    if (!resultRows.value.length || !displayColumnNames.value.length) return
    const text = formatRowsAsTsv(
      displayColumnNames.value,
      resultRows.value.map((row) => displayColumnNames.value.map((name) => row[name])),
    )
    try {
      await copyTextToClipboard(text)
      toast.success(t('modules.kingbase.browse.copied'))
    } catch {
      toast.error(t('modules.kingbase.browse.copyFailed'))
    }
  }

  /** 仅作用域变化时重拉；keep-alive 切回 Shell Tab 不重复请求。 */
  watch(
    () => [props.sessionId, props.database, props.schema, props.table] as const,
    async () => {
      selectedRowKeys.value = []
      lastResult.value = null
      metaReady.value = false
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
    if (props.active && scopeOk.value) void loadData(false)
  })

  watch(ddlMenuOpen, (open) => {
    if (open && !ddlText.value) void loadBrowseDdl()
  })

  return {
    t,
    loading,
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
    filterSqlConfig,
    browseGutterWidth: BROWSE_GUTTER_WIDTH,
    ddlMenuOpen,
    ddlLoading,
    ddlText,
    objectType,
    exportMenuOpen,
    importMenuOpen,
    metaReady,
    saving,
    canEdit,
    canInsert,
    canDelete,
    deleteConfirm,
    loadData,
    refresh,
    applyFilters,
    onFilterKeydown,
    copyBrowseDdl,
    canOpenDesign,
    openDesignTable,
    openDdlTab,
    copyTsv,
    onCellEditCommit,
    openInsert,
    flushNewRow,
    deleteSelected,
    pasteTsv,
    localExport,
    localImport,
    openFullCsv,
  }
}
