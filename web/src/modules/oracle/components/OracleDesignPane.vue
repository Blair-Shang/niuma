<script setup lang="ts">
/**
 * Oracle 表设计器：挂载公共 TableDesignShell，方言负责草稿 / RPC / 类型目录。
 * 默认 id NUMBER IDENTITY、真 CREATE 预览、外键、网格编辑、列拖拽、索引多选。
 */
import {
  RsButton,
  RsEmpty,
  RsInput,
  RsSelect,
  RsTable,
  reorderTableRows,
  useRsToast,
  type RsSelectOptions,
  type RsTableColumn,
  type RsTableRowDropPosition,
} from '@niuma/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { oracleApi } from '@/api/oracle'
import {
  TableDesignPreviewPopover,
  TableDesignShell,
  type TableDesignSection,
  type TableDesignSectionItem,
  type TableDesignShellLabels,
} from '@/modules/database'
import {
  patchCategoryObjectCount,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import { categoryPath } from '@/modules/oracle/conn-tree-shared'
import type { ConnItem } from '@/modules/ops/types'
import { useTabStore } from '@/stores/tab'
import {
  ORACLE_BASE_TYPE_OPTIONS,
  ORACLE_FK_ACTIONS,
  ORACLE_INDEX_METHODS,
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
} from '@/modules/oracle/utils/table-design'
import { formatSql } from '@/modules/sql-editor/format'
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
} from '@/modules/oracle/utils/table-design-ops'
import { isOracleConnectionError } from '@/modules/oracle/utils/oracleConnectionError'
import { useSessionActionStore } from '@/stores/session-actions'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  schema: string
  table?: string
  designMode: 'create' | 'alter'
  active: boolean
  sessionLabel?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const sessionActions = useSessionActionStore()

function noteConnectionLost(err: unknown): void {
  if (!isOracleConnectionError(err)) return
  if (props.profileId) {
    toast.warning(t('modules.oracle.session.connectionLost'))
    sessionActions.requestReconnect(props.profileId)
  } else {
    toast.warning(t('modules.oracle.session.reconnectHint'))
  }
}

type DesignTab = 'columns' | 'indexes' | 'foreignKeys'
type ColRow = DesignColumnDraft & Record<string, unknown>
type IdxRow = DesignIndexDraft & Record<string, unknown>
type FkRow = DesignForeignKeyDraft & Record<string, unknown>

const activeSection = ref<TableDesignSection>('columns')
const loading = ref(false)
const saving = ref(false)
const previewSqls = ref<string[]>([])
const showPreview = ref(false)
const previewLoading = ref(false)
/** 创建成功后本地切到 alter，不依赖 Tab props 同步时机 */
const localDesignMode = ref<'create' | 'alter' | null>(null)
const localTable = ref<string | null>(null)
const tableName = ref(props.table ?? '')
const tableComment = ref('')
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

const shellLabels = computed<TableDesignShellLabels>(() => ({
  reload: t('modules.oracle.design.reload'),
  preview: t('modules.oracle.design.preview'),
  create: t('modules.oracle.design.create'),
  apply: t('modules.oracle.design.apply'),
  previewTitle: t('modules.oracle.design.previewTitle'),
  selectRow: t('modules.oracle.design.selectRow'),
  copyPreview: t('modules.oracle.design.copyPreview'),
  moveUp: t('modules.oracle.design.moveUp'),
  moveDown: t('modules.oracle.design.moveDown'),
  add: t('modules.oracle.design.addColumn'),
}))

const addButtonLabel = computed(() => {
  if (activeSection.value === 'indexes') return t('modules.oracle.design.addIndex')
  if (activeSection.value === 'foreignKeys') return t('modules.oracle.design.addForeignKey')
  return t('modules.oracle.design.addColumn')
})

const title = computed(() =>
  modeCreate.value
    ? t('modules.oracle.design.createTitle')
    : t('modules.oracle.design.alterTitle', { name: effectiveTable.value ?? '' }),
)

const sections = computed<TableDesignSectionItem[]>(() => [
  {
    id: 'columns',
    label: t('modules.oracle.design.tabColumns'),
    count: columns.value.filter((c) => !c.removed).length,
  },
  {
    id: 'indexes',
    label: t('modules.oracle.design.tabIndexes'),
    count: indexes.value.filter((i) => !i.removed).length,
  },
  {
    id: 'foreignKeys',
    label: t('modules.oracle.design.tabForeignKeys'),
    count: foreignKeys.value.filter((f) => !f.removed).length,
  },
])

const indexMethodOptions: RsSelectOptions = ORACLE_INDEX_METHODS.map((v) => ({
  value: v,
  label: v,
}))

const typeBaseSelectOptions = ORACLE_BASE_TYPE_OPTIONS.map((o) => ({
  value: o.base,
  label: o.base,
}))

const fkActionOptions = ORACLE_FK_ACTIONS.map((v) => ({ value: v, label: v }))

const draftColumnSelectOptions = computed(() =>
  columns.value
    .filter((c) => !c.removed && c.name.trim())
    .map((c) => ({ value: c.name, label: c.name })),
)

const displayColumns = computed((): ColRow[] =>
  columns.value
    .filter((c) => !c.removed)
    .map((c) => {
      let status = t('modules.oracle.design.statusOk')
      if (!c.originalName) status = t('modules.oracle.design.statusNew')
      else {
        const orig = origColumns.value.find((o) => o.originalName === c.originalName)
        if (
          orig &&
          (c.name !== orig.name ||
            c.dataType !== orig.dataType ||
            c.nullable !== orig.nullable ||
            c.defaultExpr !== orig.defaultExpr ||
            c.comment !== orig.comment ||
            c.primaryKey !== orig.primaryKey ||
            c.autoIncrement !== orig.autoIncrement)
        ) {
          status = t('modules.oracle.design.statusEdit')
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
          ? t('modules.oracle.design.idxKindPrimary')
          : i.unique
            ? t('modules.oracle.design.idxKindUnique')
            : t('modules.oracle.design.idxKindNormal'),
      })) as IdxRow[],
)
const displayForeignKeys = computed(
  (): FkRow[] => foreignKeys.value.filter((f) => !f.removed) as FkRow[],
)

const editingCol = computed(
  () => columns.value.find((c) => c.__rowKey === editingColKey.value) ?? null,
)
const editingIdx = computed(
  () => indexes.value.find((i) => i.__rowKey === editingIdxKey.value) ?? null,
)
const editingFk = computed(
  () => foreignKeys.value.find((f) => f.__rowKey === editingFkKey.value) ?? null,
)

const columnColumns = computed((): RsTableColumn<ColRow>[] => {
  const cols: RsTableColumn<ColRow>[] = [
  { key: 'name', title: t('modules.oracle.design.colName'), minWidth: 110, editable: true },
  {
    key: 'typeBase',
    title: t('modules.oracle.design.colType'),
    minWidth: 120,
    editable: true,
    valueType: 'select',
    editorOptions: { options: typeBaseSelectOptions, searchable: true, creatable: true },
  },
  {
    key: 'typeLength',
    title: t('modules.oracle.design.colLength'),
    width: 72,
    align: 'center',
    valueType: 'number',
    editable: (row) => {
      const kind = dataTypeParamKind(row.typeBase)
      return kind === 'length' || kind === 'precision'
    },
  },
  {
    key: 'typeScale',
    title: t('modules.oracle.design.colScale'),
    width: 64,
    align: 'center',
    valueType: 'number',
    editable: (row) => dataTypeParamKind(row.typeBase) === 'precision',
  },
  {
    key: 'primaryKey',
    title: t('modules.oracle.design.colPk'),
    width: 52,
    align: 'center',
    editable: true,
    valueType: 'boolean',
  },
  {
    key: 'nullable',
    title: t('modules.oracle.design.colNullable'),
    width: 52,
    align: 'center',
    editable: true,
    valueType: 'boolean',
  },
  {
    key: 'autoIncrement',
    title: t('modules.oracle.design.colAi'),
    width: 52,
    align: 'center',
    editable: true,
    valueType: 'boolean',
  },
  {
    key: 'defaultExpr',
    title: t('modules.oracle.design.colDefault'),
    minWidth: 100,
    editable: true,
    ellipsis: true,
  },
  {
    key: 'comment',
    title: t('modules.oracle.design.colComment'),
    minWidth: 100,
    editable: true,
    ellipsis: true,
  },
  ]
  if (!modeCreate.value) {
    cols.push({
      key: 'status',
      title: t('modules.oracle.design.colStatus'),
      width: 72,
      align: 'center',
    })
  }
  return cols
})

const indexColumns = computed((): RsTableColumn<IdxRow>[] => [
  { key: 'name', title: t('modules.oracle.design.idxName'), minWidth: 110, editable: true },
  {
    key: 'kindLabel',
    title: t('modules.oracle.design.idxKind'),
    width: 88,
    editable: false,
  },
  {
    key: 'columnsText',
    title: t('modules.oracle.design.idxColumns'),
    minWidth: 160,
    editable: true,
    valueType: 'select',
    headerTip: t('modules.oracle.design.idxColumnsTip'),
    editorOptions: {
      options: draftColumnSelectOptions.value,
      multiple: true,
      searchable: true,
      clearable: true,
    },
  },
  {
    key: 'method',
    title: t('modules.oracle.design.idxMethod'),
    width: 88,
    editable: true,
    valueType: 'select',
    editorOptions: { options: indexMethodOptions },
  },
  {
    key: 'unique',
    title: t('modules.oracle.design.idxUnique'),
    width: 64,
    align: 'center',
    editable: true,
    valueType: 'boolean',
  },
])

const fkColumns = computed((): RsTableColumn<FkRow>[] => [
  { key: 'name', title: t('modules.oracle.design.fkName'), minWidth: 100, editable: true },
  {
    key: 'columnsText',
    title: t('modules.oracle.design.fkColumns'),
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
    title: t('modules.oracle.design.fkRefTable'),
    minWidth: 120,
    editable: true,
    valueType: 'select',
    editorOptions: {
      options: refTableOptions.value,
      searchable: true,
      clearable: true,
    },
  },
  {
    key: 'refColumnsText',
    title: t('modules.oracle.design.fkRefColumns'),
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
    title: t('modules.oracle.design.fkOnDelete'),
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

function patchColumn(
  key: string,
  patch: (col: DesignColumnDraft) => DesignColumnDraft,
): void {
  columns.value = columns.value.map((c) => (c.__rowKey === key ? patch(c) : c))
}

function onColCommit(row: ColRow, column: RsTableColumn<ColRow>, _i: number, value: unknown): void {
  const key = String(column.key)
  const draft = String(value ?? '').trim()
  patchColumn(row.__rowKey, (r) => {
    if (key === 'name') return { ...r, name: draft || r.name }
    if (key === 'typeBase') {
      const nextBase = (draft || r.typeBase).toUpperCase()
      const kind = dataTypeParamKind(nextBase)
      const opt = ORACLE_BASE_TYPE_OPTIONS.find((o) => o.base.toUpperCase() === nextBase)
      let typeLength: number | undefined
      let typeScale: number | undefined
      if (kind === 'length') {
        typeLength = opt?.defaultLength
      } else if (kind === 'precision') {
        typeLength = opt?.defaultPrecision ?? 38
        typeScale = opt?.defaultScale ?? 0
      }
      const next = {
        ...r,
        typeBase: opt?.base ?? nextBase,
        typeLength,
        typeScale,
        unsigned: false,
        enumValues: '',
      }
      return { ...next, dataType: syncColumnDataType(next) }
    }
    if (key === 'typeLength') {
      const n = draft === '' ? undefined : Number(draft)
      const next = { ...r, typeLength: Number.isFinite(n) ? n : undefined }
      return { ...next, dataType: syncColumnDataType(next) }
    }
    if (key === 'typeScale') {
      const n = draft === '' ? undefined : Number(draft)
      const next = { ...r, typeScale: Number.isFinite(n) ? n : undefined }
      return { ...next, dataType: syncColumnDataType(next) }
    }
    if (key === 'defaultExpr') return { ...r, defaultExpr: draft }
    if (key === 'comment') return { ...r, comment: draft }
    if (key === 'nullable') return { ...r, nullable: asBool(value, r.nullable) }
    if (key === 'autoIncrement') return { ...r, autoIncrement: asBool(value, r.autoIncrement) }
    if (key === 'primaryKey') {
      const pk = asBool(value, r.primaryKey)
      return { ...r, primaryKey: pk, nullable: pk ? false : r.nullable }
    }
    return r
  })
  // 栏位主键 ↔ 索引 PRIMARY（对齐 Navicat）
  if (key === 'primaryKey' || key === 'name') {
    indexes.value = syncPrimaryIndexFromColumns(indexes.value, columns.value)
  }
}

function onIdxCommit(row: IdxRow, column: RsTableColumn<IdxRow>, _i: number, value: unknown): void {
  const key = String(column.key)
  const current = indexes.value.find((r) => r.__rowKey === row.__rowKey)
  if (!current) return

  // PRIMARY：名称/唯一不可改；改列清单回写栏位主键勾选
  if (current.primary) {
    if (key === 'name' || key === 'unique' || key === 'method') return
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
      const name = isDefaultIndexName(r.name) ? suggestIndexName(columnsText, r.name || 'idx') : r.name
      return { ...r, name, columnsText }
    }
    if (key === 'method') {
      const method = String(value ?? 'NORMAL').toUpperCase()
      return { ...r, method: method === 'BITMAP' ? 'BITMAP' : 'NORMAL' }
    }
    if (key === 'unique') return { ...r, unique: asBool(value, r.unique) }
    return r
  })
}

async function ensureRefTables(): Promise<void> {
  if (!props.profileId && !props.sessionId) return
  try {
    const result = await oracleApi.treeTables({
      profileId: props.profileId,
      sessionId: props.sessionId ?? undefined,
      schema: props.schema,
      types: ['table'],
    })
    refTableOptions.value = (result.tables ?? []).map((tb) => ({
      value: tb.name,
      label: tb.name,
    }))
  } catch {
    refTableOptions.value = []
  }
}

async function ensureRefColumns(table: string): Promise<void> {
  if (!table.trim() || (!props.profileId && !props.sessionId)) {
    refColumnOptions.value = []
    return
  }
  try {
    const base = props.sessionId
      ? { sessionId: props.sessionId, schema: props.schema, table }
      : { profileId: props.profileId!, schema: props.schema, table }
    const result = await oracleApi.metaColumns(base)
    refColumnOptions.value = (result.columns ?? []).map((c) => ({
      value: c.name,
      label: c.name,
    }))
  } catch {
    refColumnOptions.value = []
  }
}

function onFkEditStart(row: FkRow, column: RsTableColumn<FkRow>): void {
  const key = String(column.key)
  if (key === 'refTable') void ensureRefTables()
  if (key === 'refColumnsText' && row.refTable) void ensureRefColumns(row.refTable)
}

function onFkCommit(row: FkRow, column: RsTableColumn<FkRow>, _i: number, value: unknown): void {
  const key = String(column.key)
  const draft = String(value ?? '').trim()
  foreignKeys.value = foreignKeys.value.map((r) => {
    if (r.__rowKey !== row.__rowKey) return r
    if (key === 'name') return { ...r, name: draft }
    if (key === 'columnsText') return { ...r, columnsText: multiSelectText(value) }
    if (key === 'refTable') {
      if (draft !== r.refTable) {
        void ensureRefColumns(draft)
        return { ...r, refTable: draft, refColumnsText: '' }
      }
      return { ...r, refTable: draft }
    }
    if (key === 'refColumnsText') return { ...r, refColumnsText: multiSelectText(value) }
    if (key === 'onDelete') {
      const upper = draft.toUpperCase()
      return {
        ...r,
        onDelete: (ORACLE_FK_ACTIONS as readonly string[]).includes(upper) ? upper : r.onDelete,
      }
    }
    return r
  })
}

function addColumn(): void {
  const col = newEmptyColumn()
  col.name = `col_${columns.value.filter((c) => !c.removed).length + 1}`
  columns.value = [...columns.value, col]
  editingColKey.value = col.__rowKey
  editingIdxKey.value = null
  editingFkKey.value = null
  activeSection.value = 'columns'
}

function removeCol(key: string): void {
  columns.value = columns.value.map((c) =>
    c.__rowKey === key ? { ...c, removed: true } : c,
  )
  indexes.value = syncPrimaryIndexFromColumns(indexes.value, columns.value)
  if (editingColKey.value === key) editingColKey.value = null
}

function addIndex(): void {
  const idx = newEmptyIndex()
  indexes.value = [...indexes.value, idx]
  editingIdxKey.value = idx.__rowKey
  editingColKey.value = null
  editingFkKey.value = null
  activeSection.value = 'indexes'
}

function removeIdx(key: string): void {
  const target = indexes.value.find((i) => i.__rowKey === key)
  if (target?.primary) {
    // 删除 PRIMARY = 清除所有栏位主键勾选（对齐 Navicat）
    columns.value = columns.value.map((c) =>
      c.primaryKey ? { ...c, primaryKey: false } : c,
    )
    indexes.value = syncPrimaryIndexFromColumns(indexes.value, columns.value)
  } else {
    indexes.value = indexes.value.map((i) =>
      i.__rowKey === key ? { ...i, removed: true } : i,
    )
  }
  if (editingIdxKey.value === key) editingIdxKey.value = null
}

function addForeignKey(): void {
  const fk = newEmptyForeignKey()
  foreignKeys.value = [...foreignKeys.value, fk]
  editingFkKey.value = fk.__rowKey
  editingColKey.value = null
  editingIdxKey.value = null
  activeSection.value = 'foreignKeys'
  void ensureRefTables()
}

function removeFk(key: string): void {
  foreignKeys.value = foreignKeys.value.map((f) =>
    f.__rowKey === key ? { ...f, removed: true } : f,
  )
  if (editingFkKey.value === key) editingFkKey.value = null
}

function onAddCurrent(): void {
  if (activeSection.value === 'indexes') addIndex()
  else if (activeSection.value === 'foreignKeys') addForeignKey()
  else addColumn()
}

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

async function copyPreviewSql(): Promise<void> {
  if (!previewSqls.value.length) {
    const ok = await loadPreviewSql()
    if (!ok) return
  }
  const body = previewSqls.value.join(';\n\n')
  if (!body.trim()) return
  try {
    await navigator.clipboard.writeText(body.endsWith(';') ? body : `${body};`)
    toast.success(t('modules.oracle.design.copyPreviewOk'))
  } catch {
    toast.error(t('modules.oracle.design.copyPreviewFailed'))
  }
}

function onColumnRowDrop(
  dragKeys: string[],
  dropKey: string,
  position: RsTableRowDropPosition,
): void {
  const dragKey = dragKeys[0]
  if (!dragKey || dragKey === dropKey) return
  const visible = columns.value.filter((c) => !c.removed)
  const dragIndex = visible.findIndex((c) => c.__rowKey === dragKey)
  const dropIndex = visible.findIndex((c) => c.__rowKey === dropKey)
  if (dragIndex < 0 || dropIndex < 0) return
  const reordered = reorderTableRows(visible, dragIndex, dropIndex, position)
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
    if (
      field === 'typeBase' ||
      field === 'typeLength' ||
      field === 'typeScale'
    ) {
      if (field === 'typeBase') {
        const nextBase = String(value).toUpperCase()
        const opt = ORACLE_BASE_TYPE_OPTIONS.find((o) => o.base.toUpperCase() === nextBase)
        updated.typeBase = opt?.base ?? nextBase
        updated.unsigned = false
        updated.enumValues = ''
        const kind = dataTypeParamKind(updated.typeBase)
        if (kind === 'none') {
          updated.typeLength = undefined
          updated.typeScale = undefined
        } else if (kind === 'length') {
          updated.typeLength = opt?.defaultLength
          updated.typeScale = undefined
        } else if (kind === 'precision') {
          updated.typeLength = opt?.defaultPrecision ?? 38
          updated.typeScale = opt?.defaultScale ?? 0
        }
      }
      updated.dataType = syncColumnDataType(updated)
    }
    if (field === 'primaryKey' && value) {
      updated.nullable = false
    }
    return updated
  })
  if (field === 'primaryKey' || field === 'name') {
    indexes.value = syncPrimaryIndexFromColumns(indexes.value, columns.value)
  }
}

async function load(): Promise<void> {
  if (modeCreate.value) return
  const table = effectiveTable.value
  if (!props.schema || !table) return
  if (!props.sessionId && !props.profileId) return
  loading.value = true
  try {
    const base = props.sessionId
      ? { sessionId: props.sessionId, schema: props.schema, table }
      : { profileId: props.profileId!, schema: props.schema, table }
    const colsResult = await oracleApi.metaColumns(base)
    const idxsResult = await oracleApi.metaIndexes(base)
    const pkResult = await oracleApi.metaPrimaryKey(base)
    const fkResult = await oracleApi.metaForeignKeys(base).catch(() => ({ foreignKeys: [] }))
    const rows = toDesignRows(colsResult.columns, pkResult.columns ?? [])
    const idxDrafts = toIndexDrafts(idxsResult.indexes, pkResult.columns ?? [])
    const fkDrafts = toForeignKeyDrafts(fkResult.foreignKeys ?? [])
    columns.value = rows
    indexes.value = idxDrafts
    foreignKeys.value = fkDrafts
    origColumns.value = rows.map((c) => ({ ...c }))
    origIndexes.value = idxDrafts.map((i) => ({ ...i }))
    origForeignKeys.value = fkDrafts.map((f) => ({ ...f }))
    tableComment.value = colsResult.tableComment ?? ''
    tableName.value = table
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}

function buildCreatePayload() {
  return {
    sessionId: props.sessionId ?? undefined,
    schema: props.schema,
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
    comment: tableComment.value || undefined,
  }
}

/** 拉取并格式化预览 SQL；校验失败返回 false（不抛错）。 */
async function loadPreviewSql(): Promise<boolean> {
  if (!props.sessionId) return false
  try {
    if (modeCreate.value) {
      if (!tableName.value.trim()) {
        toast.error(t('modules.oracle.design.needTableName'))
        return false
      }
      const cols = buildCreateColumns(columns.value)
      if (cols.length === 0) {
        toast.info(t('modules.oracle.design.needColumns'))
        return false
      }
      const result = await oracleApi.ddlCreateTablePreview(buildCreatePayload())
      previewSqls.value = formatPreviewSqls(result.sql ?? [])
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
        // 无变更也打开预览，用 SQL 注释说明，避免 Popover 一闪即关
        previewSqls.value = [`-- ${t('modules.oracle.design.noChanges')}`]
        return true
      }
      const result = await oracleApi.ddlDesignPreview({
        sessionId: props.sessionId,
        schema: props.schema,
        name: effectiveTable.value!,
        ops,
      })
      previewSqls.value = formatPreviewSqls(result.sql)
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

function formatPreviewSqls(sqls: string[]): string[] {
  return sqls.map((s) => {
    const raw = s.trim()
    if (!raw) return raw
    try {
      return formatSql(raw, { dialect: 'oracle' })
    } catch {
      return raw
    }
  })
}

async function refreshTreeAfterCreate(): Promise<void> {
  if (!props.profileId || !props.schema) return
  const conn = { profileId: props.profileId, kind: 'oracle' } as ConnItem
  const tablesPath = categoryPath(props.schema, 'tables')
  try {
    await refreshResourceIfLoaded(conn, tablesPath, { deep: true })
    patchCategoryObjectCount(conn, tablesPath, { delta: 1 })
  } catch {
    // 刷树失败不影响创建成功提示
  }
}

/** 创建成功后切换为编辑态：主按钮变为「保存」，并按已建表加载元数据。 */
function switchToAlterAfterCreate(name: string): void {
  localDesignMode.value = 'alter'
  localTable.value = name
  tableName.value = name
  const tabs = useTabStore()
  const tabId = tabs.activeTabId
  if (tabId) {
    tabs.updateTabProps(tabId, { designMode: 'alter', table: name })
    const designLabel = t('modules.oracle.session.tabDesign')
    const base = props.schema ? `${props.schema}.${name}` : name
    tabs.updateTitle(tabId, `${base} · ${designLabel}`)
  }
}

async function onApply(): Promise<void> {
  if (!props.sessionId) return
  saving.value = true
  try {
    if (modeCreate.value) {
      const name = tableName.value.trim()
      if (!name) {
        toast.error(t('modules.oracle.design.needTableName'))
        return
      }
      const cols = buildCreateColumns(columns.value)
      if (cols.length === 0) {
        toast.info(t('modules.oracle.design.needColumns'))
        return
      }
      await oracleApi.ddlCreateTable(buildCreatePayload())
      toast.success(t('modules.oracle.design.createOk', { name }))
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
        toast.info(t('modules.oracle.design.noChanges'))
        return
      }
      const table = effectiveTable.value
      if (!table) {
        toast.error(t('modules.oracle.design.needTableName'))
        return
      }
      await oracleApi.ddlDesignApply({
        sessionId: props.sessionId,
        schema: props.schema,
        name: table,
        ops,
      })
      toast.success(t('modules.oracle.design.applyOk'))
      showPreview.value = false
      await load()
    }
  } catch (e) {
    noteConnectionLost(e)
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}

watch(
  () => [props.sessionId, props.schema, props.table, props.active, props.designMode] as const,
  ([sid, , , active]) => {
    if (active && (sid || props.profileId)) {
      if (modeCreate.value) {
        if (columns.value.length === 0) {
          columns.value = defaultCreateTableColumns()
          indexes.value = syncPrimaryIndexFromColumns([], columns.value)
        }
      } else {
        void load()
      }
    }
  },
  { immediate: true },
)

onMounted(() => {
  if (modeCreate.value && columns.value.length === 0) {
    columns.value = defaultCreateTableColumns()
    indexes.value = syncPrimaryIndexFromColumns([], columns.value)
  }
})

watch(activeSection, (sec) => {
  if (sec === 'foreignKeys') void ensureRefTables()
})
</script>

<template>
  <TableDesignShell
    class="nm-oracle-design"
    :labels="shellLabels"
    :title="title"
    :mode="designMode"
    :scope-label="sessionLabel"
    :loading="loading"
    :saving="saving"
    :show-reload="!modeCreate"
    :sections="sections"
    :active-section="activeSection"
    @reload="load"
    @apply="onApply"
    @update:active-section="activeSection = $event"
  >
    <template #preview>
      <TableDesignPreviewPopover
        :open="showPreview"
        :sql="previewSqls"
        :loading="previewLoading"
        :empty-label="t('modules.oracle.design.noChanges')"
        @update:open="onPreviewOpenChange"
      >
        <RsButton size="sm" variant="ghost" :disabled="loading">
          {{ shellLabels.preview }}
        </RsButton>
      </TableDesignPreviewPopover>
    </template>
    <template #toolbar-extra>
      <RsButton size="sm" variant="ghost" icon="plus" @click="onAddCurrent">
        {{ addButtonLabel }}
      </RsButton>
      <RsButton
        size="sm"
        variant="ghost"
        icon="arrow-up"
        :disabled="activeSection !== 'columns' || !editingColKey"
        :title="shellLabels.moveUp"
        @click="moveSelectedColumn(-1)"
      />
      <RsButton
        size="sm"
        variant="ghost"
        icon="arrow-down"
        :disabled="activeSection !== 'columns' || !editingColKey"
        :title="shellLabels.moveDown"
        @click="moveSelectedColumn(1)"
      />
    </template>

    <template #meta>
      <div class="nm-oracle-design__meta-row">
        <label class="nm-oracle-design__meta-label">{{ t('modules.oracle.design.tableName') }}</label>
        <RsInput
          v-if="modeCreate"
          v-model="tableName"
          size="sm"
          :placeholder="t('modules.oracle.design.tableNamePh')"
        />
        <span v-else class="nm-oracle-design__meta-readonly">{{ table || tableName }}</span>
      </div>
      <div class="nm-oracle-design__meta-row nm-oracle-design__meta-row--full">
        <label class="nm-oracle-design__meta-label">{{ t('modules.oracle.design.tableComment') }}</label>
        <RsInput
          v-model="tableComment"
          size="sm"
          :placeholder="t('modules.oracle.design.tableCommentPh')"
        />
      </div>
    </template>

    <template #list>
      <template v-if="activeSection === 'columns'">
        <RsTable
          class="nm-oracle-design__grid"
          :columns="columnColumns"
          :data="displayColumns"
          row-key="__rowKey"
          size="sm"
          striped
          fill
          bordered
          column-bordered
          show-index
          editable
          :edit-gutter="false"
          edit-trigger="dblclick"
          row-draggable
          row-drop-mode="reorder"
          row-drag-trigger="handle"
          :highlighted-row-key="editingColKey ?? undefined"
          :context-menu-items="
            (row) =>
              row
                ? [
                    {
                      key: 'remove',
                      label: t('modules.oracle.design.remove'),
                      icon: 'trash-2',
                      danger: true,
                    },
                  ]
                : []
          "
          @row-click="(row) => { editingColKey = String(row.__rowKey); editingIdxKey = null; editingFkKey = null }"
          @cell-edit-commit="onColCommit"
          @row-drop="onColumnRowDrop"
          @context-menu-select="(key, row) => key === 'remove' && row && removeCol(String(row.__rowKey))"
        />
      </template>

      <template v-else-if="activeSection === 'indexes'">
        <RsTable
          class="nm-oracle-design__grid"
          :columns="indexColumns"
          :data="displayIndexes"
          row-key="__rowKey"
          size="sm"
          striped
          fill
          bordered
          column-bordered
          editable
          :edit-gutter="false"
          edit-trigger="dblclick"
          :highlighted-row-key="editingIdxKey ?? undefined"
          :context-menu-items="
            (row) =>
              row
                ? [
                    {
                      key: 'remove',
                      label: t('modules.oracle.design.remove'),
                      icon: 'trash-2',
                      danger: true,
                    },
                  ]
                : []
          "
          @row-click="(row) => { editingIdxKey = String(row.__rowKey); editingColKey = null; editingFkKey = null }"
          @cell-edit-commit="onIdxCommit"
          @context-menu-select="(key, row) => key === 'remove' && row && removeIdx(String(row.__rowKey))"
        />
      </template>

      <template v-else>
        <RsTable
          class="nm-oracle-design__grid"
          :columns="fkColumns"
          :data="displayForeignKeys"
          row-key="__rowKey"
          size="sm"
          striped
          fill
          bordered
          column-bordered
          editable
          :edit-gutter="false"
          edit-trigger="dblclick"
          :highlighted-row-key="editingFkKey ?? undefined"
          :context-menu-items="
            (row) =>
              row
                ? [
                    {
                      key: 'remove',
                      label: t('modules.oracle.design.remove'),
                      icon: 'trash-2',
                      danger: true,
                    },
                  ]
                : []
          "
          @row-click="(row) => { editingFkKey = String(row.__rowKey); editingColKey = null; editingIdxKey = null }"
          @cell-edit-start="onFkEditStart"
          @cell-edit-commit="onFkCommit"
          @context-menu-select="(key, row) => key === 'remove' && row && removeFk(String(row.__rowKey))"
        />
      </template>
    </template>

    <template #editor>
      <template v-if="activeSection === 'columns' && editingCol">
        <div class="nm-oracle-design__editor-title">{{ t('modules.oracle.design.editColumn') }}</div>
        <div class="nm-oracle-design__form">
          <div class="nm-oracle-design__field">
            <label>{{ t('modules.oracle.design.colName') }}</label>
            <RsInput
              :model-value="editingCol.name"
              size="sm"
              @update:model-value="updateColSideField(editingCol!.__rowKey, 'name', String($event ?? ''))"
            />
          </div>
          <div class="nm-oracle-design__field">
            <label>{{ t('modules.oracle.design.colType') }}</label>
            <RsSelect
              :model-value="editingCol.typeBase"
              size="sm"
              :options="typeBaseSelectOptions"
              @update:model-value="updateColSideField(editingCol!.__rowKey, 'typeBase', String($event))"
            />
          </div>
          <div
            v-if="
              dataTypeParamKind(editingCol.typeBase) === 'length' ||
              dataTypeParamKind(editingCol.typeBase) === 'precision'
            "
            class="nm-oracle-design__field"
          >
            <label>{{ t('modules.oracle.design.colLength') }}</label>
            <RsInput
              :model-value="editingCol.typeLength != null ? String(editingCol.typeLength) : ''"
              size="sm"
              @update:model-value="
                updateColSideField(
                  editingCol!.__rowKey,
                  'typeLength',
                  $event === '' || $event == null ? undefined : Number($event),
                )
              "
            />
          </div>
          <div
            v-if="dataTypeParamKind(editingCol.typeBase) === 'precision'"
            class="nm-oracle-design__field"
          >
            <label>{{ t('modules.oracle.design.colScale') }}</label>
            <RsInput
              :model-value="editingCol.typeScale != null ? String(editingCol.typeScale) : ''"
              size="sm"
              @update:model-value="
                updateColSideField(
                  editingCol!.__rowKey,
                  'typeScale',
                  $event === '' || $event == null ? undefined : Number($event),
                )
              "
            />
          </div>
          <div class="nm-oracle-design__field">
            <label>{{ t('modules.oracle.design.colDefault') }}</label>
            <RsInput
              :model-value="editingCol.defaultExpr"
              size="sm"
              :placeholder="t('modules.oracle.design.colDefaultPh')"
              @update:model-value="
                updateColSideField(editingCol!.__rowKey, 'defaultExpr', String($event ?? ''))
              "
            />
          </div>
          <div class="nm-oracle-design__field">
            <label>{{ t('modules.oracle.design.colComment') }}</label>
            <RsInput
              :model-value="editingCol.comment"
              size="sm"
              :placeholder="t('modules.oracle.design.colCommentPh')"
              @update:model-value="
                updateColSideField(editingCol!.__rowKey, 'comment', String($event ?? ''))
              "
            />
          </div>
          <p class="nm-oracle-design__hint">{{ t('modules.oracle.design.gridEditHint') }}</p>
        </div>
      </template>
      <template v-else-if="activeSection === 'indexes' && editingIdx">
        <div class="nm-oracle-design__editor-title">{{ t('modules.oracle.design.editIndex') }}</div>
        <div class="nm-oracle-design__form">
          <div class="nm-oracle-design__field">
            <label>{{ t('modules.oracle.design.idxName') }}</label>
            <RsInput
              :model-value="editingIdx.name"
              size="sm"
              :disabled="editingIdx.primary"
              :placeholder="t('modules.oracle.design.idxNamePh')"
              @update:model-value="
                indexes = indexes.map((i) =>
                  i.__rowKey === editingIdx!.__rowKey && !i.primary
                    ? { ...i, name: String($event ?? '') }
                    : i,
                )
              "
            />
          </div>
          <div class="nm-oracle-design__field">
            <label>{{ t('modules.oracle.design.idxKind') }}</label>
            <RsInput
              :model-value="
                editingIdx.primary
                  ? t('modules.oracle.design.idxKindPrimary')
                  : editingIdx.unique
                    ? t('modules.oracle.design.idxKindUnique')
                    : t('modules.oracle.design.idxKindNormal')
              "
              size="sm"
              disabled
            />
          </div>
          <div class="nm-oracle-design__field">
            <label>{{ t('modules.oracle.design.idxMethod') }}</label>
            <RsSelect
              :model-value="editingIdx.method || 'NORMAL'"
              size="sm"
              :disabled="editingIdx.primary"
              :options="indexMethodOptions"
              @update:model-value="
                indexes = indexes.map((i) =>
                  i.__rowKey === editingIdx!.__rowKey && !i.primary
                    ? { ...i, method: String($event || 'NORMAL') }
                    : i,
                )
              "
            />
          </div>
        </div>
      </template>
      <template v-else-if="activeSection === 'foreignKeys' && editingFk">
        <div class="nm-oracle-design__editor-title">{{ t('modules.oracle.design.editForeignKey') }}</div>
        <div class="nm-oracle-design__form">
          <div class="nm-oracle-design__field">
            <label>{{ t('modules.oracle.design.fkOnDelete') }}</label>
            <RsSelect
              :model-value="editingFk.onDelete"
              size="sm"
              :options="fkActionOptions"
              @update:model-value="
                foreignKeys = foreignKeys.map((f) =>
                  f.__rowKey === editingFk!.__rowKey
                    ? { ...f, onDelete: String($event) }
                    : f,
                )
              "
            />
          </div>
        </div>
      </template>
      <div v-else class="nm-oracle-design__editor-empty">
        <RsEmpty
          fill
          radius="none"
          icon-radius="none"
          :description="t('modules.oracle.design.selectRow')"
        />
      </div>
    </template>
  </TableDesignShell>
</template>

<style scoped>
.nm-oracle-design__meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.nm-oracle-design__meta-row--full {
  flex: 1;
  min-width: 240px;
}
.nm-oracle-design__meta-label {
  font-size: 12px;
  color: var(--rs-fg-muted);
  white-space: nowrap;
  min-width: 60px;
}
.nm-oracle-design__meta-readonly {
  font-size: 12px;
  font-weight: 500;
  min-width: 80px;
}
.nm-oracle-design__grid {
  flex: 1;
  min-height: 0;
}
.nm-oracle-design__editor-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--rs-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.nm-oracle-design__editor-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nm-oracle-design__form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nm-oracle-design__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.nm-oracle-design__field label {
  font-size: 11px;
  color: var(--rs-fg-muted);
}
.nm-oracle-design__field--check {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.nm-oracle-design__hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--rs-fg-muted);
  line-height: 1.4;
}
</style>
