<script setup lang="ts">
/**
 * ClickHouse 表设计器：MergeTree 族建表 + 列 / 跳数索引变更。
 * 对齐产品内 MySQL 设计器交互：网格编辑、拖拽排序；并覆盖 CH 特色（引擎参数、多键 ORDER BY、TTL/SETTINGS）。
 */
import {
  RsButton,
  RsEmpty,
  RsInput,
  RsSelect,
  RsTable,
  RsTooltip,
  reorderTableRows,
  useRsToast,
  type RsSelectOptions,
  type RsTableColumn,
  type RsTableRowDropPosition,
} from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { clickhouseApi } from '@/api/clickhouse'
import {
  TableDesignPreviewPopover,
  TableDesignShell,
  type TableDesignSection,
  type TableDesignSectionItem,
  type TableDesignShellLabels,
} from '@/modules/database'
import { useClickHouseClusterOptions } from '@/modules/clickhouse/composables/useClickHouseClusterOptions'
import { fetchConnectionDefaultCluster } from '@/modules/clickhouse/utils/cluster'
import { refreshResourceIfLoaded } from '@/modules/ops/composables/useConnTreeChildren'
import type { ConnItem } from '@/modules/ops/types'
import {
  CLICKHOUSE_BASE_TYPE_OPTIONS,
  CLICKHOUSE_CODEC_OPTIONS,
  CLICKHOUSE_ENGINE_OPTIONS,
  CLICKHOUSE_INDEX_TYPE_OPTIONS,
  CLICKHOUSE_INNER_TYPE_PRESETS,
  CLICKHOUSE_PARTITION_PRESETS,
  composeEngine,
  composeKeyExpression,
  dataTypeParamKind,
  defaultCreateTableColumns,
  defaultParamsForBase,
  newEmptyColumn,
  newEmptyIndex,
  parseEngine,
  parseKeyExpression,
  resolveEngineOption,
  syncColumnDataType,
  type DesignColumnDraft,
  type DesignIndexDraft,
} from '@/modules/clickhouse/utils/table-design'
import {
  buildAlterDesignOps,
  buildCreateColumns,
  buildCreateIndexes,
  toDesignRows,
  toIndexDrafts,
} from '@/modules/clickhouse/utils/table-design-ops'
import {
  columnsFromImportSeed,
  takeClickHouseDesignSeed,
} from '@/modules/clickhouse/utils/design-seed'
import { useSessionRegistry } from '@/stores/session-registry'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database: string
  table?: string
  designMode: 'create' | 'alter'
  active: boolean
  sessionLabel?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const sessionRegistry = useSessionRegistry()

type ColRow = DesignColumnDraft & Record<string, unknown>
type IdxRow = DesignIndexDraft & Record<string, unknown>
type SelectOpt = { value: string; label: string }

const activeSection = ref<TableDesignSection>('columns')
const loading = ref(false)
const saving = ref(false)
const previewSqls = ref<string[]>([])
const showPreview = ref(false)
const previewLoading = ref(false)
const localDesignMode = ref<'create' | 'alter' | null>(null)
const localTable = ref<string | null>(null)
const tableName = ref(props.table ?? '')
const tableComment = ref('')
const engineBase = ref('MergeTree')
const engineArgs = ref('')
const orderByParts = ref<string[]>(['dt', 'id'])
const orderByCustom = ref('')
const partitionBy = ref('toYYYYMM(dt)')
const primaryKeyParts = ref<string[]>([])
const primaryKeyCustom = ref('')
const sampleBy = ref('')
const ttl = ref('')
const settings = ref('')
const {
  onCluster: cluster,
  supportOnCluster,
  clusterOptions,
  loading: clustersLoading,
  reload: reloadClusters,
  resolveOnCluster,
} = useClickHouseClusterOptions()
const columns = ref<DesignColumnDraft[]>([])
const indexes = ref<DesignIndexDraft[]>([])
const origColumns = ref<DesignColumnDraft[]>([])
const origIndexes = ref<DesignIndexDraft[]>([])
const origComment = ref('')
const origOrderBy = ref('')
const selectedKey = ref<string | undefined>(undefined)

const modeCreate = computed(() => (localDesignMode.value ?? props.designMode) === 'create')
const effectiveTable = computed(() => localTable.value ?? props.table ?? tableName.value)
const title = computed(() =>
  modeCreate.value
    ? t('modules.clickhouse.design.createTitle')
    : t('modules.clickhouse.design.alterTitle'),
)

const dialectCaps = computed(() => {
  if (!props.sessionId) return [] as string[]
  return sessionRegistry.getDialectForSession(props.sessionId)?.capabilities ?? []
})
const engineEditable = computed(() => modeCreate.value)
const partitionEditable = computed(() => modeCreate.value)

const composedEngine = computed(() => composeEngine(engineBase.value, engineArgs.value))
const engineOpt = computed(() => resolveEngineOption(engineBase.value))
const showEngineArgs = computed(() => {
  const kind = engineOpt.value?.paramKind ?? 'none'
  return kind !== 'none'
})

const orderByExpression = computed(() => {
  if (orderByCustom.value.trim()) return orderByCustom.value.trim()
  return composeKeyExpression(orderByParts.value)
})

const primaryKeyExpression = computed(() => {
  if (primaryKeyCustom.value.trim()) return primaryKeyCustom.value.trim()
  return composeKeyExpression(primaryKeyParts.value)
})

function withCurrentOption(opts: SelectOpt[], current: string): SelectOpt[] {
  const cur = current.trim()
  if (cur && !opts.some((o) => o.value === cur)) {
    return [{ value: cur, label: cur }, ...opts]
  }
  return opts
}

const typeBaseOptions = computed<RsSelectOptions>(() =>
  CLICKHOUSE_BASE_TYPE_OPTIONS.map((o) => ({ value: o.base, label: o.base })),
)

const indexTypeOptions = computed<RsSelectOptions>(() =>
  CLICKHOUSE_INDEX_TYPE_OPTIONS.map((v) => ({ value: v, label: v })),
)

const engineBaseOptions = computed<RsSelectOptions>(() =>
  withCurrentOption(
    CLICKHOUSE_ENGINE_OPTIONS.map((o) => ({ value: o.base, label: o.base })),
    engineBase.value,
  ),
)

const codecOptions = computed<RsSelectOptions>(() =>
  CLICKHOUSE_CODEC_OPTIONS.map((v) => ({ value: v, label: v })),
)

const innerTypeOptions = computed<RsSelectOptions>(() =>
  CLICKHOUSE_INNER_TYPE_PRESETS.map((v) => ({ value: v, label: v })),
)

const mapInnerOptions = computed<RsSelectOptions>(() => [
  { value: 'String, String', label: 'String, String' },
  { value: 'String, UInt64', label: 'String, UInt64' },
  { value: 'String, Float64', label: 'String, Float64' },
  { value: 'LowCardinality(String), UInt64', label: 'LowCardinality(String), UInt64' },
  { value: 'UInt64, String', label: 'UInt64, String' },
])

const columnNameOptions = computed((): SelectOpt[] =>
  columns.value
    .filter((c) => !c.removed && c.name.trim())
    .map((c) => ({ value: c.name, label: c.name })),
)

const partitionByOptions = computed<RsSelectOptions>(() => {
  const merged: SelectOpt[] = CLICKHOUSE_PARTITION_PRESETS.map((v) => ({ value: v, label: v }))
  for (const c of columnNameOptions.value) {
    if (!merged.some((o) => o.value === c.value)) merged.push(c)
  }
  return withCurrentOption(merged, partitionBy.value)
})

const sections = computed((): TableDesignSectionItem[] => [
  {
    id: 'columns',
    label: t('modules.clickhouse.design.tabColumns'),
    count: columns.value.filter((c) => !c.removed).length,
  },
  {
    id: 'indexes',
    label: t('modules.clickhouse.design.tabIndexes'),
    count: indexes.value.filter((i) => !i.removed).length,
  },
  { id: 'options', label: t('modules.clickhouse.design.tabOptions') },
])

const shellLabels = computed((): TableDesignShellLabels => ({
  reload: t('modules.clickhouse.design.reload'),
  preview: t('modules.clickhouse.design.preview'),
  create: t('modules.clickhouse.design.create'),
  apply: t('modules.clickhouse.design.apply'),
  previewTitle: t('modules.clickhouse.design.previewTitle'),
  add: activeSection.value === 'indexes'
    ? t('modules.clickhouse.design.addIndex')
    : t('modules.clickhouse.design.addColumn'),
  selectRow: activeSection.value === 'indexes'
    ? t('modules.clickhouse.design.selectIndex')
    : t('modules.clickhouse.design.selectRow'),
  copyPreview: t('modules.clickhouse.design.copyPreview'),
  moveUp: t('modules.clickhouse.design.moveUp'),
  moveDown: t('modules.clickhouse.design.moveDown'),
}))

const selectedColumn = computed(() =>
  columns.value.find((c) => c.__rowKey === selectedKey.value && !c.removed) ?? null,
)

const selectedIndex = computed(() =>
  indexes.value.find((i) => i.__rowKey === selectedKey.value && !i.removed) ?? null,
)

const indexExprOptions = computed<RsSelectOptions>(() =>
  withCurrentOption(columnNameOptions.value, selectedIndex.value?.expression ?? ''),
)

const columnRows = computed<ColRow[]>(() =>
  columns.value.filter((c) => !c.removed).map((c) => ({ ...c })),
)

const indexRows = computed<IdxRow[]>(() =>
  indexes.value.filter((i) => !i.removed).map((i) => ({ ...i })),
)

const columnColumns = computed((): RsTableColumn<ColRow>[] => {
  const cols: RsTableColumn<ColRow>[] = [
    { key: 'name', title: t('modules.clickhouse.design.colName'), minWidth: 110, editable: true },
    {
      key: 'typeBase',
      title: t('modules.clickhouse.design.colType'),
      minWidth: 120,
      editable: true,
      valueType: 'select',
      editorOptions: { options: typeBaseOptions.value, searchable: true, creatable: true },
    },
    {
      key: 'typeLength',
      title: t('modules.clickhouse.design.colPrecision'),
      width: 72,
      align: 'center',
      valueType: 'number',
      headerTip: t('modules.clickhouse.design.colPrecisionTip'),
      editable: (row) => {
        const kind = dataTypeParamKind(String(row.typeBase ?? ''))
        return kind === 'length' || kind === 'precision' || kind === 'decimal'
      },
    },
    {
      key: 'typeScale',
      title: t('modules.clickhouse.design.colScale'),
      width: 64,
      align: 'center',
      valueType: 'number',
      headerTip: t('modules.clickhouse.design.colScaleTip'),
      editable: (row) => {
        const kind = dataTypeParamKind(String(row.typeBase ?? ''))
        return kind === 'scale' || kind === 'decimal'
      },
    },
    {
      key: 'typeInner',
      title: t('modules.clickhouse.design.colInner'),
      minWidth: 140,
      editable: (row) => {
        const kind = dataTypeParamKind(String(row.typeBase ?? ''))
        return kind === 'array' || kind === 'map' || kind === 'nested' || kind === 'aggregate'
      },
      valueType: 'select',
      headerTip: t('modules.clickhouse.design.colInnerTip'),
      editorOptions: {
        options: [
          ...innerTypeOptions.value,
          ...mapInnerOptions.value,
        ],
        searchable: true,
        creatable: true,
      },
    },
    {
      key: 'enumValues',
      title: t('modules.clickhouse.design.colEnum'),
      minWidth: 140,
      editable: (row) => dataTypeParamKind(String(row.typeBase ?? '')) === 'enum',
      ellipsis: true,
      headerTip: t('modules.clickhouse.design.colEnumTip'),
    },
    {
      key: 'nullable',
      title: t('modules.clickhouse.design.colNullable'),
      width: 64,
      align: 'center',
      editable: true,
      valueType: 'boolean',
    },
    {
      key: 'lowCardinality',
      title: t('modules.clickhouse.design.colLowCard'),
      width: 72,
      align: 'center',
      editable: true,
      valueType: 'boolean',
    },
    {
      key: 'defaultExpr',
      title: t('modules.clickhouse.design.colDefault'),
      minWidth: 100,
      editable: true,
      ellipsis: true,
    },
    {
      key: 'codec',
      title: t('modules.clickhouse.design.colCodec'),
      minWidth: 100,
      editable: modeCreate.value,
      valueType: 'select',
      editorOptions: {
        options: codecOptions.value,
        searchable: true,
        creatable: true,
        clearable: true,
      },
    },
    {
      key: 'comment',
      title: t('modules.clickhouse.design.colComment'),
      minWidth: 100,
      editable: true,
      ellipsis: true,
    },
  ]
  if (!modeCreate.value) {
    cols.unshift({
      key: 'status',
      title: t('modules.clickhouse.design.colStatus'),
      width: 64,
      formatter: (_v, row) => {
        const r = row as ColRow
        if (r.removed) return '—'
        if (!r.originalName) return t('modules.clickhouse.design.statusNew')
        const prev = origColumns.value.find((o) => o.__rowKey === r.__rowKey)
        if (
          !prev
          || r.name !== prev.name
          || r.dataType !== prev.dataType
          || r.defaultExpr !== prev.defaultExpr
          || r.comment !== prev.comment
        ) {
          return t('modules.clickhouse.design.statusEdit')
        }
        return t('modules.clickhouse.design.statusOk')
      },
    })
  }
  return cols
})

const indexColumns = computed((): RsTableColumn<IdxRow>[] => {
  const cols: RsTableColumn<IdxRow>[] = [
    { key: 'name', title: t('modules.clickhouse.design.idxName'), minWidth: 110, editable: true },
    {
      key: 'expression',
      title: t('modules.clickhouse.design.idxExpr'),
      minWidth: 140,
      editable: true,
      valueType: 'select',
      editorOptions: {
        options: columnNameOptions.value,
        searchable: true,
        creatable: true,
      },
    },
    {
      key: 'type',
      title: t('modules.clickhouse.design.idxType'),
      minWidth: 110,
      editable: true,
      valueType: 'select',
      editorOptions: { options: indexTypeOptions.value },
    },
    {
      key: 'granularity',
      title: t('modules.clickhouse.design.idxGranularity'),
      width: 96,
      editable: true,
      valueType: 'number',
    },
  ]
  if (!modeCreate.value) {
    cols.unshift({
      key: 'status',
      title: t('modules.clickhouse.design.colStatus'),
      width: 64,
      formatter: (_v, row) => {
        const r = row as IdxRow
        if (r.removed) return '—'
        if (!r.originalName) return t('modules.clickhouse.design.statusNew')
        const prev = origIndexes.value.find((o) => o.__rowKey === r.__rowKey)
        if (
          !prev
          || r.name !== prev.name
          || r.expression !== prev.expression
          || r.type !== prev.type
          || r.granularity !== prev.granularity
        ) {
          return t('modules.clickhouse.design.statusEdit')
        }
        return t('modules.clickhouse.design.statusOk')
      },
    })
  }
  return cols
})

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  return fallback
}

function patchColumn(key: string, patch: (col: DesignColumnDraft) => DesignColumnDraft): void {
  columns.value = columns.value.map((c) => (c.__rowKey === key ? patch(c) : c))
}

function resyncDataType(col: DesignColumnDraft): DesignColumnDraft {
  return { ...col, dataType: syncColumnDataType(col) }
}

function onColCommit(row: ColRow, column: RsTableColumn<ColRow>, _i: number, value: unknown): void {
  const key = String(column.key)
  const draft = String(value ?? '').trim()
  patchColumn(row.__rowKey, (r) => {
    if (key === 'name') return { ...r, name: draft || r.name }
    if (key === 'typeBase') {
      const nextBase = draft || r.typeBase
      const defaults = defaultParamsForBase(nextBase)
      return resyncDataType({
        ...r,
        typeBase: nextBase,
        typeLength: defaults.typeLength,
        typeScale: defaults.typeScale,
        typeInner: defaults.typeInner ?? '',
        enumValues: defaults.enumValues ?? '',
      })
    }
    if (key === 'typeLength') {
      const n = draft === '' ? undefined : Number(draft)
      return resyncDataType({
        ...r,
        typeLength: Number.isFinite(n as number) ? (n as number) : undefined,
      })
    }
    if (key === 'typeScale') {
      const n = draft === '' ? undefined : Number(draft)
      return resyncDataType({
        ...r,
        typeScale: Number.isFinite(n as number) ? (n as number) : undefined,
      })
    }
    if (key === 'typeInner') return resyncDataType({ ...r, typeInner: draft })
    if (key === 'enumValues') return resyncDataType({ ...r, enumValues: draft })
    if (key === 'nullable') return resyncDataType({ ...r, nullable: asBool(value, r.nullable) })
    if (key === 'lowCardinality') {
      return resyncDataType({ ...r, lowCardinality: asBool(value, r.lowCardinality) })
    }
    if (key === 'defaultExpr') return { ...r, defaultExpr: draft }
    if (key === 'comment') return { ...r, comment: draft }
    if (key === 'codec') return { ...r, codec: draft }
    return r
  })
}

function onIdxCommit(row: IdxRow, column: RsTableColumn<IdxRow>, _i: number, value: unknown): void {
  const key = String(column.key)
  indexes.value = indexes.value.map((r) => {
    if (r.__rowKey !== row.__rowKey) return r
    if (key === 'name') return { ...r, name: String(value ?? '').trim() }
    if (key === 'expression') return { ...r, expression: String(value ?? '').trim() }
    if (key === 'type') return { ...r, type: String(value ?? 'minmax').trim() || 'minmax' }
    if (key === 'granularity') {
      const n = Number.parseInt(String(value ?? ''), 10)
      return { ...r, granularity: Number.isFinite(n) && n > 0 ? n : 1 }
    }
    return r
  })
}

function updateColSideField<K extends keyof DesignColumnDraft>(
  key: string,
  field: K,
  value: DesignColumnDraft[K],
): void {
  patchColumn(key, (r) => {
    const next = { ...r, [field]: value }
    if (
      field === 'typeBase'
      || field === 'typeLength'
      || field === 'typeScale'
      || field === 'typeInner'
      || field === 'enumValues'
      || field === 'nullable'
      || field === 'lowCardinality'
    ) {
      if (field === 'typeBase') {
        const defaults = defaultParamsForBase(String(value))
        return resyncDataType({
          ...next,
          typeLength: defaults.typeLength,
          typeScale: defaults.typeScale,
          typeInner: defaults.typeInner ?? '',
          enumValues: defaults.enumValues ?? '',
        })
      }
      return resyncDataType(next)
    }
    return next
  })
}

function typeLengthLabel(typeBase: string): string {
  const kind = dataTypeParamKind(typeBase)
  if (kind === 'length') return t('modules.clickhouse.design.colLength')
  if (kind === 'precision' || kind === 'decimal') return t('modules.clickhouse.design.colPrecision')
  return t('modules.clickhouse.design.colParam')
}

function typeInnerLabel(typeBase: string): string {
  const kind = dataTypeParamKind(typeBase)
  if (kind === 'array') return t('modules.clickhouse.design.colArrayElem')
  if (kind === 'map') return t('modules.clickhouse.design.colMapKV')
  if (kind === 'aggregate') return t('modules.clickhouse.design.colAggregateArgs')
  if (kind === 'nested') return t('modules.clickhouse.design.colNestedArgs')
  return t('modules.clickhouse.design.colInner')
}

function showTypeLength(typeBase: string): boolean {
  const kind = dataTypeParamKind(typeBase)
  return kind === 'length' || kind === 'precision' || kind === 'decimal'
}

function showTypeScale(typeBase: string): boolean {
  const kind = dataTypeParamKind(typeBase)
  return kind === 'scale' || kind === 'decimal'
}

function showTypeInner(typeBase: string): boolean {
  const kind = dataTypeParamKind(typeBase)
  return kind === 'array' || kind === 'map' || kind === 'nested' || kind === 'aggregate'
}

function showEnumValues(typeBase: string): boolean {
  return dataTypeParamKind(typeBase) === 'enum'
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

function removeCol(key: string): void {
  selectedKey.value = key
  removeSelected()
}

function moveSelectedColumn(delta: number): void {
  const key = selectedKey.value
  if (!key || activeSection.value !== 'columns') return
  const active = columns.value.filter((c) => !c.removed)
  const idx = active.findIndex((c) => c.__rowKey === key)
  const next = idx + delta
  if (idx < 0 || next < 0 || next >= active.length) return
  const copy = [...active]
  const [row] = copy.splice(idx, 1)
  copy.splice(next, 0, row)
  const removed = columns.value.filter((c) => c.removed)
  columns.value = [...copy, ...removed]
}

function setOrderByFromSelect(value: unknown): void {
  orderByCustom.value = ''
  if (Array.isArray(value)) {
    orderByParts.value = value.map(String).filter(Boolean)
    return
  }
  const s = String(value ?? '').trim()
  orderByParts.value = s ? parseKeyExpression(s) : []
}

function setPrimaryKeyFromSelect(value: unknown): void {
  primaryKeyCustom.value = ''
  if (Array.isArray(value)) {
    primaryKeyParts.value = value.map(String).filter(Boolean)
    return
  }
  const s = String(value ?? '').trim()
  primaryKeyParts.value = s ? parseKeyExpression(s) : []
}

function onEngineBaseChange(value: unknown): void {
  engineBase.value = String(value ?? 'MergeTree')
  const opt = resolveEngineOption(engineBase.value)
  if (!opt || opt.paramKind === 'none') {
    engineArgs.value = ''
  }
}

function resetCreateDefaults(): void {
  const seed = takeClickHouseDesignSeed(props.database)
  const seededCols = seed?.columns?.length ? columnsFromImportSeed(seed.columns) : null
  columns.value = seededCols ?? defaultCreateTableColumns()
  indexes.value = []
  origColumns.value = []
  origIndexes.value = []
  tableComment.value = ''
  origComment.value = ''
  engineBase.value = 'MergeTree'
  engineArgs.value = ''
  if (seededCols) {
    const first = seededCols[0]?.name?.trim()
    orderByParts.value = first ? [first] : []
    orderByCustom.value = ''
    partitionBy.value = ''
    primaryKeyParts.value = first ? [first] : []
  } else {
    orderByParts.value = ['dt', 'id']
    orderByCustom.value = ''
    partitionBy.value = 'toYYYYMM(dt)'
    primaryKeyParts.value = []
  }
  primaryKeyCustom.value = ''
  sampleBy.value = ''
  ttl.value = ''
  settings.value = ''
  origOrderBy.value = ''
  tableName.value = seed?.tableName
    || (props.table?.startsWith('new_') ? '' : (props.table ?? ''))
  selectedKey.value = columns.value[0]?.__rowKey
  activeSection.value = 'columns'
}

function applyLoadedKeys(orderByRaw: string, primaryKeyRaw: string): void {
  const ob = orderByRaw.trim()
  const parts = parseKeyExpression(ob)
  const simple = parts.length > 0 && parts.every((p) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p))
  if (simple) {
    orderByParts.value = parts
    orderByCustom.value = ''
  } else {
    orderByParts.value = []
    orderByCustom.value = ob
  }
  const pk = primaryKeyRaw.trim()
  if (!pk) {
    primaryKeyParts.value = []
    primaryKeyCustom.value = ''
    return
  }
  const pkParts = parseKeyExpression(pk)
  const pkSimple = pkParts.every((p) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p))
  if (pkSimple) {
    primaryKeyParts.value = pkParts
    primaryKeyCustom.value = ''
  } else {
    primaryKeyParts.value = []
    primaryKeyCustom.value = pk
  }
}

async function load(): Promise<void> {
  if (modeCreate.value) {
    resetCreateDefaults()
    return
  }
  if (!props.sessionId || !props.database || !effectiveTable.value) return
  loading.value = true
  try {
    const [cols, info, idxs] = await Promise.all([
      clickhouseApi.metaColumns({
        sessionId: props.sessionId,
        database: props.database,
        table: effectiveTable.value,
      }),
      clickhouseApi.metaTableInfo({
        sessionId: props.sessionId,
        database: props.database,
        table: effectiveTable.value,
      }),
      clickhouseApi.metaIndexes({
        sessionId: props.sessionId,
        database: props.database,
        table: effectiveTable.value,
      }),
    ])
    columns.value = toDesignRows(cols.columns ?? [])
    origColumns.value = toDesignRows(cols.columns ?? [])
    indexes.value = toIndexDrafts(idxs.indexes ?? [])
    origIndexes.value = toIndexDrafts(idxs.indexes ?? [])
    tableName.value = effectiveTable.value
    tableComment.value = info.comment ?? cols.tableComment ?? ''
    origComment.value = tableComment.value
    const parsed = parseEngine(info.engine || 'MergeTree')
    engineBase.value = parsed.base
    engineArgs.value = parsed.args
    applyLoadedKeys(info.sortingKey || '', info.primaryKey || '')
    origOrderBy.value = orderByExpression.value
    partitionBy.value = info.partitionKey || ''
    sampleBy.value = ''
    ttl.value = ''
    settings.value = ''
    if (activeSection.value === 'indexes') {
      selectedKey.value = indexes.value.find((i) => !i.removed)?.__rowKey
    } else {
      selectedKey.value = columns.value[0]?.__rowKey
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}

function addColumn(): void {
  const col = newEmptyColumn()
  col.name = `col_${columns.value.filter((c) => !c.removed).length + 1}`
  columns.value = [...columns.value, col]
  selectedKey.value = col.__rowKey
  activeSection.value = 'columns'
}

function addIndex(): void {
  const idx = newEmptyIndex()
  const first = columns.value.find((c) => !c.removed && c.name.trim())
  if (first) idx.expression = first.name
  indexes.value = [...indexes.value, idx]
  selectedKey.value = idx.__rowKey
  activeSection.value = 'indexes'
}

function removeSelected(): void {
  const key = selectedKey.value
  if (!key) return
  if (activeSection.value === 'indexes') {
    indexes.value = indexes.value.map((i) => {
      if (i.__rowKey !== key) return i
      if (!i.originalName) return { ...i, removed: true, name: '' }
      return { ...i, removed: true }
    }).filter((i) => !(i.removed && !i.originalName))
    selectedKey.value = indexes.value.find((i) => !i.removed)?.__rowKey
    return
  }
  columns.value = columns.value.map((c) => {
    if (c.__rowKey !== key) return c
    if (!c.originalName) return { ...c, removed: true, name: '' }
    return { ...c, removed: true }
  }).filter((c) => !(c.removed && !c.originalName))
  selectedKey.value = columns.value.find((c) => !c.removed)?.__rowKey
}

function onSectionChange(section: TableDesignSection): void {
  activeSection.value = section
  if (section === 'indexes') {
    selectedKey.value = indexes.value.find((i) => !i.removed)?.__rowKey
  } else if (section === 'columns') {
    selectedKey.value = columns.value.find((c) => !c.removed)?.__rowKey
  } else {
    selectedKey.value = undefined
  }
}

function setSelectedIndexGranularity(raw: string | number): void {
  const idx = selectedIndex.value
  if (!idx) return
  const n = Number.parseInt(String(raw), 10)
  idx.granularity = Number.isFinite(n) && n > 0 ? n : 1
}

function buildCreateParams() {
  const name = tableName.value.trim()
  if (!name) throw new Error(t('modules.clickhouse.design.needTableName'))
  const createCols = buildCreateColumns(columns.value)
  if (!createCols.length) throw new Error(t('modules.clickhouse.design.needColumns'))
  const ob = orderByExpression.value
  if (!ob) throw new Error(t('modules.clickhouse.design.needOrderBy'))
  if (showEngineArgs.value) {
    const kind = engineOpt.value?.paramKind
    if ((kind === 'sign' || kind === 'sign_version' || kind === 'config') && !engineArgs.value.trim()) {
      throw new Error(t('modules.clickhouse.design.needEngineArgs'))
    }
  }
  const createIndexes = buildCreateIndexes(indexes.value)
  return {
    sessionId: props.sessionId ?? undefined,
    database: props.database,
    name,
    columns: createCols,
    indexes: createIndexes.length ? createIndexes : undefined,
    engine: composedEngine.value,
    orderBy: ob,
    partitionBy: partitionBy.value.trim() || undefined,
    primaryKey: primaryKeyExpression.value || undefined,
    sampleBy: sampleBy.value.trim() || undefined,
    ttl: ttl.value.trim() || undefined,
    settings: settings.value.trim() || undefined,
    comment: tableComment.value.trim() || undefined,
    cluster: resolveOnCluster(),
  }
}

function buildAlterParams() {
  const name = effectiveTable.value?.trim()
  if (!name) throw new Error(t('modules.clickhouse.design.needTableName'))
  const ops = buildAlterDesignOps(
    origColumns.value,
    columns.value,
    origComment.value,
    tableComment.value,
    origOrderBy.value,
    orderByExpression.value,
    origIndexes.value,
    indexes.value,
  )
  if (!ops.length) throw new Error(t('modules.clickhouse.design.noChanges'))
  return {
    sessionId: props.sessionId ?? undefined,
    database: props.database,
    name,
    ops,
    cluster: resolveOnCluster(),
  }
}

async function syncClusterOptions(): Promise<void> {
  if (!props.profileId) return
  const preferred = await fetchConnectionDefaultCluster(props.profileId)
  const caps = dialectCaps.value
  // 方言能力已就绪且无集群 → 跳过；能力未就绪则自行探测 Keeper
  const capabilityHint =
    caps.length === 0 ? undefined : caps.includes('clickhouse.cluster')
  await reloadClusters({
    profileId: props.profileId,
    sessionId: props.sessionId,
    preferred,
    capabilityHint,
  })
}

async function runPreview(): Promise<void> {
  previewLoading.value = true
  try {
    const result = modeCreate.value
      ? await clickhouseApi.ddlCreateTablePreview(buildCreateParams())
      : await clickhouseApi.ddlDesignPreview(buildAlterParams())
    previewSqls.value = result.sql ?? []
    showPreview.value = true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    previewLoading.value = false
  }
}

async function onApply(): Promise<void> {
  if (!props.sessionId) {
    toast.error(t('modules.clickhouse.monitor.needSession'))
    return
  }
  saving.value = true
  try {
    if (modeCreate.value) {
      const params = buildCreateParams()
      await clickhouseApi.ddlCreateTable({ ...params, sessionId: props.sessionId })
      toast.success(t('modules.clickhouse.design.createOk'))
      localDesignMode.value = 'alter'
      localTable.value = params.name
      tableName.value = params.name
      await refreshTree(params.name)
      await load()
    } else {
      const params = buildAlterParams()
      await clickhouseApi.ddlDesignApply({ ...params, sessionId: props.sessionId })
      toast.success(t('modules.clickhouse.design.applyOk'))
      await refreshTree(params.name)
      await load()
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}

async function refreshTree(_table: string): Promise<void> {
  if (!props.profileId || !props.database) return
  // 必须带 kind：否则 ensureConnKind / getConnTreeProvider 失败，缓存已删却无法重拉，分类会空塌
  const conn = { profileId: props.profileId, kind: 'clickhouse' } as ConnItem
  await refreshResourceIfLoaded(
    conn,
    {
      segments: [
        { kind: 'database', name: props.database },
        { kind: 'category', name: 'tables' },
      ],
    },
    { deep: false },
  ).catch(() => undefined)
}

async function copyPreview(): Promise<void> {
  const text = previewSqls.value.join(';\n\n')
  if (!text.trim()) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('modules.clickhouse.design.copyPreviewOk'))
  } catch {
    toast.error(t('modules.clickhouse.design.copyPreviewFailed'))
  }
}

async function onPreviewOpenChange(open: boolean): Promise<void> {
  showPreview.value = open
  if (open) await runPreview()
}

watch(
  () => [props.sessionId, props.database, props.table, props.designMode, props.active] as const,
  () => {
    if (props.active) void load()
  },
  { immediate: true },
)

watch(
  () => [props.sessionId, props.profileId, props.active, dialectCaps.value.join('|')] as const,
  () => {
    if (props.active && props.profileId) void syncClusterOptions()
  },
  { immediate: true },
)
</script>

<template>
  <TableDesignShell
    :labels="shellLabels"
    :title="title"
    :mode="modeCreate ? 'create' : 'alter'"
    :scope-label="sessionLabel"
    :loading="loading"
    :saving="saving"
    :show-reload="!modeCreate"
    :sections="sections"
    :active-section="activeSection"
    @reload="load"
    @apply="onApply"
    @update:active-section="onSectionChange"
  >
    <template #preview>
      <TableDesignPreviewPopover
        :open="showPreview"
        :title="shellLabels.previewTitle"
        :sql="previewSqls"
        :loading="previewLoading"
        :copy-label="shellLabels.copyPreview"
        :empty-label="t('modules.clickhouse.design.noChanges')"
        @update:open="onPreviewOpenChange"
        @copy="copyPreview"
      >
        <RsButton size="sm" variant="ghost" :disabled="loading">
          {{ shellLabels.preview }}
        </RsButton>
      </TableDesignPreviewPopover>
    </template>

    <template #toolbar-extra>
      <RsButton
        v-if="activeSection === 'columns'"
        size="sm"
        variant="ghost"
        @click="addColumn"
      >
        {{ t('modules.clickhouse.design.addColumn') }}
      </RsButton>
      <RsButton
        v-if="activeSection === 'indexes'"
        size="sm"
        variant="ghost"
        @click="addIndex"
      >
        {{ t('modules.clickhouse.design.addIndex') }}
      </RsButton>
      <RsButton
        v-if="(activeSection === 'columns' && selectedColumn) || (activeSection === 'indexes' && selectedIndex)"
        size="sm"
        variant="ghost"
        @click="removeSelected"
      >
        {{ t('modules.clickhouse.design.remove') }}
      </RsButton>
      <RsButton
        size="sm"
        variant="ghost"
        icon="arrow-up"
        :disabled="activeSection !== 'columns' || !selectedKey"
        :title="shellLabels.moveUp"
        @click="moveSelectedColumn(-1)"
      />
      <RsButton
        size="sm"
        variant="ghost"
        icon="arrow-down"
        :disabled="activeSection !== 'columns' || !selectedKey"
        :title="shellLabels.moveDown"
        @click="moveSelectedColumn(1)"
      />
    </template>

    <template #meta>
      <div class="nm-ch-design__meta-row">
        <label class="nm-ch-design__meta-label">{{ t('modules.clickhouse.design.tableName') }}</label>
        <RsInput
          v-if="modeCreate"
          v-model="tableName"
          size="sm"
          :placeholder="t('modules.clickhouse.design.tableNamePh')"
        />
        <span v-else class="nm-ch-design__meta-readonly">{{ effectiveTable || tableName }}</span>
      </div>
      <div class="nm-ch-design__meta-row">
        <label class="nm-ch-design__meta-label">{{ t('modules.clickhouse.design.engine') }}</label>
        <RsSelect
          :model-value="engineBase"
          size="sm"
          :options="engineBaseOptions"
          :disabled="!engineEditable"
          :placeholder="t('modules.clickhouse.design.enginePh')"
          @update:model-value="onEngineBaseChange"
        />
      </div>
      <div v-if="showEngineArgs" class="nm-ch-design__meta-row">
        <label class="nm-ch-design__meta-label">{{ t('modules.clickhouse.design.engineArgs') }}</label>
        <RsInput
          v-model="engineArgs"
          size="sm"
          :disabled="!engineEditable"
          :placeholder="engineOpt?.paramHint || t('modules.clickhouse.design.engineArgsPh')"
        />
      </div>
      <div class="nm-ch-design__meta-row nm-ch-design__meta-row--wide">
        <label class="nm-ch-design__meta-label">{{ t('modules.clickhouse.design.orderBy') }} *</label>
        <RsSelect
          :model-value="orderByCustom ? undefined : orderByParts"
          size="sm"
          multiple
          searchable
          creatable
          :options="columnNameOptions"
          :disabled="!!orderByCustom"
          :placeholder="t('modules.clickhouse.design.orderByPh')"
          @update:model-value="setOrderByFromSelect"
        />
      </div>
      <div class="nm-ch-design__meta-row nm-ch-design__meta-row--wide">
        <RsTooltip
          icon
          :content="t('modules.clickhouse.design.orderByExprHint')"
          side="bottom"
          align="start"
        >
          <label class="nm-ch-design__meta-label">{{ t('modules.clickhouse.design.orderByExpr') }}</label>
        </RsTooltip>
        <RsInput
          v-model="orderByCustom"
          size="sm"
          clearable
          :placeholder="t('modules.clickhouse.design.orderByExprPh')"
        />
      </div>
      <div class="nm-ch-design__meta-row nm-ch-design__meta-row--full">
        <label class="nm-ch-design__meta-label">{{ t('modules.clickhouse.design.tableComment') }}</label>
        <RsInput
          v-model="tableComment"
          size="sm"
          :placeholder="t('modules.clickhouse.design.tableCommentPh')"
        />
      </div>
    </template>

    <template #list>
      <template v-if="activeSection === 'columns'">
        <RsEmpty
          v-if="!columnRows.length"
          :description="t('modules.clickhouse.design.needColumns')"
        />
        <RsTable
          v-else
          class="nm-ch-design__grid"
          :columns="columnColumns"
          :data="columnRows"
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
          :highlighted-row-key="selectedKey"
          :context-menu-items="
            (row) =>
              row
                ? [
                    {
                      key: 'remove',
                      label: t('modules.clickhouse.design.remove'),
                      icon: 'trash-2',
                      danger: true,
                    },
                  ]
                : []
          "
          @row-click="(row: ColRow) => (selectedKey = row.__rowKey)"
          @cell-edit-commit="onColCommit"
          @row-drop="onColumnRowDrop"
          @context-menu-select="(key, row) => key === 'remove' && row && removeCol(String(row.__rowKey))"
        />
      </template>
      <template v-else-if="activeSection === 'indexes'">
        <RsEmpty
          v-if="!indexRows.length"
          :description="t('modules.clickhouse.design.indexesEmpty')"
        />
        <RsTable
          v-else
          class="nm-ch-design__grid"
          :columns="indexColumns"
          :data="indexRows"
          row-key="__rowKey"
          size="sm"
          striped
          fill
          bordered
          column-bordered
          editable
          :edit-gutter="false"
          edit-trigger="dblclick"
          :highlighted-row-key="selectedKey"
          :context-menu-items="
            (row) =>
              row
                ? [
                    {
                      key: 'remove',
                      label: t('modules.clickhouse.design.remove'),
                      icon: 'trash-2',
                      danger: true,
                    },
                  ]
                : []
          "
          @row-click="(row: IdxRow) => (selectedKey = row.__rowKey)"
          @cell-edit-commit="onIdxCommit"
          @context-menu-select="(key, row) => key === 'remove' && row && removeCol(String(row.__rowKey))"
        />
      </template>
      <div v-else class="nm-ch-design__options">
        <div class="nm-ch-design__options-grid">
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.partitionBy') }}</label>
            <RsSelect
              v-model="partitionBy"
              size="sm"
              creatable
              clearable
              :options="partitionByOptions"
              :disabled="!partitionEditable"
              :placeholder="t('modules.clickhouse.design.partitionByPh')"
            />
          </div>
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.primaryKey') }}</label>
            <RsSelect
              :model-value="primaryKeyCustom ? undefined : primaryKeyParts"
              size="sm"
              multiple
              searchable
              creatable
              clearable
              :options="columnNameOptions"
              :disabled="!modeCreate || !!primaryKeyCustom"
              :placeholder="t('modules.clickhouse.design.primaryKeyPh')"
              @update:model-value="setPrimaryKeyFromSelect"
            />
          </div>
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.primaryKeyExpr') }}</label>
            <RsInput
              v-model="primaryKeyCustom"
              size="sm"
              :disabled="!modeCreate"
              :placeholder="t('modules.clickhouse.design.primaryKeyExprPh')"
            />
          </div>
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.sampleBy') }}</label>
            <RsInput
              v-model="sampleBy"
              size="sm"
              :disabled="!modeCreate"
              :placeholder="t('modules.clickhouse.design.sampleByPh')"
            />
          </div>
          <div class="nm-ch-design__field nm-ch-design__field--wide">
            <label>{{ t('modules.clickhouse.design.ttl') }}</label>
            <RsInput
              v-model="ttl"
              size="sm"
              :disabled="!modeCreate"
              :placeholder="t('modules.clickhouse.design.ttlPh')"
            />
          </div>
          <div class="nm-ch-design__field nm-ch-design__field--wide">
            <label>{{ t('modules.clickhouse.design.settings') }}</label>
            <RsInput
              v-model="settings"
              size="sm"
              :disabled="!modeCreate"
              :placeholder="t('modules.clickhouse.design.settingsPh')"
            />
          </div>
          <div v-if="supportOnCluster" class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.onCluster') }}</label>
            <RsSelect
              v-model="cluster"
              size="sm"
              :options="clusterOptions"
              :disabled="clustersLoading"
              :placeholder="t('modules.clickhouse.design.onClusterPh')"
              clearable
              searchable
              creatable
            />
          </div>
        </div>
        <p class="nm-ch-design__hint">
          {{
            modeCreate
              ? t('modules.clickhouse.design.optionsCreateHint')
              : t('modules.clickhouse.design.optionsAlterHint')
          }}
        </p>
        <p v-if="modeCreate" class="nm-ch-design__hint">
          {{ t('modules.clickhouse.design.enginePreview', { engine: composedEngine }) }}
          · ORDER BY {{ orderByExpression || '—' }}
        </p>
      </div>
    </template>

    <template #editor>
      <template v-if="activeSection === 'columns' && selectedColumn">
        <div class="nm-ch-design__editor-title">{{ t('modules.clickhouse.design.editColumn') }}</div>
        <div class="nm-ch-design__form">
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.colName') }}</label>
            <RsInput
              :model-value="selectedColumn.name"
              size="sm"
              @update:model-value="updateColSideField(selectedColumn!.__rowKey, 'name', String($event ?? ''))"
            />
          </div>
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.colType') }}</label>
            <RsSelect
              :model-value="selectedColumn.typeBase"
              size="sm"
              creatable
              searchable
              :options="typeBaseOptions"
              @update:model-value="updateColSideField(selectedColumn!.__rowKey, 'typeBase', String($event))"
            />
          </div>
          <div
            v-if="showTypeLength(selectedColumn.typeBase)"
            class="nm-ch-design__field"
          >
            <label>{{ typeLengthLabel(selectedColumn.typeBase) }}</label>
            <RsInput
              :model-value="selectedColumn.typeLength != null ? String(selectedColumn.typeLength) : ''"
              size="sm"
              :placeholder="t('modules.clickhouse.design.colPrecisionPh')"
              @update:model-value="
                updateColSideField(
                  selectedColumn!.__rowKey,
                  'typeLength',
                  Number.parseInt(String($event ?? ''), 10) || undefined,
                )
              "
            />
          </div>
          <div
            v-if="showTypeScale(selectedColumn.typeBase)"
            class="nm-ch-design__field"
          >
            <label>{{ t('modules.clickhouse.design.colScale') }}</label>
            <RsInput
              :model-value="selectedColumn.typeScale != null ? String(selectedColumn.typeScale) : ''"
              size="sm"
              :placeholder="t('modules.clickhouse.design.colScalePh')"
              @update:model-value="
                updateColSideField(
                  selectedColumn!.__rowKey,
                  'typeScale',
                  Number.parseInt(String($event ?? ''), 10) || undefined,
                )
              "
            />
          </div>
          <div
            v-if="showTypeInner(selectedColumn.typeBase)"
            class="nm-ch-design__field"
          >
            <label>{{ typeInnerLabel(selectedColumn.typeBase) }}</label>
            <RsSelect
              :model-value="selectedColumn.typeInner"
              size="sm"
              creatable
              searchable
              :options="dataTypeParamKind(selectedColumn.typeBase) === 'map' ? mapInnerOptions : innerTypeOptions"
              :placeholder="t('modules.clickhouse.design.colInnerPh')"
              @update:model-value="
                updateColSideField(selectedColumn!.__rowKey, 'typeInner', String($event ?? ''))
              "
            />
          </div>
          <div
            v-if="showEnumValues(selectedColumn.typeBase)"
            class="nm-ch-design__field"
          >
            <label>{{ t('modules.clickhouse.design.colEnum') }}</label>
            <RsInput
              :model-value="selectedColumn.enumValues"
              size="sm"
              :placeholder="t('modules.clickhouse.design.colEnumPh')"
              @update:model-value="
                updateColSideField(selectedColumn!.__rowKey, 'enumValues', String($event ?? ''))
              "
            />
          </div>
          <div class="nm-ch-design__field nm-ch-design__field--check">
            <label>{{ t('modules.clickhouse.design.colNullable') }}</label>
            <input
              type="checkbox"
              :checked="selectedColumn.nullable"
              @change="
                updateColSideField(
                  selectedColumn!.__rowKey,
                  'nullable',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
          </div>
          <div class="nm-ch-design__field nm-ch-design__field--check">
            <label>{{ t('modules.clickhouse.design.colLowCard') }}</label>
            <input
              type="checkbox"
              :checked="selectedColumn.lowCardinality"
              @change="
                updateColSideField(
                  selectedColumn!.__rowKey,
                  'lowCardinality',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
          </div>
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.colDataType') }}</label>
            <RsInput :model-value="selectedColumn.dataType" size="sm" disabled />
          </div>
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.colDefault') }}</label>
            <RsInput
              :model-value="selectedColumn.defaultExpr"
              size="sm"
              :placeholder="t('modules.clickhouse.design.colDefaultPh')"
              @update:model-value="
                updateColSideField(selectedColumn!.__rowKey, 'defaultExpr', String($event ?? ''))
              "
            />
          </div>
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.colCodec') }}</label>
            <RsSelect
              :model-value="selectedColumn.codec"
              size="sm"
              creatable
              clearable
              :disabled="!modeCreate"
              :options="codecOptions"
              :placeholder="t('modules.clickhouse.design.colCodecPh')"
              @update:model-value="
                updateColSideField(selectedColumn!.__rowKey, 'codec', String($event ?? ''))
              "
            />
          </div>
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.colComment') }}</label>
            <RsInput
              :model-value="selectedColumn.comment"
              size="sm"
              :placeholder="t('modules.clickhouse.design.colCommentPh')"
              @update:model-value="
                updateColSideField(selectedColumn!.__rowKey, 'comment', String($event ?? ''))
              "
            />
          </div>
          <p class="nm-ch-design__hint">{{ t('modules.clickhouse.design.gridEditHint') }}</p>
        </div>
      </template>
      <template v-else-if="activeSection === 'indexes' && selectedIndex">
        <div class="nm-ch-design__editor-title">{{ t('modules.clickhouse.design.editIndex') }}</div>
        <div class="nm-ch-design__form">
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.idxName') }}</label>
            <RsInput v-model="selectedIndex.name" size="sm" />
          </div>
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.idxExpr') }}</label>
            <RsSelect
              v-model="selectedIndex.expression"
              size="sm"
              creatable
              :options="indexExprOptions"
              :placeholder="t('modules.clickhouse.design.idxExprPh')"
            />
          </div>
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.idxType') }}</label>
            <RsSelect
              v-model="selectedIndex.type"
              size="sm"
              :options="indexTypeOptions"
            />
          </div>
          <div class="nm-ch-design__field">
            <label>{{ t('modules.clickhouse.design.idxGranularity') }}</label>
            <RsInput
              :model-value="String(selectedIndex.granularity || 1)"
              size="sm"
              :placeholder="t('modules.clickhouse.design.idxGranularityPh')"
              @update:model-value="setSelectedIndexGranularity"
            />
          </div>
        </div>
      </template>
      <div v-else class="nm-ch-design__editor-empty">
        <RsEmpty
          fill
          radius="none"
          icon-radius="none"
          :description="activeSection === 'indexes'
            ? t('modules.clickhouse.design.selectIndex')
            : activeSection === 'options'
              ? t('modules.clickhouse.design.optionsEditorHint')
              : t('modules.clickhouse.design.selectRow')"
        />
      </div>
    </template>
  </TableDesignShell>
</template>

<style scoped>
.nm-ch-design__meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.nm-ch-design__meta-row :deep(.rs-select),
.nm-ch-design__meta-row :deep(.rs-input) {
  flex: 1;
  min-width: 120px;
}
.nm-ch-design__meta-row--wide :deep(.rs-select),
.nm-ch-design__meta-row--wide :deep(.rs-input) {
  min-width: 160px;
}
.nm-ch-design__meta-row--full {
  flex: 1;
  min-width: 200px;
}
.nm-ch-design__meta-row--full :deep(.rs-input) {
  flex: 1;
  min-width: 140px;
}
.nm-ch-design__meta-label {
  font-size: 12px;
  color: var(--rs-fg-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.nm-ch-design__meta-row :deep(.rs-tooltip__with-icon) {
  flex-shrink: 0;
}
.nm-ch-design__meta-readonly {
  font-size: 12px;
  font-weight: 500;
  min-width: 80px;
}
.nm-ch-design__grid {
  flex: 1;
  min-height: 0;
}
.nm-ch-design__options {
  padding: 12px;
  overflow: auto;
}
.nm-ch-design__options-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.nm-ch-design__hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--rs-fg-muted);
  line-height: 1.5;
}
.nm-ch-design__editor-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--rs-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.nm-ch-design__editor-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nm-ch-design__form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nm-ch-design__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.nm-ch-design__field--wide {
  grid-column: 1 / -1;
}
.nm-ch-design__field label {
  font-size: 11px;
  color: var(--rs-fg-muted);
}
.nm-ch-design__field--check {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
</style>
