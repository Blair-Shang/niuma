<script setup lang="ts" generic="T extends import('./table-utils').RsTableRowData">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRsI18n } from '../composables/useRsI18n'
import RsIcon from './RsIcon.vue'
import RsContextMenu from './RsContextMenu.vue'
import type { RsContextMenuItem } from './context-menu-utils'
import type {
  RsTableColumn,
  RsTableGroupBy,
  RsTableRowDropPosition,
  RsTableRowEntry,
  RsTableRowKey,
  RsTableSelectionType,
  RsTableSize,
  RsTableSortOrder,
  RsTableSortState,
} from './table-utils'
import {
  buildTableEntries,
  clampColumnWidth,
  createInitialColumnWidths,
  fixedCellStyle,
  getCellValue,
  getSortOrderForKey,
  getSortPriorityForKey,
  injectExpandRows,
  isNearScrollBottom,
  isTableRowDisabled,
  parseColumnWidth,
  reorderColumnKeys,
  resolveColumnOrder,
  resolveColumnStyle,
  resolveEntryKey,
  resolveFixedColumnStyles,
  resolveOrderedColumns,
  resolveRowKey,
  resolveScrollWidth,
  resolveSelectAllState,
  resolveTableRowHeight,
  resolveTableSize,
  resolveTableVirtualEnabled,
  selectRowKeys,
  sliceVirtualTableEntries,
  toggleExpandedRowKeys,
  toggleMultiSortState,
  toggleSelectAll,
  toggleSortState,
} from './table-utils'
import {
  createTableRowDragHandlers,
  createTableRowDragState,
  type RsTableRowDragTrigger,
  type RsTableRowDropMode,
} from './table-drag'
import { resolveVirtualListHeight } from './virtual-list-utils'

const props = withDefaults(
  defineProps<{
    columns: RsTableColumn<T>[]
    data: T[]
    rowKey?: RsTableRowKey<T>
    loading?: boolean
    bordered?: boolean
    compact?: boolean
    size?: RsTableSize
    scrollX?: number | string
    selectable?: boolean
    selectionType?: RsTableSelectionType
    selectedRowKeys?: string[]
    defaultSelectedRowKeys?: string[]
    rowSelectable?: (row: T, index: number) => boolean
    expandable?: boolean
    expandedRowKeys?: string[]
    defaultExpandedRowKeys?: string[]
    rowExpandable?: (row: T, index: number) => boolean
    expandRowHeight?: number
    striped?: boolean
    showIndex?: boolean
    showHeader?: boolean
    remoteSort?: boolean
    filterText?: string
    filterKeys?: string[]
    groupBy?: RsTableGroupBy<T>
    groupLabel?: (key: string) => string
    sort?: RsTableSortState | null
    defaultSort?: RsTableSortState | null
    multiSort?: boolean
    maxSort?: number
    sorts?: RsTableSortState[]
    defaultSorts?: RsTableSortState[]
    columnDraggable?: boolean
    columnOrder?: string[]
    defaultColumnOrder?: string[]
    rowDraggable?: boolean
    /** 行拖拽触发方式：手柄列或整行 */
    rowDragTrigger?: RsTableRowDragTrigger
    /** reorder=上下插入排序；into=拖入目标行 */
    rowDropMode?: RsTableRowDropMode
    rowDraggableWhen?: (row: T, index: number) => boolean
    rowDropTargetWhen?: (row: T, index: number) => boolean
    canRowDrop?: (dragKeys: string[], dropKey: string) => boolean
    virtual?: boolean
    height?: number | string
    rowHeight?: number
    overscan?: number
    infinite?: boolean
    hasMore?: boolean
    loadingMore?: boolean
    infiniteDistance?: number
    virtualOnInfinite?: boolean
    resizable?: boolean
    columnWidths?: Record<string, number>
    minColumnWidth?: number
    maxColumnWidth?: number
    /** 右键行时自动选中（selectable 开启时默认 true） */
    selectOnContextmenu?: boolean
    /**
     * 右键菜单项工厂函数。提供后 RsTable 内部集成 RsContextMenu，
     * 无需业务层再包裹。
     * @param row 右键的行（空白区域为 null）
     * @param selectedRows 当前已选行
     */
    contextMenuItems?: (row: T | null, selectedRows: T[]) => RsContextMenuItem[]
  }>(),
  {
    loading: false,
    bordered: true,
    compact: false,
    size: 'md',
    selectable: false,
    selectionType: 'checkbox',
    expandable: false,
    defaultExpandedRowKeys: () => [],
    striped: false,
    showIndex: false,
    showHeader: true,
    remoteSort: false,
    defaultSelectedRowKeys: () => [],
    defaultSorts: () => [],
    defaultColumnOrder: () => [],
    multiSort: false,
    maxSort: 3,
    columnDraggable: false,
    rowDraggable: false,
    rowDragTrigger: 'handle',
    rowDropMode: 'reorder',
    overscan: 4,
    infiniteDistance: 80,
    virtualOnInfinite: true,
    minColumnWidth: 48,
    maxColumnWidth: 640,
  },
)

const emit = defineEmits<{
  rowClick: [row: T, index: number]
  rowDblclick: [row: T, index: number]
  rowContextmenu: [row: T, index: number, event: MouseEvent]
  contextMenuSelect: [key: string, row: T | null, selectedRows: T[]]
  'update:sort': [value: RsTableSortState | null]
  'update:sorts': [value: RsTableSortState[]]
  sortsChange: [value: RsTableSortState[]]
  'update:columnOrder': [value: string[]]
  columnOrderChange: [value: string[]]
  rowDrop: [dragKeys: string[], dropKey: string, position: RsTableRowDropPosition]
  rowDragStart: [dragKeys: string[], event: DragEvent]
  'update:selectedRowKeys': [keys: string[]]
  'update:expandedRowKeys': [keys: string[]]
  selectionChange: [keys: string[]]
  expandChange: [keys: string[]]
  loadMore: []
  'update:columnWidths': [value: Record<string, number>]
  columnResize: [key: string, width: number]
}>()

const { t } = useRsI18n()

const internalSort = ref<RsTableSortState | null>(props.defaultSort ?? null)
const internalSorts = ref<RsTableSortState[]>([...props.defaultSorts])
const internalColumnOrder = ref<string[]>([...props.defaultColumnOrder])
const scrollTop = ref(0)
const internalColumnWidths = ref<Record<string, number>>({})
const loadMoreLocked = ref(false)
const internalSelectedRowKeys = ref<string[]>([...props.defaultSelectedRowKeys])
const internalExpandedRowKeys = ref<string[]>([...props.defaultExpandedRowKeys])
const dragColumnKey = ref<string | null>(null)
const rowDragState = createTableRowDragState()
const { dragRowKeys, dropRowTargetKey, dropRowPosition } = rowDragState
const showRowDragHandle = computed(
  () => props.rowDraggable && props.rowDragTrigger === 'handle',
)

const resolvedSize = computed(() => resolveTableSize(props.compact, props.size))

const isSelectionControlled = computed(() => props.selectedRowKeys !== undefined)
const selectedRowKeys = computed({
  get: () => (isSelectionControlled.value ? props.selectedRowKeys ?? [] : internalSelectedRowKeys.value),
  set: (value: string[]) => {
    if (isSelectionControlled.value) emit('update:selectedRowKeys', value)
    else internalSelectedRowKeys.value = value
    emit('selectionChange', value)
  },
})

const selectedKeySet = computed(() => new Set(selectedRowKeys.value))

const isExpandedControlled = computed(() => props.expandedRowKeys !== undefined)
const expandedRowKeys = computed({
  get: () => (isExpandedControlled.value ? props.expandedRowKeys ?? [] : internalExpandedRowKeys.value),
  set: (value: string[]) => {
    if (isExpandedControlled.value) emit('update:expandedRowKeys', value)
    else internalExpandedRowKeys.value = value
    emit('expandChange', value)
  },
})
const expandedKeySet = computed(() => new Set(expandedRowKeys.value))

const useVirtualScroll = computed(() =>
  resolveTableVirtualEnabled({
    virtual: props.virtual,
    infinite: props.infinite,
    virtualOnInfinite: props.virtualOnInfinite,
  }),
)

const useScrollContainer = computed(() => useVirtualScroll.value || props.infinite)

const isSortControlled = computed(() => props.sort !== undefined)
const sortState = computed({
  get: () => (isSortControlled.value ? props.sort ?? null : internalSort.value),
  set: (value: RsTableSortState | null) => {
    if (isSortControlled.value) emit('update:sort', value)
    else internalSort.value = value
  },
})

const isSortsControlled = computed(() => props.sorts !== undefined)
const sortsState = computed({
  get: () => (isSortsControlled.value ? props.sorts ?? [] : internalSorts.value),
  set: (value: RsTableSortState[]) => {
    if (isSortsControlled.value) emit('update:sorts', value)
    else internalSorts.value = value
    emit('sortsChange', value)
  },
})

const isColumnOrderControlled = computed(() => props.columnOrder !== undefined)
const columnOrderState = computed({
  get: () =>
    isColumnOrderControlled.value
      ? props.columnOrder ?? []
      : internalColumnOrder.value.length
        ? internalColumnOrder.value
        : resolveColumnOrder(props.columns),
  set: (value: string[]) => {
    if (isColumnOrderControlled.value) emit('update:columnOrder', value)
    else internalColumnOrder.value = value
    emit('columnOrderChange', value)
  },
})

const displayColumns = computed(() => resolveOrderedColumns(props.columns, columnOrderState.value))

const isColumnWidthsControlled = computed(() => props.columnWidths !== undefined)
const resolvedColumnWidths = computed({
  get: () => (isColumnWidthsControlled.value ? props.columnWidths ?? {} : internalColumnWidths.value),
  set: (value: Record<string, number>) => {
    if (isColumnWidthsControlled.value) emit('update:columnWidths', value)
    else internalColumnWidths.value = value
  },
})

watch(
  () => props.columns,
  (columns) => {
    const next = createInitialColumnWidths(columns, {
      ...resolvedColumnWidths.value,
      ...props.columnWidths,
    })
    if (!isColumnWidthsControlled.value) internalColumnWidths.value = next
    if (!isColumnOrderControlled.value) {
      internalColumnOrder.value = resolveColumnOrder(columns, internalColumnOrder.value)
    }
  },
  { immediate: true, deep: true },
)

const dragColumnOffset = computed(() => (showRowDragHandle.value ? 40 : 0))
const expandColumnOffset = computed(() => dragColumnOffset.value + (props.expandable ? 40 : 0))
const selectColumnOffset = computed(() => expandColumnOffset.value + (props.selectable ? 40 : 0))

const fixedRowHeight = computed(() => resolveTableRowHeight(resolvedSize.value, props.rowHeight))
const viewportHeight = computed(() => Number.parseInt(resolveVirtualListHeight(props.height, 320), 10))
const tableMinWidth = computed(() => resolveScrollWidth(props.scrollX))
const fixedColumnStyles = computed(() =>
  resolveFixedColumnStyles(displayColumns.value, resolvedColumnWidths.value, {
    selectable: props.selectable,
    showIndex: props.showIndex,
    expandable: props.expandable,
    rowDraggable: showRowDragHandle.value,
  }),
)

const tableEntries = computed(() =>
  injectExpandRows(
    buildTableEntries(props.data, displayColumns.value, {
      sort: sortState.value,
      sorts: sortsState.value,
      multiSort: props.multiSort,
      filterText: props.filterText,
      filterKeys: props.filterKeys,
      groupBy: props.groupBy,
      groupLabel: props.groupLabel,
      remoteSort: props.remoteSort,
    }),
    expandedKeySet.value,
    props.rowKey,
    props.rowExpandable,
  ),
)

const virtualSlice = computed(() => {
  if (!useVirtualScroll.value) {
    return { entries: tableEntries.value, paddingTop: 0, paddingBottom: 0 }
  }
  return sliceVirtualTableEntries(
    tableEntries.value,
    scrollTop.value,
    viewportHeight.value,
    fixedRowHeight.value,
    undefined,
    props.overscan,
    (props.expandRowHeight ?? undefined) as 80 | undefined,
  )
})

const visibleEntries = computed(() => virtualSlice.value.entries)
const hasData = computed(() => dataRows.value.length > 0)

/**
 * 单次遍历 tableEntries，产出 dataRows、selectableRowKeys、rowKeyByIndex。
 * - 仅依赖 tableEntries（排序/过滤/数据变化），不依赖 selectedKeySet，
 *   避免选中操作触发不必要的全量重遍历。
 * - rowKeyByIndex：rowIndex → rowKey，供模板和内部函数 O(1) 查询，
 *   消除每行 8+ 次重复 resolveRowKey 调用。
 */
const rowDerivedState = computed(() => {
  const rows: Extract<RsTableRowEntry<T>, { type: 'row' }>[] = []
  const selKeys: string[] = []
  const keyByIndex = new Map<number, string>()
  for (const entry of tableEntries.value) {
    if (entry.type !== 'row') continue
    rows.push(entry)
    const key = resolveRowKey(entry.row, entry.rowIndex, props.rowKey)
    keyByIndex.set(entry.rowIndex, key)
    const disabled = isTableRowDisabled(entry.row)
    if (!disabled && (props.rowSelectable ? props.rowSelectable(entry.row, entry.rowIndex) : true)) {
      selKeys.push(key)
    }
  }
  return { rows, selKeys, keyByIndex }
})

const dataRows = computed(() => rowDerivedState.value.rows)
const selectableRowKeys = computed(() => rowDerivedState.value.selKeys)
/** rowIndex → rowKey 缓存，消除模板热路径重复 resolveRowKey */
const rowKeyByIndex = computed(() => rowDerivedState.value.keyByIndex)

/**
 * 当前已选行对象（供 contextMenuItems 使用）。
 * 依赖 dataRows + selectedKeySet，选中变化时单独重算，
 * 不触发 dataRows/selectableRowKeys 的重遍历。
 */
const selectedRows = computed<T[]>(() => {
  const keySet = selectedKeySet.value
  const keyMap = rowKeyByIndex.value
  return dataRows.value
    .filter((entry) => keySet.has(keyMap.get(entry.rowIndex) ?? ''))
    .map((entry) => entry.row)
})

const selectAllState = computed(() => resolveSelectAllState(selectedRowKeys.value, selectableRowKeys.value))

const bodyColspan = computed(() => {
  let count = displayColumns.value.length
  if (showRowDragHandle.value) count += 1
  if (props.expandable) count += 1
  if (props.selectable) count += 1
  if (props.showIndex) count += 1
  return count
})

const isRadioSelection = computed(() => props.selectionType === 'radio')

let resizeState: { key: string; startX: number; startWidth: number } | null = null

/** 列样式 Map：按 column.key 缓存，避免模板热路径每次创建新对象 */
const columnStyleMap = computed<Map<string, Record<string, string> | undefined>>(() => {
  const map = new Map<string, Record<string, string> | undefined>()
  for (const col of displayColumns.value) {
    const base = resolveColumnStyle(col, resolvedColumnWidths.value) ?? {}
    const fixed = fixedCellStyle(fixedColumnStyles.value.get(col.key))
    let merged: Record<string, string> | undefined
    if (fixed) merged = { ...base, ...fixed }
    else if (Object.keys(base).length) merged = base
    map.set(col.key, merged)
  }
  return map
})

/** 表头列样式：固定列需同时 sticky top + left/right */
const columnHeaderStyleMap = computed<Map<string, Record<string, string> | undefined>>(() => {
  const map = new Map<string, Record<string, string> | undefined>()
  for (const col of displayColumns.value) {
    const base = resolveColumnStyle(col, resolvedColumnWidths.value) ?? {}
    const fixed = fixedCellStyle(fixedColumnStyles.value.get(col.key), { header: true })
    let merged: Record<string, string> | undefined
    if (fixed) merged = { ...base, ...fixed }
    else if (Object.keys(base).length) merged = base
    map.set(col.key, merged)
  }
  return map
})

/** td 静态 class Map：列配置不变时复用，消除每行每列重复拼接 */
const columnTdClassMap = computed<Map<string, string[]>>(() => {
  const map = new Map<string, string[]>()
  for (const col of displayColumns.value) {
    const classes: string[] = [`rs-table__cell--${col.align ?? 'left'}`]
    if (col.ellipsis) classes.push('rs-table__td--ellipsis')
    if (col.fixed) classes.push('rs-table__cell--fixed')
    map.set(col.key, classes)
  }
  return map
})

/** 4 个固定前缀列的 style（拖拽/展开/选择/序号），避免每行重复计算 */
const dragLeadStyle = computed(() => fixedCellStyle({ fixed: 'left', left: 0 }) ?? {})
const expandLeadStyle = computed(() => fixedCellStyle({ fixed: 'left', left: dragColumnOffset.value }) ?? {})
const selectLeadStyle = computed(() => fixedCellStyle({ fixed: 'left', left: expandColumnOffset.value }) ?? {})
const indexLeadStyle = computed(() => fixedCellStyle({ fixed: 'left', left: selectColumnOffset.value }) ?? {})
const dragLeadHeaderStyle = computed(() => fixedCellStyle({ fixed: 'left', left: 0 }, { header: true }) ?? {})
const expandLeadHeaderStyle = computed(() => fixedCellStyle({ fixed: 'left', left: dragColumnOffset.value }, { header: true }) ?? {})
const selectLeadHeaderStyle = computed(() => fixedCellStyle({ fixed: 'left', left: expandColumnOffset.value }, { header: true }) ?? {})
const indexLeadHeaderStyle = computed(() => fixedCellStyle({ fixed: 'left', left: selectColumnOffset.value }, { header: true }) ?? {})

function sortOrderFor(key: string): RsTableSortOrder {
  if (props.multiSort) return getSortOrderForKey(sortsState.value, key)
  return sortState.value?.key === key ? sortState.value.order : null
}

function sortPriorityFor(key: string): number {
  if (!props.multiSort) return 0
  return getSortPriorityForKey(sortsState.value, key)
}

function sortIconName(key: string): string {
  const order = sortOrderFor(key)
  if (order === 'asc') return 'arrow-up'
  if (order === 'desc') return 'arrow-down'
  return 'arrow-up-down'
}

function onHeaderClick(column: RsTableColumn<T>): void {
  if (!column.sortable) return
  if (props.multiSort) {
    sortsState.value = toggleMultiSortState(sortsState.value, column.key, props.maxSort)
    return
  }
  sortState.value = toggleSortState(sortState.value, column.key)
}

function onColumnDragStart(key: string, event: DragEvent): void {
  if (!props.columnDraggable) return
  dragColumnKey.value = key
  if (!event.dataTransfer) return
  event.dataTransfer.setData('text/plain', key)
  event.dataTransfer.effectAllowed = 'move'
}

function onColumnDragOver(key: string, event: DragEvent): void {
  if (!props.columnDraggable || !dragColumnKey.value || dragColumnKey.value === key) return
  event.preventDefault()
}

function onColumnDrop(key: string, event: DragEvent): void {
  if (!props.columnDraggable || !dragColumnKey.value) return
  event.preventDefault()
  if (dragColumnKey.value === key) return
  columnOrderState.value = reorderColumnKeys(columnOrderState.value, dragColumnKey.value, key)
  dragColumnKey.value = null
}

function onColumnDragEnd(): void {
  dragColumnKey.value = null
}

function onRowClick(entry: RsTableRowEntry<T>): void {
  if (entry.type !== 'row') return
  emit('rowClick', entry.row, entry.rowIndex)
}

function onRowDblclick(entry: RsTableRowEntry<T>): void {
  if (entry.type !== 'row') return
  emit('rowDblclick', entry.row, entry.rowIndex)
}

/** 当前右键行（null = 空白区域），仅 contextMenuItems 存在时使用 */
const ctxRow = ref<T | null>(null)

const resolvedCtxItems = computed<RsContextMenuItem[]>(() => {
  if (!props.contextMenuItems) return []
  const selected = selectedRows.value
  return props.contextMenuItems(ctxRow.value as T | null, selected)
})

function onCtxMenuSelect(key: string): void {
  emit('contextMenuSelect', key, ctxRow.value as T | null, selectedRows.value)
}

function onTableContextmenu(event: MouseEvent): void {
  if (!props.contextMenuItems) return
  const tr = (event.target as HTMLElement).closest('tr.rs-table__row')
  if (!tr) ctxRow.value = null
}

function onRowContextmenu(entry: RsTableRowEntry<T>, event: MouseEvent): void {
  if (entry.type !== 'row') return
  const shouldSelect = props.selectOnContextmenu ?? props.selectable
  if (shouldSelect && canSelectRow(entry) && !isRowSelected(entry)) {
    selectedRowKeys.value = selectRowKeys(selectedRowKeys.value, rowKeyFor(entry), props.selectionType)
  }
  if (props.contextMenuItems) ctxRow.value = entry.row
  emit('rowContextmenu', entry.row, entry.rowIndex, event)
}

/** 从缓存 Map 中 O(1) 取行 key，消除重复 resolveRowKey 调用 */
function rowKeyFor(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): string {
  return rowKeyByIndex.value.get(entry.rowIndex) ?? resolveRowKey(entry.row, entry.rowIndex, props.rowKey)
}

const rowDrag = createTableRowDragHandlers<T>({
  state: rowDragState,
  getRowDraggable: () => props.rowDraggable,
  getRowDragTrigger: () => props.rowDragTrigger,
  getRowDropMode: () => props.rowDropMode,
  rowDraggableWhen: props.rowDraggableWhen,
  rowDropTargetWhen: props.rowDropTargetWhen,
  canRowDrop: props.canRowDrop,
  rowKeyFor: (row, index) => resolveRowKey(row, index, props.rowKey),
  isRowDisabled: isTableRowDisabled,
  getSelectedKeys: () => selectedRowKeys.value,
  onDragStart: (dragKeys, event) => emit('rowDragStart', dragKeys, event),
  onDrop: (dragKeys, dropKey, position) => emit('rowDrop', dragKeys, dropKey, position),
})

function onRowDragStart(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>, event: DragEvent): void {
  rowDrag.onRowDragStart(entry.row, entry.rowIndex, event)
}

function onRowDragOver(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>, event: DragEvent): void {
  rowDrag.onRowDragOver(entry.row, entry.rowIndex, event)
}

function onRowDragLeave(event: DragEvent): void {
  rowDrag.onRowDragLeave(event)
}

function onRowDrop(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>, event: DragEvent): void {
  rowDrag.onRowDrop(entry.row, entry.rowIndex, event)
}

function onRowDragEnd(): void {
  rowDrag.onRowDragEnd()
}

function isRowDropTarget(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): boolean {
  return rowDrag.isRowDropTarget(rowKeyFor(entry))
}

function isRowDragging(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): boolean {
  return rowDrag.isRowDragging(rowKeyFor(entry))
}

function canDragRow(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): boolean {
  return rowDrag.canDragRow(entry.row, entry.rowIndex)
}

function isRowDragByRow(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): boolean {
  return props.rowDraggable && props.rowDragTrigger === 'row' && canDragRow(entry)
}

function isRowSelected(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): boolean {
  return selectedKeySet.value.has(rowKeyFor(entry))
}

function canSelectRow(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): boolean {
  if (isTableRowDisabled(entry.row)) return false
  return props.rowSelectable ? props.rowSelectable(entry.row, entry.rowIndex) : true
}

function onToggleRow(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): void {
  if (!canSelectRow(entry)) return
  selectedRowKeys.value = selectRowKeys(selectedRowKeys.value, rowKeyFor(entry), props.selectionType)
}

function canExpandRow(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): boolean {
  if (!props.expandable) return false
  if (props.rowExpandable) return props.rowExpandable(entry.row, entry.rowIndex)
  return true
}

function isRowExpanded(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): boolean {
  return expandedKeySet.value.has(rowKeyFor(entry))
}

function onToggleExpand(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): void {
  if (!canExpandRow(entry)) return
  expandedRowKeys.value = toggleExpandedRowKeys(expandedRowKeys.value, rowKeyFor(entry))
}

function onToggleSelectAll(): void {
  const select = selectAllState.value !== 'checked'
  selectedRowKeys.value = toggleSelectAll(selectedRowKeys.value, selectableRowKeys.value, select)
}

/** RAF handle，用于节流滚动更新；组件卸载时取消，防止内存泄漏 */
let scrollRafId = 0

function onScroll(event: Event): void {
  const element = event.target as HTMLElement
  // 无限加载判断不节流，保证触底灵敏
  if (props.infinite && !props.loading && !props.loadingMore && props.hasMore && !loadMoreLocked.value) {
    if (isNearScrollBottom(element.scrollTop, element.scrollHeight, element.clientHeight, props.infiniteDistance)) {
      loadMoreLocked.value = true
      emit('loadMore')
    }
  }
  // 虚拟滚动位置更新用 RAF 节流：每帧最多更新一次，避免高频重算 virtualSlice
  if (useVirtualScroll.value) {
    if (scrollRafId) return
    scrollRafId = requestAnimationFrame(() => {
      scrollTop.value = element.scrollTop
      scrollRafId = 0
    })
  } else {
    scrollTop.value = element.scrollTop
  }
}

watch(
  () => [props.loadingMore, props.hasMore] as const,
  ([loadingMore, hasMore]) => {
    if (!loadingMore || !hasMore) loadMoreLocked.value = false
  },
)

function onResizeMove(event: MouseEvent): void {
  if (!resizeState) return
  const nextWidth = clampColumnWidth(
    resizeState.startWidth + event.clientX - resizeState.startX,
    props.minColumnWidth,
    props.maxColumnWidth,
  )
  const next = { ...resolvedColumnWidths.value, [resizeState.key]: nextWidth }
  resolvedColumnWidths.value = next
  emit('columnResize', resizeState.key, nextWidth)
}

function stopResize(): void {
  resizeState = null
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', stopResize)
}

function onResizeStart(key: string, event: MouseEvent): void {
  if (!props.resizable) return
  const column = displayColumns.value.find((item) => item.key === key)
  const startWidth = resolvedColumnWidths.value[key] ?? parseColumnWidth(column?.width)
  resizeState = { key, startX: event.clientX, startWidth }
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', stopResize)
}

onUnmounted(() => {
  stopResize()
  if (scrollRafId) {
    cancelAnimationFrame(scrollRafId)
    scrollRafId = 0
  }
})
</script>

<template>
  <RsContextMenu
    :disabled="!contextMenuItems"
    :items="resolvedCtxItems"
    @select="onCtxMenuSelect"
  >
    <!-- shell 作为 ContextMenuTrigger 宿主；::before 伪元素铺满 shell 捕获空白区右键 -->
    <div
      class="rs-table-shell"
      :class="{ 'rs-table-shell--ctx': !!contextMenuItems }"
      @contextmenu="onTableContextmenu"
    >
      <div
        class="rs-table rs-native-scrollbar"
        :class="{
          'rs-table--bordered': bordered,
          'rs-table--compact': compact,
          [`rs-table--${resolvedSize}`]: true,
          'rs-table--virtual': useVirtualScroll,
          'rs-table--infinite': infinite,
          'rs-table--resizable': resizable,
          'rs-table--striped': striped,
          'rs-table--selectable': selectable,
          'rs-table--expandable': expandable,
          'rs-table--draggable': rowDraggable || columnDraggable,
          'rs-table--scroll-x': !!scrollX,
          'rs-table--ctx': !!contextMenuItems,
        }"
        :style="useScrollContainer ? { maxHeight: resolveVirtualListHeight(height, 320) } : undefined"
        @scroll="onScroll"
      >
    <table class="rs-table__table" :style="tableMinWidth ? { minWidth: tableMinWidth } : undefined">
      <thead v-if="showHeader" class="rs-table__head">
        <tr>
          <th
            v-if="showRowDragHandle"
            class="rs-table__th rs-table__th--drag"
            :style="dragLeadHeaderStyle"
          />
          <th
            v-if="expandable"
            class="rs-table__th rs-table__th--expand"
            :style="expandLeadHeaderStyle"
          />
          <th
            v-if="selectable"
            class="rs-table__th rs-table__th--selection"
            :style="selectLeadHeaderStyle"
          >
            <label
              v-if="!isRadioSelection"
              class="rs-table__checkbox"
              :class="{
                'rs-table__checkbox--checked': selectAllState === 'checked',
                'rs-table__checkbox--indeterminate': selectAllState === 'indeterminate',
              }"
            >
              <input
                type="checkbox"
                class="rs-table__checkbox-input"
                :checked="selectAllState === 'checked'"
                :aria-label="t('table.selectAll')"
                @change="onToggleSelectAll"
              >
              <span class="rs-table__checkbox-box" aria-hidden="true" />
            </label>
          </th>
          <th
            v-if="showIndex"
            class="rs-table__th rs-table__th--index rs-table__cell--center"
            :style="indexLeadHeaderStyle"
          >
            {{ t('table.index') }}
          </th>
          <th
            v-for="column in displayColumns"
            :key="column.key"
            class="rs-table__th"
            :class="[
              `rs-table__cell--${column.align ?? 'left'}`,
              { 'rs-table__th--sortable': column.sortable },
              { 'rs-table__cell--fixed': column.fixed },
              { 'rs-table__th--dragging': dragColumnKey === column.key },
            ]"
            :style="columnHeaderStyleMap.get(column.key)"
            @dragover="onColumnDragOver(column.key, $event)"
            @drop="onColumnDrop(column.key, $event)"
            @click="onHeaderClick(column)"
          >
            <span
              v-if="columnDraggable"
              class="rs-table__column-drag-handle"
              draggable="true"
              :aria-label="t('table.dragColumn')"
              @click.stop
              @dragstart.stop="onColumnDragStart(column.key, $event)"
              @dragend.stop="onColumnDragEnd"
            >⋮⋮</span>
            <slot :name="`header-${column.key}`" :column="column">
              {{ column.title }}
            </slot>
            <span
              v-if="column.sortable"
              class="rs-table__sort"
              :class="{ 'rs-table__sort--active': !!sortOrderFor(column.key) }"
              aria-hidden="true"
            >
              <RsIcon :name="sortIconName(column.key)" size="sm" />
              <span v-if="multiSort && sortPriorityFor(column.key) > 1" class="rs-table__sort-priority">
                {{ sortPriorityFor(column.key) }}
              </span>
            </span>
            <span
              v-if="resizable"
              class="rs-table__resize-handle"
              @mousedown.stop="onResizeStart(column.key, $event)"
            />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td class="rs-table__empty" :colspan="bodyColspan">{{ t('table.loading') }}</td>
        </tr>
        <tr v-else-if="!hasData">
          <td class="rs-table__empty" :colspan="bodyColspan">
            <slot name="empty">{{ t('table.empty') }}</slot>
          </td>
        </tr>
        <template v-else>
          <tr
            v-if="useVirtualScroll && virtualSlice.paddingTop > 0"
            class="rs-table__virtual-pad"
          >
            <td :colspan="bodyColspan" :style="{ height: `${virtualSlice.paddingTop}px` }" />
          </tr>
          <template v-for="entry in visibleEntries" :key="resolveEntryKey(entry, rowKey)">
            <tr v-if="entry.type === 'group'" class="rs-table__group-row">
              <td class="rs-table__group-cell" :colspan="bodyColspan">
                <slot name="group" :key="entry.key" :label="entry.label">
                  {{ entry.label }}
                </slot>
              </td>
            </tr>
            <tr
              v-else-if="entry.type === 'expand'"
              class="rs-table__expand-row"
            >
              <td class="rs-table__expand-cell" :colspan="bodyColspan">
                <slot name="expand" :row="entry.row" :index="entry.rowIndex" />
              </td>
            </tr>
            <tr
              v-else
              v-memo="[entry, isRowSelected(entry), isRowExpanded(entry), dragRowKeys, dropRowTargetKey, dropRowPosition]"
              class="rs-table__row"
              :class="{
                'rs-table__row--selected': isRowSelected(entry),
                'rs-table__row--striped': striped && entry.rowIndex % 2 === 1,
                'rs-table__row--disabled': isTableRowDisabled(entry.row),
                'rs-table__row--draggable': isRowDragByRow(entry),
                'rs-table__row--dragging': isRowDragging(entry),
                'rs-table__row--drop-before': isRowDropTarget(entry) && dropRowPosition === 'before',
                'rs-table__row--drop-after': isRowDropTarget(entry) && dropRowPosition === 'after',
                'rs-table__row--drop-into': isRowDropTarget(entry) && dropRowPosition === 'into',
              }"
              @click="onRowClick(entry)"
              @dblclick="onRowDblclick(entry)"
              @contextmenu="onRowContextmenu(entry, $event)"
              @dragover="onRowDragOver(entry, $event)"
              @dragleave="onRowDragLeave"
              @drop="onRowDrop(entry, $event)"
            >
              <td
                v-if="showRowDragHandle"
                class="rs-table__td rs-table__td--drag"
                :style="dragLeadStyle"
                @click.stop
              >
                <span
                  v-if="!isTableRowDisabled(entry.row)"
                  class="rs-table__row-drag-handle"
                  draggable="true"
                  :aria-label="t('table.dragRow')"
                  @dragstart="onRowDragStart(entry, $event)"
                  @dragend="onRowDragEnd"
                >⋮⋮</span>
              </td>
              <td
                v-if="expandable"
                class="rs-table__td rs-table__td--expand"
                :style="expandLeadStyle"
                @click.stop
              >
                <button
                  v-if="canExpandRow(entry)"
                  type="button"
                  class="rs-table__expand-btn"
                  :class="{ 'rs-table__expand-btn--expanded': isRowExpanded(entry) }"
                  :aria-label="isRowExpanded(entry) ? t('table.collapseRow') : t('table.expandRow')"
                  @click="onToggleExpand(entry)"
                >
                  ›
                </button>
              </td>
              <td
                v-if="selectable"
                class="rs-table__td rs-table__td--selection"
                :style="selectLeadStyle"
                @click.stop
              >
                <label
                  class="rs-table__checkbox"
                  :class="{ 'rs-table__checkbox--checked': isRowSelected(entry) }"
                >
                  <input
                    :type="selectionType"
                    class="rs-table__checkbox-input"
                    :name="isRadioSelection ? 'rs-table-radio' : undefined"
                    :checked="isRowSelected(entry)"
                    :disabled="!canSelectRow(entry)"
                    :aria-label="t('table.selectRow')"
                    @change="onToggleRow(entry)"
                  >
                  <span class="rs-table__checkbox-box" :class="{ 'rs-table__checkbox-box--radio': isRadioSelection }" aria-hidden="true" />
                </label>
              </td>
              <td
                v-if="showIndex"
                class="rs-table__td rs-table__td--index rs-table__cell--center"
                :style="indexLeadStyle"
              >
                {{ entry.rowIndex + 1 }}
              </td>
              <td
                v-for="column in displayColumns"
                :key="column.key"
                class="rs-table__td"
                :class="[
                  columnTdClassMap.get(column.key),
                  { 'rs-table__td--row-draggable': isRowDragByRow(entry) },
                ]"
                :style="columnStyleMap.get(column.key)"
                :draggable="isRowDragByRow(entry)"
                @dragstart="isRowDragByRow(entry) ? onRowDragStart(entry, $event) : undefined"
                @dragend="isRowDragByRow(entry) ? onRowDragEnd() : undefined"
              >
                <span
                  :class="{ 'rs-table__ellipsis-text': column.ellipsis }"
                  :title="column.ellipsis && !$slots[column.key]
                    ? String(column.render ? column.render(entry.row, entry.rowIndex) : getCellValue(entry.row, column) ?? '')
                    : undefined"
                >
                  <slot :name="column.key" :row="entry.row" :column="column" :index="entry.rowIndex">
                    {{ column.render ? column.render(entry.row, entry.rowIndex) : getCellValue(entry.row, column) }}
                  </slot>
                </span>
              </td>
            </tr>
          </template>
          <tr
            v-if="useVirtualScroll && virtualSlice.paddingBottom > 0"
            class="rs-table__virtual-pad"
          >
            <td :colspan="bodyColspan" :style="{ height: `${virtualSlice.paddingBottom}px` }" />
          </tr>
          <tr v-if="infinite && loadingMore">
            <td class="rs-table__empty rs-table__empty--more" :colspan="bodyColspan">
              {{ t('table.loadingMore') }}
            </td>
          </tr>
        </template>
      </tbody>
      <tfoot v-if="$slots.summary" class="rs-table__foot">
        <tr>
          <td class="rs-table__summary" :colspan="bodyColspan">
            <slot name="summary" />
          </td>
        </tr>
      </tfoot>
    </table>
      </div>
    </div>
  </RsContextMenu>
</template>

<style scoped>
.rs-table-shell {
  width: 100%;
  min-width: 0;
}
.rs-table-shell--ctx {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: inherit;
  height: 100%;
  width: 100%;
}
/* 空白区域命中层（伪元素替代额外 DOM 节点） */
.rs-table-shell--ctx::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
}
.rs-table-shell--ctx > .rs-table {
  position: relative;
  z-index: 1;
}
.rs-table {
  width: 100%;
  min-width: 0;
  overflow: auto;
  border-radius: var(--rs-table-radius);
  background: var(--rs-table-bg);
}
/* 有表头时容器与 sticky header 同色，消除右侧滚动条轨道与表头的色差 */
.rs-table:has(.rs-table__head) {
  background: var(--rs-table-bg-header);
}
.rs-table:has(.rs-table__head) .rs-table__table > tbody {
  background: var(--rs-table-body-bg);
}
/* 内置右键：shell 撑满 + 内层 table 区域自行滚动，无需外层 RsScrollbar */
.rs-table-shell--ctx > .rs-table.rs-table--ctx {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
.rs-table-shell--ctx > .rs-table.rs-table--ctx:has(.rs-table__head) {
  background: var(--rs-table-bg-header);
}
.rs-table-shell--ctx > .rs-table.rs-table--ctx:has(.rs-table__head) .rs-table__table > tbody {
  background: var(--rs-table-body-bg);
}
.rs-table-shell--ctx > .rs-table.rs-table--ctx:not(:has(.rs-table__head)) {
  background: transparent;
}
.rs-table--virtual {
  overflow: auto;
}
.rs-table--bordered {
  border: 1px solid var(--rs-table-border);
}
.rs-table__table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  color: var(--rs-table-fg);
  font-size: var(--rs-font-size-sm);
}
.rs-table__th,
.rs-table__td {
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-table-cell-divider);
  white-space: nowrap;
}
.rs-table--compact .rs-table__th,
.rs-table--compact .rs-table__td,
.rs-table--sm .rs-table__th,
.rs-table--sm .rs-table__td {
  padding: var(--rs-space-xs) var(--rs-space-sm);
}
.rs-table--sm .rs-table__table {
  font-size: var(--rs-font-size-sm);
}
.rs-table--lg .rs-table__th,
.rs-table--lg .rs-table__td {
  padding: var(--rs-space-md) var(--rs-space-lg);
}
.rs-table--lg .rs-table__table {
  font-size: var(--rs-font-size-base);
}
.rs-table__th {
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--rs-table-header-bg);
  color: var(--rs-table-header-fg);
  font-weight: var(--rs-table-header-weight);
}
.rs-table__th.rs-table__cell--fixed,
.rs-table__th.rs-table__th--drag,
.rs-table__th.rs-table__th--expand,
.rs-table__th.rs-table__th--selection,
.rs-table__th.rs-table__th--index {
  z-index: 4;
}
/* 行级底色变量：所有 body 单元格统一继承，避免斑马纹与前缀列断裂 */
.rs-table__row {
  --rs-table-row-bg: var(--rs-table-body-bg);
}
.rs-table__row .rs-table__td,
.rs-table__row .rs-table__cell--fixed {
  background-color: var(--rs-table-row-bg);
}
.rs-table--scroll-x .rs-table__table {
  width: max-content;
}
.rs-table__th--expand,
.rs-table__td--expand {
  width: 40px;
  padding-inline: var(--rs-space-xs);
  text-align: center;
}
.rs-table__th--drag,
.rs-table__td--drag {
  width: 40px;
  padding-inline: var(--rs-space-xs);
  text-align: center;
}
.rs-table__column-drag-handle,
.rs-table__row-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  color: var(--rs-table-muted-fg);
  cursor: grab;
  user-select: none;
  letter-spacing: -0.15em;
  font-size: 0.75rem;
}
.rs-table__column-drag-handle:active,
.rs-table__row-drag-handle:active {
  cursor: grabbing;
}
.rs-table__th--dragging {
  opacity: 0.55;
}
.rs-table__row--dragging {
  opacity: 0.55;
}
.rs-table__row--drop-before {
  box-shadow: inset 0 2px 0 var(--rs-table-drop-indicator);
}
.rs-table__row--drop-after {
  box-shadow: inset 0 -2px 0 var(--rs-table-drop-indicator);
}
.rs-table__row--drop-into {
  --rs-table-row-bg: color-mix(in srgb, var(--rs-primary) 14%, var(--rs-table-row-bg, transparent));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rs-primary) 45%, transparent);
}
.rs-table__row--draggable {
  cursor: grab;
  user-select: none;
}
.rs-table__row--draggable:active {
  cursor: grabbing;
}
.rs-table__td--row-draggable {
  cursor: grab;
  user-select: none;
}
.rs-table__td--row-draggable:active {
  cursor: grabbing;
}
.rs-table__sort-priority {
  margin-left: 0.125rem;
  font-size: 0.625rem;
  color: var(--rs-table-muted-fg);
}
.rs-table__expand-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border: 0;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-table-muted-fg);
  cursor: pointer;
  transition: transform 0.15s ease;
}
.rs-table__expand-btn--expanded {
  transform: rotate(90deg);
}
.rs-table__expand-row {
  background: var(--rs-table-expand-bg);
}
.rs-table__expand-cell {
  padding: var(--rs-space-sm) var(--rs-space-md) var(--rs-space-md);
}
.rs-table__foot {
  position: sticky;
  bottom: 0;
  z-index: 2;
  background: var(--rs-table-footer-bg);
}
.rs-table__summary {
  padding: var(--rs-space-sm) var(--rs-space-md);
  color: var(--rs-table-muted-fg);
  font-weight: var(--rs-table-header-weight);
}
.rs-table__checkbox-box--radio {
  border-radius: 999px;
}
.rs-table__checkbox--checked .rs-table__checkbox-box--radio::after {
  width: 0.35rem;
  height: 0.35rem;
  border: 0;
  border-radius: 999px;
  background: var(--rs-on-primary, #fff);
  transform: none;
}
.rs-table--resizable .rs-table__th:not(.rs-table__cell--fixed):not(.rs-table__th--drag):not(.rs-table__th--expand):not(.rs-table__th--selection):not(.rs-table__th--index) {
  position: relative;
}
.rs-table__th--sortable {
  cursor: pointer;
}
.rs-table__row--striped:not(.rs-table__row--selected) {
  --rs-table-row-bg: var(--rs-table-row-stripe);
}
.rs-table__row--selected {
  --rs-table-row-bg: var(--rs-table-row-selected);
  color: var(--rs-table-row-selected-fg);
}
.rs-table__row--selected .rs-table__td:first-child,
.rs-table__row--selected .rs-table__cell--fixed:first-child {
  box-shadow: inset 3px 0 0 var(--rs-table-row-selected-accent, var(--rs-primary));
}
.rs-table__row:hover:not(.rs-table__row--disabled):not(.rs-table__row--selected) {
  --rs-table-row-bg: var(--rs-table-row-hover);
}
.rs-table__row--selected:hover:not(.rs-table__row--disabled) {
  --rs-table-row-bg: var(--rs-table-row-selected-hover, var(--rs-table-row-selected));
}
.rs-table__row--disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.rs-table__th--selection,
.rs-table__td--selection {
  width: 40px;
  padding-inline: var(--rs-space-sm);
  text-align: center;
}
.rs-table__th--index,
.rs-table__td--index {
  width: 56px;
  color: var(--rs-table-muted-fg);
}
.rs-table__td--ellipsis {
  overflow: hidden;
  max-width: 0;
}
.rs-table__ellipsis-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-table__checkbox {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.rs-table__checkbox-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.rs-table__checkbox-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-xs, 4px);
  background: var(--rs-table-checkbox-bg);
}
.rs-table__checkbox--checked .rs-table__checkbox-box,
.rs-table__checkbox--indeterminate .rs-table__checkbox-box {
  border-color: var(--rs-primary);
  background: var(--rs-primary);
}
.rs-table__checkbox--checked .rs-table__checkbox-box::after {
  content: '';
  width: 0.3rem;
  height: 0.55rem;
  border: solid var(--rs-on-primary, #fff);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg) translate(-1px, -1px);
}
.rs-table__checkbox--indeterminate .rs-table__checkbox-box::after {
  content: '';
  width: 0.5rem;
  height: 2px;
  background: var(--rs-on-primary, #fff);
  border-radius: 1px;
}
.rs-table__group-row {
  background: var(--rs-table-group-bg);
}
.rs-table__group-cell {
  padding: var(--rs-space-xs) var(--rs-space-md);
  color: var(--rs-table-muted-fg);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
}
.rs-table__virtual-pad td {
  padding: 0;
  border: 0;
  line-height: 0;
}
.rs-table__cell--left {
  text-align: left;
}
.rs-table__cell--center {
  text-align: center;
}
.rs-table__cell--right {
  text-align: right;
}
.rs-table__empty {
  padding: var(--rs-space-xl);
  color: var(--rs-table-muted-fg);
  text-align: center;
}
.rs-table__empty--more {
  padding: var(--rs-space-md);
}
.rs-table__sort {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  margin-left: var(--rs-space-xs);
  color: var(--rs-table-muted-fg);
  vertical-align: middle;
}
.rs-table__sort--active {
  color: var(--rs-table-sort-active-fg);
}
.rs-table__resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  touch-action: none;
}
.rs-table__resize-handle::after {
  content: '';
  position: absolute;
  top: 25%;
  right: 2px;
  width: 1px;
  height: 50%;
  background: var(--rs-table-resize-handle);
}
.rs-table__resize-handle:hover::after {
  background: var(--rs-table-resize-handle-hover);
}
/* 滚动条交汇角与容器底色一致 */
.rs-table.rs-native-scrollbar:has(.rs-table__head)::-webkit-scrollbar-corner {
  background: var(--rs-table-scrollbar-corner);
}
</style>
