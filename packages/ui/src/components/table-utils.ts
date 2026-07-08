import type { VNodeChild } from 'vue'

export type RsTableColumnAlign = 'left' | 'center' | 'right'
export type RsTableColumnFixed = 'left' | 'right'
export type RsTableSortOrder = 'asc' | 'desc' | null
export type RsTableSelectionType = 'checkbox' | 'radio'
export type RsTableSize = 'sm' | 'md' | 'lg'

/** 行数据最小约束：任意非原始类型对象（interface / type 均可） */
export type RsTableRowData = object

/**
 * 可选约定字段（非强制）。
 * - 未传 `rowKey` 时，`resolveRowKey` 依次回退 `id` → `key` → 行索引
 * - `disabled === true` 时行不可选
 */
export interface RsTableRowConvention {
  id?: string | number
  key?: string | number
  disabled?: boolean
}

/**
 * 行字段访问器：列 key（ keyof 字符串键）、任意路径字符串、或自定义函数。
 * 用于 `rowKey`、`groupBy` 等配置。
 */
export type RsTableFieldAccessor<T extends RsTableRowData = RsTableRowData> =
  | Extract<keyof T, string>
  | string
  | ((row: T) => string)

/** 行唯一键配置 */
export type RsTableRowKey<T extends RsTableRowData = RsTableRowData> = RsTableFieldAccessor<T>

/** 分组字段配置 */
export type RsTableGroupBy<T extends RsTableRowData = RsTableRowData> = RsTableFieldAccessor<T>

/** 单元格 render 返回值（文本、数字或 Vue VNode） */
export type RsTableCellRenderResult = VNodeChild

function readConvention(row: object): Partial<RsTableRowConvention> {
  const record = row as Record<string, unknown>
  const result: Partial<RsTableRowConvention> = {}
  const { id, key, disabled } = record
  if (typeof id === 'string' || typeof id === 'number') result.id = id
  if (typeof key === 'string' || typeof key === 'number') result.key = key
  if (typeof disabled === 'boolean') result.disabled = disabled
  return result
}

function formatComparableValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value instanceof Date) return value.toISOString()
  return JSON.stringify(value)
}

function readRowKeyFallback(row: object): string | undefined {
  const { id, key } = readConvention(row)
  if (typeof id === 'string' || typeof id === 'number') return String(id)
  if (typeof key === 'string' || typeof key === 'number') return String(key)
  return undefined
}

export interface RsTableSortState {
  key: string
  order: Exclude<RsTableSortOrder, null>
}

export interface RsTableColumn<T extends RsTableRowData = Record<string, unknown>> {
  key: string
  title: string
  dataIndex?: Extract<keyof T, string> | string
  width?: number | string
  minWidth?: number | string
  align?: RsTableColumnAlign
  sortable?: boolean
  sorter?: (left: T, right: T) => number
  fixed?: RsTableColumnFixed
  ellipsis?: boolean
  render?: (row: T, index: number) => RsTableCellRenderResult
}

export type RsTableSelectAllState = 'checked' | 'indeterminate' | 'unchecked'

export type RsTableRowEntry<T extends RsTableRowData = Record<string, unknown>> =
  | { type: 'row'; row: T; rowIndex: number }
  | { type: 'group'; key: string; label: string }
  | { type: 'expand'; row: T; rowIndex: number; rowKey: string }

export const TABLE_ROW_HEIGHT = {
  sm: 33,
  md: 41,
  lg: 48,
  group: 36,
  expand: 80,
} as const

export interface RsTableFixedCellStyle {
  fixed: RsTableColumnFixed
  left?: number
  right?: number
}

export function getCellValue<T extends RsTableRowData>(row: T, column: RsTableColumn<T>): unknown {
  return row[(column.dataIndex ?? column.key) as keyof T]
}

export function compareTableValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === undefined || a === null) return -1
  if (b === undefined || b === null) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return formatComparableValue(a).localeCompare(formatComparableValue(b))
}

export function toggleSortState(current: RsTableSortState | null, key: string): RsTableSortState | null {
  if (current?.key !== key) return { key, order: 'asc' }
  if (current.order === 'asc') return { key, order: 'desc' }
  return null
}

export function toggleMultiSortState(
  sorts: readonly RsTableSortState[],
  key: string,
  maxSort = 3,
): RsTableSortState[] {
  const existingIndex = sorts.findIndex((item) => item.key === key)
  if (existingIndex < 0) {
    const next = [...sorts, { key, order: 'asc' as const }]
    return next.length > maxSort ? next.slice(next.length - maxSort) : next
  }
  const existing = sorts[existingIndex]
  if (!existing) return [...sorts]
  if (existing.order === 'asc') {
    return sorts.map((item, index) => (index === existingIndex ? { key, order: 'desc' as const } : item))
  }
  return sorts.filter((_, index) => index !== existingIndex)
}

export function getSortOrderForKey(sorts: readonly RsTableSortState[], key: string): RsTableSortOrder {
  return sorts.find((item) => item.key === key)?.order ?? null
}

export function getSortPriorityForKey(sorts: readonly RsTableSortState[], key: string): number {
  const index = sorts.findIndex((item) => item.key === key)
  return index >= 0 ? index + 1 : 0
}

export function compareTableRowsBySort<T extends RsTableRowData>(
  left: T,
  right: T,
  column: RsTableColumn<T>,
  order: Exclude<RsTableSortOrder, null>,
): number {
  const direction = order === 'asc' ? 1 : -1
  if (column.sorter) return column.sorter(left, right) * direction
  return compareTableValues(getCellValue(left, column), getCellValue(right, column)) * direction
}

export function sortTableRows<T extends RsTableRowData>(
  rows: readonly T[],
  columns: readonly RsTableColumn<T>[],
  sort: RsTableSortState | null,
): T[] {
  if (!sort) return [...rows]
  const column = columns.find((item) => item.key === sort.key)
  if (!column) return [...rows]
  return [...rows].sort((left, right) => compareTableRowsBySort(left, right, column, sort.order))
}

export function sortTableRowsMulti<T extends RsTableRowData>(
  rows: readonly T[],
  columns: readonly RsTableColumn<T>[],
  sorts: readonly RsTableSortState[],
): T[] {
  if (sorts.length === 0) return [...rows]
  return [...rows].sort((left, right) => {
    for (const sort of sorts) {
      const column = columns.find((item) => item.key === sort.key)
      if (!column) continue
      const compare = compareTableRowsBySort(left, right, column, sort.order)
      if (compare !== 0) return compare
    }
    return 0
  })
}

export function filterTableRows<T extends RsTableRowData>(
  rows: readonly T[],
  query: string,
  columns: readonly RsTableColumn<T>[],
  keys?: string[],
): T[] {
  const trimmed = query.trim()
  if (!trimmed) return [...rows]
  const searchKeys = keys ?? columns.map((column) => column.key)
  const lower = trimmed.toLowerCase()
  return rows.filter((row) =>
    searchKeys.some((key) => {
      const column = columns.find((item) => item.key === key)
      const value = column ? getCellValue(row, column) : row[key as keyof T]
      return formatComparableValue(value).toLowerCase().includes(lower)
    }),
  )
}

export function resolveGroupKey<T extends RsTableRowData>(
  row: T,
  groupBy: RsTableGroupBy<T>,
): string {
  if (typeof groupBy === 'function') return groupBy(row)
  return String(row[groupBy as keyof T] ?? '')
}

export function groupTableRows<T extends RsTableRowData>(
  rows: readonly T[],
  groupBy: RsTableGroupBy<T>,
  labelFormatter?: (key: string) => string,
): RsTableRowEntry<T>[] {
  const result: RsTableRowEntry<T>[] = []
  let lastKey: string | null = null
  rows.forEach((row, rowIndex) => {
    const key = resolveGroupKey(row, groupBy)
    if (key !== lastKey) {
      result.push({ type: 'group', key, label: labelFormatter?.(key) ?? key })
      lastKey = key
    }
    result.push({ type: 'row', row, rowIndex })
  })
  return result
}

export function resolveColumnOrder<T extends RsTableRowData>(
  columns: readonly RsTableColumn<T>[],
  order?: readonly string[],
): string[] {
  const keys = columns.map((column) => column.key)
  if (!order?.length) return keys
  const valid = order.filter((key) => keys.includes(key))
  const missing = keys.filter((key) => !valid.includes(key))
  return [...valid, ...missing]
}

export function resolveOrderedColumns<T extends RsTableRowData>(
  columns: readonly RsTableColumn<T>[],
  order?: readonly string[],
): RsTableColumn<T>[] {
  const map = new Map(columns.map((column) => [column.key, column]))
  return resolveColumnOrder(columns, order)
    .map((key) => map.get(key))
    .filter((column): column is RsTableColumn<T> => column !== undefined)
}

export function reorderColumnKeys(order: readonly string[], dragKey: string, dropKey: string): string[] {
  if (dragKey === dropKey) return [...order]
  const next = order.filter((key) => key !== dragKey)
  const dropIndex = next.indexOf(dropKey)
  if (dropIndex < 0) return [...order]
  next.splice(dropIndex, 0, dragKey)
  return next
}

export type RsTableRowDropPosition = 'before' | 'after' | 'into'

export function reorderTableRows<T>(
  rows: readonly T[],
  dragIndex: number,
  dropIndex: number,
  position: RsTableRowDropPosition,
): T[] {
  if (dragIndex < 0 || dropIndex < 0 || dragIndex === dropIndex) return [...rows]
  const next = [...rows]
  const [moved] = next.splice(dragIndex, 1)
  if (moved === undefined) return [...rows]
  let targetIndex = dropIndex
  if (dragIndex < dropIndex) targetIndex -= 1
  if (position === 'after') targetIndex += 1
  next.splice(targetIndex, 0, moved)
  return next
}

export function buildTableEntries<T extends RsTableRowData>(
  rows: readonly T[],
  columns: readonly RsTableColumn<T>[],
  options: {
    sort?: RsTableSortState | null
    sorts?: readonly RsTableSortState[]
    multiSort?: boolean
    filterText?: string
    filterKeys?: string[]
    groupBy?: RsTableGroupBy<T>
    groupLabel?: (key: string) => string
    remoteSort?: boolean
  } = {},
): RsTableRowEntry<T>[] {
  let processed = filterTableRows(rows, options.filterText ?? '', columns, options.filterKeys)
  if (!options.remoteSort) {
    if (options.multiSort && options.sorts?.length) {
      processed = sortTableRowsMulti(processed, columns, options.sorts)
    } else {
      processed = sortTableRows(processed, columns, options.sort ?? null)
    }
  }
  if (options.groupBy) {
    const groupBy = options.groupBy
    processed = [...processed].sort((left, right) =>
      compareTableValues(resolveGroupKey(left, groupBy), resolveGroupKey(right, groupBy)),
    )
    return groupTableRows(processed, groupBy, options.groupLabel)
  }
  return processed.map((row, rowIndex) => ({ type: 'row' as const, row, rowIndex }))
}

export function injectExpandRows<T extends RsTableRowData>(
  entries: readonly RsTableRowEntry<T>[],
  expandedKeys: ReadonlySet<string>,
  rowKey?: RsTableRowKey<T>,
  rowExpandable?: (row: T, index: number) => boolean,
): RsTableRowEntry<T>[] {
  const result: RsTableRowEntry<T>[] = []
  for (const entry of entries) {
    result.push(entry)
    if (entry.type !== 'row') continue
    if (rowExpandable && !rowExpandable(entry.row, entry.rowIndex)) continue
    const key = resolveRowKey(entry.row, entry.rowIndex, rowKey)
    if (expandedKeys.has(key)) {
      result.push({ type: 'expand', row: entry.row, rowIndex: entry.rowIndex, rowKey: key })
    }
  }
  return result
}

export function toggleExpandedRowKeys(keys: readonly string[], key: string): string[] {
  const next = new Set(keys)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return [...next]
}

export function resolveTableSize(compact: boolean, size: RsTableSize = 'md'): RsTableSize {
  if (compact) return 'sm'
  return size
}

export function resolveTableRowHeight(size: RsTableSize = 'md', custom?: number): number {
  if (custom !== undefined) return custom
  return TABLE_ROW_HEIGHT[size]
}

export function resolveTableVirtualEnabled(options: {
  virtual?: boolean
  infinite?: boolean
  virtualOnInfinite?: boolean
}): boolean {
  if (options.virtual) return true
  if (options.infinite && options.virtualOnInfinite !== false) return true
  return false
}

export function isNearScrollBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  distance = 80,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= distance
}

export function entryHeight<T extends RsTableRowData>(
  entry: RsTableRowEntry<T>,
  rowHeight: number,
  groupRowHeight = TABLE_ROW_HEIGHT.group,
  expandRowHeight = TABLE_ROW_HEIGHT.expand,
): number {
  if (entry.type === 'group') return groupRowHeight
  if (entry.type === 'expand') return expandRowHeight
  return rowHeight
}

export function resolveScrollWidth(scrollX?: number | string, _columns?: readonly RsTableColumn[]): string | undefined {
  if (scrollX === undefined) return undefined
  if (typeof scrollX === 'number') return `${scrollX}px`
  return scrollX
}

export function resolveLeadingColumnWidth(options: {
  selectable?: boolean
  showIndex?: boolean
  expandable?: boolean
  rowDraggable?: boolean
}): number {
  let width = 0
  if (options.rowDraggable) width += 40
  if (options.expandable) width += 40
  if (options.selectable) width += 40
  if (options.showIndex) width += 56
  return width
}

export function resolveFixedColumnStyles<T extends RsTableRowData>(
  columns: readonly RsTableColumn<T>[],
  widths: Record<string, number | string>,
  options: {
    selectable?: boolean
    showIndex?: boolean
    expandable?: boolean
    rowDraggable?: boolean
  } = {},
): Map<string, RsTableFixedCellStyle> {
  const result = new Map<string, RsTableFixedCellStyle>()
  const leading = resolveLeadingColumnWidth(options)
  let leftOffset = leading

  for (const column of columns) {
    if (column.fixed !== 'left') continue
    result.set(column.key, { fixed: 'left', left: leftOffset })
    leftOffset += parseColumnWidth(widths[column.key] ?? column.width)
  }

  let rightOffset = 0
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    const column = columns[index]
    if (column?.fixed !== 'right') continue
    result.set(column.key, { fixed: 'right', right: rightOffset })
    rightOffset += parseColumnWidth(widths[column.key] ?? column.width)
  }

  return result
}

export function fixedCellStyle(
  style?: RsTableFixedCellStyle,
  options?: { header?: boolean },
): Record<string, string> | undefined {
  if (!style) return undefined
  const result: Record<string, string> = {
    position: 'sticky',
    zIndex: options?.header ? '4' : '2',
  }
  if (options?.header) result.top = '0'
  if (style.fixed === 'left' && style.left !== undefined) {
    result.left = `${style.left}px`
    return result
  }
  if (style.fixed === 'right' && style.right !== undefined) {
    result.right = `${style.right}px`
    return result
  }
  return undefined
}

export function selectRowKeys(
  selectedKeys: readonly string[],
  key: string,
  selectionType: RsTableSelectionType,
): string[] {
  if (selectionType === 'radio') return [key]
  return toggleRowSelection(selectedKeys, key)
}

export function sliceVirtualTableEntries<T extends RsTableRowData>(
  entries: readonly RsTableRowEntry<T>[],
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  groupRowHeight = TABLE_ROW_HEIGHT.group,
  overscan = 4,
  expandRowHeight = TABLE_ROW_HEIGHT.expand,
): {
  entries: RsTableRowEntry<T>[]
  paddingTop: number
  paddingBottom: number
} {
  if (entries.length === 0) return { entries: [], paddingTop: 0, paddingBottom: 0 }

  const heights = entries.map((entry) => entryHeight(entry, rowHeight, groupRowHeight, expandRowHeight))
  const totalHeight = heights.reduce((sum, height) => sum + height, 0)
  const overscanPx = overscan * rowHeight
  const targetTop = Math.max(0, scrollTop - overscanPx)

  let acc = 0
  let start = 0
  for (let index = 0; index < heights.length; index += 1) {
    if (acc + heights[index] > targetTop) {
      start = index
      break
    }
    acc += heights[index]
    if (index === heights.length - 1) start = heights.length
  }

  const paddingTop = heights.slice(0, start).reduce((sum, height) => sum + height, 0)

  let visibleHeight = 0
  let end = start
  for (let index = start; index < heights.length; index += 1) {
    visibleHeight += heights[index]
    end = index + 1
    if (visibleHeight >= viewportHeight + overscanPx * 2) break
  }

  const renderedHeight = heights.slice(start, end).reduce((sum, height) => sum + height, 0)
  const paddingBottom = Math.max(0, totalHeight - paddingTop - renderedHeight)

  return {
    entries: entries.slice(start, end),
    paddingTop,
    paddingBottom,
  }
}

export function resolveRowKey<T extends RsTableRowData>(row: T, index: number, rowKey?: RsTableRowKey<T>): string {
  if (typeof rowKey === 'function') return rowKey(row)
  if (rowKey) return String(row[rowKey as keyof T])
  return readRowKeyFallback(row) ?? String(index)
}

export function resolveEntryKey<T extends RsTableRowData>(
  entry: RsTableRowEntry<T>,
  rowKey?: RsTableRowKey<T>,
): string {
  if (entry.type === 'group') return `group:${entry.key}`
  if (entry.type === 'expand') return `expand:${entry.rowKey}`
  return resolveRowKey(entry.row, entry.rowIndex, rowKey)
}

export function resolveColumnStyle<T extends RsTableRowData = Record<string, unknown>>(
  column: RsTableColumn<T>,
  widths?: Record<string, number | string>,
): Record<string, string> | undefined {
  const width = widths?.[column.key] ?? column.width
  if (width === undefined) return undefined
  return { width: typeof width === 'number' ? `${width}px` : width }
}

export function clampColumnWidth(width: number, min = 48, max = 640): number {
  return Math.min(max, Math.max(min, width))
}

export function parseColumnWidth(width: number | string | undefined, fallback = 120): number {
  if (typeof width === 'number') return width
  if (typeof width === 'string' && width.endsWith('px')) return Number.parseInt(width, 10) || fallback
  return fallback
}

export function createInitialColumnWidths<T extends RsTableRowData>(
  columns: readonly RsTableColumn<T>[],
  overrides?: Record<string, number | string>,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const column of columns) {
    const override = overrides?.[column.key]
    if (typeof override === 'number') {
      result[column.key] = override
      continue
    }
    if (typeof override === 'string' && override.endsWith('px')) {
      result[column.key] = Number.parseInt(override, 10) || parseColumnWidth(column.width)
      continue
    }
    if (typeof column.width === 'number') {
      result[column.key] = column.width
    }
  }
  return result
}

export function isTableRowDisabled<T extends RsTableRowData>(row: T): boolean {
  return readConvention(row).disabled === true
}

export function resolveSelectableRowKeys<T extends RsTableRowData>(
  rows: readonly T[],
  rowKey?: RsTableRowKey<T>,
  rowSelectable?: (row: T, index: number) => boolean,
): string[] {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => {
      if (isTableRowDisabled(row)) return false
      return rowSelectable ? rowSelectable(row, index) : true
    })
    .map(({ row, index }) => resolveRowKey(row, index, rowKey))
}

export function resolveSelectAllState(
  selectedKeys: readonly string[],
  allKeys: readonly string[],
): RsTableSelectAllState {
  if (allKeys.length === 0) return 'unchecked'
  const selectedCount = allKeys.filter((key) => selectedKeys.includes(key)).length
  if (selectedCount === 0) return 'unchecked'
  if (selectedCount === allKeys.length) return 'checked'
  return 'indeterminate'
}

export function toggleRowSelection(selectedKeys: readonly string[], key: string): string[] {
  const next = new Set(selectedKeys)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return [...next]
}

export function toggleSelectAll(
  selectedKeys: readonly string[],
  allKeys: readonly string[],
  select: boolean,
): string[] {
  const next = new Set(selectedKeys)
  if (select) {
    for (const key of allKeys) next.add(key)
  } else {
    for (const key of allKeys) next.delete(key)
  }
  return [...next]
}
