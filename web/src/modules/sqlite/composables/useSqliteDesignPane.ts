/**
 * SQLite 表设计器状态与 RPC（供 SqliteDesignPane 挂载）。
 */
import { useRsToast, type RsSelectOptions, type RsTableColumn } from '@niuma/ui'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { sqliteApi } from '@/api'
import type {
  TableDesignSection,
  TableDesignSectionItem,
  TableDesignShellLabels,
} from '@/modules/database'
import { refreshResourceIfLoaded } from '@/modules/ops/composables/useConnTreeChildren'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { formatSql } from '@/modules/sql-editor/format'
import { useTabStore } from '@/stores/tab'
import {
  SQLITE_BASE_TYPE_OPTIONS,
  SQLITE_FK_ACTIONS,
  dataTypeParamKind,
  defaultCreateTableColumns,
  isDefaultIndexName,
  joinColumnList,
  newEmptyColumn,
  newEmptyForeignKey,
  newEmptyIndex,
  suggestIndexName,
  syncColumnDataType,
  type DesignColumnDraft,
  type DesignForeignKeyDraft,
  type DesignIndexDraft,
} from '@/modules/sqlite/utils/table-design'
import {
  applyPrimaryIndexToColumns,
  buildAlterDesignOps,
  buildCreateColumns,
  buildCreateForeignKeys,
  buildCreateIndexes,
  syncPrimaryIndexFromColumns,
  toDesignRows,
  toForeignKeyDrafts,
  toIndexDrafts,
} from '@/modules/sqlite/utils/table-design-ops'

export type ColRow = DesignColumnDraft & Record<string, unknown>
export type IdxRow = DesignIndexDraft & Record<string, unknown>
export type FkRow = DesignForeignKeyDraft & Record<string, unknown>

export interface SqliteDesignPaneProps {
  sessionId: string | null
  profileId?: string
  schema: string
  table?: string
  designMode: 'create' | 'alter'
  active: boolean
  sessionLabel?: string
}

export function useSqliteDesignPane(props: SqliteDesignPaneProps) {
  const { t } = useI18n()
  const toast = useRsToast()

  const activeSection = ref<TableDesignSection>('columns')
  const loading = ref(false)
  const saving = ref(false)
  const previewSqls = ref<string[]>([])
  const showPreview = ref(false)
  const previewLoading = ref(false)
  const designStrategy = ref('')
  const designWarning = ref('')
  const localDesignMode = ref<'create' | 'alter' | null>(null)
  const localTable = ref<string | null>(null)
  const tableName = ref(props.table ?? '')

  const columns = ref<DesignColumnDraft[]>([])
  const indexes = ref<DesignIndexDraft[]>([])
  const foreignKeys = ref<DesignForeignKeyDraft[]>([])
  const origColumns = ref<DesignColumnDraft[]>([])
  const origIndexes = ref<DesignIndexDraft[]>([])
  const origForeignKeys = ref<DesignForeignKeyDraft[]>([])

  const refTableOptions = ref<RsSelectOptions>([])
  const refColumnOptions = ref<RsSelectOptions>([])
  const editingColKey = ref<string | null>(null)
  const editingIdxKey = ref<string | null>(null)
  const editingFkKey = ref<string | null>(null)

  const modeCreate = computed(() => (localDesignMode.value ?? props.designMode) === 'create')
  const effectiveTable = computed(() => localTable.value ?? props.table)
  const designMode = computed<'create' | 'alter'>(() => (modeCreate.value ? 'create' : 'alter'))
  const schemaName = computed(() => props.schema?.trim() || 'main')

  const shellLabels = computed<TableDesignShellLabels>(() => ({
    reload: t('modules.sqlite.design.reload'),
    preview: t('modules.sqlite.design.preview'),
    create: t('modules.sqlite.design.create'),
    apply: t('modules.sqlite.design.apply'),
    previewTitle: t('modules.sqlite.design.previewTitle'),
    selectRow: t('modules.sqlite.design.selectRow'),
    copyPreview: t('modules.sqlite.design.copyPreview'),
    moveUp: t('modules.sqlite.design.moveUp'),
    moveDown: t('modules.sqlite.design.moveDown'),
    add: t('modules.sqlite.design.addColumn'),
  }))

  const addButtonLabel = computed(() => {
    if (activeSection.value === 'indexes') return t('modules.sqlite.design.addIndex')
    if (activeSection.value === 'foreignKeys') return t('modules.sqlite.design.addForeignKey')
    return t('modules.sqlite.design.addColumn')
  })

  const title = computed(() =>
    modeCreate.value
      ? t('modules.sqlite.design.createTitle')
      : t('modules.sqlite.design.alterTitle', { name: effectiveTable.value ?? '' }),
  )

  const sections = computed<TableDesignSectionItem[]>(() => [
    {
      id: 'columns',
      label: t('modules.sqlite.design.tabColumns'),
      count: columns.value.filter((c) => !c.removed).length,
    },
    {
      id: 'indexes',
      label: t('modules.sqlite.design.tabIndexes'),
      count: indexes.value.filter((i) => !i.removed).length,
    },
    {
      id: 'foreignKeys',
      label: t('modules.sqlite.design.tabForeignKeys'),
      count: foreignKeys.value.filter((f) => !f.removed).length,
    },
  ])

  const typeBaseSelectOptions = SQLITE_BASE_TYPE_OPTIONS.map((o) => ({
    value: o.base,
    label: o.base,
  }))
  const fkActionOptions = SQLITE_FK_ACTIONS.map((v) => ({ value: v, label: v }))

  const draftColumnSelectOptions = computed(() =>
    columns.value
      .filter((c) => !c.removed && c.name.trim())
      .map((c) => ({ value: c.name, label: c.name })),
  )

  const displayColumns = computed((): ColRow[] =>
    columns.value
      .filter((c) => !c.removed)
      .map((c) => {
        let status = t('modules.sqlite.design.statusOk')
        if (!c.originalName) status = t('modules.sqlite.design.statusNew')
        else {
          const orig = origColumns.value.find((o) => o.originalName === c.originalName)
          if (
            orig &&
            (c.name !== orig.name ||
              c.dataType !== orig.dataType ||
              c.nullable !== orig.nullable ||
              c.defaultExpr !== orig.defaultExpr ||
              c.primaryKey !== orig.primaryKey ||
              c.autoIncrement !== orig.autoIncrement ||
              c.checkExpr !== orig.checkExpr ||
              c.generatedExpr !== orig.generatedExpr ||
              c.generatedType !== orig.generatedType)
          ) {
            status = t('modules.sqlite.design.statusEdit')
          }
        }
        return { ...c, status }
      }) as ColRow[],
  )

  const displayIndexes = computed(
    (): IdxRow[] =>
      indexes.value
        .filter((i) => !i.removed)
        .map((i) => ({
          ...i,
          kindLabel: i.primary
            ? t('modules.sqlite.design.idxKindPrimary')
            : i.unique
              ? t('modules.sqlite.design.idxKindUnique')
              : t('modules.sqlite.design.idxKindNormal'),
        })) as IdxRow[],
  )

  const displayForeignKeys = computed(
    (): FkRow[] => foreignKeys.value.filter((f) => !f.removed) as FkRow[],
  )

  const columnColumns = computed((): RsTableColumn<ColRow>[] => {
    const cols: RsTableColumn<ColRow>[] = [
      { key: 'name', title: t('modules.sqlite.design.colName'), minWidth: 110, editable: true },
      {
        key: 'typeBase',
        title: t('modules.sqlite.design.colType'),
        minWidth: 110,
        editable: true,
        valueType: 'select',
        editorOptions: { options: typeBaseSelectOptions, searchable: true, creatable: true },
      },
      {
        key: 'typeLength',
        title: t('modules.sqlite.design.colLength'),
        width: 72,
        align: 'center',
        valueType: 'number',
        editable: (row) => dataTypeParamKind(row.typeBase) === 'length',
      },
      {
        key: 'primaryKey',
        title: t('modules.sqlite.design.colPk'),
        width: 52,
        align: 'center',
        editable: true,
        valueType: 'boolean',
      },
      {
        key: 'nullable',
        title: t('modules.sqlite.design.colNullable'),
        width: 52,
        align: 'center',
        editable: true,
        valueType: 'boolean',
      },
      {
        key: 'autoIncrement',
        title: t('modules.sqlite.design.colAi'),
        width: 52,
        align: 'center',
        editable: true,
        valueType: 'boolean',
      },
      {
        key: 'defaultExpr',
        title: t('modules.sqlite.design.colDefault'),
        minWidth: 100,
        editable: true,
        ellipsis: true,
      },
    ]
    if (!modeCreate.value) {
      cols.push({
        key: 'status',
        title: t('modules.sqlite.design.colStatus'),
        width: 72,
        align: 'center',
      })
    }
    return cols
  })

  const indexColumns = computed((): RsTableColumn<IdxRow>[] => [
    { key: 'name', title: t('modules.sqlite.design.idxName'), minWidth: 110, editable: true },
    { key: 'kindLabel', title: t('modules.sqlite.design.idxKind'), width: 88, editable: false },
    {
      key: 'columnsText',
      title: t('modules.sqlite.design.idxColumns'),
      minWidth: 160,
      editable: true,
      valueType: 'select',
      headerTip: t('modules.sqlite.design.idxColumnsTip'),
      editorOptions: {
        options: draftColumnSelectOptions.value,
        multiple: true,
        searchable: true,
        clearable: true,
      },
    },
    {
      key: 'unique',
      title: t('modules.sqlite.design.idxUnique'),
      width: 64,
      align: 'center',
      editable: true,
      valueType: 'boolean',
    },
  ])

  const fkColumns = computed((): RsTableColumn<FkRow>[] => [
    { key: 'name', title: t('modules.sqlite.design.fkName'), minWidth: 100, editable: true },
    {
      key: 'columnsText',
      title: t('modules.sqlite.design.fkColumns'),
      minWidth: 140,
      editable: true,
      valueType: 'select',
      editorOptions: {
        options: draftColumnSelectOptions.value,
        multiple: true,
        searchable: true,
        clearable: true,
      },
    },
    {
      key: 'refTable',
      title: t('modules.sqlite.design.fkRefTable'),
      minWidth: 120,
      editable: true,
      valueType: 'select',
      editorOptions: { options: refTableOptions.value, searchable: true, clearable: true },
    },
    {
      key: 'refColumnsText',
      title: t('modules.sqlite.design.fkRefColumns'),
      minWidth: 140,
      editable: true,
      valueType: 'select',
      editorOptions: {
        options: refColumnOptions.value,
        multiple: true,
        searchable: true,
        clearable: true,
      },
    },
    {
      key: 'onDelete',
      title: t('modules.sqlite.design.fkOnDelete'),
      width: 110,
      editable: true,
      valueType: 'select',
      editorOptions: { options: fkActionOptions },
    },
    {
      key: 'onUpdate',
      title: t('modules.sqlite.design.fkOnUpdate'),
      width: 110,
      editable: true,
      valueType: 'select',
      editorOptions: { options: fkActionOptions },
    },
  ])

  function asBool(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value
    if (value === 'true' || value === 1 || value === '1') return true
    if (value === 'false' || value === 0 || value === '0') return false
    return fallback
  }

  function multiSelectText(value: unknown): string {
    if (Array.isArray(value)) return joinColumnList(value.map(String))
    return String(value ?? '').trim()
  }

  function patchColumn(key: string, patch: (col: DesignColumnDraft) => DesignColumnDraft): void {
    columns.value = columns.value.map((c) => (c.__rowKey === key ? patch(c) : c))
  }

  function onColCommit(
    row: ColRow,
    column: RsTableColumn<ColRow>,
    _i: number,
    value: unknown,
  ): void {
    const key = String(column.key)
    const draft = String(value ?? '').trim()
    patchColumn(row.__rowKey, (r) => {
      if (key === 'name') return { ...r, name: draft || r.name }
      if (key === 'typeBase') {
        const nextBase = (draft || r.typeBase).toUpperCase()
        const kind = dataTypeParamKind(nextBase)
        const opt = SQLITE_BASE_TYPE_OPTIONS.find((o) => o.base === nextBase)
        let typeLength = r.typeLength
        if (kind === 'none') typeLength = undefined
        else if (kind === 'length' && typeLength == null) typeLength = opt?.defaultLength ?? 255
        const next = { ...r, typeBase: nextBase, typeLength }
        return { ...next, dataType: syncColumnDataType(next) }
      }
      if (key === 'typeLength') {
        const n = draft === '' ? undefined : Number(draft)
        const next = { ...r, typeLength: Number.isFinite(n) ? n : undefined }
        return { ...next, dataType: syncColumnDataType(next) }
      }
      if (key === 'defaultExpr') return { ...r, defaultExpr: draft }
      if (key === 'nullable') return { ...r, nullable: asBool(value, r.nullable) }
      if (key === 'autoIncrement') return { ...r, autoIncrement: asBool(value, r.autoIncrement) }
      if (key === 'primaryKey') {
        const pk = asBool(value, r.primaryKey)
        return { ...r, primaryKey: pk, nullable: pk ? false : r.nullable }
      }
      return r
    })
    if (key === 'primaryKey' || key === 'name') {
      indexes.value = syncPrimaryIndexFromColumns(indexes.value, columns.value)
    }
  }

  function onIdxCommit(
    row: IdxRow,
    column: RsTableColumn<IdxRow>,
    _i: number,
    value: unknown,
  ): void {
    const key = String(column.key)
    const current = indexes.value.find((r) => r.__rowKey === row.__rowKey)
    if (!current) return
    if (current.primary) {
      if (key === 'name' || key === 'unique') return
      if (key === 'columnsText') {
        const columnsText = multiSelectText(value)
        indexes.value = indexes.value.map((r) =>
          r.__rowKey === row.__rowKey
            ? { ...r, name: 'PRIMARY', columnsText, unique: true, primary: true }
            : r,
        )
        columns.value = applyPrimaryIndexToColumns(columns.value, columnsText)
      }
      return
    }
    indexes.value = indexes.value.map((r) => {
      if (r.__rowKey !== row.__rowKey) return r
      if (key === 'name') return { ...r, name: String(value ?? '').trim() }
      if (key === 'columnsText') {
        const columnsText = multiSelectText(value)
        const name = isDefaultIndexName(r.name)
          ? suggestIndexName(columnsText, r.name || 'idx')
          : r.name
        return { ...r, name, columnsText }
      }
      if (key === 'unique') return { ...r, unique: asBool(value, r.unique) }
      return r
    })
  }

  function onFkCommit(row: FkRow, column: RsTableColumn<FkRow>, _i: number, value: unknown): void {
    const key = String(column.key)
    foreignKeys.value = foreignKeys.value.map((r) => {
      if (r.__rowKey !== row.__rowKey) return r
      if (key === 'name') return { ...r, name: String(value ?? '').trim() }
      if (key === 'columnsText') return { ...r, columnsText: multiSelectText(value) }
      if (key === 'refTable') {
        const refTable = String(value ?? '').trim()
        void loadRefColumns(refTable)
        return { ...r, refTable, refColumnsText: '' }
      }
      if (key === 'refColumnsText') return { ...r, refColumnsText: multiSelectText(value) }
      if (key === 'onDelete') return { ...r, onDelete: String(value ?? 'NO ACTION') }
      if (key === 'onUpdate') return { ...r, onUpdate: String(value ?? 'NO ACTION') }
      return r
    })
  }

  function removeCol(key: string): void {
    const target = columns.value.find((c) => c.__rowKey === key)
    if (!target) return
    if (!target.originalName) {
      columns.value = columns.value.filter((c) => c.__rowKey !== key)
    } else {
      columns.value = columns.value.map((c) =>
        c.__rowKey === key ? { ...c, removed: true } : c,
      )
    }
    indexes.value = syncPrimaryIndexFromColumns(indexes.value, columns.value)
  }

  function removeIdx(key: string): void {
    const target = indexes.value.find((i) => i.__rowKey === key)
    if (!target) return
    if (target.primary) {
      columns.value = applyPrimaryIndexToColumns(columns.value, '')
    }
    if (!target.originalName) {
      indexes.value = indexes.value.filter((i) => i.__rowKey !== key)
      return
    }
    indexes.value = indexes.value.map((i) =>
      i.__rowKey === key ? { ...i, removed: true } : i,
    )
  }

  function removeFk(key: string): void {
    const target = foreignKeys.value.find((f) => f.__rowKey === key)
    if (!target) return
    if (!target.originalName) {
      foreignKeys.value = foreignKeys.value.filter((f) => f.__rowKey !== key)
      return
    }
    foreignKeys.value = foreignKeys.value.map((f) =>
      f.__rowKey === key ? { ...f, removed: true } : f,
    )
  }

  function onAddCurrent(): void {
    if (activeSection.value === 'indexes') {
      indexes.value = [...indexes.value, newEmptyIndex()]
      return
    }
    if (activeSection.value === 'foreignKeys') {
      foreignKeys.value = [...foreignKeys.value, newEmptyForeignKey()]
      return
    }
    columns.value = [...columns.value, newEmptyColumn()]
  }

  const editingCol = computed(
    () => columns.value.find((c) => c.__rowKey === editingColKey.value) ?? null,
  )
  const editingIdx = computed(
    () => indexes.value.find((i) => i.__rowKey === editingIdxKey.value) ?? null,
  )
  const editingFk = computed(
    () => foreignKeys.value.find((f) => f.__rowKey === editingFkKey.value) ?? null,
  )

  function moveSelectedColumn(delta: -1 | 1): void {
    if (activeSection.value !== 'columns' || !editingColKey.value) return
    const visible = columns.value.filter((c) => !c.removed)
    const idx = visible.findIndex((c) => c.__rowKey === editingColKey.value)
    const target = idx + delta
    if (idx < 0 || target < 0 || target >= visible.length) return
    const reordered = [...visible]
    const [moved] = reordered.splice(idx, 1)
    if (!moved) return
    reordered.splice(target, 0, moved)
    const removed = columns.value.filter((c) => c.removed)
    columns.value = [...reordered, ...removed]
  }

  function updateColSideField<K extends keyof DesignColumnDraft>(
    key: string,
    field: K,
    value: DesignColumnDraft[K],
  ): void {
    patchColumn(key, (c) => {
      const updated = { ...c, [field]: value }
      if (field === 'typeBase' || field === 'typeLength') {
        if (field === 'typeBase') {
          const nextBase = String(value).toUpperCase()
          const kind = dataTypeParamKind(nextBase)
          const opt = SQLITE_BASE_TYPE_OPTIONS.find((o) => o.base === nextBase)
          updated.typeBase = nextBase
          if (kind === 'none') updated.typeLength = undefined
          else if (kind === 'length' && updated.typeLength == null) {
            updated.typeLength = opt?.defaultLength ?? 255
          }
        }
        updated.dataType = syncColumnDataType(updated)
      }
      if (field === 'primaryKey' && value) {
        updated.nullable = false
      }
      if (field === 'generatedType') {
        if (!updated.generatedType) {
          updated.generatedExpr = ''
        } else {
          updated.defaultExpr = ''
          updated.autoIncrement = false
        }
      }
      if (field === 'generatedExpr' && updated.generatedType) {
        updated.defaultExpr = ''
        updated.autoIncrement = false
      }
      return updated
    })
    if (field === 'primaryKey' || field === 'name') {
      indexes.value = syncPrimaryIndexFromColumns(indexes.value, columns.value)
    }
  }

  const generatedTypeOptions = computed(() => [
    { value: '', label: t('modules.sqlite.design.generatedNone') },
    { value: 'VIRTUAL', label: 'VIRTUAL' },
    { value: 'STORED', label: 'STORED' },
  ])

  function columnsTextFromSelect(value: unknown): string {
    if (Array.isArray(value)) return value.map(String).join(', ')
    return String(value ?? '')
  }

  function updateIdxSideField(
    key: string,
    field: 'name' | 'columnsText' | 'unique',
    value: string | boolean,
  ): void {
    const current = indexes.value.find((r) => r.__rowKey === key)
    if (!current || current.primary) return
    indexes.value = indexes.value.map((r) => {
      if (r.__rowKey !== key) return r
      if (field === 'name') return { ...r, name: String(value).trim() }
      if (field === 'columnsText') {
        const columnsText = String(value)
        const name = isDefaultIndexName(r.name)
          ? suggestIndexName(columnsText, r.name || 'idx')
          : r.name
        return { ...r, name, columnsText }
      }
      if (field === 'unique') return { ...r, unique: Boolean(value) }
      return r
    })
  }

  function updateFkSideField(
    key: string,
    field: 'name' | 'columnsText' | 'refTable' | 'refColumnsText' | 'onDelete' | 'onUpdate',
    value: string,
  ): void {
    foreignKeys.value = foreignKeys.value.map((r) => {
      if (r.__rowKey !== key) return r
      if (field === 'refTable') {
        void loadRefColumns(value)
        return { ...r, refTable: value.trim(), refColumnsText: '' }
      }
      return { ...r, [field]: value }
    })
  }

  async function ensureRefTables(): Promise<void> {
    if (!props.sessionId || refTableOptions.value.length > 0) return
    try {
      const result = await sqliteApi.treeTables({
        sessionId: props.sessionId,
        schema: schemaName.value,
        types: ['table'],
        limit: 500,
      })
      const objects = result.objects ?? result.tables ?? []
      refTableOptions.value = objects.map((o) => ({ value: o.name, label: o.name }))
    } catch {
      /* 可手输 */
    }
  }

  async function loadRefColumns(table: string): Promise<void> {
    if (!props.sessionId || !table.trim()) {
      refColumnOptions.value = []
      return
    }
    try {
      const result = await sqliteApi.metaColumns({
        sessionId: props.sessionId,
        schema: schemaName.value,
        table: table.trim(),
      })
      refColumnOptions.value = (result.columns ?? []).map((c) => ({
        value: c.name,
        label: c.name,
      }))
    } catch {
      refColumnOptions.value = []
    }
  }

  async function load(): Promise<void> {
    if (modeCreate.value) return
    const table = effectiveTable.value
    if (!table || !props.sessionId) return
    loading.value = true
    try {
      const base = { sessionId: props.sessionId, schema: schemaName.value, table }
      const [colsResult, idxsResult, pkResult, fkResult] = await Promise.all([
        sqliteApi.metaColumns(base),
        sqliteApi.metaIndexes(base),
        sqliteApi.metaPrimaryKey(base),
        sqliteApi.metaForeignKeys(base).catch(() => ({ foreignKeys: [] })),
      ])
      const pkCols = pkResult.columns ?? []
      const rows = toDesignRows(colsResult.columns, pkCols)
      const idxDrafts = toIndexDrafts(idxsResult.indexes, pkCols)
      const fkDrafts = toForeignKeyDrafts(fkResult.foreignKeys ?? [])
      columns.value = rows
      indexes.value = idxDrafts
      foreignKeys.value = fkDrafts
      origColumns.value = rows.map((c) => ({ ...c }))
      origIndexes.value = idxDrafts.map((i) => ({ ...i }))
      origForeignKeys.value = fkDrafts.map((f) => ({ ...f }))
      tableName.value = table
      designStrategy.value = ''
      designWarning.value = ''
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      loading.value = false
    }
  }

  function buildCreatePayload() {
    return {
      sessionId: props.sessionId ?? undefined,
      schema: schemaName.value,
      name: tableName.value.trim(),
      columns: buildCreateColumns(columns.value),
      indexes: (() => {
        const idxs = buildCreateIndexes(indexes.value)
        return idxs.length ? idxs : undefined
      })(),
      foreignKeys: (() => {
        const fks = buildCreateForeignKeys(foreignKeys.value)
        return fks.length ? fks : undefined
      })(),
    }
  }

  function formatPreviewSqls(sqls: string[]): string[] {
    return sqls.map((s) => {
      const raw = s.trim()
      if (!raw) return raw
      try {
        return formatSql(raw, { dialect: 'sqlite' })
      } catch {
        return raw
      }
    })
  }

  async function loadPreviewSql(): Promise<boolean> {
    if (!props.sessionId) return false
    try {
      if (modeCreate.value) {
        if (!tableName.value.trim()) {
          toast.error(t('modules.sqlite.design.needTableName'))
          return false
        }
        if (buildCreateColumns(columns.value).length === 0) {
          toast.info(t('modules.sqlite.design.needColumns'))
          return false
        }
        const result = await sqliteApi.ddlCreateTablePreview(buildCreatePayload())
        previewSqls.value = formatPreviewSqls(result.sql ?? [])
        designStrategy.value = ''
        designWarning.value = ''
      } else {
        const ops = buildAlterDesignOps(
          origColumns.value,
          columns.value,
          origIndexes.value,
          indexes.value,
          origForeignKeys.value,
          foreignKeys.value,
        )
        if (ops.length === 0) {
          previewSqls.value = [`-- ${t('modules.sqlite.design.noChanges')}`]
          designStrategy.value = ''
          designWarning.value = ''
          return true
        }
        const result = await sqliteApi.ddlDesignPreview({
          sessionId: props.sessionId,
          schema: schemaName.value,
          name: effectiveTable.value!,
          ops,
        })
        previewSqls.value = formatPreviewSqls(result.sql)
        designStrategy.value = result.strategy ?? ''
        designWarning.value = result.warning ?? ''
      }
      return previewSqls.value.length > 0
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      return false
    }
  }

  async function onPreviewOpenChange(open: boolean): Promise<void> {
    if (!open) {
      showPreview.value = false
      previewLoading.value = false
      return
    }
    showPreview.value = true
    previewLoading.value = true
    previewSqls.value = []
    try {
      const ok = await loadPreviewSql()
      if (!ok) showPreview.value = false
    } finally {
      previewLoading.value = false
    }
  }

  async function copyPreviewSql(): Promise<void> {
    if (!previewSqls.value.length) {
      const ok = await loadPreviewSql()
      if (!ok) return
    }
    const body = previewSqls.value.join(';\n\n')
    if (!body.trim()) return
    try {
      await navigator.clipboard.writeText(body.endsWith(';') ? body : `${body};`)
      toast.success(t('modules.sqlite.design.copyPreviewOk'))
    } catch {
      toast.error(t('modules.sqlite.design.copyPreviewFailed'))
    }
  }

  function categoryPath(schema: string, category: string): ConnResourcePath {
    return {
      segments: [
        { kind: 'schema', name: schema },
        { kind: 'category', name: category },
      ],
    }
  }

  async function refreshTreeAfterCreate(): Promise<void> {
    if (!props.profileId) return
    const conn = { profileId: props.profileId, kind: 'sqlite' } as ConnItem
    try {
      await refreshResourceIfLoaded(conn, categoryPath(schemaName.value, 'tables'), { deep: true })
      await refreshResourceIfLoaded(
        conn,
        { segments: [{ kind: 'schema', name: schemaName.value }] },
        { deep: false },
      )
    } catch {
      /* ignore */
    }
  }

  function switchToAlterAfterCreate(name: string): void {
    localDesignMode.value = 'alter'
    localTable.value = name
    tableName.value = name
    const tabs = useTabStore()
    const tabId = tabs.activeTabId
    if (tabId) {
      tabs.updateTabProps(tabId, { designMode: 'alter', table: name })
      const designLabel = t('modules.sqlite.session.tabDesign')
      tabs.updateTitle(tabId, `${schemaName.value}.${name} · ${designLabel}`)
    }
  }

  async function onApply(): Promise<void> {
    if (!props.sessionId) return
    saving.value = true
    try {
      if (modeCreate.value) {
        const name = tableName.value.trim()
        if (!name) {
          toast.error(t('modules.sqlite.design.needTableName'))
          return
        }
        if (buildCreateColumns(columns.value).length === 0) {
          toast.info(t('modules.sqlite.design.needColumns'))
          return
        }
        await sqliteApi.ddlCreateTable(buildCreatePayload())
        toast.success(t('modules.sqlite.design.createOk', { name }))
        showPreview.value = false
        await refreshTreeAfterCreate()
        switchToAlterAfterCreate(name)
        await load()
      } else {
        const ops = buildAlterDesignOps(
          origColumns.value,
          columns.value,
          origIndexes.value,
          indexes.value,
          origForeignKeys.value,
          foreignKeys.value,
        )
        if (ops.length === 0) {
          toast.info(t('modules.sqlite.design.noChanges'))
          return
        }
        const table = effectiveTable.value
        if (!table) {
          toast.error(t('modules.sqlite.design.needTableName'))
          return
        }
        const result = await sqliteApi.ddlDesignApply({
          sessionId: props.sessionId,
          schema: schemaName.value,
          name: table,
          ops,
        })
        designStrategy.value = result.strategy ?? ''
        designWarning.value = result.warning ?? ''
        if (result.warning) {
          toast.success(`${t('modules.sqlite.design.applyOk')} · ${result.warning}`)
        } else {
          toast.success(t('modules.sqlite.design.applyOk'))
        }
        showPreview.value = false
        await load()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      saving.value = false
    }
  }

  function ensureCreateDefaults(): void {
    if (columns.value.length === 0) {
      columns.value = defaultCreateTableColumns()
      indexes.value = syncPrimaryIndexFromColumns([], columns.value)
    }
  }

  watch(
    () => [props.sessionId, props.schema, props.table, props.active, props.designMode] as const,
    ([sid, , , active]) => {
      if (active && sid) {
        if (modeCreate.value) ensureCreateDefaults()
        else void load()
      }
    },
    { immediate: true },
  )

  onMounted(() => {
    if (modeCreate.value) ensureCreateDefaults()
  })

  watch(activeSection, (sec) => {
    if (sec === 'foreignKeys') void ensureRefTables()
  })

  // reactive 包裹以便模板里 d.xxx 自动解包 ref
  return reactive({
    t,
    activeSection,
    loading,
    saving,
    previewSqls,
    showPreview,
    previewLoading,
    designStrategy,
    designWarning,
    tableName,
    modeCreate,
    effectiveTable,
    designMode,
    shellLabels,
    addButtonLabel,
    title,
    sections,
    displayColumns,
    displayIndexes,
    displayForeignKeys,
    columnColumns,
    indexColumns,
    fkColumns,
    editingColKey,
    editingIdxKey,
    editingFkKey,
    editingCol,
    editingIdx,
    editingFk,
    typeBaseSelectOptions,
    generatedTypeOptions,
    draftColumnSelectOptions,
    refTableOptions,
    refColumnOptions,
    fkActionOptions,
    dataTypeParamKind,
    onColCommit,
    onIdxCommit,
    onFkCommit,
    removeCol,
    removeIdx,
    removeFk,
    onAddCurrent,
    moveSelectedColumn,
    updateColSideField,
    updateIdxSideField,
    updateFkSideField,
    columnsTextFromSelect,
    load,
    onPreviewOpenChange,
    copyPreviewSql,
    onApply,
  })
}
