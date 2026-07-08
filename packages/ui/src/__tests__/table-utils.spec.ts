import { describe, expect, it } from 'vitest'
import {
  buildTableEntries,
  clampColumnWidth,
  filterTableRows,
  fixedCellStyle,
  groupTableRows,
  injectExpandRows,
  isNearScrollBottom,
  resolveFixedColumnStyles,
  resolveSelectableRowKeys,
  resolveSelectAllState,
  resolveTableVirtualEnabled,
  selectRowKeys,
  sliceVirtualTableEntries,
  sortTableRows,
  toggleMultiSortState,
  toggleRowSelection,
  toggleSelectAll,
  toggleSortState,
  reorderColumnKeys,
  reorderTableRows,
  resolveColumnOrder,
  resolveOrderedColumns,
  sortTableRowsMulti,
} from '../components/table-utils'

describe('table-utils', () => {
  const columns = [
    { key: 'name', title: '名称', sortable: true },
    { key: 'status', title: '状态' },
    { key: 'count', title: '数量', sortable: true },
  ]

  const rows = [
    { id: '1', name: 'Alpha', status: 'running', count: 12 },
    { id: '2', name: 'Beta', status: 'stopped', count: 7 },
    { id: '3', name: 'Gamma', status: 'running', count: 23 },
  ]

  it('filters rows by query across columns', () => {
    expect(filterTableRows(rows, 'alp', columns).map((row) => row.name)).toEqual(['Alpha'])
    expect(filterTableRows(rows, 'running', columns, ['status'])).toHaveLength(2)
    expect(filterTableRows(rows, '  ', columns)).toHaveLength(3)
  })

  it('toggles sort state', () => {
    expect(toggleSortState(null, 'name')).toEqual({ key: 'name', order: 'asc' })
    expect(toggleSortState({ key: 'name', order: 'asc' }, 'name')).toEqual({ key: 'name', order: 'desc' })
    expect(toggleSortState({ key: 'name', order: 'desc' }, 'name')).toBeNull()
  })

  it('sorts rows by numeric and string columns', () => {
    expect(sortTableRows(rows, columns, { key: 'name', order: 'asc' }).map((row) => row.name)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ])
    expect(sortTableRows(rows, columns, { key: 'count', order: 'desc' }).map((row) => row.count)).toEqual([23, 12, 7])
  })

  it('groups rows and inserts group headers', () => {
    const sorted = [...rows].sort((left, right) => left.status.localeCompare(right.status))
    const grouped = groupTableRows(sorted, 'status', (key) => `状态：${key}`)
    expect(grouped.filter((entry) => entry.type === 'group').map((entry) => entry.label)).toEqual([
      '状态：running',
      '状态：stopped',
    ])
    expect(grouped.filter((entry) => entry.type === 'row')).toHaveLength(3)
  })

  it('builds entries with filter, sort and group pipeline', () => {
    const entries = buildTableEntries(rows, columns, {
      filterText: 'running',
      filterKeys: ['status'],
      sort: { key: 'count', order: 'desc' },
      groupBy: 'status',
      groupLabel: (key) => key,
    })
    expect(entries.some((entry) => entry.type === 'group' && entry.key === 'running')).toBe(true)
    const dataRows = entries.filter((entry) => entry.type === 'row')
    expect(dataRows).toHaveLength(2)
    expect(dataRows[0].type === 'row' && dataRows[0].row.name).toBe('Gamma')
  })

  it('slices virtual entries with padding', () => {
    const entries = buildTableEntries(
      Array.from({ length: 100 }, (_, index) => ({
        id: String(index),
        name: `Row ${index}`,
        status: 'running',
        count: index,
      })),
      columns,
    )
    const slice = sliceVirtualTableEntries(entries, 400, 200, 40, 36, 2)
    expect(slice.entries.length).toBeLessThan(entries.length)
    expect(slice.paddingTop).toBeGreaterThan(0)
    expect(slice.paddingBottom).toBeGreaterThan(0)
  })

  it('clamps column width', () => {
    expect(clampColumnWidth(10)).toBe(48)
    expect(clampColumnWidth(900)).toBe(640)
    expect(clampColumnWidth(120)).toBe(120)
  })

  it('resolves virtual scroll for infinite mode', () => {
    expect(resolveTableVirtualEnabled({ infinite: true })).toBe(true)
    expect(resolveTableVirtualEnabled({ infinite: true, virtualOnInfinite: false })).toBe(false)
    expect(resolveTableVirtualEnabled({ virtual: true })).toBe(true)
  })

  it('detects near scroll bottom', () => {
    expect(isNearScrollBottom(300, 400, 120, 80)).toBe(true)
    expect(isNearScrollBottom(100, 400, 120, 80)).toBe(false)
  })

  it('resolves row selection helpers', () => {
    const rows = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B', disabled: true },
      { id: '3', name: 'C' },
    ]
    const keys = resolveSelectableRowKeys(rows, 'id')
    expect(keys).toEqual(['1', '3'])
    expect(resolveSelectAllState(['1'], keys)).toBe('indeterminate')
    expect(toggleSelectAll([], keys, true)).toEqual(['1', '3'])
    expect(toggleRowSelection(['1', '3'], '1')).toEqual(['3'])
  })

  it('injects expand rows after expanded keys', () => {
    const entries = buildTableEntries(
      [{ id: '1', name: 'A' }],
      [{ key: 'name', title: '名称' }],
    )
    const expanded = injectExpandRows(entries, new Set(['1']), 'id')
    expect(expanded).toHaveLength(2)
    expect(expanded[1]?.type).toBe('expand')
  })

  it('resolves fixed column offsets', () => {
    const styles = resolveFixedColumnStyles(
      [
        { key: 'name', title: '名称', fixed: 'left', width: 100 },
        { key: 'action', title: '操作', fixed: 'right', width: 80 },
      ],
      {},
      { expandable: true },
    )
    expect(styles.get('name')?.left).toBe(40)
    expect(styles.get('action')?.right).toBe(0)
  })

  it('applies header top sticky for fixed cells', () => {
    expect(fixedCellStyle({ fixed: 'left', left: 0 }, { header: true })).toEqual({
      position: 'sticky',
      zIndex: '4',
      top: '0',
      left: '0px',
    })
    expect(fixedCellStyle({ fixed: 'right', right: 12 })).toEqual({
      position: 'sticky',
      zIndex: '2',
      right: '12px',
    })
  })

  it('selects single row in radio mode', () => {
    expect(selectRowKeys([], 'a', 'radio')).toEqual(['a'])
    expect(selectRowKeys(['a'], 'b', 'radio')).toEqual(['b'])
  })

  it('toggles multi-column sort state', () => {
    expect(toggleMultiSortState([], 'name')).toEqual([{ key: 'name', order: 'asc' }])
    expect(toggleMultiSortState([{ key: 'name', order: 'asc' }], 'count')).toEqual([
      { key: 'name', order: 'asc' },
      { key: 'count', order: 'asc' },
    ])
    expect(toggleMultiSortState([{ key: 'name', order: 'desc' }], 'name')).toEqual([])
  })

  it('sorts rows by multiple columns', () => {
    const mixed = [
      { id: '1', name: 'A', status: 'running', count: 10 },
      { id: '2', name: 'A', status: 'stopped', count: 5 },
      { id: '3', name: 'B', status: 'running', count: 8 },
    ]
    const sorted = sortTableRowsMulti(mixed, columns, [
      { key: 'name', order: 'asc' },
      { key: 'count', order: 'desc' },
    ])
    expect(sorted.map((row) => row.id)).toEqual(['1', '2', '3'])
  })

  it('reorders columns and rows', () => {
    expect(reorderColumnKeys(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(resolveOrderedColumns(columns, ['count', 'name']).map((column) => column.key)).toEqual([
      'count',
      'name',
      'status',
    ])
    expect(resolveColumnOrder(columns, ['status', 'name'])).toEqual(['status', 'name', 'count'])
    expect(reorderTableRows(['a', 'b', 'c'], 2, 0, 'before')).toEqual(['c', 'a', 'b'])
  })

  it('builds entries with multi sort', () => {
    const entries = buildTableEntries(rows, columns, {
      multiSort: true,
      sorts: [
        { key: 'status', order: 'asc' },
        { key: 'count', order: 'desc' },
      ],
    })
    const dataRows = entries.filter((entry) => entry.type === 'row')
    expect(dataRows[0].type === 'row' && dataRows[0].row.name).toBe('Gamma')
  })
})
