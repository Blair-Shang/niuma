<script setup lang="ts">
import {
  RsButton,
  RsEmpty,
  RsInput,
  RsLoading,
  RsTable,
  RsTabs,
  useRsToast,
} from '@niuma/ui'
import type { RsSelectOptions, RsTabItem, RsTableColumn } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { vastbaseApi } from '@/api'
import type {
  VastColumnInfo,
  VastConstraintInfo,
} from '@/api/types/vastbase'
import { refreshResourceIfLoaded } from '@/modules/ops/composables/useConnTreeChildren'
import type { ConnItem } from '@/modules/ops/types'
import { useTabStore } from '@/stores/tab'
import {
  addDraftCheck,
  addDraftColumn,
  addDraftForeignKey,
  addDraftIndex,
  buildAlterDesignOps,
  buildCreateChecks,
  buildCreateColumns,
  buildCreateForeignKeys,
  buildCreateIndexes,
  toCheckDrafts,
  toDesignRows,
  toForeignKeyDrafts,
  toIndexDrafts,
} from '@/modules/vastbase/utils/table-design-ops'
import {
  dataTypeParamKind,
  defaultCreateTableColumns,
  normalizeIndexMethod,
  parseColumnList,
  syncColumnDataType,
  VAST_BASE_TYPE_OPTIONS,
  VAST_INDEX_METHODS,
  type DesignCheckDraft,
  type DesignColumnDraft,
  type DesignForeignKeyDraft,
  type DesignIndexDraft,
  resolveBaseTypeOption,
} from '@/modules/vastbase/utils/table-design'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  table?: string
  designMode?: 'create' | 'alter'
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()
const tabStore = useTabStore()
const activeSection = ref('columns')

const isCreate = computed(() => props.designMode === 'create')
const loading = ref(false)
const applying = ref(false)
const snapshot = ref<VastColumnInfo[]>([])
const pkSnapshot = ref<string[]>([])
const constraints = ref<VastConstraintInfo[]>([])
const rows = ref<DesignColumnDraft[]>([])
const indexes = ref<DesignIndexDraft[]>([])
const foreignKeys = ref<DesignForeignKeyDraft[]>([])
const checks = ref<DesignCheckDraft[]>([])
const previewSQL = ref<string[]>([])
const draftTableName = ref(props.table?.trim() || 'new_table')
const tableComment = ref('')
const tableCommentSnapshot = ref('')
const createdAsAlter = ref(false)
const effectiveTableName = ref(props.table ?? '')

const modeCreate = computed(() => isCreate.value && !createdAsAlter.value)
const tableName = computed(() =>
  modeCreate.value ? draftTableName.value.trim() : effectiveTableName.value || props.table || '',
)

type ColRow = DesignColumnDraft & { status: string }
type IdxRow = DesignIndexDraft & { status: string }
type FkRow = DesignForeignKeyDraft & { status: string }
type ChkRow = DesignCheckDraft & { status: string }

const FK_ACTION_OPTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']

const typeBaseSelectOptions = VAST_BASE_TYPE_OPTIONS.map((o) => ({
  value: o.base,
  label: o.base,
}))

const indexMethodSelectOptions = VAST_INDEX_METHODS.map((v) => ({ value: v, label: v }))

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
    const result = await vastbaseApi.treeSchemas({
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
    const result = await vastbaseApi.treeTables({
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
      vastbaseApi.metaColumns({
        sessionId: props.sessionId,
        database: props.database,
        schema: sch,
        table: tbl,
      }),
      vastbaseApi.metaPrimaryKey({
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
    { key: 'name', title: t('modules.vastbase.design.colName'), minWidth: 110, editable: true },
    {
      key: 'typeBase',
      title: t('modules.vastbase.design.colType'),
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
      title: t('modules.vastbase.design.colLength'),
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
      title: t('modules.vastbase.design.colScale'),
      width: 72,
      align: 'center',
      editable: (row) => dataTypeParamKind(row.typeBase) === 'precision',
      valueType: 'number',
    },
    {
      key: 'primaryKey',
      title: t('modules.vastbase.design.colPk'),
      width: 52,
      align: 'center',
      editable: true,
      valueType: 'boolean',
    },
    {
      key: 'nullable',
      title: t('modules.vastbase.design.colNullable'),
      width: 52,
      align: 'center',
      editable: true,
      valueType: 'boolean',
    },
    {
      key: 'defaultExpr',
      title: t('modules.vastbase.design.colDefault'),
      minWidth: 120,
      editable: true,
      ellipsis: true,
    },
    {
      key: 'comment',
      title: t('modules.vastbase.design.colComment'),
      minWidth: 100,
      editable: true,
      ellipsis: true,
    },
  ]
  if (!modeCreate.value) {
    cols.push({
      key: 'status',
      title: t('modules.vastbase.design.colStatus'),
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
      title: t('modules.vastbase.design.idxName'),
      minWidth: 110,
      editable: (row) => !row.primary,
    },
    {
      key: 'columnsText',
      title: t('modules.vastbase.design.idxColumns'),
      minWidth: 140,
      editable: (row) => !row.primary,
      valueType: 'select',
      headerTip: t('modules.vastbase.design.idxColumnsTip'),
      editorOptions: {
        options: colOptions,
        multiple: true,
        searchable: true,
        creatable: true,
        clearable: true,
      },
    },
    {
      key: 'expression',
      title: t('modules.vastbase.design.idxExpression'),
      minWidth: 120,
      editable: (row) => !row.primary,
      ellipsis: true,
      headerTip: t('modules.vastbase.design.idxExpressionTip'),
    },
    {
      key: 'whereText',
      title: t('modules.vastbase.design.idxWhere'),
      minWidth: 110,
      editable: (row) => !row.primary,
      ellipsis: true,
    },
    {
      key: 'method',
      title: t('modules.vastbase.design.idxMethod'),
      width: 88,
      align: 'center',
      editable: (row) => !row.primary,
      valueType: 'select',
      editorOptions: { options: indexMethodSelectOptions, creatable: true },
    },
    {
      key: 'unique',
      title: t('modules.vastbase.design.idxUnique'),
      width: 52,
      align: 'center',
      editable: (row) => !row.primary,
      valueType: 'boolean',
    },
  ]
  if (!modeCreate.value) {
    cols.push({
      key: 'status',
      title: t('modules.vastbase.design.colStatus'),
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
    { key: 'name', title: t('modules.vastbase.design.fkName'), minWidth: 100, editable: true },
    {
      key: 'columnsText',
      title: t('modules.vastbase.design.fkColumns'),
      minWidth: 120,
      editable: true,
      valueType: 'select',
      headerTip: t('modules.vastbase.design.fkColumnsTip'),
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
      title: t('modules.vastbase.design.fkRefSchema'),
      width: 100,
      editable: true,
      valueType: 'select',
      headerTip: t('modules.vastbase.design.fkRefSchemaTip'),
      editorOptions: {
        options: schemaOpts,
        searchable: true,
        creatable: true,
        clearable: false,
      },
    },
    {
      key: 'refTable',
      title: t('modules.vastbase.design.fkRefTable'),
      minWidth: 110,
      editable: true,
      valueType: 'select',
      headerTip: t('modules.vastbase.design.fkRefTableTip'),
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
      title: t('modules.vastbase.design.fkRefColumns'),
      minWidth: 120,
      editable: true,
      valueType: 'select',
      headerTip: t('modules.vastbase.design.fkRefColumnsTip'),
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
      title: t('modules.vastbase.design.fkOnDelete'),
      minWidth: 110,
      editable: true,
      valueType: 'select',
      editorOptions: { options: fkActionSelectOptions },
    },
    {
      key: 'onUpdate',
      title: t('modules.vastbase.design.fkOnUpdate'),
      minWidth: 110,
      editable: true,
      valueType: 'select',
      editorOptions: { options: fkActionSelectOptions },
    },
  ]
  if (!modeCreate.value) {
    cols.push({
      key: 'status',
      title: t('modules.vastbase.design.colStatus'),
      width: 72,
      align: 'center',
    })
  }
  return cols
})

const checkColumns = computed((): RsTableColumn<ChkRow>[] => {
  const cols: RsTableColumn<ChkRow>[] = [
    { key: 'name', title: t('modules.vastbase.design.chkName'), minWidth: 110, editable: true },
    {
      key: 'expression',
      title: t('modules.vastbase.design.chkExpression'),
      minWidth: 220,
      editable: true,
      ellipsis: true,
    },
  ]
  if (!modeCreate.value) {
    cols.push({
      key: 'status',
      title: t('modules.vastbase.design.colStatus'),
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
        ? t('modules.vastbase.design.statusNew')
        : r.name !== r.originalName
          ? t('modules.vastbase.design.statusRename')
          : t('modules.vastbase.design.statusEdit'),
    })),
)

function indexStatus(r: DesignIndexDraft): string {
  if (r.primary) return t('modules.vastbase.design.idxPrimary')
  if (!r.originalName) return t('modules.vastbase.design.statusNew')
  const changed =
    r.name !== r.snapName ||
    r.columnsText !== r.snapColumnsText ||
    r.expression !== r.snapExpression ||
    r.whereText !== r.snapWhereText ||
    r.unique !== r.snapUnique ||
    normalizeIndexMethod(r.method) !== normalizeIndexMethod(r.snapMethod)
  return changed
    ? t('modules.vastbase.design.statusEdit')
    : t('modules.vastbase.design.statusUnchanged')
}

function fkStatus(r: DesignForeignKeyDraft): string {
  if (!r.originalName) return t('modules.vastbase.design.statusNew')
  const changed =
    r.name !== r.snapName ||
    r.columnsText !== r.snapColumnsText ||
    r.refSchema !== r.snapRefSchema ||
    r.refTable !== r.snapRefTable ||
    r.refColumnsText !== r.snapRefColumnsText ||
    r.onDelete !== r.snapOnDelete ||
    r.onUpdate !== r.snapOnUpdate
  return changed
    ? t('modules.vastbase.design.statusEdit')
    : t('modules.vastbase.design.statusUnchanged')
}

function checkStatus(r: DesignCheckDraft): string {
  if (!r.originalName) return t('modules.vastbase.design.statusNew')
  const changed = r.name !== r.snapName || r.expression !== r.snapExpression
  return changed
    ? t('modules.vastbase.design.statusEdit')
    : t('modules.vastbase.design.statusUnchanged')
}

const displayIndexes = computed((): IdxRow[] =>
  indexes.value
    .filter((r) => !r.removed)
    .map((r) => ({
      ...r,
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

const sectionItems = computed((): RsTabItem[] => [
  {
    value: 'columns',
    label: t('modules.vastbase.design.tabColumns'),
    icon: 'table-2',
    badge: displayColumns.value.length || undefined,
  },
  {
    value: 'indexes',
    label: t('modules.vastbase.design.tabIndexes'),
    icon: 'list-ordered',
    badge: displayIndexes.value.length || undefined,
  },
  {
    value: 'foreignKeys',
    label: t('modules.vastbase.design.tabForeignKeys'),
    icon: 'link-2',
    badge: displayForeignKeys.value.length || undefined,
  },
  {
    value: 'checks',
    label: t('modules.vastbase.design.tabChecks'),
    icon: 'shield-check',
    badge: displayChecks.value.length || undefined,
  },
])

const scopeOk = computed(() => {
  if (!props.sessionId || !props.schema) return false
  if (modeCreate.value) return draftTableName.value.trim().length > 0
  return !!tableName.value
})

const addButtonLabel = computed(() => {
  if (activeSection.value === 'indexes') return t('modules.vastbase.design.addIndex')
  if (activeSection.value === 'foreignKeys') return t('modules.vastbase.design.addForeignKey')
  if (activeSection.value === 'checks') return t('modules.vastbase.design.addCheck')
  return t('modules.vastbase.design.addColumn')
})

const scopeLabel = computed(() => {
  if (modeCreate.value) return draftTableName.value.trim() || 'new_table'
  return [props.schema, tableName.value].filter(Boolean).join('.')
})

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
  indexes.value = []
  foreignKeys.value = []
  checks.value = []
  snapshot.value = []
  pkSnapshot.value = []
  constraints.value = []
  previewSQL.value = []
  createdAsAlter.value = false
  effectiveTableName.value = ''
  activeSection.value = 'columns'
}

function clearFkCatalogCache(): void {
  schemaSelectOptions.value = []
  tablesBySchema.value = new Map()
  columnsByRelation.value = new Map()
}

async function loadDesign(): Promise<void> {
  if (modeCreate.value) {
    initCreateDraft()
    void prefetchFkCatalog()
    return
  }
  const name = tableName.value
  if (!props.sessionId || !props.schema || !name) return
  loading.value = true
  try {
    const [cols, pk, idx, fks, cons] = await Promise.all([
      vastbaseApi.metaColumns({
        sessionId: props.sessionId,
        database: props.database,
        schema: props.schema,
        table: name,
      }),
      vastbaseApi.metaPrimaryKey({
        sessionId: props.sessionId,
        database: props.database,
        schema: props.schema,
        table: name,
      }),
      vastbaseApi.metaIndexes({
        sessionId: props.sessionId,
        database: props.database,
        schema: props.schema,
        table: name,
      }),
      vastbaseApi.metaForeignKeys({
        sessionId: props.sessionId,
        database: props.database,
        schema: props.schema,
        table: name,
      }),
      vastbaseApi.metaConstraints({
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
    indexes.value = toIndexDrafts(idx.indexes ?? [])
    foreignKeys.value = toForeignKeyDrafts(fks.foreignKeys ?? [])
    checks.value = toCheckDrafts(cons.constraints ?? [])
    previewSQL.value = []
    void prefetchFkCatalog()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.design.loadError'))
  } finally {
    loading.value = false
  }
}

function onAdd(): void {
  if (activeSection.value === 'indexes') {
    indexes.value = addDraftIndex(indexes.value)
    return
  }
  if (activeSection.value === 'foreignKeys') {
    foreignKeys.value = addDraftForeignKey(foreignKeys.value, props.schema || 'public')
    return
  }
  if (activeSection.value === 'checks') {
    checks.value = addDraftCheck(checks.value)
    return
  }
  rows.value = addDraftColumn(rows.value)
}

function markColumnRemoved(rowKey: string): void {
  rows.value = rows.value.map((r) =>
    r.__rowKey === rowKey ? { ...r, removed: true } : r,
  )
}

function markIndexRemoved(rowKey: string): void {
  indexes.value = indexes.value.map((r) =>
    r.__rowKey === rowKey && !r.primary ? { ...r, removed: true } : r,
  )
}

function markForeignKeyRemoved(rowKey: string): void {
  foreignKeys.value = foreignKeys.value.map((r) =>
    r.__rowKey === rowKey ? { ...r, removed: true } : r,
  )
}

function markCheckRemoved(rowKey: string): void {
  checks.value = checks.value.map((r) =>
    r.__rowKey === rowKey ? { ...r, removed: true } : r,
  )
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
}

function onIdxCommit(
  row: IdxRow,
  column: RsTableColumn<IdxRow>,
  _i: number,
  value: unknown,
): void {
  const key = String(column.key)
  const draft = String(value ?? '').trim()
  indexes.value = indexes.value.map((r) => {
    if (r.__rowKey !== row.__rowKey || r.primary) return r
    if (key === 'name') return { ...r, name: draft || r.name }
    if (key === 'columnsText') {
      const name = isDefaultIndexName(r.name) ? suggestIndexName(draft, r.name) : r.name
      return {
        ...r,
        name,
        columnsText: draft,
        expression: draft ? '' : r.expression,
      }
    }
    if (key === 'expression') return { ...r, expression: draft, columnsText: draft ? '' : r.columnsText }
    if (key === 'whereText') return { ...r, whereText: draft }
    if (key === 'method') return { ...r, method: normalizeIndexMethod(draft || r.method) }
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

async function preview(): Promise<void> {
  if (!props.schema || !scopeOk.value) return
  try {
    if (modeCreate.value) {
      const columns = buildCreateColumns(rows.value)
      if (columns.length === 0) {
        previewSQL.value = []
        toast.info(t('modules.vastbase.design.needColumns'))
        return
      }
      const result = await vastbaseApi.ddlCreateTablePreview({
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
      previewSQL.value = result.sql
      return
    }

    const ops = alterOps()
    if (ops.length === 0) {
      previewSQL.value = []
      toast.info(t('modules.vastbase.design.noChanges'))
      return
    }
    const result = await vastbaseApi.ddlDesignPreview({
      sessionId: props.sessionId ?? undefined,
      profileId: props.profileId,
      database: props.database,
      schema: props.schema,
      name: tableName.value,
      ops,
    })
    previewSQL.value = result.sql
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.design.previewError'))
  }
}

async function refreshTablesCategoryInTree(): Promise<void> {
  if (!props.profileId || !props.database || !props.schema) return
  // 仅刷新「表」分类节点，避免 invalidate 整棵连接树导致已展开节点全部折叠
  const conn = { profileId: props.profileId, kind: 'vastbase' } as ConnItem
  await refreshResourceIfLoaded(conn, {
    segments: [
      { kind: 'database', name: props.database },
      { kind: 'schema', name: props.schema },
      { kind: 'category', name: 'tables' },
    ],
  })
}

async function apply(): Promise<void> {
  if (!props.sessionId || !props.schema || !scopeOk.value) return
  applying.value = true
  try {
    if (modeCreate.value) {
      const columns = buildCreateColumns(rows.value)
      if (columns.length === 0) {
        toast.info(t('modules.vastbase.design.needColumns'))
        return
      }
      const result = await vastbaseApi.ddlCreateTableApply({
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
      previewSQL.value = result.sql
      toast.success(t('modules.vastbase.design.createDone'))
      await refreshTablesCategoryInTree()
      effectiveTableName.value = tableName.value
      createdAsAlter.value = true
      await loadDesign()
      return
    }

    const ops = alterOps()
    if (ops.length === 0) {
      toast.info(t('modules.vastbase.design.noChanges'))
      return
    }
    const result = await vastbaseApi.ddlDesignApply({
      sessionId: props.sessionId,
      database: props.database,
      schema: props.schema,
      name: tableName.value,
      ops,
    })
    previewSQL.value = result.sql
    toast.success(t('modules.vastbase.design.applyDone'))
    // 索引/列/约束变更不体现在连接树节点上，无需 invalidate（否则会整树折叠）
    await loadDesign()
  } catch (e) {
    toast.error(
      e instanceof Error
        ? e.message
        : modeCreate.value
          ? t('modules.vastbase.design.createError')
          : t('modules.vastbase.design.applyError'),
    )
  } finally {
    applying.value = false
  }
}

function openInQuery(): void {
  if (!props.profileId) return
  const run = () => {
    if (!previewSQL.value.length) return
    const base = [props.database, props.schema].filter(Boolean).join('.') || 'Vastbase'
    tabStore.openTab({
      moduleId: 'vastbase',
      title: `${base} · ${t('modules.vastbase.session.tabQuery')}`,
      icon: 'database',
      closable: true,
      props: {
        profileId: props.profileId,
        database: props.database,
        schema: props.schema,
        initialTab: 'query',
        initialSql: `${previewSQL.value.join(';\n')};`,
      },
    })
  }
  if (!previewSQL.value.length) {
    void preview().then(run)
    return
  }
  run()
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

watch(
  () =>
    [props.sessionId, props.database, props.schema, props.table, props.designMode, props.active] as const,
  () => {
    if (!props.active) return
    if (isCreate.value && !createdAsAlter.value) {
      initCreateDraft()
      void prefetchFkCatalog()
      return
    }
    if (props.schema && (tableName.value || props.table)) void loadDesign()
  },
  { immediate: true },
)
</script>

<template>
  <div class="nm-vast-design">
    <div
      class="nm-vast-design__meta"
      :title="modeCreate ? t('modules.vastbase.design.hintCreate') : t('modules.vastbase.design.hint')"
    >
      <div class="nm-vast-design__meta-item">
        <span class="nm-vast-design__meta-label">{{ t('modules.vastbase.design.metaName') }}</span>
        <RsInput
          v-if="modeCreate"
          v-model="draftTableName"
          size="sm"
          class="nm-vast-design__meta-name"
        />
        <span v-else class="nm-vast-design__meta-readonly">{{ scopeLabel }}</span>
      </div>
      <div class="nm-vast-design__meta-item nm-vast-design__meta-item--grow">
        <span class="nm-vast-design__meta-label">{{ t('modules.vastbase.design.metaComment') }}</span>
        <RsInput
          v-model="tableComment"
          size="sm"
          :placeholder="t('modules.vastbase.design.tableCommentPh')"
        />
      </div>
      <div class="nm-vast-design__meta-actions">
        <RsButton variant="ghost" size="sm" icon="plus" :disabled="!scopeOk" @click="onAdd">
          {{ addButtonLabel }}
        </RsButton>
        <RsButton variant="ghost" size="sm" icon="eye" :disabled="!scopeOk" @click="preview">
          {{ t('modules.vastbase.design.preview') }}
        </RsButton>
        <RsButton
          variant="primary"
          size="sm"
          :icon="modeCreate ? 'plus' : 'check'"
          :loading="applying"
          :disabled="!scopeOk"
          @click="apply"
        >
          {{ modeCreate ? t('modules.vastbase.design.createTable') : t('modules.vastbase.design.apply') }}
        </RsButton>
        <RsButton variant="ghost" size="sm" icon="terminal" :disabled="!scopeOk" @click="openInQuery">
          {{ t('modules.vastbase.design.openInQuery') }}
        </RsButton>
        <RsButton
          v-if="!modeCreate"
          variant="ghost"
          size="sm"
          icon="refresh-cw"
          :loading="loading"
          @click="loadDesign"
        >
          {{ t('modules.vastbase.structure.refresh') }}
        </RsButton>
      </div>
    </div>

    <RsLoading v-if="loading && rows.length === 0" class="nm-vast-design__loading" />
    <RsEmpty
      v-else-if="!schema || (!modeCreate && !tableName)"
      fill
      icon="table"
      :description="t('modules.vastbase.structure.needTable')"
    />
    <RsTabs
      v-else
      v-model="activeSection"
      :items="sectionItems"
      size="sm"
      variant="line"
      class="nm-vast-design__tabs"
    >
      <template #columns>
        <div class="nm-vast-design__panel">
          <RsTable
            class="nm-vast-design__grid"
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
            :context-menu-items="
              (row) =>
                row
                  ? [
                      {
                        key: 'remove',
                        label: t('modules.vastbase.design.removeColumn'),
                        icon: 'trash-2',
                        danger: true,
                      },
                    ]
                  : []
            "
            @cell-edit-commit="onColCommit"
            @context-menu-select="
              (key, row) => key === 'remove' && row && markColumnRemoved(row.__rowKey)
            "
          />
        </div>
      </template>

      <template #indexes>
        <div class="nm-vast-design__panel">
          <RsTable
            class="nm-vast-design__grid"
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
            :context-menu-items="
              (row) =>
                row && !row.primary
                  ? [
                      {
                        key: 'remove',
                        label: row.originalName
                          ? t('modules.vastbase.design.dropIndex')
                          : t('modules.vastbase.design.removeIndex'),
                        icon: 'trash-2',
                        danger: true,
                      },
                    ]
                  : []
            "
            @cell-edit-commit="onIdxCommit"
            @context-menu-select="
              (key, row) => key === 'remove' && row && markIndexRemoved(row.__rowKey)
            "
          />
        </div>
      </template>

      <template #foreignKeys>
        <div class="nm-vast-design__panel">
          <RsTable
            class="nm-vast-design__grid"
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
            :context-menu-items="
              (row) =>
                row
                  ? [
                      {
                        key: 'remove',
                        label: row.originalName
                          ? t('modules.vastbase.design.dropForeignKey')
                          : t('modules.vastbase.design.removeForeignKey'),
                        icon: 'trash-2',
                        danger: true,
                      },
                    ]
                  : []
            "
            @cell-edit-start="onFkEditStart"
            @cell-edit-commit="onFkCommit"
            @context-menu-select="
              (key, row) => key === 'remove' && row && markForeignKeyRemoved(row.__rowKey)
            "
          />
        </div>
      </template>

      <template #checks>
        <div class="nm-vast-design__panel">
          <RsTable
            class="nm-vast-design__grid"
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
            :context-menu-items="
              (row) =>
                row
                  ? [
                      {
                        key: 'remove',
                        label: row.originalName
                          ? t('modules.vastbase.design.dropCheck')
                          : t('modules.vastbase.design.removeCheck'),
                        icon: 'trash-2',
                        danger: true,
                      },
                    ]
                  : []
            "
            @cell-edit-commit="onChkCommit"
            @context-menu-select="
              (key, row) => key === 'remove' && row && markCheckRemoved(row.__rowKey)
            "
          />
        </div>
      </template>
    </RsTabs>

    <div v-if="previewSQL.length" class="nm-vast-design__preview">
      <div class="nm-vast-design__preview-head">
        <h4>{{ t('modules.vastbase.design.previewTitle') }}</h4>
        <span class="nm-vast-design__preview-count">{{ previewSQL.length }}</span>
      </div>
      <pre>{{ previewSQL.join(';\n') }};</pre>
    </div>
  </div>
</template>

<style scoped>
.nm-vast-design {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--rs-surface);
}

.nm-vast-design__meta {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
  padding: 0.35rem var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-elevated, var(--rs-surface));
}

.nm-vast-design__meta-item {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  min-width: 0;
}

.nm-vast-design__meta-item--grow {
  flex: 1;
}

.nm-vast-design__meta-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

.nm-vast-design__meta-label {
  flex-shrink: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-vast-design__meta-name {
  width: 12rem;
}

.nm-vast-design__meta-readonly {
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
}

.nm-vast-design__meta-item--grow :deep(.rs-input) {
  flex: 1;
  min-width: 0;
}

.nm-vast-design__tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: var(--rs-space-sm);
  margin-top: var(--rs-space-xs);
}

.nm-vast-design__tabs :deep(.rs-tabs),
.nm-vast-design__tabs :deep(.rs-tabs__body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-vast-design__tabs :deep(.rs-tabs__nav) {
  flex-shrink: 0;
}

.nm-vast-design__tabs :deep(.rs-tabs__panel[data-state='active']) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-vast-design__tabs :deep(.rs-tabs__panel-inner) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}

.nm-vast-design__panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.nm-vast-design__grid {
  flex: 1;
  min-height: 0;
}

.nm-vast-design__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-vast-design__preview {
  flex-shrink: 0;
  max-height: 9rem;
  margin: 0 var(--rs-space-sm) var(--rs-space-sm);
  overflow: auto;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  background: var(--rs-surface-elevated, var(--rs-surface));
}

.nm-vast-design__preview-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  padding: 0.35rem var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-vast-design__preview-head h4 {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  color: var(--rs-muted);
}

.nm-vast-design__preview-count {
  font-size: 0.65rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--rs-surface-hover);
  color: var(--rs-muted);
}

.nm-vast-design__preview pre {
  margin: 0;
  padding: var(--rs-space-sm);
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: var(--rs-font-size-xs);
  white-space: pre-wrap;
  line-height: 1.45;
}
</style>
