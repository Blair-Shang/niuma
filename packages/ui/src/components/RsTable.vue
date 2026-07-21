<script setup lang="ts" generic="T extends import('./table-utils').RsTableRowData">
import { computed, nextTick, onActivated, onMounted, onUnmounted, ref, useSlots, watch } from 'vue'
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
import { useTableCellTooltip } from '../composables/useTableCellTooltip'
import { useTableEdit } from '../composables/useTableEdit'
import { useTableRowHighlight } from '../composables/useTableRowHighlight'
import RsTableBodyRow from './table/RsTableBodyRow.vue'
import RsTableHeaderFilter from './table/RsTableHeaderFilter.vue'
import {
  isBooleanToggleColumn,
  isCellValueChanged,
  isColumnEditable,
  isColumnNullable,
  isRowEditPending,
  listBatchColumnTargets,
  navigateEditableCell,
  nullToEditText,
  parseCellEditInput,
  parseClipboardGrid,
  resolveCellEditText,
  resolveColumnRawValue,
  validateCellValueAsync,
  type RsTableCellEditFocusMode,
  type RsTableCellNavigateDirection,
} from './table/table-edit-utils'
import {
  buildDefaultTableContextMenuItems,
  resolveTableCellCopyText,
  resolveTableRowCopyText,
  TABLE_CTX_COPY_CELL,
  TABLE_CTX_COPY_ROW,
} from './table/table-context-menu'
import { copyTextToClipboard } from '../utils/rs-clipboard'
import {
  buildTableEntries,
  buildVirtualHeightModel,
  clampColumnWidth,
  columnUsesSharedTooltip,
  createInitialColumnWidths,
  fixedCellStyle,
  getSortOrderForKey,
  getSortPriorityForKey,
  injectExpandRows,
  isColumnFilterActive,
  isNearScrollBottom,
  isTableRowDisabled,
  parseColumnWidth,
  reorderColumnKeys,
  resolveCellTooltipMode,
  resolveCellTooltipText,
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
  selectRowKeys,
  selectRowKeysByClick,
  sliceVirtualColumns,
  sliceVirtualHeightModel,
  resolveColumnPixelWidth,
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
import './table/rs-table.css'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    columns: RsTableColumn<T>[]
    data: T[]
    rowKey?: RsTableRowKey<T>
    loading?: boolean
    bordered?: boolean
    columnBordered?: boolean
    /** 外容器圆角；嵌套在已有圆角/直角父级时可设为 false */
    rounded?: boolean
    /** 填充父级高度：表格自身成为受限滚动容器，纵向滚动内置、横向滚动条固定在可视底部 */
    fill?: boolean
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
    columnFilters?: Record<string, string>
    defaultColumnFilters?: Record<string, string>
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
    /** fill 模式下数据行数达到该阈值时自动启用虚拟滚动；0 表示禁用自动启用 */
    virtualAutoThreshold?: number
    /**
     * 列虚拟化：仅渲染横向可视区附近的数据列。
     * true 强制开；false 强制关；默认 `'auto'` 由 virtualColumnsAutoThreshold 判定。
     * （勿用可选 boolean：Vue 会把缺省 prop 收成 false，导致自动模式失效。）
     */
    virtualColumns?: boolean | 'auto'
    /** 数据列数达到该阈值时自动列虚拟化；0 表示禁用自动。默认 40 */
    virtualColumnsAutoThreshold?: number
    /** 列虚拟化左右额外保留列数 */
    virtualColumnOverscan?: number
    height?: number | string
    rowHeight?: number
    overscan?: number
    infinite?: boolean
    hasMore?: boolean
    loadingMore?: boolean
    infiniteDistance?: number
    virtualOnInfinite?: boolean
    resizable?: boolean
    /** auto：列宽随内容/表头自适应；fixed：列宽固定（拖拽后精确锁定） */
    columnLayout?: 'auto' | 'fixed'
    /** 列宽初始值（单向）；拖拽后由组件内部维护，不受外部 prop 覆盖 */
    initialColumnWidths?: Record<string, number>
    minColumnWidth?: number
    maxColumnWidth?: number
    /** 右键行时自动选中（selectable 开启时默认 true） */
    selectOnContextmenu?: boolean
    /**
     * 额外右键菜单项（追加在默认「复制单元格 / 复制行」之后）。
     * @param row 右键的行（空白区域为 null）
     * @param selectedRows 当前已选行
     */
    contextMenuItems?: (row: T | null, selectedRows: T[]) => RsContextMenuItem[]
    /** 启用内置右键菜单（复制单元格 / 复制行），默认 true */
    contextMenu?: boolean
    /** 启用表格级共享 cell tooltip（ellipsis / column.tooltip）；整表仅一个浮层 */
    cellTooltip?: boolean
    /** 共享 tooltip 悬停延迟（ms），0 为即时显示 */
    cellTooltipDelay?: number
    /** 列头 headerTip 走同一共享浮层，默认 true */
    headerTooltip?: boolean
    /** 启用行内单元格编辑 */
    editable?: boolean
    /** 默认单元格编辑触发方式 */
    editTrigger?: 'click' | 'dblclick'
    /** 行内编辑时显示 Monaco 式 gutter（行号 / 待提交图标） */
    editGutter?: boolean
    /** 行号列初始宽度（px） */
    editGutterWidth?: number
    /** 启用当前行高亮（与 checkbox 选区独立） */
    highlightRow?: boolean
    highlightedRowKey?: string
    defaultHighlightedRowKey?: string
    /** 点击行时更新高亮行 */
    highlightRowOnClick?: boolean
    /** 单行手动提交：单元格编辑暂存，点击行状态列提交 */
    rowCommit?: boolean
    /**
     * 额外标记行待提交（如业务侧「新建行」草稿）。
     * 为 true 时 gutter 显示提交/撤销；点击提交触发 rowEditCommit（changes 可为空）。
     */
    rowPending?: (row: T, index: number) => boolean
    /** 显示行状态列（commit / rollback 图标） */
    showRowStatus?: boolean
    /** 允许显式 NULL（Ctrl/Cmd+0）；列级 nullable 可覆盖 */
    allowNull?: boolean
    /** NULL 展示文案 */
    nullLabel?: string
    /** 进入编辑时光标策略 */
    editFocusMode?: RsTableCellEditFocusMode
    /** 启用键盘导航（F2 / 方向键 / Tab） */
    editKeyboard?: boolean
    /** 启用 Ctrl+Z / Ctrl+Y 撤销重做 */
    editUndo?: boolean
    /** 撤销栈上限 */
    editUndoLimit?: number
    /** 启用 TSV 粘贴到焦点格 */
    editPaste?: boolean
    /**
     * 多选行时，提交当前列会批量写入所有已选可编辑行。
     * 需同时开启 selectable（checkbox 或 row）。
     */
    editBatch?: boolean
    /**
     * 视图切换标识：变化时重置滚动位置（不销毁实例）。
     * 用于同一表格实例切换不同数据集（如多结果页签），避免 :key 整表重建。
     */
    viewKey?: string | number
    /**
     * 外层 keep-alive 可见性；变为 true 时重同步虚拟滚动视口与 scroll 位置。
     * 嵌套在 keep-alive 内的 RsTable 不会收到 onActivated，需由父级传入。
     */
    layoutActive?: boolean
  }>(),
  {
    loading: false,
    bordered: true,
    columnBordered: false,
    rounded: false,
    fill: false,
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
    virtualColumnOverscan: 2,
    infiniteDistance: 80,
    virtualOnInfinite: true,
    virtualAutoThreshold: 50,
    virtualColumns: 'auto',
    virtualColumnsAutoThreshold: 40,
    resizable: false,
    columnLayout: 'auto',
    minColumnWidth: 48,
    maxColumnWidth: 640,
    cellTooltip: true,
    cellTooltipDelay: 300,
    headerTooltip: true,
    editable: false,
    editTrigger: 'dblclick',
    editGutter: true,
    editGutterWidth: 32,
    highlightRow: false,
    highlightRowOnClick: true,
    rowCommit: false,
    showRowStatus: true,
    allowNull: true,
    nullLabel: '(NULL)',
    editFocusMode: 'end',
    editKeyboard: true,
    editUndo: true,
    editUndoLimit: 50,
    editPaste: true,
    editBatch: true,
    contextMenu: true,
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
  'update:columnFilters': [value: Record<string, string>]
  columnFiltersChange: [value: Record<string, string>]
  rowDrop: [dragKeys: string[], dropKey: string, position: RsTableRowDropPosition]
  rowDragStart: [dragKeys: string[], event: DragEvent]
  'update:selectedRowKeys': [keys: string[]]
  'update:expandedRowKeys': [keys: string[]]
  selectionChange: [keys: string[]]
  expandChange: [keys: string[]]
  loadMore: []
  columnResize: [key: string, width: number]
  'update:highlightedRowKey': [key: string | undefined]
  highlightChange: [key: string | undefined]
  cellEditStart: [row: T, column: RsTableColumn<T>, index: number]
  cellEditCommit: [row: T, column: RsTableColumn<T>, index: number, value: unknown, previous: unknown]
  cellEditCancel: [row: T, column: RsTableColumn<T>, index: number]
  cellEditInvalid: [row: T, column: RsTableColumn<T>, index: number, message: string, value: unknown]
  cellEditBatchCommit: [
    column: RsTableColumn<T>,
    changes: Array<{ row: T; index: number; value: unknown; previous: unknown }>,
  ]
  cellEditUndo: [entry: {
    items: Array<{ rowKey: string; colKey: string; rowIndex: number; previous: unknown; next: unknown }>
  }]
  cellEditRedo: [entry: {
    items: Array<{ rowKey: string; colKey: string; rowIndex: number; previous: unknown; next: unknown }>
  }]
  cellEditReject: [row: T, index: number, reason?: string]
  rowEditCommit: [
    row: T,
    index: number,
    changes: Array<{ colKey: string; value: unknown; previous: unknown }>,
  ]
  rowEditRollback: [row: T, index: number]
}>()

const { t } = useRsI18n()
const slots = useSlots()

const sharedTipRef = ref<HTMLElement | null>(null)
const {
  state: cellTipState,
  onPointerOver: onCellTipOver,
  onPointerOut: onCellTipOut,
  hide: hideCellTooltip,
} = useTableCellTooltip({
  enabled: () => props.cellTooltip,
  headerEnabled: () => props.headerTooltip,
  delay: () => props.cellTooltipDelay,
  tipRef: sharedTipRef,
})

const showEditGutterColumn = computed(() => props.editable && props.editGutter)
const showIndexColumn = computed(() => props.showIndex && !showEditGutterColumn.value)
const showRowStatusColumn = computed(() => props.rowCommit && props.showRowStatus && !showEditGutterColumn.value)

const resolvedGutterWidth = computed(() => props.editGutterWidth)

const tableEdit = useTableEdit({
  enabled: () => props.editable,
  undoLimit: () => props.editUndoLimit,
})

const activeEditCellKey = computed(() => {
  const cell = tableEdit.editingCell.value
  return cell ? `${cell.rowKey}:${cell.colKey}` : ''
})

const activeFocusCellKey = computed(() => {
  const cell = tableEdit.focusCell.value
  return cell ? `${cell.rowKey}:${cell.colKey}` : ''
})

const activeErrorMapSize = computed(() => tableEdit.errorMap.value.size)
const activeValidatingMapSize = computed(() => tableEdit.validatingMap.value.size)

const contextMenuEnabled = computed(() => props.contextMenu !== false)

const isHighlightControlled = computed(() => props.highlightedRowKey !== undefined)
const rowHighlight = useTableRowHighlight({
  enabled: () => props.highlightRow,
  highlightRowOnClick: () => props.highlightRowOnClick,
  isControlled: () => isHighlightControlled.value,
  highlightedRowKey: () => props.highlightedRowKey,
  defaultHighlightedRowKey: () => props.defaultHighlightedRowKey,
  onUpdate: (value) => {
    if (isHighlightControlled.value) emit('update:highlightedRowKey', value)
    emit('highlightChange', value)
  },
})

const internalSort = ref<RsTableSortState | null>(props.defaultSort ?? null)
const internalSorts = ref<RsTableSortState[]>([...props.defaultSorts])
const internalColumnOrder = ref<string[]>([...props.defaultColumnOrder])
const scrollTop = ref(0)
const scrollLeft = ref(0)
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

const virtualScrollEnabled = computed(() => {
  if (props.virtual === true) return true
  if (props.infinite && props.virtualOnInfinite !== false) return true
  if (props.virtual === false) return false
  const threshold = props.virtualAutoThreshold ?? 0
  return Boolean(props.fill && threshold > 0 && props.data.length >= threshold)
})

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
  get: () => {
    if (isColumnOrderControlled.value) {
      return props.columnOrder ?? []
    }
    if (internalColumnOrder.value.length) {
      return internalColumnOrder.value
    }
    return resolveColumnOrder(props.columns)
  },
  set: (value: string[]) => {
    if (isColumnOrderControlled.value) emit('update:columnOrder', value)
    else internalColumnOrder.value = value
    emit('columnOrderChange', value)
  },
})

const isColumnFiltersControlled = computed(() => props.columnFilters !== undefined)
const internalColumnFilters = ref<Record<string, string>>(props.defaultColumnFilters ?? {})
const columnFiltersState = computed(() => props.columnFilters ?? internalColumnFilters.value)

function updateColumnFilter(key: string, value: string) {
  const next = { ...columnFiltersState.value }
  if (value.trim()) next[key] = value
  else delete next[key]
  if (isColumnFiltersControlled.value) emit('update:columnFilters', next)
  else internalColumnFilters.value = next
  emit('columnFiltersChange', next)
}

function columnFilterValue(key: string): string {
  return columnFiltersState.value[key] ?? ''
}

const displayColumns = computed(() => resolveOrderedColumns(props.columns, columnOrderState.value))

const resolvedColumnWidths = computed({
  get: () => internalColumnWidths.value,
  set: (value: Record<string, number>) => {
    internalColumnWidths.value = value
  },
})

/** 列宽已显式定义（fixed / 每列均有 width 或初始值）时需稳定布局，避免松手回弹 */
const useStableColumnWidths = computed(() => {
  if (!props.resizable) return false
  if (props.columnLayout === 'fixed') return true
  const widths = internalColumnWidths.value
  return displayColumns.value.every((col) => {
    return typeof widths[col.key] === 'number' || col.width !== undefined
  })
})

function syncInternalColumnWidths(columns: typeof props.columns): void {
  const preserved: Record<string, number> = {}
  for (const column of columns) {
    const width = internalColumnWidths.value[column.key]
    if (typeof width === 'number') preserved[column.key] = width
  }
  internalColumnWidths.value = createInitialColumnWidths(
    columns,
    { ...props.initialColumnWidths, ...preserved },
    { forceAll: props.resizable && useStableColumnWidths.value },
  )
}

watch(
  () => props.columns,
  (columns) => {
    syncInternalColumnWidths(columns)
    if (!isColumnOrderControlled.value) {
      internalColumnOrder.value = resolveColumnOrder(columns, internalColumnOrder.value)
    }
  },
  { immediate: true },
)

let viewportResizeObserver: ResizeObserver | null = null

function syncMeasuredViewportSize(): void {
  const el = scrollContainerRef.value
  if (!el) return
  const nextH = el.clientHeight
  if (nextH > 0 && nextH !== measuredViewportHeight.value) {
    measuredViewportHeight.value = nextH
  }
  const nextW = el.clientWidth
  if (nextW > 0 && nextW !== measuredViewportWidth.value) {
    measuredViewportWidth.value = nextW
  }
}

/** 布局稳定后再测一次，避免 fill / keep-alive 激活首帧 clientHeight 为 0 */
function syncVirtualLayoutFromDom(): void {
  const el = scrollContainerRef.value
  if (!el) return
  syncMeasuredViewportSize()
  if (virtualScrollEnabled.value) {
    scrollTop.value = el.scrollTop
  }
  if (virtualColumnsEnabled.value) {
    scrollLeft.value = el.scrollLeft
  }
}

function scheduleVirtualLayoutSync(): void {
  syncVirtualLayoutFromDom()
  void nextTick(() => {
    syncVirtualLayoutFromDom()
    requestAnimationFrame(() => {
      syncVirtualLayoutFromDom()
    })
  })
}

function resetScrollPosition(): void {
  scrollTop.value = 0
  scrollLeft.value = 0
  const el = scrollContainerRef.value
  if (el) {
    el.scrollTop = 0
    el.scrollLeft = 0
  }
  scheduleVirtualLayoutSync()
}

const dragColumnOffset = computed(() => (showRowDragHandle.value ? 40 : 0))
const expandColumnOffset = computed(() => dragColumnOffset.value + (props.expandable ? 40 : 0))
/** 左侧选择列仅 checkbox / radio 显示；row 模式靠点击行多选 */
const showSelectColumn = computed(
  () => props.selectable && props.selectionType !== 'row',
)
const isRowSelection = computed(() => props.selectable && props.selectionType === 'row')
const selectColumnOffset = computed(
  () => expandColumnOffset.value + (showSelectColumn.value ? 40 : 0),
)
/** 行点击多选的 Shift 锚点 */
const selectionAnchorKey = ref<string | null>(null)

const fixedRowHeight = computed(() => resolveTableRowHeight(resolvedSize.value, props.rowHeight))
const scrollContainerRef = ref<HTMLElement | null>(null)
const measuredViewportHeight = ref(0)
const measuredViewportWidth = ref(0)
const viewportHeight = computed(() => {
  if (typeof props.height === 'number' && props.height > 0) return props.height
  if (typeof props.height === 'string') {
    const parsed = Number.parseInt(props.height, 10)
    if (Number.isFinite(parsed) && parsed > 0 && !props.height.includes('%')) return parsed
  }
  if (measuredViewportHeight.value > 0) return measuredViewportHeight.value
  const el = scrollContainerRef.value
  if (el && el.clientHeight > 0) return el.clientHeight
  return 320
})
const tableMinWidth = computed(() => resolveScrollWidth(props.scrollX))

onMounted(() => {
  scheduleVirtualLayoutSync()
  const el = scrollContainerRef.value
  if (!el || typeof ResizeObserver === 'undefined') return
  viewportResizeObserver = new ResizeObserver(() => syncMeasuredViewportSize())
  viewportResizeObserver.observe(el)
})

onActivated(() => {
  scheduleVirtualLayoutSync()
})

watch(
  () => props.layoutActive,
  (active) => {
    if (active) scheduleVirtualLayoutSync()
  },
  { flush: 'post' },
)

watch(
  () => props.viewKey,
  (_next, prev) => {
    if (prev === undefined) return
    resetScrollPosition()
  },
)

/** 前缀列固定宽度（与 CSS 一致），用于 resizable 模式精确计算表格总宽 */
const PREFIX_COL_WIDTH = {
  drag: 40,
  expand: 40,
  select: 40,
  index: 56,
  gutter: 32,
  status: 52,
} as const

/** 拖拽会话中的列宽快照（仅在拖拽开始时写入一次，供 colgroup 初始渲染） */
const resizePaintWidths = ref<Record<string, number> | null>(null)
/** 是否处于列宽拖拽中（切换 fixed 布局，移动过程走 DOM 直写避免整表重渲染） */
const isColumnResizing = ref(false)
const tableRef = ref<HTMLTableElement | null>(null)

/** 拖拽中的实时列宽（非响应式，避免 mousemove 触发整表更新） */
let activeDragWidths: Record<string, number> | null = null

/** 样式计算用：拖拽初始帧用快照，否则用持久化列宽 */
const effectiveColumnWidths = computed(() => resizePaintWidths.value ?? resolvedColumnWidths.value)

const dataColumnWidth = (column: RsTableColumn<T>): number =>
  resolveColumnPixelWidth(column, effectiveColumnWidths.value)

/** 左/右冻结列始终实体渲染；中间列参与横向虚拟化 */
const leftFixedDataColumns = computed(() => displayColumns.value.filter((c) => c.fixed === 'left'))
const rightFixedDataColumns = computed(() => displayColumns.value.filter((c) => c.fixed === 'right'))
const fluidDataColumns = computed(() => displayColumns.value.filter((c) => !c.fixed))

const virtualColumnsEnabled = computed(() => {
  if (props.virtualColumns === false) return false
  if (isColumnResizing.value) return false
  if (props.virtualColumns === true) return fluidDataColumns.value.length > 0
  // 'auto'：按列数阈值
  const threshold = props.virtualColumnsAutoThreshold ?? 0
  return threshold > 0 && fluidDataColumns.value.length >= threshold
})

const fluidLeadingOffset = computed(() => {
  let sum = 0
  if (showRowDragHandle.value) sum += PREFIX_COL_WIDTH.drag
  if (props.expandable) sum += PREFIX_COL_WIDTH.expand
  if (showSelectColumn.value) sum += PREFIX_COL_WIDTH.select
  if (showEditGutterColumn.value) sum += resolvedGutterWidth.value
  else if (showIndexColumn.value) sum += PREFIX_COL_WIDTH.index
  if (showRowStatusColumn.value) sum += PREFIX_COL_WIDTH.status
  for (const col of leftFixedDataColumns.value) sum += dataColumnWidth(col)
  return sum
})

const columnVirtualSlice = computed(() => {
  const fluidCount = fluidDataColumns.value.length
  if (!virtualColumnsEnabled.value) {
    return {
      columns: displayColumns.value,
      paddingLeft: 0,
      paddingRight: 0,
      startIndex: 0,
      endIndex: fluidCount,
      fluidCount,
    }
  }
  const viewport = Math.max(measuredViewportWidth.value || 320, 120)
  const midScroll = Math.max(0, scrollLeft.value - fluidLeadingOffset.value)
  const midViewport = Math.max(120, viewport - Math.min(viewport - 40, fluidLeadingOffset.value))
  const sliced = sliceVirtualColumns(fluidDataColumns.value, {
    scrollLeft: midScroll,
    viewportWidth: midViewport,
    getWidth: dataColumnWidth,
    overscan: props.virtualColumnOverscan ?? 2,
  })
  return {
    columns: [
      ...leftFixedDataColumns.value,
      ...sliced.columns,
      ...rightFixedDataColumns.value,
    ],
    paddingLeft: sliced.paddingLeft,
    paddingRight: sliced.paddingRight,
    startIndex: sliced.startIndex,
    endIndex: sliced.endIndex,
    fluidCount,
  }
})

const visibleDataColumns = computed(() => columnVirtualSlice.value.columns)
const columnPadLeft = computed(() => columnVirtualSlice.value.paddingLeft)
const columnPadRight = computed(() => columnVirtualSlice.value.paddingRight)

const useScrollContainer = computed(
  () => virtualScrollEnabled.value || props.infinite || virtualColumnsEnabled.value,
)

const scrollContainerStyle = computed(() => {
  const style: Record<string, string> = {}
  if (useScrollContainer.value && !props.fill) {
    const resolvedHeight = resolveVirtualListHeight(props.height, 320)
    if (resolvedHeight) {
      style.height = resolvedHeight
      style.maxHeight = resolvedHeight
    }
  }
  if (showEditGutterColumn.value) {
    style['--rs-table-gutter-width'] = `${resolvedGutterWidth.value}px`
  }
  return Object.keys(style).length ? style : undefined
})

/** DEV：列虚拟是否生效 + 可视切片，便于对照 heap 里 `<td>` 数量 */
if (import.meta.env.DEV) {
  watch(
    () => {
      const slice = columnVirtualSlice.value
      const enabled = virtualColumnsEnabled.value
      return {
        enabled,
        prop: props.virtualColumns,
        threshold: props.virtualColumnsAutoThreshold,
        fluidCols: slice.fluidCount,
        renderedCols: slice.columns.length,
        fluidSlice: enabled ? `${slice.startIndex}..${slice.endIndex}` : 'all',
        padLeft: Math.round(slice.paddingLeft),
        padRight: Math.round(slice.paddingRight),
        resizing: isColumnResizing.value,
      }
    },
    (state, prev) => {
      if (
        prev &&
        state.enabled === prev.enabled &&
        state.fluidCols === prev.fluidCols &&
        state.fluidSlice === prev.fluidSlice &&
        state.renderedCols === prev.renderedCols &&
        state.resizing === prev.resizing
      ) {
        return
      }
      console.info('[RsTable:virtual-cols]', state)
    },
    { immediate: true },
  )
}

/** resizable 且列宽稳定时，或拖拽会话中：表格宽度 = 各列宽度之和 */
const resizableTableWidth = computed(() => {
  if (!props.resizable) return undefined
  if (!resizePaintWidths.value && props.columnLayout === 'auto' && !useStableColumnWidths.value) {
    return undefined
  }
  let sum = 0
  if (showRowDragHandle.value) sum += PREFIX_COL_WIDTH.drag
  if (props.expandable) sum += PREFIX_COL_WIDTH.expand
  if (showSelectColumn.value) sum += PREFIX_COL_WIDTH.select
  if (showEditGutterColumn.value) sum += resolvedGutterWidth.value
  else if (showIndexColumn.value) sum += PREFIX_COL_WIDTH.index
  const widths = effectiveColumnWidths.value
  for (const col of displayColumns.value) {
    sum += widths[col.key] ?? parseColumnWidth(col.width ?? col.minWidth)
  }
  return `${sum}px`
})

const tableInlineStyle = computed(() => {
  if (isColumnResizing.value) {
    return undefined
  }
  if (props.resizable) {
    if (props.columnLayout === 'auto' && !useStableColumnWidths.value) {
      return tableMinWidth.value
        ? { width: '100%', minWidth: tableMinWidth.value }
        : { width: '100%' }
    }
    const width = resizableTableWidth.value
    const minWidth = tableMinWidth.value ?? width
    return width ? { width, minWidth } : undefined
  }
  return tableMinWidth.value ? { minWidth: tableMinWidth.value } : undefined
})

const useFixedColumnLayout = computed(
  () => useStableColumnWidths.value || isColumnResizing.value,
)

/** 列最小/显式宽度之和（不含可任意压缩的流体列）。用于判断是否需要横向滚动。 */
function estimateRequiredTableWidth(): number {
  let sum = measurePrefixColumnWidth()
  if (showRowStatusColumn.value) sum += PREFIX_COL_WIDTH.status
  const widths = effectiveColumnWidths.value
  for (const col of displayColumns.value) {
    const stored = widths[col.key]
    if (typeof stored === 'number') {
      sum += stored
      continue
    }
    if (typeof col.width === 'number') {
      sum += col.width
      continue
    }
    if (col.minWidth !== undefined) {
      sum += typeof col.minWidth === 'number' ? col.minWidth : parseColumnWidth(col.minWidth, 0)
    }
  }
  return sum
}

/** 仅当列宽确需超过容器时开启横向滚动（避免纵向条引发的伪横向条）。 */
const overflowXEnabled = computed(() => {
  if (virtualColumnsEnabled.value) return true
  if (props.scrollX != null && props.scrollX !== '') return true
  const viewportW = measuredViewportWidth.value
  if (viewportW <= 0) return false
  if (useFixedColumnLayout.value) {
    const raw = resizableTableWidth.value
    const sum = raw ? Number.parseInt(raw, 10) : estimateRequiredTableWidth()
    return Number.isFinite(sum) && sum > viewportW
  }
  return estimateRequiredTableWidth() > viewportW
})

function measurePrefixColumnWidth(): number {
  let sum = 0
  if (showRowDragHandle.value) sum += PREFIX_COL_WIDTH.drag
  if (props.expandable) sum += PREFIX_COL_WIDTH.expand
  if (showSelectColumn.value) sum += PREFIX_COL_WIDTH.select
  if (showEditGutterColumn.value) sum += resolvedGutterWidth.value
  else if (showIndexColumn.value) sum += PREFIX_COL_WIDTH.index
  return sum
}

function applyTableColumnWidths(table: HTMLTableElement, widths: Record<string, number>): void {
  let sum = measurePrefixColumnWidth()
  for (const column of displayColumns.value) {
    const col = table.querySelector<HTMLTableColElement>(`colgroup col[data-col-key="${column.key}"]`)
    const width = widths[column.key] ?? parseColumnWidth(column.width ?? column.minWidth)
    if (col) col.style.width = `${width}px`
    const th = table.querySelector<HTMLTableCellElement>(`thead th[data-col-key="${column.key}"]`)
    if (th) th.style.width = `${width}px`
    sum += width
  }
  table.style.width = `${sum}px`
  const minWidth = tableMinWidth.value
  if (minWidth) table.style.minWidth = minWidth
}

function resolvedDataColumnWidth(key: string, fallback?: number | string): number {
  const stored = effectiveColumnWidths.value[key]
  if (typeof stored === 'number') return stored
  return parseColumnWidth(fallback)
}
const fixedColumnStyles = computed(() =>
  resolveFixedColumnStyles(displayColumns.value, effectiveColumnWidths.value, {
    selectable: showSelectColumn.value,
    showIndex: showIndexColumn.value,
    showEditGutter: showEditGutterColumn.value,
    gutterWidth: resolvedGutterWidth.value,
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
      columnFilters: columnFiltersState.value,
      groupBy: props.groupBy,
      groupLabel: props.groupLabel,
      remoteSort: props.remoteSort,
    }),
    expandedKeySet.value,
    props.rowKey,
    props.rowExpandable,
  ),
)

const virtualHeightModel = computed(() =>
  buildVirtualHeightModel(
    tableEntries.value,
    fixedRowHeight.value,
    undefined,
    (props.expandRowHeight ?? undefined) as 80 | undefined,
  ),
)

const virtualSlice = computed(() => {
  if (!virtualScrollEnabled.value) {
    return { entries: tableEntries.value, paddingTop: 0, paddingBottom: 0 }
  }
  return sliceVirtualHeightModel(
    virtualHeightModel.value,
    scrollTop.value,
    viewportHeight.value,
    fixedRowHeight.value,
    props.overscan,
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
  let count = visibleDataColumns.value.length
  if (columnPadLeft.value > 0) count += 1
  if (columnPadRight.value > 0) count += 1
  if (showRowDragHandle.value) count += 1
  if (props.expandable) count += 1
  if (showSelectColumn.value) count += 1
  if (showEditGutterColumn.value || showIndexColumn.value) count += 1
  if (showRowStatusColumn.value) count += 1
  return count
})

const isRadioSelection = computed(() => props.selectionType === 'radio')

let resizeState: {
  key: string
  startX: number
  startWidth: number
  currentWidth: number
  /** 拖拽开始时从 DOM 批量测量的各列宽度 */
  domSnapshot: Record<string, number>
  /** auto 模式：拖拽前已持久化的列宽 */
  persistedWidths: Record<string, number>
} | null = null
let resizeRafId = 0
let latestResizeClientX = 0
let resizeMoved = false

/** 列样式 Map：按 column.key 缓存，避免模板热路径每次创建新对象 */
const columnStyleMap = computed<Map<string, Record<string, string> | undefined>>(() => {
  const map = new Map<string, Record<string, string> | undefined>()
  for (const col of displayColumns.value) {
    const base = resolveColumnStyle(col, effectiveColumnWidths.value) ?? {}
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
    const base = resolveColumnStyle(col, effectiveColumnWidths.value) ?? {}
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
const gutterLeadStyle = computed(() => fixedCellStyle({ fixed: 'left', left: selectColumnOffset.value }) ?? {})
const dragLeadHeaderStyle = computed(() => fixedCellStyle({ fixed: 'left', left: 0 }, { header: true }) ?? {})
const expandLeadHeaderStyle = computed(() => fixedCellStyle({ fixed: 'left', left: dragColumnOffset.value }, { header: true }) ?? {})
const selectLeadHeaderStyle = computed(() => fixedCellStyle({ fixed: 'left', left: expandColumnOffset.value }, { header: true }) ?? {})
const indexLeadHeaderStyle = computed(() => fixedCellStyle({ fixed: 'left', left: selectColumnOffset.value }, { header: true }) ?? {})
const gutterLeadHeaderStyle = computed(() => fixedCellStyle({ fixed: 'left', left: selectColumnOffset.value }, { header: true }) ?? {})

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

function onRowClick(entry: RsTableRowEntry<T>, event?: MouseEvent): void {
  if (entry.type !== 'row') return
  const rowKey = rowKeyFor(entry)
  if (isRowSelection.value && canSelectRow(entry) && !tableEdit.editingCell.value) {
    const toggle = Boolean(event && (event.ctrlKey || event.metaKey))
    const range = Boolean(event?.shiftKey)
    selectedRowKeys.value = selectRowKeysByClick(selectedRowKeys.value, rowKey, {
      toggle,
      range,
      orderedKeys: selectableRowKeys.value,
      anchorKey: selectionAnchorKey.value,
    })
    if (!range) selectionAnchorKey.value = rowKey
    // 清掉浏览器划选，避免与行选区叠成「拖蓝选中文字」观感
    if (typeof window !== 'undefined') {
      window.getSelection()?.removeAllRanges()
    }
  }
  rowHighlight.applyRowClickHighlight(rowKey)
  emit('rowClick', entry.row, entry.rowIndex)
}

/** 行选模式下 Shift/Ctrl 按下时禁止开始原生文本选区 */
function onRowSelectMouseDown(event: MouseEvent): void {
  if (!isRowSelection.value) return
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    event.preventDefault()
  }
}

function onRowDblclick(entry: RsTableRowEntry<T>, _event?: MouseEvent): void {
  if (entry.type !== 'row') return
  emit('rowDblclick', entry.row, entry.rowIndex)
}

/** 当前右键行（null = 空白区域） */
const ctxRow = ref<T | null>(null)
const ctxRowIndex = ref<number | null>(null)
const ctxColKey = ref<string | null>(null)
const ctxMenuItems = ref<RsContextMenuItem[]>([])

function refreshCtxMenuItems(): void {
  if (!contextMenuEnabled.value) {
    ctxMenuItems.value = []
    return
  }

  const items = buildDefaultTableContextMenuItems({
    copyCellLabel: t('table.copyCell'),
    copyRowLabel: t('table.copyRow'),
    hasRow: ctxRow.value != null,
    hasCell: ctxColKey.value != null,
  })

  const custom = props.contextMenuItems?.(ctxRow.value as T | null, selectedRows.value) ?? []
  if (custom.length > 0) {
    if (items.length > 0) {
      items.push({ key: '__ctx-sep', label: '', separator: true })
    }
    items.push(...custom)
  }

  ctxMenuItems.value = items
}

async function copyCtxCell(): Promise<void> {
  if (!ctxRow.value || ctxRowIndex.value == null || !ctxColKey.value) return
  const column = displayColumns.value.find((item) => item.key === ctxColKey.value)
  if (!column) return
  const key = resolveRowKey(ctxRow.value, ctxRowIndex.value, props.rowKey)
  const text = resolveTableCellCopyText(
    ctxRow.value,
    column,
    ctxRowIndex.value,
    tableEdit.getDraft(key, column.key),
  )
  await copyTextToClipboard(text)
}

async function copyCtxRow(): Promise<void> {
  if (!ctxRow.value || ctxRowIndex.value == null) return
  const key = resolveRowKey(ctxRow.value, ctxRowIndex.value, props.rowKey)
  const text = resolveTableRowCopyText(
    ctxRow.value,
    ctxRowIndex.value,
    displayColumns.value,
    tableEdit.getDraft,
    key,
  )
  await copyTextToClipboard(text)
}

async function onCtxMenuSelect(key: string): Promise<void> {
  if (key === TABLE_CTX_COPY_CELL) {
    await copyCtxCell()
    emit('contextMenuSelect', key, ctxRow.value as T | null, selectedRows.value)
    return
  }
  if (key === TABLE_CTX_COPY_ROW) {
    await copyCtxRow()
    emit('contextMenuSelect', key, ctxRow.value as T | null, selectedRows.value)
    return
  }
  emit('contextMenuSelect', key, ctxRow.value as T | null, selectedRows.value)
}

function prepareRowContextmenu(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): void {
  const shouldSelect = props.selectOnContextmenu ?? props.selectable
  if (shouldSelect && canSelectRow(entry) && !isRowSelected(entry)) {
    selectedRowKeys.value = selectRowKeys(selectedRowKeys.value, rowKeyFor(entry), props.selectionType)
  }
  if (contextMenuEnabled.value) {
    ctxRow.value = entry.row
    ctxRowIndex.value = entry.rowIndex
  }
}

function onTableContextmenu(event: MouseEvent): void {
  if (!contextMenuEnabled.value) return
  const tr = (event.target as HTMLElement).closest('tr.rs-table__row')
  if (!tr) {
    ctxRow.value = null
    ctxRowIndex.value = null
    ctxColKey.value = null
    refreshCtxMenuItems()
  }
}

function onRowContextmenu(entry: RsTableRowEntry<T>, event: MouseEvent): void {
  if (entry.type !== 'row') return
  if ((event.target as HTMLElement).closest('.rs-table__td--data')) return
  prepareRowContextmenu(entry)
  ctxColKey.value = null
  refreshCtxMenuItems()
  emit('rowContextmenu', entry.row, entry.rowIndex, event)
}

function onCellContextmenu(entry: RsTableRowEntry<T>, colKey: string, event: MouseEvent): void {
  if (entry.type !== 'row') return
  prepareRowContextmenu(entry)
  ctxColKey.value = colKey
  refreshCtxMenuItems()
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

function cellTooltipEnabled(column: RsTableColumn<T>, rowIndex: number): boolean {
  return props.cellTooltip && columnUsesSharedTooltip(column) && !slots[column.key]
}

function cellTooltipMode(column: RsTableColumn<T>, rowIndex: number): string | undefined {
  if (!cellTooltipEnabled(column, rowIndex)) return undefined
  return resolveCellTooltipMode(column) ?? undefined
}

function cellTooltipText(column: RsTableColumn<T>, row: T, rowIndex: number): string | undefined {
  if (!cellTooltipEnabled(column, rowIndex)) return undefined
  const text = resolveCellTooltipText(column, row, rowIndex)
  return text || undefined
}

function cellTooltipFallbackTitle(column: RsTableColumn<T>, row: T, rowIndex: number): string | undefined {
  if (props.cellTooltip || !column.ellipsis || slots[column.key]) return undefined
  const text = resolveCellTooltipText(column, row, rowIndex)
  return text || undefined
}

function hasColumnSlot(key: string): boolean {
  return Boolean(slots[key])
}

function hasEditSlot(key: string): boolean {
  return Boolean(slots[`edit-${key}`])
}

function resolveColumnByKey(colKey: string): RsTableColumn<T> | undefined {
  return displayColumns.value.find((column) => column.key === colKey)
}

function findRowEntryByKey(rowKey: string): Extract<RsTableRowEntry<T>, { type: 'row' }> | undefined {
  return dataRows.value.find((item) => rowKeyByIndex.value.get(item.rowIndex) === rowKey)
}

function buildEditableCellList() {
  const result: Array<{ rowKey: string; colKey: string; rowIndex: number }> = []
  for (const entry of dataRows.value) {
    const rowKey = rowKeyFor(entry)
    for (const column of displayColumns.value) {
      if (!isColumnEditable(column, entry.row, entry.rowIndex, props.editable)) continue
      result.push({ rowKey, colKey: column.key, rowIndex: entry.rowIndex })
    }
  }
  return result
}

function onCellStartEdit(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>, colKey: string): void {
  const column = resolveColumnByKey(colKey)
  if (!column) return
  if (isBooleanToggleColumn(column)) return
  if (!isColumnEditable(column, entry.row, entry.rowIndex, props.editable)) return
  const key = rowKeyFor(entry)
  const initialText = resolveCellEditText(entry.row, column, entry.rowIndex, tableEdit.getDraft(key, colKey))
  tableEdit.startEdit({ rowKey: key, colKey, rowIndex: entry.rowIndex }, initialText)
  emit('cellEditStart', entry.row, column, entry.rowIndex)
}

function onCellUpdateDraft(_entry: Extract<RsTableRowEntry<T>, { type: 'row' }>, _colKey: string, value: string): void {
  tableEdit.updateDraft(value)
}

function onCellCancelEdit(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>, colKey: string): void {
  const column = resolveColumnByKey(colKey)
  tableEdit.cancelEdit()
  if (column) emit('cellEditCancel', entry.row, column, entry.rowIndex)
}

async function onCellCommitEdit(
  entry: Extract<RsTableRowEntry<T>, { type: 'row' }>,
  colKey: string,
  rawText: string,
  options?: { navigate?: RsTableCellNavigateDirection; skipUndo?: boolean; skipBatch?: boolean },
): Promise<boolean> {
  const column = resolveColumnByKey(colKey)
  if (!column) return false
  const allowNull = isColumnNullable(column, props.allowNull)
  const parsed = parseCellEditInput(rawText, entry.row, column, entry.rowIndex, { allowNull })
  const rowKey = rowKeyFor(entry)

  tableEdit.setValidating(rowKey, colKey, true)
  let error: string | null = null
  try {
    error = await validateCellValueAsync(parsed, entry.row, column, entry.rowIndex)
  } finally {
    tableEdit.setValidating(rowKey, colKey, false)
  }

  if (error) {
    tableEdit.updateDraft(rawText)
    tableEdit.setCellError(rowKey, colKey, error)
    emit('cellEditInvalid', entry.row, column, entry.rowIndex, error, parsed)
    return false
  }
  tableEdit.clearCellError(rowKey, colKey)

  const batchEnabled =
    props.editBatch &&
    props.selectable &&
    props.selectionType !== 'radio' &&
    !props.rowCommit &&
    !options?.skipBatch

  const targets = batchEnabled
    ? listBatchColumnTargets({
        rows: dataRows.value.map((item) => ({
          row: item.row,
          rowIndex: item.rowIndex,
          rowKey: rowKeyFor(item),
        })),
        column,
        tableEditable: props.editable,
        selectedKeys: selectedRowKeys.value,
        anchorRowKey: rowKey,
      })
    : [{ row: entry.row, rowIndex: entry.rowIndex, rowKey }]

  if (props.rowCommit) {
    const previous = resolveColumnRawValue(entry.row, column, entry.rowIndex)
    if (!isCellValueChanged(previous, parsed)) {
      tableEdit.unstageCell(rowKey, colKey)
      tableEdit.cancelEdit()
      if (options?.navigate) moveEditFocus(entry, colKey, options.navigate, false)
      return true
    }
    tableEdit.stageCell({
      rowKey,
      colKey,
      rowIndex: entry.rowIndex,
      draft: rawText,
      original: previous,
    })
    if (options?.navigate) moveEditFocus(entry, colKey, options.navigate, true)
    return true
  }

  tableEdit.cancelEdit()

  const undoItems: Array<{
    rowKey: string
    colKey: string
    rowIndex: number
    previous: unknown
    next: unknown
  }> = []
  const batchChanges: Array<{ row: T; index: number; value: unknown; previous: unknown }> = []

  for (const target of targets) {
    const previous = resolveColumnRawValue(target.row, column, target.rowIndex)
    if (!isCellValueChanged(previous, parsed)) continue
    undoItems.push({
      rowKey: target.rowKey,
      colKey,
      rowIndex: target.rowIndex,
      previous,
      next: parsed,
    })
    batchChanges.push({
      row: target.row,
      index: target.rowIndex,
      value: parsed,
      previous,
    })
    if (target.rowKey === rowKey) {
      emit('cellEditCommit', target.row, column, target.rowIndex, parsed, previous)
    } else {
      emit('cellEditCommit', target.row, column, target.rowIndex, parsed, previous)
    }
  }

  if (batchChanges.length > 1) {
    emit('cellEditBatchCommit', column, batchChanges)
  }

  if (!options?.skipUndo && props.editUndo && undoItems.length) {
    tableEdit.pushUndo({ items: undoItems })
  }

  if (options?.navigate) moveEditFocus(entry, colKey, options.navigate, true)
  return true
}

function moveEditFocus(
  entry: Extract<RsTableRowEntry<T>, { type: 'row' }>,
  colKey: string,
  direction: RsTableCellNavigateDirection,
  startEditNext: boolean,
): void {
  if (!props.editKeyboard) return
  const cells = buildEditableCellList()
  const next = navigateEditableCell(
    cells,
    rowKeyFor(entry),
    colKey,
    direction,
    displayColumns.value.length || 1,
  )
  if (!next) return
  const nextEntry = findRowEntryByKey(next.rowKey)
  if (!nextEntry) return
  tableEdit.setFocusCell(next)
  rowHighlight.applyRowClickHighlight(next.rowKey)
  if (startEditNext) {
    const column = resolveColumnByKey(next.colKey)
    if (column && isBooleanToggleColumn(column)) return
    onCellStartEdit(nextEntry, next.colKey)
  }
}

async function onCellNavigate(
  entry: Extract<RsTableRowEntry<T>, { type: 'row' }>,
  colKey: string,
  direction: RsTableCellNavigateDirection,
): Promise<void> {
  const draft = tableEdit.editingDraft.value
  await onCellCommitEdit(entry, colKey, draft, { navigate: direction })
}

function onCellClick(entry: RsTableRowEntry<T>, colKey: string, event?: MouseEvent): void {
  if (entry.type !== 'row') return
  onRowClick(entry, event)
  if (!props.editable) return
  const column = resolveColumnByKey(colKey)
  if (!column) return
  tableEdit.setFocusCell({
    rowKey: rowKeyFor(entry),
    colKey,
    rowIndex: entry.rowIndex,
  })
}

function applyUndoRedoValue(
  entry: Extract<RsTableRowEntry<T>, { type: 'row' }>,
  colKey: string,
  value: unknown,
): void {
  const column = resolveColumnByKey(colKey)
  if (!column) return
  const previous = resolveColumnRawValue(entry.row, column, entry.rowIndex)
  emit('cellEditCommit', entry.row, column, entry.rowIndex, value, previous)
}

function onEditUndo(): void {
  if (!props.editUndo) return
  const entry = tableEdit.undo()
  if (!entry) return
  for (const item of entry.items) {
    const rowEntry = findRowEntryByKey(item.rowKey)
    if (!rowEntry) continue
    applyUndoRedoValue(rowEntry, item.colKey, item.previous)
  }
  emit('cellEditUndo', entry)
}

function onEditRedo(): void {
  if (!props.editUndo) return
  const entry = tableEdit.redo()
  if (!entry) return
  for (const item of entry.items) {
    const rowEntry = findRowEntryByKey(item.rowKey)
    if (!rowEntry) continue
    applyUndoRedoValue(rowEntry, item.colKey, item.next)
  }
  emit('cellEditRedo', entry)
}

function onTableKeydown(event: KeyboardEvent): void {
  if (!props.editable || !props.editKeyboard) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
    // 编辑器内部自行处理；仅拦截全局撤销
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      if (!tableEdit.editingCell.value) {
        event.preventDefault()
        onEditUndo()
      }
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))
    ) {
      if (!tableEdit.editingCell.value) {
        event.preventDefault()
        onEditRedo()
      }
    }
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
    event.preventDefault()
    onEditUndo()
    return
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))
  ) {
    event.preventDefault()
    onEditRedo()
    return
  }

  const focus = tableEdit.focusCell.value
  if (!focus) return
  const entry = findRowEntryByKey(focus.rowKey)
  if (!entry) return
  const column = resolveColumnByKey(focus.colKey)
  if (!column) return

  if (event.key === 'F2' || event.key === 'Enter') {
    event.preventDefault()
    if (isBooleanToggleColumn(column)) {
      const next = !coerceBooleanFromRow(entry, column)
      onCellCommitEdit(entry, focus.colKey, next ? 'true' : 'false')
      return
    }
    onCellStartEdit(entry, focus.colKey)
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    tableEdit.cancelEdit()
    return
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (!isColumnEditable(column, entry.row, entry.rowIndex, props.editable)) return
    event.preventDefault()
    const allowNull = isColumnNullable(column, props.allowNull)
    onCellCommitEdit(entry, focus.colKey, allowNull ? nullToEditText() : '')
    return
  }

  if (event.key === 'Tab') {
    event.preventDefault()
    moveEditFocus(entry, focus.colKey, event.shiftKey ? 'prev' : 'next', false)
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    moveEditFocus(entry, focus.colKey, 'next', false)
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    moveEditFocus(entry, focus.colKey, 'prev', false)
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveEditFocus(entry, focus.colKey, 'down', false)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveEditFocus(entry, focus.colKey, 'up', false)
  }
}

function coerceBooleanFromRow(
  entry: Extract<RsTableRowEntry<T>, { type: 'row' }>,
  column: RsTableColumn<T>,
): boolean {
  const raw = resolveColumnRawValue(entry.row, column, entry.rowIndex)
  if (raw == null) return false
  if (typeof raw === 'boolean') return raw
  return String(raw).toLowerCase() === 'true' || raw === 1 || raw === '1'
}

function onTablePaste(event: ClipboardEvent): void {
  if (!props.editable || !props.editPaste) return
  if (tableEdit.editingCell.value) return
  const focus = tableEdit.focusCell.value
  if (!focus) return
  const text = event.clipboardData?.getData('text/plain')
  if (!text) return
  const grid = parseClipboardGrid(text)
  if (!grid.length) return
  event.preventDefault()

  const startEntry = findRowEntryByKey(focus.rowKey)
  if (!startEntry) return
  const startRowPos = dataRows.value.findIndex((item) => rowKeyFor(item) === focus.rowKey)
  const startColIndex = displayColumns.value.findIndex((column) => column.key === focus.colKey)
  if (startRowPos < 0 || startColIndex < 0) return

  for (let r = 0; r < grid.length; r += 1) {
    const rowEntry = dataRows.value[startRowPos + r]
    if (!rowEntry) break
    const line = grid[r] ?? []
    for (let c = 0; c < line.length; c += 1) {
      const column = displayColumns.value[startColIndex + c]
      if (!column) break
      if (!isColumnEditable(column, rowEntry.row, rowEntry.rowIndex, props.editable)) continue
      onCellCommitEdit(rowEntry, column.key, line[c] ?? '')
    }
  }
}

function rejectRowEdit(rowKey: string, reason?: string): void {
  const entry = findRowEntryByKey(rowKey)
  tableEdit.rollbackRow(rowKey)
  if (entry) emit('cellEditReject', entry.row, entry.rowIndex, reason)
}

function onRowCommitEdit(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): void {
  const rowKey = rowKeyFor(entry)
  const staged = tableEdit.commitRow(rowKey)
  if (!staged.length) return
  const changes = staged.map((item) => {
    const column = resolveColumnByKey(item.colKey)
    const allowNull = column ? isColumnNullable(column, props.allowNull) : props.allowNull
    const value = column
      ? parseCellEditInput(item.draft, entry.row, column, entry.rowIndex, { allowNull })
      : item.draft
    return {
      colKey: item.colKey,
      value,
      previous: item.original,
    }
  })
  emit('rowEditCommit', entry.row, entry.rowIndex, changes)
}

function onRowRollbackEdit(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): void {
  if (!props.rowCommit && isExternalRowPending(entry)) {
    emit('rowEditRollback', entry.row, entry.rowIndex)
    return
  }
  tableEdit.rollbackRow(rowKeyFor(entry))
  emit('rowEditRollback', entry.row, entry.rowIndex)
}

function isExternalRowPending(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): boolean {
  return Boolean(props.rowPending?.(entry.row, entry.rowIndex))
}

function rowEditPending(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): boolean {
  if (isExternalRowPending(entry)) return true
  const rowKey = rowKeyFor(entry)
  return isRowEditPending(rowKey, entry.row, entry.rowIndex, {
    isRowDirty: tableEdit.isRowDirty,
    editingCell: tableEdit.editingCell.value,
    editingDraft: tableEdit.editingDraft.value,
    resolveColumn: resolveColumnByKey,
  })
}

function onGutterCommit(entry: Extract<RsTableRowEntry<T>, { type: 'row' }>): void {
  if (props.rowCommit) {
    onRowCommitEdit(entry)
    return
  }
  if (isExternalRowPending(entry)) {
    emit('rowEditCommit', entry.row, entry.rowIndex, [])
    return
  }
  const editing = tableEdit.editingCell.value
  if (editing?.rowKey !== rowKeyFor(entry)) return
  onCellCommitEdit(entry, editing.colKey, tableEdit.editingDraft.value)
}

function getRowByKey(rowKey: string): T | undefined {
  const entry = dataRows.value.find((item) => rowKeyByIndex.value.get(item.rowIndex) === rowKey)
  return entry?.row
}

function getRowByIndex(index: number): T | undefined {
  return dataRows.value.find((item) => item.rowIndex === index)?.row
}

function getColumnValues(colKey: string): unknown[] {
  const column = resolveColumnByKey(colKey)
  if (!column) return []
  return dataRows.value.map((entry) => resolveColumnRawValue(entry.row, column, entry.rowIndex))
}

function getCellValueByKey(rowKey: string, colKey: string): unknown {
  const row = getRowByKey(rowKey)
  const column = resolveColumnByKey(colKey)
  if (!row || !column) return undefined
  const entry = dataRows.value.find((item) => rowKeyByIndex.value.get(item.rowIndex) === rowKey)
  if (!entry) return undefined
  return resolveColumnRawValue(entry.row, column, entry.rowIndex)
}

defineExpose({
  getRowByKey,
  getRowByIndex,
  getColumnValues,
  getCellValue: getCellValueByKey,
  getHighlightedRowKey: () => rowHighlight.highlightedKey.value,
  setHighlightedRowKey: rowHighlight.setHighlightedKey,
  cancelCellEdit: () => tableEdit.cancelEdit(),
  cancelAllEdits: () => tableEdit.cancelAll(),
  getDirtyCellKeys: () => [...tableEdit.stagedMap.value.keys()],
  getCellError: tableEdit.getCellError,
  setCellError: tableEdit.setCellError,
  rejectRowEdit,
  undoEdit: onEditUndo,
  redoEdit: onEditRedo,
  commitRowEdits: (rowKey: string) => {
    const entry = dataRows.value.find((item) => rowKeyByIndex.value.get(item.rowIndex) === rowKey)
    if (entry) onRowCommitEdit(entry)
  },
  rollbackRowEdits: (rowKey: string) => {
    const entry = dataRows.value.find((item) => rowKeyByIndex.value.get(item.rowIndex) === rowKey)
    if (entry) onRowRollbackEdit(entry)
  },
})

/** RAF handle，用于节流滚动更新；组件卸载时取消，防止内存泄漏 */
let scrollRafId = 0

function onScroll(event: Event): void {
  hideCellTooltip()
  // 保留编辑草稿：虚拟滚动卸载行后滚回仍可恢复编辑态
  const element = event.target as HTMLElement
  // 无限加载判断不节流，保证触底灵敏
  if (props.infinite && !props.loading && !props.loadingMore && props.hasMore && !loadMoreLocked.value) {
    if (isNearScrollBottom(element.scrollTop, element.scrollHeight, element.clientHeight, props.infiniteDistance)) {
      loadMoreLocked.value = true
      emit('loadMore')
    }
  }
  // 行/列虚拟滚动位置：RAF 节流，每帧最多写一次
  if (virtualScrollEnabled.value || virtualColumnsEnabled.value) {
    if (scrollRafId) return
    scrollRafId = requestAnimationFrame(() => {
      if (virtualScrollEnabled.value) scrollTop.value = element.scrollTop
      if (virtualColumnsEnabled.value) scrollLeft.value = element.scrollLeft
      scrollRafId = 0
    })
  }
}

watch(
  () => [props.loadingMore, props.hasMore] as const,
  ([loadingMore, hasMore]) => {
    if (!loadingMore || !hasMore) loadMoreLocked.value = false
  },
)

function beginResizeSession(): void {
  if (!resizeState || isColumnResizing.value) return
  isColumnResizing.value = true
  activeDragWidths = { ...resizeState.domSnapshot }
  resizePaintWidths.value = { ...activeDragWidths }
  void nextTick(() => {
    if (tableRef.value && activeDragWidths) applyTableColumnWidths(tableRef.value, activeDragWidths)
  })
}

function onResizeMove(event: MouseEvent): void {
  if (!resizeState) return
  latestResizeClientX = event.clientX
  if (!resizeMoved && Math.abs(latestResizeClientX - resizeState.startX) < 1) return
  if (!resizeMoved) {
    resizeMoved = true
    beginResizeSession()
  }
  if (resizeRafId !== 0) return
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = 0
    if (!resizeState || !activeDragWidths) return
    const nextWidth = clampColumnWidth(
      resizeState.startWidth + latestResizeClientX - resizeState.startX,
      props.minColumnWidth,
      props.maxColumnWidth,
    )
    resizeState.currentWidth = nextWidth
    activeDragWidths = { ...resizeState.domSnapshot, [resizeState.key]: nextWidth }
    if (tableRef.value) applyTableColumnWidths(tableRef.value, activeDragWidths)
  })
}

function stopResize(): void {
  if (resizeState && resizeMoved) {
    const finalWidth = clampColumnWidth(
      resizeState.startWidth + latestResizeClientX - resizeState.startX,
      props.minColumnWidth,
      props.maxColumnWidth,
    )
    if (finalWidth !== resizeState.startWidth) {
      const merged = { ...resizeState.domSnapshot, [resizeState.key]: finalWidth }
      resolvedColumnWidths.value = merged
      emit('columnResize', resizeState.key, finalWidth)
    }
  }
  if (tableRef.value) {
    tableRef.value.style.width = ''
    tableRef.value.style.minWidth = ''
    for (const th of tableRef.value.querySelectorAll<HTMLTableCellElement>('thead th[data-col-key]')) {
      th.style.width = ''
    }
  }
  isColumnResizing.value = false
  resizePaintWidths.value = null
  activeDragWidths = null
  resizeState = null
  resizeMoved = false
  if (resizeRafId !== 0) {
    cancelAnimationFrame(resizeRafId)
    resizeRafId = 0
  }
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', stopResize, { capture: true })
}

function onResizeStart(key: string, event: MouseEvent): void {
  if (!props.resizable) return

  const thEl = (event.currentTarget as HTMLElement).closest('th') as HTMLTableCellElement | null
  if (!thEl) return
  const tableEl = thEl.closest('table') as HTMLTableElement | null
  if (!tableEl) return

  const dataThs = Array.from(tableEl.querySelectorAll<HTMLTableCellElement>('thead th[data-col-key]'))
  const domSnapshot: Record<string, number> = {}
  for (const th of dataThs) {
    domSnapshot[th.dataset.colKey!] = th.offsetWidth
  }

  const startWidth = domSnapshot[key] ?? thEl.offsetWidth
  latestResizeClientX = event.clientX
  resizeMoved = false
  resizeState = {
    key,
    startX: event.clientX,
    startWidth,
    currentWidth: startWidth,
    domSnapshot,
    persistedWidths: { ...resolvedColumnWidths.value },
  }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', stopResize, { capture: true })
}

onUnmounted(() => {
  stopResize()
  viewportResizeObserver?.disconnect()
  viewportResizeObserver = null
  if (scrollRafId) {
    cancelAnimationFrame(scrollRafId)
    scrollRafId = 0
  }
})
</script>

<template>
  <RsContextMenu
    :disabled="!contextMenuEnabled"
    :items="ctxMenuItems"
    @select="onCtxMenuSelect"
  >
    <!-- shell 作为 ContextMenuTrigger 宿主；::before 伪元素铺满 shell 捕获空白区右键 -->
    <div
      class="rs-table-shell"
      :class="{ 'rs-table-shell--ctx': contextMenuEnabled, 'rs-table-shell--fill': fill }"
      tabindex="0"
      v-bind="$attrs"
      @contextmenu="onTableContextmenu"
      @keydown="onTableKeydown"
      @paste="onTablePaste"
    >
      <div
        ref="scrollContainerRef"
        class="rs-table rs-native-scrollbar"
        :class="{
          'rs-table--bordered': bordered,
          'rs-table--column-bordered': columnBordered,
          'rs-table--rounded': rounded,
          'rs-table--fill': fill,
          'rs-table--compact': compact,
          [`rs-table--${resolvedSize}`]: true,
          'rs-table--virtual': virtualScrollEnabled,
          'rs-table--virtual-cols': virtualColumnsEnabled,
          'rs-table--content-visibility': !virtualScrollEnabled && data.length >= 30,
          'rs-table--infinite': infinite,
          'rs-table--resizable': resizable,
          'rs-table--col-auto': resizable && columnLayout === 'auto',
          'rs-table--col-fixed': useFixedColumnLayout,
          'rs-table--striped': striped,
          'rs-table--selectable': selectable,
          'rs-table--row-select': isRowSelection,
          'rs-table--expandable': expandable,
          'rs-table--draggable': rowDraggable || columnDraggable,
          'rs-table--scroll-x': !!scrollX,
          'rs-table--overflow-x': overflowXEnabled,
          'rs-table--ctx': contextMenuEnabled,
          'rs-table--edit-gutter': showEditGutterColumn,
        }"
        :style="scrollContainerStyle"
        @scroll.passive="onScroll"
      >
    <table ref="tableRef" class="rs-table__table" :style="tableInlineStyle">
      <colgroup v-if="useFixedColumnLayout">
        <col v-if="showRowDragHandle" :style="{ width: `${PREFIX_COL_WIDTH.drag}px` }">
        <col v-if="expandable" :style="{ width: `${PREFIX_COL_WIDTH.expand}px` }">
        <col v-if="showSelectColumn" :style="{ width: `${PREFIX_COL_WIDTH.select}px` }">
        <col v-if="showEditGutterColumn" data-col-key="gutter" :style="{ width: `${resolvedGutterWidth}px` }">
        <col v-else-if="showIndexColumn" :style="{ width: `${PREFIX_COL_WIDTH.index}px` }">
        <col v-if="showRowStatusColumn" :style="{ width: `${PREFIX_COL_WIDTH.status}px` }">
        <col
          v-if="columnPadLeft > 0"
          class="rs-table__col-pad"
          :style="{ width: `${columnPadLeft}px` }"
        >
        <col
          v-for="column in visibleDataColumns"
          :key="column.key"
          :data-col-key="column.key"
          :style="{ width: `${resolvedDataColumnWidth(column.key, column.width ?? column.minWidth)}px` }"
        >
        <col
          v-if="columnPadRight > 0"
          class="rs-table__col-pad"
          :style="{ width: `${columnPadRight}px` }"
        >
      </colgroup>
      <thead
        v-if="showHeader"
        class="rs-table__head"
        @pointerover.passive="onCellTipOver"
        @pointerout.passive="onCellTipOut"
      >
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
            v-if="showSelectColumn"
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
            v-if="showEditGutterColumn"
            class="rs-table__th rs-table__th--gutter rs-table__cell--center"
            :style="gutterLeadHeaderStyle"
          />
          <th
            v-else-if="showIndexColumn"
            class="rs-table__th rs-table__th--index rs-table__cell--center"
            :style="indexLeadHeaderStyle"
          >
            {{ t('table.index') }}
          </th>
          <th
            v-if="showRowStatusColumn"
            class="rs-table__th rs-table__th--status rs-table__cell--center"
          >
            {{ t('table.rowStatus') }}
          </th>
          <th
            v-if="columnPadLeft > 0"
            class="rs-table__th rs-table__col-pad"
            :style="{ width: `${columnPadLeft}px`, minWidth: `${columnPadLeft}px` }"
          />
          <th
            v-for="column in visibleDataColumns"
            :key="column.key"
            :data-col-key="column.key"
            class="rs-table__th"
            :class="[
              `rs-table__cell--${column.align ?? 'left'}`,
              { 'rs-table__th--sortable': column.sortable },
              { 'rs-table__th--filterable': column.filterable },
              { 'rs-table__cell--fixed': column.fixed },
              { 'rs-table__th--dragging': dragColumnKey === column.key },
            ]"
            :style="columnHeaderStyleMap.get(column.key)"
            @dragover="onColumnDragOver(column.key, $event)"
            @drop="onColumnDrop(column.key, $event)"
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
              <span
                v-if="column.headerTip"
                class="rs-table__th-label rs-table__th-label--tip"
                :data-rs-table-header-tip="column.headerTip"
              >{{ column.title }}</span>
              <span v-else class="rs-table__th-label">{{ column.title }}</span>
            </slot>
            <span v-if="column.filterable || column.sortable" class="rs-table__header-actions">
              <RsTableHeaderFilter
                v-if="column.filterable"
                :model-value="columnFilterValue(column.key)"
                :column-title="column.title"
                :filter-label="t('table.filterColumn')"
                :placeholder="t('table.filterPlaceholder')"
                :clear-label="t('table.filterClear')"
                :apply-label="t('table.filterApply')"
                :active="isColumnFilterActive(columnFiltersState, column.key)"
                @update:model-value="updateColumnFilter(column.key, $event)"
              />
              <button
                v-if="column.sortable"
                type="button"
                class="rs-table__sort"
                :class="{ 'rs-table__sort--active': !!sortOrderFor(column.key) }"
                :title="column.title"
                :aria-label="column.title"
                @click.stop="onHeaderClick(column)"
              >
                <RsIcon :name="sortIconName(column.key)" size="sm" />
                <span v-if="multiSort && sortPriorityFor(column.key) > 1" class="rs-table__sort-priority">
                  {{ sortPriorityFor(column.key) }}
                </span>
              </button>
            </span>
            <span
              v-if="resizable"
              class="rs-table__resize-handle"
              @mousedown.stop="onResizeStart(column.key, $event)"
              @click.stop
            />
          </th>
          <th
            v-if="columnPadRight > 0"
            class="rs-table__th rs-table__col-pad"
            :style="{ width: `${columnPadRight}px`, minWidth: `${columnPadRight}px` }"
          />
        </tr>
      </thead>
      <tbody
        @pointerover.passive="onCellTipOver"
        @pointerout.passive="onCellTipOut"
      >
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
            v-if="virtualScrollEnabled && virtualSlice.paddingTop > 0"
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
            <RsTableBodyRow
              v-else
              v-memo="[
                rowKeyFor(entry),
                /* 行对象引用：父级不可变更新后必须失效，否则布尔勾选等提交不刷新 */
                entry.row,
                isRowSelected(entry),
                isRowExpanded(entry),
                rowHighlight.isHighlighted(rowKeyFor(entry)),
                rowEditPending(entry),
                tableEdit.stagedMap.value.size,
                tableEdit.editingCell.value?.rowKey === rowKeyFor(entry)
                  ? tableEdit.editingDraft.value
                  : '',
                activeEditCellKey,
                activeFocusCellKey,
                activeErrorMapSize,
                activeValidatingMapSize,
                dragRowKeys.join(','),
                dropRowTargetKey,
                dropRowPosition,
                columnPadLeft,
                columnPadRight,
                visibleDataColumns.map((c) => c.key).join('\0'),
              ]"
              :row="entry.row"
              :row-index="entry.rowIndex"
              :row-key="rowKeyFor(entry)"
              :columns="visibleDataColumns"
              :column-pad-left="columnPadLeft"
              :column-pad-right="columnPadRight"
              :column-td-class-map="columnTdClassMap"
              :column-style-map="columnStyleMap"
              :show-row-drag-handle="showRowDragHandle"
              :expandable="expandable"
              :selectable="showSelectColumn"
              :show-index="showIndexColumn"
              :show-edit-gutter="showEditGutterColumn"
              :striped="striped"
              :selection-type="selectionType"
              :is-radio-selection="isRadioSelection"
              :table-editable="editable"
              :edit-trigger="editTrigger"
              :row-commit="rowCommit"
              :allow-null="allowNull"
              :focus-mode="editFocusMode"
              :null-label="nullLabel"
              :show-row-status="showRowStatusColumn"
              :selected="isRowSelected(entry)"
              :highlighted="rowHighlight.isHighlighted(rowKeyFor(entry))"
              :expanded="isRowExpanded(entry)"
              :disabled="isTableRowDisabled(entry.row)"
              :row-drag-by-row="isRowDragByRow(entry)"
              :dragging="isRowDragging(entry)"
              :drop-target="isRowDropTarget(entry)"
              :drop-position="isRowDropTarget(entry) ? dropRowPosition : null"
              :drag-lead-style="dragLeadStyle"
              :expand-lead-style="expandLeadStyle"
              :select-lead-style="selectLeadStyle"
              :index-lead-style="indexLeadStyle"
              :gutter-lead-style="gutterLeadStyle"
              :can-expand="canExpandRow(entry)"
              :can-select="canSelectRow(entry)"
              :row-edit-pending="rowEditPending(entry)"
              :row-dirty="tableEdit.isRowDirty(rowKeyFor(entry))"
              :show-gutter-rollback="rowCommit || isExternalRowPending(entry)"
              :editing-col-key="tableEdit.editingCell.value?.rowKey === rowKeyFor(entry) ? tableEdit.editingCell.value.colKey : null"
              :focus-col-key="tableEdit.focusCell.value?.rowKey === rowKeyFor(entry) ? tableEdit.focusCell.value.colKey : null"
              :has-column-slot="hasColumnSlot"
              :has-edit-slot="hasEditSlot"
              :cell-tooltip-enabled="cellTooltipEnabled"
              :cell-tooltip-mode="cellTooltipMode"
              :cell-tooltip-text="cellTooltipText"
              :cell-tooltip-fallback-title="cellTooltipFallbackTitle"
              :get-cell-draft="tableEdit.getDraft"
              :is-cell-dirty="tableEdit.isDirty"
              :get-cell-error="tableEdit.getCellError"
              :is-cell-validating="tableEdit.isValidating"
              :drag-row-label="t('table.dragRow')"
              :expand-row-label="t('table.expandRow')"
              :collapse-row-label="t('table.collapseRow')"
              :select-row-label="t('table.selectRow')"
              :row-commit-label="t('table.rowCommit')"
              :row-rollback-label="t('table.rowRollback')"
              :gutter-commit-hint="t('table.gutterCommit')"
              @click="onRowClick(entry, $event)"
              @mousedown="onRowSelectMouseDown"
              @cell-click="(colKey, event) => onCellClick(entry, colKey, event)"
              @cell-contextmenu="(colKey, event) => onCellContextmenu(entry, colKey, event)"
              @dblclick="onRowDblclick(entry, $event)"
              @contextmenu="onRowContextmenu(entry, $event)"
              @dragover="onRowDragOver(entry, $event)"
              @dragleave="onRowDragLeave"
              @drop="onRowDrop(entry, $event)"
              @row-drag-start="onRowDragStart(entry, $event)"
              @row-drag-end="onRowDragEnd"
              @toggle-expand="onToggleExpand(entry)"
              @toggle-select="onToggleRow(entry)"
              @cell-start-edit="onCellStartEdit(entry, $event)"
              @cell-commit="(colKey, value) => onCellCommitEdit(entry, colKey, value)"
              @cell-cancel="onCellCancelEdit(entry, $event)"
              @cell-update-draft="(colKey, value) => onCellUpdateDraft(entry, colKey, value)"
              @cell-navigate="(colKey, direction) => onCellNavigate(entry, colKey, direction)"
              @row-commit="onRowCommitEdit(entry)"
              @row-rollback="onRowRollbackEdit(entry)"
              @gutter-commit="onGutterCommit(entry)"
            >
              <template v-for="column in visibleDataColumns" #[column.key]="slotProps">
                <slot :name="column.key" v-bind="slotProps" />
              </template>
              <template
                v-for="column in visibleDataColumns"
                :key="`edit-${column.key}`"
                #[`edit-${column.key}`]="slotProps"
              >
                <slot :name="`edit-${column.key}`" v-bind="slotProps" />
              </template>
            </RsTableBodyRow>
          </template>
          <tr
            v-if="virtualScrollEnabled && virtualSlice.paddingBottom > 0"
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
      <Teleport to="body">
        <div
          v-if="cellTipState.visible"
          ref="sharedTipRef"
          class="rs-table__shared-tip"
          :class="{
            'rs-table__shared-tip--ready': cellTipState.ready,
            'rs-table__shared-tip--header': cellTipState.kind === 'header',
          }"
          :style="cellTipState.style"
          role="tooltip"
        >
          {{ cellTipState.text }}
        </div>
      </Teleport>
    </div>
  </RsContextMenu>
</template>
