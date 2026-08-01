<script setup lang="ts">
/**
 * Kingbase 表设计器：挂载公共 TableDesignShell，方言负责草稿 / RPC / 类型目录。
 * 对齐 Navicat / DBeaver：默认列、CREATE 预览、外键 schema 选择、网格编辑、列拖拽。
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
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { kingbaseApi } from '@/api'
import type {
  KingbaseColumnInfo,
  KingbaseConstraintInfo,
} from '@/api/types/kingbase'
import {
  TableDesignPreviewPopover,
  TableDesignShell,
  type TableDesignSection,
  type TableDesignSectionItem,
  type TableDesignShellLabels,
} from '@/modules/database'
import { patchCategoryObjectCount, refreshResourceIfLoaded } from '@/modules/ops/composables/useConnTreeChildren'
import type { ConnItem } from '@/modules/ops/types'
import { formatSql } from '@/modules/sql-editor/format'
import { useTabStore } from '@/stores/tab'
import {
  addDraftCheck,
  addDraftColumn,
  addDraftForeignKey,
  addDraftIndex,
  applyPrimaryIndexToColumns,
  buildAlterDesignOps,
  buildCreateChecks,
  buildCreateColumns,
  buildCreateForeignKeys,
  buildCreateIndexes,
  syncPrimaryIndexFromColumns,
  toCheckDrafts,
  toDesignRows,
  toForeignKeyDrafts,
  toIndexDrafts,
} from '@/modules/kingbase/utils/table-design-ops'
import {
  dataTypeParamKind,
  defaultCreateTableColumns,
  joinColumnList,
  normalizeIndexMethod,
  parseColumnList,
  syncColumnDataType,
  KINGBASE_BASE_TYPE_OPTIONS,
  KINGBASE_INDEX_METHODS,
  type DesignCheckDraft,
  type DesignColumnDraft,
  type DesignForeignKeyDraft,
  type DesignIndexDraft,
  resolveBaseTypeOption,
} from '@/modules/kingbase/utils/table-design'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  table?: string
  designMode?: 'create' | 'alter'
  active: boolean
  sessionLabel?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const activeSection = ref<TableDesignSection>('columns')

const isCreate = computed(() => props.designMode === 'create')
const loading = ref(false)
const saving = ref(false)
const showPreview = ref(false)
const previewLoading = ref(false)
const snapshot = ref<KingbaseColumnInfo[]>([])
const pkSnapshot = ref<string[]>([])
const constraints = ref<KingbaseConstraintInfo[]>([])
const rows = ref<DesignColumnDraft[]>([])
const indexes = ref<DesignIndexDraft[]>([])
const foreignKeys = ref<DesignForeignKeyDraft[]>([])
const checks = ref<DesignCheckDraft[]>([])
const previewSqls = ref<string[]>([])
const draftTableName = ref(props.table?.trim() || 'new_table')
const tableComment = ref('')
const tableCommentSnapshot = ref('')
const createdAsAlter = ref(false)
const effectiveTableName = ref(props.table ?? '')

const editingColKey = ref<string | null>(null)
const editingIdxKey = ref<string | null>(null)
const editingFkKey = ref<string | null>(null)
const editingChkKey = ref<string | null>(null)

const modeCreate = computed(() => isCreate.value && !createdAsAlter.value)
const designMode = computed<'create' | 'alter'>(() => (modeCreate.value ? 'create' : 'alter'))
const tableName = computed(() =>
  modeCreate.value ? draftTableName.value.trim() : effectiveTableName.value || props.table || '',
)

type ColRow = DesignColumnDraft & { status: string } & Record<string, unknown>
type IdxRow = DesignIndexDraft & { status: string } & Record<string, unknown>
type FkRow = DesignForeignKeyDraft & { status: string } & Record<string, unknown>
type ChkRow = DesignCheckDraft & { status: string } & Record<string, unknown>

const FK_ACTION_OPTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']

const typeBaseSelectOptions = KINGBASE_BASE_TYPE_OPTIONS.map((o) => ({
  value: o.base,
  label: o.base,
}))

const indexMethodSelectOptions = KINGBASE_INDEX_METHODS.map((v) => ({ value: v, label: v }))

/** 本表当前草稿列，供索引 / 外键多选 */
const draftColumnSelectOptions = computed(() =>
  rows.value
    .filter((r) => !r.removed && r.name.trim())
    .map((r) => {
      const name = r.name.trim()
      return { value: name, label: name }
    }),
)

/** 外键引用：schema / 表 / 列选项缓存（按需拉取） */
const schemaSelectOptions = ref<RsSelectOptions>([])
const tablesBySchema = ref(new Map<string, RsSelectOptions>())
const columnsByRelation = ref(new Map<string, RsSelectOptions>())

function relationCacheKey(schema: string, table: string): string {
  return `${schema.trim()}.${table.trim()}`
}

function toNameOptions(names: string[]): RsSelectOptions {
  return names.filter(Boolean).map((name) => ({ value: name, label: name }))
}

async function ensureSchemasLoaded(): Promise<void> {
  if (!props.sessionId || schemaSelectOptions.value.length > 0) return
  try {
    const result = await kingbaseApi.treeSchemas({
      sessionId: props.sessionId,
      database: props.database,
    })
    schemaSelectOptions.value = toNameOptions((result.schemas ?? []).map((s) => s.name))
  } catch {
    /* 下拉可手输 */
  }
}

async function ensureTablesLoaded(schema: string): Promise<void> {
  const sch = schema.trim() || props.schema?.trim() || ''
  if (!props.sessionId || !sch || tablesBySchema.value.has(sch)) return
  try {
    const result = await kingbaseApi.treeTables({
      sessionId: props.sessionId,
      database: props.database,
      schema: sch,
      types: ['table'],
      limit: 500,
    })
    const next = new Map(tablesBySchema.value)
    next.set(sch, toNameOptions((result.tables ?? []).map((t) => t.name)))
    tablesBySchema.value = next
  } catch {
    const next = new Map(tablesBySchema.value)
    next.set(sch, [])
    tablesBySchema.value = next
  }
}

async function ensureRefColumnsLoaded(schema: string, table: string): Promise<void> {
  const sch = schema.trim() || props.schema?.trim() || ''
  const tbl = table.trim()
  if (!props.sessionId || !sch || !tbl) return
  const key = relationCacheKey(sch, tbl)
  if (columnsByRelation.value.has(key)) return
  try {
    const [cols, pk] = await Promise.all([
      kingbaseApi.metaColumns({
        sessionId: props.sessionId,
        database: props.database,
        schema: sch,
        table: tbl,
      }),
      kingbaseApi.metaPrimaryKey({
        sessionId: props.sessionId,
        database: props.database,
        schema: sch,
        table: tbl,
      }),
    ])
    const pkSet = new Set(pk.columns ?? [])
    const names = (cols.columns ?? []).map((c) => c.name)
    names.sort((a, b) => {
      const ap = pkSet.has(a) ? 0 : 1
      const bp = pkSet.has(b) ? 0 : 1
      return ap - bp || a.localeCompare(b)
    })
    const next = new Map(columnsByRelation.value)
    next.set(key, toNameOptions(names))
    columnsByRelation.value = next
  } catch {
    const next = new Map(columnsByRelation.value)
    next.set(key, [])
    columnsByRelation.value = next
  }
}

async function prefetchFkCatalog(): Promise<void> {
  await ensureSchemasLoaded()
  const sch = props.schema?.trim()
  if (sch) await ensureTablesLoaded(sch)
  // 已有外键：预热引用表列
  for (const fk of foreignKeys.value) {
    if (fk.removed) continue
    const refSch = fk.refSchema.trim() || sch || ''
    if (fk.refTable.trim()) {
      void ensureTablesLoaded(refSch)
      void ensureRefColumnsLoaded(refSch, fk.refTable)
    }
  }
}

function isDefaultIndexName(name: string): boolean {
  return !name.trim() || /^idx_col_\d+$/i.test(name.trim())
}

function suggestIndexName(columnsText: string, fallback: string): string {
  const cols = parseColumnList(columnsText)
  if (cols.length === 0) return fallback
  const joined = cols.join('_').slice(0, 48)
  return `idx_${joined}`
}

function isDefaultFkName(name: string): boolean {
  return !name.trim() || /^fk_col_\d+$/i.test(name.trim())
}

function suggestFkName(columnsText: string, fallback: string): string {
  const cols = parseColumnList(columnsText)
  if (cols.length === 0) return fallback
  return `fk_${cols.join('_').slice(0, 48)}`
}

const fkActionSelectOptions = FK_ACTION_OPTIONS.map((v) => ({ value: v, label: v }))

const columnColumns = computed((): RsTableColumn<ColRow>[] => {
  const cols: RsTableColumn<ColRow>[] = [
    { key: 'name', title: t('modules.kingbase.design.colName'), minWidth: 110, editable: true },
    {
      key: 'typeBase',
      title: t('modules.kingbase.design.colType'),
      minWidth: 120,
      editable: true,
      valueType: 'select',
      editorOptions: {
        options: typeBaseSelectOptions,
        searchable: true,
        creatable: true,
      },
    },
    {
      key: 'typeLength',
      title: t('modules.kingbase.design.colLength'),
      width: 72,
      align: 'center',
      /* 仅 length / precision 类类型可改；BIGINT 等灰态，避免「空着却点不进去」的错觉 */
      editable: (row) => {
        const kind = dataTypeParamKind(row.typeBase)
        return kind === 'length' || kind === 'precision'
      },
      valueType: 'number',
    },
    {
      key: 'typeScale',
      title: t('modules.kingbase.design.colScale'),
      width: 72,
      align: 'center',
      editable: (row) => dataTypeParamKind(row.typeBase) === 'precision',
      valueType: 'number',
    },
    {
      key: 'primaryKey',
      title: t('modules.kingbase.design.colPk'),
      width: 52,
      align: 'center',
      editable: true,
      valueType: 'boolean',
    },
    {
      key: 'nullable',
      title: t('modules.kingbase.design.colNullable'),
      width: 52,
      align: 'center',
      editable: true,
      valueType: 'boolean',
    },
    {
      key: 'defaultExpr',
      title: t('modules.kingbase.design.colDefault'),
      minWidth: 120,
      editable: true,
      ellipsis: true,
    },
    {
      key: 'comment',
      title: t('modules.kingbase.design.colComment'),
      minWidth: 100,
      editable: true,
      ellipsis: true,
    },
  ]
  if (!modeCreate.value) {
    cols.push({
      key: 'status',
      title: t('modules.kingbase.design.colStatus'),
      width: 72,
      align: 'center',
    })
  }
  return cols
})

const indexColumns = computed((): RsTableColumn<IdxRow>[] => {
  const colOptions = draftColumnSelectOptions.value
  const cols: RsTableColumn<IdxRow>[] = [
    {
      key: 'name',
      title: t('modules.kingbase.design.idxName'),
      minWidth: 110,
      editable: (row) => !row.primary,
    },
    {
      key: 'kindLabel',
      title: t('modules.kingbase.design.idxKind'),
      width: 88,
      editable: false,
    },
    {
      key: 'columnsText',
      title: t('modules.kingbase.design.idxColumns'),
      minWidth: 160,
      editable: true,
      valueType: 'select',
      headerTip: t('modules.kingbase.design.idxColumnsTip'),
      editorOptions: {
        options: colOptions,
        multiple: true,
        searchable: true,
        clearable: true,
      },
    },
    {
      key: 'method',
      title: t('modules.kingbase.design.idxMethod'),
      width: 88,
      editable: (row) => !row.primary,
      valueType: 'select',
      editorOptions: { options: indexMethodSelectOptions, creatable: true },
    },
    {
      key: 'unique',
      title: t('modules.kingbase.design.idxUnique'),
      width: 64,
      align: 'center',
      editable: (row) => !row.primary,
      valueType: 'boolean',
    },
  ]
  if (!modeCreate.value) {
    cols.push({
      key: 'status',
      title: t('modules.kingbase.design.colStatus'),
      width: 72,
      align: 'center',
    })
  }
  return cols
})

const fkColumns = computed((): RsTableColumn<FkRow>[] => {
  const colOptions = draftColumnSelectOptions.value
  const schemaOpts = schemaSelectOptions.value
  const cols: RsTableColumn<FkRow>[] = [
    { key: 'name', title: t('modules.kingbase.design.fkName'), minWidth: 100, editable: true },
    {
      key: 'columnsText',
      title: t('modules.kingbase.design.fkColumns'),
      minWidth: 120,
      editable: true,
      valueType: 'select',
      headerTip: t('modules.kingbase.design.fkColumnsTip'),
      editorOptions: {
        options: colOptions,
        multiple: true,
        searchable: true,
        creatable: true,
        clearable: true,
      },
    },
    {
      key: 'refSchema',
      title: t('modules.kingbase.design.fkRefSchema'),
      width: 100,
      editable: true,
      valueType: 'select',
      headerTip: t('modules.kingbase.design.fkRefSchemaTip'),
      editorOptions: {
        options: schemaOpts,
        searchable: true,
        creatable: true,
        clearable: false,
      },
    },
    {
      key: 'refTable',
      title: t('modules.kingbase.design.fkRefTable'),
      minWidth: 110,
      editable: true,
      valueType: 'select',
      headerTip: t('modules.kingbase.design.fkRefTableTip'),
      editorOptions: {
        options: (row) => {
          const sch =
            String((row as FkRow).refSchema ?? '').trim() || props.schema?.trim() || ''
          return tablesBySchema.value.get(sch) ?? []
        },
        searchable: true,
        creatable: true,
        clearable: true,
      },
    },
    {
      key: 'refColumnsText',
      title: t('modules.kingbase.design.fkRefColumns'),
      minWidth: 120,
      editable: true,
      valueType: 'select',
      headerTip: t('modules.kingbase.design.fkRefColumnsTip'),
      editorOptions: {
        options: (row) => {
          const fk = row as FkRow
          const sch = fk.refSchema.trim() || props.schema?.trim() || ''
          const tbl = fk.refTable.trim()
          if (!sch || !tbl) return []
          return columnsByRelation.value.get(relationCacheKey(sch, tbl)) ?? []
        },
        multiple: true,
        searchable: true,
        creatable: true,
        clearable: true,
      },
    },
    {
      key: 'onDelete',
      title: t('modules.kingbase.design.fkOnDelete'),
      minWidth: 110,
      editable: true,
      valueType: 'select',
      editorOptions: { options: fkActionSelectOptions },
    },
    {
      key: 'onUpdate',
      title: t('modules.kingbase.design.fkOnUpdate'),
      minWidth: 110,
      editable: true,
      valueType: 'select',
      editorOptions: { options: fkActionSelectOptions },
    },
  ]
  if (!modeCreate.value) {
    cols.push({
      key: 'status',
      title: t('modules.kingbase.design.colStatus'),
      width: 72,
      align: 'center',
    })
  }
  return cols
})

const checkColumns = computed((): RsTableColumn<ChkRow>[] => {
  const cols: RsTableColumn<ChkRow>[] = [
    { key: 'name', title: t('modules.kingbase.design.chkName'), minWidth: 110, editable: true },
    {
      key: 'expression',
      title: t('modules.kingbase.design.chkExpression'),
      minWidth: 220,
      editable: true,
      ellipsis: true,
    },
  ]
  if (!modeCreate.value) {
    cols.push({
      key: 'status',
      title: t('modules.kingbase.design.colStatus'),
      width: 72,
      align: 'center',
    })
  }
  return cols
})

const displayColumns = computed((): ColRow[] =>
  rows.value
    .filter((r) => !r.removed)
    .map((r) => ({
      ...r,
      status: !r.originalName
        ? t('modules.kingbase.design.statusNew')
        : r.name !== r.originalName
          ? t('modules.kingbase.design.statusRename')
          : t('modules.kingbase.design.statusEdit'),
    })),
)

function indexStatus(r: DesignIndexDraft): string {
  if (r.primary) return t('modules.kingbase.design.idxPrimary')
  if (!r.originalName) return t('modules.kingbase.design.statusNew')
  const changed =
    r.name !== r.snapName ||
    r.columnsText !== r.snapColumnsText ||
    r.expression !== r.snapExpression ||
    r.whereText !== r.snapWhereText ||
    r.unique !== r.snapUnique ||
    normalizeIndexMethod(r.method) !== normalizeIndexMethod(r.snapMethod)
  return changed
    ? t('modules.kingbase.design.statusEdit')
    : t('modules.kingbase.design.statusUnchanged')
}

function fkStatus(r: DesignForeignKeyDraft): string {
  if (!r.originalName) return t('modules.kingbase.design.statusNew')
  const changed =
    r.name !== r.snapName ||
    r.columnsText !== r.snapColumnsText ||
    r.refSchema !== r.snapRefSchema ||
    r.refTable !== r.snapRefTable ||
    r.refColumnsText !== r.snapRefColumnsText ||
    r.onDelete !== r.snapOnDelete ||
    r.onUpdate !== r.snapOnUpdate
  return changed
    ? t('modules.kingbase.design.statusEdit')
    : t('modules.kingbase.design.statusUnchanged')
}

function checkStatus(r: DesignCheckDraft): string {
  if (!r.originalName) return t('modules.kingbase.design.statusNew')
  const changed = r.name !== r.snapName || r.expression !== r.snapExpression
  return changed
    ? t('modules.kingbase.design.statusEdit')
    : t('modules.kingbase.design.statusUnchanged')
}

const displayIndexes = computed((): IdxRow[] =>
  indexes.value
    .filter((r) => !r.removed)
    .map((r) => ({
      ...r,
      kindLabel: r.primary
        ? t('modules.kingbase.design.idxKindPrimary')
        : r.unique
          ? t('modules.kingbase.design.idxKindUnique')
          : t('modules.kingbase.design.idxKindNormal'),
      status: indexStatus(r),
    })),
)

const displayForeignKeys = computed((): FkRow[] =>
  foreignKeys.value
    .filter((r) => !r.removed)
    .map((r) => ({
      ...r,
      status: fkStatus(r),
    })),
)

const displayChecks = computed((): ChkRow[] =>
  checks.value
    .filter((r) => !r.removed)
    .map((r) => ({
      ...r,
      status: checkStatus(r),
    })),
)

const shellLabels = computed<TableDesignShellLabels>(() => ({
  reload: t('modules.kingbase.design.reload'),
  preview: t('modules.kingbase.design.preview'),
  create: t('modules.kingbase.design.createTable'),
  apply: t('modules.kingbase.design.apply'),
  previewTitle: t('modules.kingbase.design.previewTitle'),
  selectRow: t('modules.kingbase.design.selectRow'),
  copyPreview: t('modules.kingbase.design.copyPreview'),
  moveUp: t('modules.kingbase.design.moveUp'),
  moveDown: t('modules.kingbase.design.moveDown'),
  add: t('modules.kingbase.design.addColumn'),
}))

const title = computed(() =>
  modeCreate.value
    ? t('modules.kingbase.design.createTitle')
    : t('modules.kingbase.design.alterTitle', { name: tableName.value }),
)

const sections = computed<TableDesignSectionItem[]>(() => [
  {
    id: 'columns',
    label: t('modules.kingbase.design.tabColumns'),
    count: displayColumns.value.length,
  },
  {
    id: 'indexes',
    label: t('modules.kingbase.design.tabIndexes'),
    count: displayIndexes.value.length,
  },
  {
    id: 'foreignKeys',
    label: t('modules.kingbase.design.tabForeignKeys'),
    count: displayForeignKeys.value.length,
  },
  {
    id: 'checks',
    label: t('modules.kingbase.design.tabChecks'),
    count: displayChecks.value.length,
  },
])

const scopeOk = computed(() => {
  if (!props.sessionId || !props.schema) return false
  if (modeCreate.value) return draftTableName.value.trim().length > 0
  return !!tableName.value
})

const addButtonLabel = computed(() => {
  if (activeSection.value === 'indexes') return t('modules.kingbase.design.addIndex')
  if (activeSection.value === 'foreignKeys') return t('modules.kingbase.design.addForeignKey')
  if (activeSection.value === 'checks') return t('modules.kingbase.design.addCheck')
  return t('modules.kingbase.design.addColumn')
})

const editingCol = computed(
  () => rows.value.find((c) => c.__rowKey === editingColKey.value) ?? null,
)
const editingIdx = computed(
  () => indexes.value.find((i) => i.__rowKey === editingIdxKey.value) ?? null,
)
const editingFk = computed(
  () => foreignKeys.value.find((f) => f.__rowKey === editingFkKey.value) ?? null,
)
const editingChk = computed(
  () => checks.value.find((c) => c.__rowKey === editingChkKey.value) ?? null,
)

function parseYesNo(draft: string, fallback: boolean): boolean {
  const lower = draft.trim().toLowerCase()
  if (!lower) return fallback
  if (['yes', 'y', 'true', '1', '是', '✓', '✔', '√'].includes(lower)) return true
  if (['no', 'n', 'false', '0', '否', '-', '—'].includes(lower)) return false
  return fallback
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  return parseYesNo(String(value ?? ''), fallback)
}

function baseLooksTemporal(base: string): boolean {
  const u = base.trim().toUpperCase()
  return u === 'TIME' || u === 'TIMESTAMP' || u === 'TIMESTAMPTZ' || u.startsWith('TIMESTAMP')
}

/** NUMERIC/DECIMAL：保证 scale ∈ [0, precision]。 */
function clampPrecisionPair(
  precisionRaw: string,
  scaleRaw: string,
): { precision: string; scale: string } {
  const p = Number(precisionRaw)
  const s = Number(scaleRaw)
  const precision = Number.isFinite(p) && p > 0 ? Math.floor(p) : 18
  let scale = Number.isFinite(s) && s >= 0 ? Math.floor(s) : 0
  if (scale > precision) scale = precision
  return { precision: String(precision), scale: String(scale) }
}

function initCreateDraft(): void {
  draftTableName.value = props.table?.trim() || 'new_table'
  tableComment.value = ''
  tableCommentSnapshot.value = ''
  rows.value = defaultCreateTableColumns()
  indexes.value = syncPrimaryIndexFromColumns([], rows.value)
  foreignKeys.value = []
  checks.value = []
  snapshot.value = []
  pkSnapshot.value = []
  constraints.value = []
  previewSqls.value = []
  createdAsAlter.value = false
  effectiveTableName.value = ''
  activeSection.value = 'columns'
  editingColKey.value = null
  editingIdxKey.value = null
  editingFkKey.value = null
  editingChkKey.value = null
}

function clearFkCatalogCache(): void {
  schemaSelectOptions.value = []
  tablesBySchema.value = new Map()
  columnsByRelation.value = new Map()
}

/** 合并并发 loadDesign（创建后 watch + apply 会各触发一次）。 */
let loadDesignInflight: Promise<void> | null = null

async function loadDesign(): Promise<void> {
  if (modeCreate.value) {
    initCreateDraft()
    void prefetchFkCatalog()
    return
  }
  if (loadDesignInflight) return loadDesignInflight
  loadDesignInflight = (async () => {
    const name = tableName.value
    if (!props.sessionId || !props.schema || !name) return
    loading.value = true
    try {
      const [cols, pk, idx, fks, cons] = await Promise.all([
        kingbaseApi.metaColumns({
          sessionId: props.sessionId,
          database: props.database,
          schema: props.schema,
          table: name,
        }),
        kingbaseApi.metaPrimaryKey({
          sessionId: props.sessionId,
          database: props.database,
          schema: props.schema,
          table: name,
        }),
        kingbaseApi.metaIndexes({
          sessionId: props.sessionId,
          database: props.database,
          schema: props.schema,
          table: name,
        }),
        kingbaseApi.metaForeignKeys({
          sessionId: props.sessionId,
          database: props.database,
          schema: props.schema,
          table: name,
        }),
        kingbaseApi.metaConstraints({
          sessionId: props.sessionId,
          database: props.database,
          schema: props.schema,
          table: name,
        }),
      ])
      snapshot.value = cols.columns
      tableComment.value = cols.tableComment ?? ''
      tableCommentSnapshot.value = cols.tableComment ?? ''
      pkSnapshot.value = pk.columns ?? []
      constraints.value = cons.constraints ?? []
      rows.value = toDesignRows(cols.columns, pk.columns ?? [])
      indexes.value = toIndexDrafts(idx.indexes ?? [], pk.columns ?? [])
      foreignKeys.value = toForeignKeyDrafts(fks.foreignKeys ?? [])
      checks.value = toCheckDrafts(cons.constraints ?? [])
      previewSqls.value = []
      editingColKey.value = null
      editingIdxKey.value = null
      editingFkKey.value = null
      editingChkKey.value = null
      void prefetchFkCatalog()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.kingbase.design.loadError'))
    } finally {
      loading.value = false
    }
  })().finally(() => {
    loadDesignInflight = null
  })
  return loadDesignInflight
}

function clearEditingKeys(): void {
  editingColKey.value = null
  editingIdxKey.value = null
  editingFkKey.value = null
  editingChkKey.value = null
}

function onAdd(): void {
  if (activeSection.value === 'indexes') {
    indexes.value = addDraftIndex(indexes.value)
    const last = indexes.value[indexes.value.length - 1]
    clearEditingKeys()
    if (last) editingIdxKey.value = last.__rowKey
    return
  }
  if (activeSection.value === 'foreignKeys') {
    foreignKeys.value = addDraftForeignKey(foreignKeys.value, props.schema || 'public')
    const last = foreignKeys.value[foreignKeys.value.length - 1]
    clearEditingKeys()
    if (last) editingFkKey.value = last.__rowKey
    void prefetchFkCatalog()
    return
  }
  if (activeSection.value === 'checks') {
    checks.value = addDraftCheck(checks.value)
    const last = checks.value[checks.value.length - 1]
    clearEditingKeys()
    if (last) editingChkKey.value = last.__rowKey
    return
  }
  rows.value = addDraftColumn(rows.value)
  const last = rows.value[rows.value.length - 1]
  clearEditingKeys()
  if (last) editingColKey.value = last.__rowKey
}

function markColumnRemoved(rowKey: string): void {
  rows.value = rows.value.map((r) =>
    r.__rowKey === rowKey ? { ...r, removed: true } : r,
  )
  if (editingColKey.value === rowKey) editingColKey.value = null
}

function markIndexRemoved(rowKey: string): void {
  indexes.value = indexes.value.map((r) =>
    r.__rowKey === rowKey && !r.primary ? { ...r, removed: true } : r,
  )
  if (editingIdxKey.value === rowKey) editingIdxKey.value = null
}

function markForeignKeyRemoved(rowKey: string): void {
  foreignKeys.value = foreignKeys.value.map((r) =>
    r.__rowKey === rowKey ? { ...r, removed: true } : r,
  )
  if (editingFkKey.value === rowKey) editingFkKey.value = null
}

function markCheckRemoved(rowKey: string): void {
  checks.value = checks.value.map((r) =>
    r.__rowKey === rowKey ? { ...r, removed: true } : r,
  )
  if (editingChkKey.value === rowKey) editingChkKey.value = null
}

function moveSelectedColumn(delta: -1 | 1): void {
  if (activeSection.value !== 'columns' || !editingColKey.value) return
  const visible = rows.value.filter((c) => !c.removed)
  const idx = visible.findIndex((c) => c.__rowKey === editingColKey.value)
  const target = idx + delta
  if (idx < 0 || target < 0 || target >= visible.length) return
  const reordered = [...visible]
  const [moved] = reordered.splice(idx, 1)
  if (!moved) return
  reordered.splice(target, 0, moved)
  const removed = rows.value.filter((c) => c.removed)
  rows.value = [...reordered, ...removed]
}

function onColumnRowDrop(
  dragKeys: string[],
  dropKey: string,
  position: RsTableRowDropPosition,
): void {
  const dragKey = dragKeys[0]
  if (!dragKey || dragKey === dropKey) return
  const visible = rows.value.filter((c) => !c.removed)
  const dragIndex = visible.findIndex((c) => c.__rowKey === dragKey)
  const dropIndex = visible.findIndex((c) => c.__rowKey === dropKey)
  if (dragIndex < 0 || dropIndex < 0) return
  const reordered = reorderTableRows(visible, dragIndex, dropIndex, position)
  const removed = rows.value.filter((c) => c.removed)
  rows.value = [...reordered, ...removed]
}

function updateColSideField<K extends keyof DesignColumnDraft>(
  key: string,
  field: K,
  value: DesignColumnDraft[K],
): void {
  rows.value = rows.value.map((r) => {
    if (r.__rowKey !== key) return r
    const updated = { ...r, [field]: value }
    if (field === 'typeBase' || field === 'typeLength' || field === 'typeScale') {
      if (field === 'typeBase') {
        const nextBase = String(value || r.typeBase)
        const kind = dataTypeParamKind(nextBase)
        const opt = resolveBaseTypeOption(nextBase)
        let typeLength = updated.typeLength
        let typeScale = updated.typeScale
        if (kind === 'none') {
          typeLength = ''
          typeScale = ''
        } else if (kind === 'length') {
          typeScale = ''
          if (!typeLength && opt?.defaultLength != null) typeLength = String(opt.defaultLength)
        } else if (kind === 'precision') {
          if (!typeLength) typeLength = String(opt?.defaultPrecision ?? 18)
          if (!typeScale) typeScale = String(opt?.defaultScale ?? 2)
          const clamped = clampPrecisionPair(typeLength, typeScale)
          typeLength = clamped.precision
          typeScale = clamped.scale
        }
        updated.typeBase = nextBase
        updated.typeLength = typeLength
        updated.typeScale = typeScale
      }
      updated.dataType = syncColumnDataType(updated)
    }
    if (field === 'primaryKey' && value) updated.nullable = false
    return updated
  })
}

function onColCommit(
  row: ColRow,
  column: RsTableColumn<ColRow>,
  _i: number,
  value: unknown,
): void {
  const key = String(column.key)
  const draft = String(value ?? '').trim()
  rows.value = rows.value.map((r) => {
    if (r.__rowKey !== row.__rowKey) return r
    if (key === 'name') return { ...r, name: draft || r.name }
    if (key === 'typeBase') {
      const nextBase = draft || r.typeBase
      const kind = dataTypeParamKind(nextBase)
      const opt = resolveBaseTypeOption(nextBase)
      let typeLength = r.typeLength
      let typeScale = r.typeScale
      if (kind === 'none') {
        typeLength = ''
        typeScale = ''
      } else if (kind === 'length') {
        typeScale = ''
        // 仅当类型声明了 defaultLength（如 CHAR）时才自动填；VARCHAR/TIME/TIMESTAMP 可留空
        if (!typeLength && opt?.defaultLength != null) {
          typeLength = String(opt.defaultLength)
        }
        // 从 NUMERIC 切到 TIMESTAMP 等时，清掉过大的无意义精度残留
        if (typeLength && opt?.defaultLength == null) {
          const n = Number(typeLength)
          if (baseLooksTemporal(nextBase) && Number.isFinite(n) && n > 6) typeLength = ''
        }
      } else if (kind === 'precision') {
        if (!typeLength) typeLength = String(opt?.defaultPrecision ?? 18)
        if (!typeScale) typeScale = String(opt?.defaultScale ?? 2)
        const clamped = clampPrecisionPair(typeLength, typeScale)
        typeLength = clamped.precision
        typeScale = clamped.scale
      }
      const parts = { typeBase: nextBase, typeLength, typeScale }
      return { ...r, ...parts, dataType: syncColumnDataType(parts) }
    }
    if (key === 'typeLength') {
      const kind = dataTypeParamKind(r.typeBase)
      let typeLength = draft
      let typeScale = r.typeScale
      if (kind === 'precision') {
        const clamped = clampPrecisionPair(typeLength, typeScale)
        typeLength = clamped.precision
        typeScale = clamped.scale
      }
      const parts = { typeBase: r.typeBase, typeLength, typeScale }
      return { ...r, ...parts, dataType: syncColumnDataType(parts) }
    }
    if (key === 'typeScale') {
      const clamped = clampPrecisionPair(r.typeLength, draft)
      const parts = {
        typeBase: r.typeBase,
        typeLength: clamped.precision,
        typeScale: clamped.scale,
      }
      return { ...r, ...parts, dataType: syncColumnDataType(parts) }
    }
    if (key === 'defaultExpr') return { ...r, defaultExpr: draft }
    if (key === 'comment') return { ...r, comment: draft }
    if (key === 'nullable') return { ...r, nullable: asBool(value, r.nullable) }
    if (key === 'primaryKey') {
      const pk = asBool(value, r.primaryKey)
      return { ...r, primaryKey: pk, nullable: pk ? false : r.nullable }
    }
    return r
  })
  // 栏位主键 ↔ 索引 PRIMARY（对齐 Navicat / MySQL / 达梦）
  if (key === 'primaryKey' || key === 'name') {
    indexes.value = syncPrimaryIndexFromColumns(indexes.value, rows.value)
  }
}

function multiSelectText(value: unknown): string {
  if (Array.isArray(value)) return joinColumnList(value.map(String))
  return String(value ?? '').trim()
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

  // PRIMARY：名称/唯一/方法不可改；改列清单回写栏位主键勾选
  if (current.primary) {
    if (key === 'name' || key === 'unique' || key === 'method') return
    if (key === 'columnsText') {
      const columnsText = multiSelectText(value)
      indexes.value = indexes.value.map((r) =>
        r.__rowKey === row.__rowKey
          ? {
              ...r,
              columnsText,
              unique: true,
              primary: true,
              expression: '',
            }
          : r,
      )
      rows.value = applyPrimaryIndexToColumns(rows.value, columnsText)
    }
    return
  }

  indexes.value = indexes.value.map((r) => {
    if (r.__rowKey !== row.__rowKey) return r
    if (key === 'name') return { ...r, name: String(value ?? '').trim() || r.name }
    if (key === 'columnsText') {
      const columnsText = multiSelectText(value)
      const name = isDefaultIndexName(r.name) ? suggestIndexName(columnsText, r.name || 'idx') : r.name
      return {
        ...r,
        name,
        columnsText,
        expression: columnsText ? '' : r.expression,
      }
    }
    if (key === 'method') return { ...r, method: normalizeIndexMethod(String(value ?? '') || r.method) }
    if (key === 'unique') return { ...r, unique: asBool(value, r.unique) }
    return r
  })
}

function normalizeActionInput(draft: string, fallback: string): string {
  const upper = draft.trim().toUpperCase()
  if (!upper) return fallback
  return FK_ACTION_OPTIONS.includes(upper) ? upper : fallback
}

function onFkCommit(row: FkRow, column: RsTableColumn<FkRow>, _i: number, value: unknown): void {
  const key = String(column.key)
  const draft = String(value ?? '').trim()
  foreignKeys.value = foreignKeys.value.map((r) => {
    if (r.__rowKey !== row.__rowKey) return r
    if (key === 'name') return { ...r, name: draft }
    if (key === 'columnsText') {
      const name = isDefaultFkName(r.name) ? suggestFkName(draft, r.name) : r.name
      return { ...r, name, columnsText: draft }
    }
    if (key === 'refSchema') {
      const schema = draft || r.refSchema || props.schema || 'public'
      void ensureTablesLoaded(schema)
      // 换 schema 后旧表可能无效，清空表与引用列
      if (schema !== r.refSchema) {
        return { ...r, refSchema: schema, refTable: '', refColumnsText: '' }
      }
      return { ...r, refSchema: schema }
    }
    if (key === 'refTable') {
      const schema = r.refSchema.trim() || props.schema || 'public'
      if (draft) void ensureRefColumnsLoaded(schema, draft)
      if (draft !== r.refTable) {
        return { ...r, refTable: draft, refColumnsText: '' }
      }
      return { ...r, refTable: draft }
    }
    if (key === 'refColumnsText') return { ...r, refColumnsText: draft }
    if (key === 'onDelete') return { ...r, onDelete: normalizeActionInput(draft, r.onDelete) }
    if (key === 'onUpdate') return { ...r, onUpdate: normalizeActionInput(draft, r.onUpdate) }
    return r
  })
}

function onFkEditStart(row: FkRow, column: RsTableColumn<FkRow>): void {
  const key = String(column.key)
  const schema = row.refSchema.trim() || props.schema?.trim() || ''
  if (key === 'refSchema') {
    void ensureSchemasLoaded()
    return
  }
  if (key === 'refTable') {
    void ensureTablesLoaded(schema)
    return
  }
  if (key === 'refColumnsText' && row.refTable.trim()) {
    void ensureRefColumnsLoaded(schema, row.refTable)
  }
}

function onChkCommit(
  row: ChkRow,
  column: RsTableColumn<ChkRow>,
  _i: number,
  value: unknown,
): void {
  const key = String(column.key)
  const draft = String(value ?? '').trim()
  checks.value = checks.value.map((r) => {
    if (r.__rowKey !== row.__rowKey) return r
    if (key === 'name') return { ...r, name: draft || r.name }
    if (key === 'expression') return { ...r, expression: draft }
    return r
  })
}

function alterOps() {
  return buildAlterDesignOps({
    tableName: tableName.value,
    rows: rows.value,
    snapshot: snapshot.value,
    pkSnapshot: pkSnapshot.value,
    indexes: indexes.value,
    foreignKeys: foreignKeys.value,
    checks: checks.value,
    constraints: constraints.value,
    tableComment: tableComment.value,
    tableCommentSnapshot: tableCommentSnapshot.value,
  })
}

function formatPreviewSqls(sqls: string[]): string[] {
  return sqls.map((s) => {
    const raw = s.trim()
    if (!raw) return raw
    try {
      return formatSql(raw, { dialect: 'kingbase' })
    } catch {
      return raw
    }
  })
}

/** 拉取并格式化预览 SQL；校验失败返回 false。 */
async function loadPreviewSql(): Promise<boolean> {
  if (!props.schema || !scopeOk.value) return false
  try {
    if (modeCreate.value) {
      const columns = buildCreateColumns(rows.value)
      if (columns.length === 0) {
        toast.info(t('modules.kingbase.design.needColumns'))
        return false
      }
      const result = await kingbaseApi.ddlCreateTablePreview({
        sessionId: props.sessionId ?? undefined,
        profileId: props.profileId,
        database: props.database,
        schema: props.schema,
        name: tableName.value,
        columns,
        comment: tableComment.value.trim() || undefined,
        indexes: buildCreateIndexes(indexes.value),
        foreignKeys: buildCreateForeignKeys(foreignKeys.value),
        checks: buildCreateChecks(checks.value),
      })
      previewSqls.value = formatPreviewSqls(result.sql)
      return previewSqls.value.length > 0
    }

    const ops = alterOps()
    if (ops.length === 0) {
      previewSqls.value = [`-- ${t('modules.kingbase.design.noChanges')}`]
      return true
    }
    const result = await kingbaseApi.ddlDesignPreview({
      sessionId: props.sessionId ?? undefined,
      profileId: props.profileId,
      database: props.database,
      schema: props.schema,
      name: tableName.value,
      ops,
    })
    previewSqls.value = formatPreviewSqls(result.sql)
    return previewSqls.value.length > 0
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.kingbase.design.previewError'))
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
    toast.success(t('modules.kingbase.design.copyPreviewOk'))
  } catch {
    toast.error(t('modules.kingbase.design.copyPreviewFailed'))
  }
}

async function refreshTablesCategoryInTree(): Promise<void> {
  if (!props.profileId || !props.database || !props.schema) return
  const conn = { profileId: props.profileId, kind: 'kingbase' } as ConnItem
  const tablesPath = {
    segments: [
      { kind: 'database', name: props.database },
      { kind: 'schema', name: props.schema },
      { kind: 'category', name: 'tables' },
    ],
  }
  await refreshResourceIfLoaded(conn, tablesPath)
  patchCategoryObjectCount(conn, tablesPath, { delta: 1 })
}

/** 创建成功后切到 alter，并按表名更新 Shell Tab 标题（对齐 MySQL）。 */
function switchToAlterAfterCreate(name: string): void {
  effectiveTableName.value = name
  createdAsAlter.value = true
  const tabs = useTabStore()
  const tabId = tabs.activeTabId
  if (!tabId) return
  tabs.updateTabProps(tabId, { designMode: 'alter', table: name })
  tabs.updateTitle(tabId, name)
  const tab = tabs.allTabs.find((item) => item.tabId === tabId)
  if (!tab) return
  const designLabel = t('modules.kingbase.session.tabDesign')
  const base =
    props.database && props.schema
      ? `${props.database}.${props.schema}.${name}`
      : props.schema
        ? `${props.schema}.${name}`
        : name
  const resourcePrefix = `${t('workspace.tabTipResource')}:`
  const featurePrefix = `${t('workspace.tabTipFeature')}:`
  const head = (tab.tooltip ?? '')
    .split('\n')
    .filter(Boolean)
    .filter((line) => !line.startsWith(resourcePrefix) && !line.startsWith(featurePrefix))
  const next = [...head]
  if (base) next.push(`${resourcePrefix} ${base}`)
  next.push(`${featurePrefix} ${designLabel}`)
  tab.tooltip = next.join('\n')
}

async function apply(): Promise<void> {
  if (!props.sessionId || !props.schema || !scopeOk.value) return
  saving.value = true
  try {
    if (modeCreate.value) {
      const columns = buildCreateColumns(rows.value)
      if (columns.length === 0) {
        toast.info(t('modules.kingbase.design.needColumns'))
        return
      }
      const result = await kingbaseApi.ddlCreateTableApply({
        sessionId: props.sessionId,
        profileId: props.profileId,
        database: props.database,
        schema: props.schema,
        name: tableName.value,
        columns,
        comment: tableComment.value.trim() || undefined,
        indexes: buildCreateIndexes(indexes.value),
        foreignKeys: buildCreateForeignKeys(foreignKeys.value),
        checks: buildCreateChecks(checks.value),
      })
      previewSqls.value = formatPreviewSqls(result.sql)
      toast.success(t('modules.kingbase.design.createDone'))
      showPreview.value = false
      await refreshTablesCategoryInTree()
      switchToAlterAfterCreate(tableName.value)
      await loadDesign()
      return
    }

    const ops = alterOps()
    if (ops.length === 0) {
      toast.info(t('modules.kingbase.design.noChanges'))
      return
    }
    const result = await kingbaseApi.ddlDesignApply({
      sessionId: props.sessionId,
      database: props.database,
      schema: props.schema,
      name: tableName.value,
      ops,
    })
    previewSqls.value = formatPreviewSqls(result.sql)
    toast.success(t('modules.kingbase.design.applyDone'))
    await loadDesign()
  } catch (e) {
    toast.error(
      e instanceof Error
        ? e.message
        : modeCreate.value
          ? t('modules.kingbase.design.createError')
          : t('modules.kingbase.design.applyError'),
    )
  } finally {
    saving.value = false
  }
}

watch(
  () => [props.sessionId, props.database] as const,
  () => {
    clearFkCatalogCache()
  },
)

watch(activeSection, (section) => {
  if (section === 'foreignKeys' && props.active) void prefetchFkCatalog()
})

function designScopeKey(): string {
  return [
    props.sessionId ?? '',
    props.database ?? '',
    props.schema ?? '',
    props.table ?? '',
    props.designMode ?? 'alter',
  ].join('\0')
}

let loadedDesignScope = ''

function ensureDesignLoaded(): void {
  if (isCreate.value && !createdAsAlter.value) {
    initCreateDraft()
    void prefetchFkCatalog()
    loadedDesignScope = designScopeKey()
    return
  }
  if (props.schema && (tableName.value || props.table)) {
    void loadDesign().then(() => {
      if (rows.value.length > 0) loadedDesignScope = designScopeKey()
    })
  }
}

/** 仅作用域变化时重拉；keep-alive 切回 Shell Tab 不重复请求。 */
watch(
  () => [props.sessionId, props.database, props.schema, props.table, props.designMode] as const,
  () => {
    if (designScopeKey() !== loadedDesignScope) {
      if (!(isCreate.value && !createdAsAlter.value)) {
        rows.value = []
        indexes.value = []
        foreignKeys.value = []
      }
      loadedDesignScope = ''
    }
    if (!props.active) return
    ensureDesignLoaded()
  },
  { immediate: true },
)

watch(
  () => props.active,
  (active) => {
    if (!active) return
    if (loadedDesignScope === designScopeKey()) {
      if ((isCreate.value && !createdAsAlter.value) || rows.value.length > 0) return
    }
    ensureDesignLoaded()
  },
)
</script>

<template>
  <TableDesignShell
    class="nm-kingbase-design"
    :labels="shellLabels"
    :title="title"
    :mode="designMode"
    :scope-label="sessionLabel"
    :loading="loading"
    :saving="saving"
    :can-preview="scopeOk"
    :can-apply="scopeOk"
    :show-reload="!modeCreate"
    :sections="sections"
    :active-section="activeSection"
    @reload="loadDesign"
    @apply="apply"
    @update:active-section="activeSection = $event"
  >
    <template #preview>
      <TableDesignPreviewPopover
        :open="showPreview"
        :title="shellLabels.previewTitle"
        :sql="previewSqls"
        :loading="previewLoading"
        :copy-label="shellLabels.copyPreview"
        :empty-label="t('modules.kingbase.design.noChanges')"
        @update:open="onPreviewOpenChange"
        @copy="copyPreviewSql"
      >
        <RsButton size="sm" variant="ghost" :disabled="!scopeOk || loading">
          {{ shellLabels.preview }}
        </RsButton>
      </TableDesignPreviewPopover>
    </template>

    <template #toolbar-extra>
      <RsButton size="sm" variant="ghost" icon="plus" :disabled="!scopeOk" @click="onAdd">
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
      <div class="nm-kingbase-design__meta-row">
        <label class="nm-kingbase-design__meta-label">{{ t('modules.kingbase.design.tableName') }}</label>
        <RsInput
          v-if="modeCreate"
          v-model="draftTableName"
          size="sm"
          :placeholder="t('modules.kingbase.design.tableNamePh')"
        />
        <span v-else class="nm-kingbase-design__meta-readonly">{{ tableName }}</span>
      </div>
      <div class="nm-kingbase-design__meta-row nm-kingbase-design__meta-row--full">
        <label class="nm-kingbase-design__meta-label">{{ t('modules.kingbase.design.tableComment') }}</label>
        <RsInput
          v-model="tableComment"
          size="sm"
          :placeholder="t('modules.kingbase.design.tableCommentPh')"
        />
      </div>
    </template>

    <template #list>
      <RsEmpty
        v-if="!schema || (!modeCreate && !tableName)"
        fill
        radius="none"
        icon-radius="none"
        icon="table"
        :description="t('modules.kingbase.structure.needTable')"
      />
      <template v-else-if="activeSection === 'columns'">
        <RsTable
          class="nm-kingbase-design__grid"
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
                      label: t('modules.kingbase.design.removeColumn'),
                      icon: 'trash-2',
                      danger: true,
                    },
                  ]
                : []
          "
          @row-click="
            (row) => {
              editingColKey = String(row.__rowKey)
              editingIdxKey = null
              editingFkKey = null
              editingChkKey = null
            }
          "
          @cell-edit-commit="onColCommit"
          @row-drop="onColumnRowDrop"
          @context-menu-select="
            (key, row) => key === 'remove' && row && markColumnRemoved(String(row.__rowKey))
          "
        />
      </template>

      <template v-else-if="activeSection === 'indexes'">
        <RsTable
          class="nm-kingbase-design__grid"
          :columns="indexColumns"
          :data="displayIndexes"
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
          :highlighted-row-key="editingIdxKey ?? undefined"
          :context-menu-items="
            (row) =>
              row && !row.primary
                ? [
                    {
                      key: 'remove',
                      label: row.originalName
                        ? t('modules.kingbase.design.dropIndex')
                        : t('modules.kingbase.design.removeIndex'),
                      icon: 'trash-2',
                      danger: true,
                    },
                  ]
                : []
          "
          @row-click="
            (row) => {
              editingIdxKey = String(row.__rowKey)
              editingColKey = null
              editingFkKey = null
              editingChkKey = null
            }
          "
          @cell-edit-commit="onIdxCommit"
          @context-menu-select="
            (key, row) => key === 'remove' && row && markIndexRemoved(String(row.__rowKey))
          "
        />
      </template>

      <template v-else-if="activeSection === 'foreignKeys'">
        <RsTable
          class="nm-kingbase-design__grid"
          :columns="fkColumns"
          :data="displayForeignKeys"
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
          :highlighted-row-key="editingFkKey ?? undefined"
          :context-menu-items="
            (row) =>
              row
                ? [
                    {
                      key: 'remove',
                      label: row.originalName
                        ? t('modules.kingbase.design.dropForeignKey')
                        : t('modules.kingbase.design.removeForeignKey'),
                      icon: 'trash-2',
                      danger: true,
                    },
                  ]
                : []
          "
          @row-click="
            (row) => {
              editingFkKey = String(row.__rowKey)
              editingColKey = null
              editingIdxKey = null
              editingChkKey = null
            }
          "
          @cell-edit-start="onFkEditStart"
          @cell-edit-commit="onFkCommit"
          @context-menu-select="
            (key, row) => key === 'remove' && row && markForeignKeyRemoved(String(row.__rowKey))
          "
        />
      </template>

      <template v-else>
        <RsTable
          class="nm-kingbase-design__grid"
          :columns="checkColumns"
          :data="displayChecks"
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
          :highlighted-row-key="editingChkKey ?? undefined"
          :context-menu-items="
            (row) =>
              row
                ? [
                    {
                      key: 'remove',
                      label: row.originalName
                        ? t('modules.kingbase.design.dropCheck')
                        : t('modules.kingbase.design.removeCheck'),
                      icon: 'trash-2',
                      danger: true,
                    },
                  ]
                : []
          "
          @row-click="
            (row) => {
              editingChkKey = String(row.__rowKey)
              editingColKey = null
              editingIdxKey = null
              editingFkKey = null
            }
          "
          @cell-edit-commit="onChkCommit"
          @context-menu-select="
            (key, row) => key === 'remove' && row && markCheckRemoved(String(row.__rowKey))
          "
        />
      </template>
    </template>

    <template #editor>
      <template v-if="activeSection === 'columns' && editingCol">
        <div class="nm-kingbase-design__editor-title">{{ t('modules.kingbase.design.editColumn') }}</div>
        <div class="nm-kingbase-design__form">
          <div class="nm-kingbase-design__field">
            <label>{{ t('modules.kingbase.design.colName') }}</label>
            <RsInput
              :model-value="editingCol.name"
              size="sm"
              @update:model-value="updateColSideField(editingCol!.__rowKey, 'name', String($event ?? ''))"
            />
          </div>
          <div class="nm-kingbase-design__field">
            <label>{{ t('modules.kingbase.design.colType') }}</label>
            <RsSelect
              :model-value="editingCol.typeBase"
              size="sm"
              :options="typeBaseSelectOptions"
              searchable
              creatable
              @update:model-value="updateColSideField(editingCol!.__rowKey, 'typeBase', String($event))"
            />
          </div>
          <div class="nm-kingbase-design__field">
            <label>{{ t('modules.kingbase.design.colDefault') }}</label>
            <RsInput
              :model-value="editingCol.defaultExpr"
              size="sm"
              :placeholder="t('modules.kingbase.design.colDefaultPh')"
              @update:model-value="
                updateColSideField(editingCol!.__rowKey, 'defaultExpr', String($event ?? ''))
              "
            />
          </div>
          <div class="nm-kingbase-design__field">
            <label>{{ t('modules.kingbase.design.colComment') }}</label>
            <RsInput
              :model-value="editingCol.comment"
              size="sm"
              :placeholder="t('modules.kingbase.design.colCommentPh')"
              @update:model-value="
                updateColSideField(editingCol!.__rowKey, 'comment', String($event ?? ''))
              "
            />
          </div>
          <p class="nm-kingbase-design__hint">{{ t('modules.kingbase.design.gridEditHint') }}</p>
        </div>
      </template>
      <template v-else-if="activeSection === 'indexes' && editingIdx">
        <div class="nm-kingbase-design__editor-title">{{ t('modules.kingbase.design.editIndex') }}</div>
        <div class="nm-kingbase-design__form">
          <div class="nm-kingbase-design__field">
            <label>{{ t('modules.kingbase.design.idxName') }}</label>
            <RsInput
              :model-value="editingIdx.name"
              size="sm"
              :disabled="editingIdx.primary"
              :placeholder="t('modules.kingbase.design.idxNamePh')"
              @update:model-value="
                indexes = indexes.map((i) =>
                  i.__rowKey === editingIdx!.__rowKey && !i.primary
                    ? { ...i, name: String($event ?? '') }
                    : i,
                )
              "
            />
          </div>
          <div class="nm-kingbase-design__field">
            <label>{{ t('modules.kingbase.design.idxMethod') }}</label>
            <RsSelect
              :model-value="normalizeIndexMethod(editingIdx.method)"
              size="sm"
              :disabled="editingIdx.primary"
              :options="indexMethodSelectOptions"
              creatable
              @update:model-value="
                indexes = indexes.map((i) =>
                  i.__rowKey === editingIdx!.__rowKey && !i.primary
                    ? { ...i, method: normalizeIndexMethod(String($event || i.method)) }
                    : i,
                )
              "
            />
          </div>
          <div class="nm-kingbase-design__field">
            <label>{{ t('modules.kingbase.design.idxWhere') }}</label>
            <RsInput
              :model-value="editingIdx.whereText"
              size="sm"
              :disabled="editingIdx.primary"
              @update:model-value="
                indexes = indexes.map((i) =>
                  i.__rowKey === editingIdx!.__rowKey && !i.primary
                    ? { ...i, whereText: String($event ?? '') }
                    : i,
                )
              "
            />
          </div>
        </div>
      </template>
      <template v-else-if="activeSection === 'foreignKeys' && editingFk">
        <div class="nm-kingbase-design__editor-title">{{ t('modules.kingbase.design.editForeignKey') }}</div>
        <div class="nm-kingbase-design__form">
          <div class="nm-kingbase-design__field">
            <label>{{ t('modules.kingbase.design.fkRefSchema') }}</label>
            <RsSelect
              :model-value="editingFk.refSchema || schema"
              size="sm"
              :options="schemaSelectOptions"
              searchable
              creatable
              @focus="ensureSchemasLoaded"
              @update:model-value="
                ((sch) => {
                  const next = String(sch || props.schema || 'public')
                  foreignKeys = foreignKeys.map((f) =>
                    f.__rowKey === editingFk!.__rowKey
                      ? { ...f, refSchema: next, refTable: '', refColumnsText: '' }
                      : f,
                  )
                  void ensureTablesLoaded(next)
                })($event)
              "
            />
          </div>
          <div class="nm-kingbase-design__field">
            <label>{{ t('modules.kingbase.design.fkOnDelete') }}</label>
            <RsSelect
              :model-value="editingFk.onDelete"
              size="sm"
              :options="fkActionSelectOptions"
              @update:model-value="
                foreignKeys = foreignKeys.map((f) =>
                  f.__rowKey === editingFk!.__rowKey ? { ...f, onDelete: String($event) } : f,
                )
              "
            />
          </div>
          <div class="nm-kingbase-design__field">
            <label>{{ t('modules.kingbase.design.fkOnUpdate') }}</label>
            <RsSelect
              :model-value="editingFk.onUpdate"
              size="sm"
              :options="fkActionSelectOptions"
              @update:model-value="
                foreignKeys = foreignKeys.map((f) =>
                  f.__rowKey === editingFk!.__rowKey ? { ...f, onUpdate: String($event) } : f,
                )
              "
            />
          </div>
        </div>
      </template>
      <template v-else-if="activeSection === 'checks' && editingChk">
        <div class="nm-kingbase-design__editor-title">{{ t('modules.kingbase.design.editCheck') }}</div>
        <div class="nm-kingbase-design__form">
          <div class="nm-kingbase-design__field">
            <label>{{ t('modules.kingbase.design.chkName') }}</label>
            <RsInput
              :model-value="editingChk.name"
              size="sm"
              @update:model-value="
                checks = checks.map((c) =>
                  c.__rowKey === editingChk!.__rowKey ? { ...c, name: String($event ?? '') } : c,
                )
              "
            />
          </div>
          <div class="nm-kingbase-design__field">
            <label>{{ t('modules.kingbase.design.chkExpression') }}</label>
            <RsInput
              :model-value="editingChk.expression"
              size="sm"
              :placeholder="t('modules.kingbase.design.chkExpressionPh')"
              @update:model-value="
                checks = checks.map((c) =>
                  c.__rowKey === editingChk!.__rowKey
                    ? { ...c, expression: String($event ?? '') }
                    : c,
                )
              "
            />
          </div>
        </div>
      </template>
      <div v-else class="nm-kingbase-design__editor-empty">
        <RsEmpty
          fill
          radius="none"
          icon-radius="none"
          :description="t('modules.kingbase.design.selectRow')"
        />
      </div>
    </template>
  </TableDesignShell>
</template>

<style scoped>
.nm-kingbase-design__meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.nm-kingbase-design__meta-row--full {
  flex: 1;
  min-width: 240px;
}
.nm-kingbase-design__meta-label {
  font-size: 12px;
  color: var(--rs-fg-muted);
  white-space: nowrap;
  min-width: 60px;
}
.nm-kingbase-design__meta-readonly {
  font-size: 12px;
  font-weight: 500;
  min-width: 80px;
}
.nm-kingbase-design__grid {
  flex: 1;
  min-height: 0;
}
.nm-kingbase-design__editor-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--rs-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.nm-kingbase-design__editor-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nm-kingbase-design__form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nm-kingbase-design__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.nm-kingbase-design__field label {
  font-size: 11px;
  color: var(--rs-fg-muted);
}
.nm-kingbase-design__hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--rs-fg-muted);
  line-height: 1.4;
}
</style>
