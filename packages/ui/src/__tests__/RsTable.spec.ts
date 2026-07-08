import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import RsTable from '../components/RsTable.vue'

describe('RsTable', () => {
  const columns = [
    { key: 'name', title: '名称', sortable: true, width: 120 },
    { key: 'count', title: '数量', align: 'right' as const, sortable: true, width: 80 },
  ]

  const data = [
    { id: '1', name: 'B', count: 20, status: 'running' },
    { id: '2', name: 'A', count: 10, status: 'stopped' },
    { id: '3', name: 'C', count: 5, status: 'running' },
  ]

  it('renders column headers and cell values', () => {
    const wrapper = mount(RsTable, {
      props: { columns, data },
    })
    expect(wrapper.text()).toContain('名称')
    expect(wrapper.text()).toContain('数量')
    expect(wrapper.text()).toContain('B')
    expect(wrapper.text()).toContain('20')
  })

  it('sorts rows ascending then descending on header click', async () => {
    const wrapper = mount(RsTable, {
      props: { columns, data },
    })
    const nameHeader = wrapper.findAll('th')[0]
    await nameHeader.trigger('click')
    expect(wrapper.findAll('.rs-table__row td')[0].text()).toBe('A')
    await nameHeader.trigger('click')
    expect(wrapper.findAll('.rs-table__row td')[0].text()).toBe('C')
  })

  it('clears sort on third header click', async () => {
    const wrapper = mount(RsTable, {
      props: { columns, data },
    })
    const nameHeader = wrapper.findAll('th')[0]
    await nameHeader.trigger('click')
    await nameHeader.trigger('click')
    await nameHeader.trigger('click')
    expect(wrapper.find('.rs-table__sort--active').exists()).toBe(false)
    expect(wrapper.findAll('.rs-table__row td')[0].text()).toBe('B')
  })

  it('supports controlled sort via v-model:sort', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        sort: { key: 'count', order: 'asc' },
        'onUpdate:sort': (value: { key: string; order: 'asc' | 'desc' } | null) => wrapper.setProps({ sort: value }),
      },
    })
    expect(wrapper.findAll('.rs-table__row td')[1].text()).toBe('5')
    await wrapper.findAll('th')[1].trigger('click')
    expect(wrapper.emitted('update:sort')?.[0]?.[0]).toEqual({ key: 'count', order: 'desc' })
  })

  it('filters rows with filterText', () => {
    const wrapper = mount(RsTable, {
      props: { columns, data, filterText: 'a' },
    })
    expect(wrapper.findAll('.rs-table__row')).toHaveLength(1)
    expect(wrapper.text()).toContain('A')
  })

  it('renders group headers when groupBy is set', () => {
    const wrapper = mount(RsTable, {
      props: {
        columns: [...columns, { key: 'status', title: '状态' }],
        data,
        groupBy: 'status',
        groupLabel: (key: string) => `分组 ${key}`,
      },
    })
    expect(wrapper.findAll('.rs-table__group-row')).toHaveLength(2)
    expect(wrapper.text()).toContain('分组 running')
    expect(wrapper.text()).toContain('分组 stopped')
  })

  it('virtual mode renders a subset of rows', () => {
    const largeData = Array.from({ length: 200 }, (_, index) => ({
      id: String(index),
      name: `Row ${index}`,
      count: index,
      status: 'running',
    }))
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data: largeData,
        virtual: true,
        height: 200,
        rowHeight: 40,
      },
    })
    expect(wrapper.findAll('.rs-table__row').length).toBeLessThan(largeData.length)
    expect(wrapper.find('.rs-table__virtual-pad').exists()).toBe(true)
  })

  it('emits loadMore when scrolled near bottom in infinite mode', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        infinite: true,
        hasMore: true,
        height: 120,
      },
    })
    const container = wrapper.find('.rs-table').element as HTMLElement
    Object.defineProperty(container, 'scrollHeight', { value: 400, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 120, configurable: true })
    container.scrollTop = 300
    await wrapper.find('.rs-table').trigger('scroll')
    expect(wrapper.emitted('loadMore')).toHaveLength(1)
  })

  it('auto enables virtual scroll in infinite mode for large datasets', () => {
    const largeData = Array.from({ length: 500 }, (_, index) => ({
      id: String(index),
      name: `Row ${index}`,
      count: index,
      status: 'running',
    }))
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data: largeData,
        infinite: true,
        hasMore: false,
        height: 200,
        rowHeight: 40,
      },
    })
    expect(wrapper.find('.rs-table').classes()).toContain('rs-table--virtual')
    expect(wrapper.findAll('.rs-table__row').length).toBeLessThan(30)
    expect(wrapper.find('.rs-table__virtual-pad').exists()).toBe(true)
  })

  it('shows loading placeholder', () => {
    const wrapper = mount(RsTable, {
      props: { columns, data, loading: true },
    })
    expect(wrapper.find('.rs-table__empty').text()).toBe('加载中…')
    expect(wrapper.findAll('.rs-table__row')).toHaveLength(0)
  })

  it('shows default empty state', () => {
    const wrapper = mount(RsTable, {
      props: { columns, data: [] },
    })
    expect(wrapper.find('.rs-table__empty').text()).toBe('暂无数据')
  })

  it('renders custom empty slot', () => {
    const wrapper = mount(RsTable, {
      props: { columns, data: [] },
      slots: { empty: '暂无数据' },
    })
    expect(wrapper.find('.rs-table__empty').text()).toBe('暂无数据')
  })

  it('applies compact and bordered modifiers', () => {
    const wrapper = mount(RsTable, {
      props: { columns, data, compact: true, bordered: false },
    })
    const root = wrapper.find('.rs-table')
    expect(root.classes()).toContain('rs-table--compact')
    expect(root.classes()).not.toContain('rs-table--bordered')
  })

  it('uses column render function', () => {
    const wrapper = mount(RsTable, {
      props: {
        columns: [{ key: 'name', title: '名称', render: (row: { name: string }) => `·${row.name}·` }],
        data: [{ id: '1', name: '任务' }],
      },
    })
    expect(wrapper.find('td').text()).toBe('·任务·')
  })

  it('renders cell slot by column key', () => {
    const wrapper = mount(RsTable, {
      props: {
        columns: [{ key: 'name', title: '名称' }],
        data: [{ id: '1', name: '任务' }],
      },
      slots: { name: '<span class="custom-cell">自定义</span>' },
    })
    expect(wrapper.find('.custom-cell').text()).toBe('自定义')
  })

  it('emits rowClick with row and index', async () => {
    const wrapper = mount(RsTable, {
      props: { columns, data },
    })
    await wrapper.find('.rs-table__row').trigger('click')
    expect(wrapper.emitted('rowClick')?.[0]).toEqual([data[0], 0])
  })

  it('updates column width when resize handle is dragged', async () => {
    const wrapper = mount(RsTable, {
      props: { columns, data, resizable: true },
    })
    const handle = wrapper.find('.rs-table__resize-handle')
    await handle.trigger('mousedown', { clientX: 100 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(wrapper.emitted('columnResize')?.[0]).toEqual(['name', 160])
  })

  it('supports row selection with select all', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        selectable: true,
        rowKey: 'id',
        selectedRowKeys: [] as string[],
        'onUpdate:selectedRowKeys': (keys: string[]) => wrapper.setProps({ selectedRowKeys: keys }),
      },
    })
    const rowChecks = wrapper.findAll('.rs-table__row .rs-table__checkbox-input')
    await rowChecks[0]!.setValue(true)
    expect(wrapper.props('selectedRowKeys')).toEqual(['1'])
    await wrapper.find('.rs-table__head .rs-table__checkbox-input').setValue(true)
    expect(wrapper.props('selectedRowKeys')).toEqual(['1', '2', '3'])
  })

  it('renders index column and striped rows', () => {
    const wrapper = mount(RsTable, {
      props: { columns, data, showIndex: true, striped: true, selectable: true, rowKey: 'id' },
    })
    expect(wrapper.find('.rs-table__td--index').text()).toBe('1')
    expect(wrapper.find('.rs-table__row--striped').exists()).toBe(true)
    const stripedRow = wrapper.find('.rs-table__row--striped')
    const selectionCell = stripedRow.find('.rs-table__td--selection')
    expect(selectionCell.exists()).toBe(true)
    expect(getComputedStyle(selectionCell.element).backgroundColor).toBe(
      getComputedStyle(stripedRow.element).backgroundColor,
    )
  })

  it('shows sort icons on sortable columns and highlights active sort', async () => {
    const wrapper = mount(RsTable, {
      props: { columns, data },
    })
    const sortIcons = wrapper.findAll('.rs-table__sort')
    expect(sortIcons.length).toBe(2)
    expect(wrapper.find('.rs-table__sort--active').exists()).toBe(false)
    await wrapper.findAll('th')[0].trigger('click')
    expect(wrapper.find('.rs-table__sort--active').exists()).toBe(true)
    expect(wrapper.find('.rs-table__sort--active .rs-icon').exists()).toBe(true)
  })

  it('hides header when showHeader is false', () => {
    const wrapper = mount(RsTable, {
      props: { columns, data, showHeader: false },
    })
    expect(wrapper.find('thead').exists()).toBe(false)
  })

  it('applies ellipsis wrapper and overflow styles', () => {
    const wrapper = mount(RsTable, {
      props: {
        columns: [{ key: 'name', title: '名称', ellipsis: true, width: 80 }],
        data: [{ id: '1', name: '这是一段非常非常长的文本用于测试省略号效果' }],
      },
    })
    const cell = wrapper.find('.rs-table__td--ellipsis')
    const text = wrapper.find('.rs-table__ellipsis-text')
    expect(cell.exists()).toBe(true)
    expect(text.exists()).toBe(true)
    expect(text.text()).toContain('非常非常长')
    expect(cell.attributes('style')).toContain('width: 80px')
  })

  it('expands rows with expand slot', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        expandable: true,
        expandedRowKeys: [] as string[],
        rowKey: 'id',
        'onUpdate:expandedRowKeys': (keys: string[]) => wrapper.setProps({ expandedRowKeys: keys }),
      },
      slots: { expand: '<div class="expand-slot">detail</div>' },
    })
    await wrapper.find('.rs-table__expand-btn').trigger('click')
    expect(wrapper.props('expandedRowKeys')).toEqual(['1'])
    await wrapper.setProps({ expandedRowKeys: ['1'] })
    expect(wrapper.find('.expand-slot').exists()).toBe(true)
  })

  it('supports radio selection', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        selectable: true,
        selectionType: 'radio',
        rowKey: 'id',
        selectedRowKeys: [] as string[],
        'onUpdate:selectedRowKeys': (keys: string[]) => wrapper.setProps({ selectedRowKeys: keys }),
      },
    })
    const inputs = wrapper.findAll('.rs-table__row .rs-table__checkbox-input')
    await inputs[0]!.setValue(true)
    await inputs[1]!.setValue(true)
    expect(wrapper.props('selectedRowKeys')).toEqual(['2'])
  })

  it('does not sort locally when remoteSort is enabled', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        remoteSort: true,
        sort: null,
        'onUpdate:sort': (value: { key: string; order: 'asc' | 'desc' } | null) => wrapper.setProps({ sort: value }),
      },
    })
    await wrapper.findAll('th')[0].trigger('click')
    expect(wrapper.emitted('update:sort')?.[0]?.[0]).toEqual({ key: 'name', order: 'asc' })
    expect(wrapper.findAll('.rs-table__row td')[0].text()).toBe('B')
  })

  it('renders fixed column classes and horizontal scroll', () => {
    const wrapper = mount(RsTable, {
      props: {
        columns: [
          { key: 'name', title: '名称', fixed: 'left' as const, width: 120 },
          { key: 'count', title: '数量', fixed: 'right' as const, width: 80 },
        ],
        data,
        scrollX: 600,
        rowKey: 'id',
      },
    })
    expect(wrapper.find('.rs-table').classes()).toContain('rs-table--scroll-x')
    expect(wrapper.find('.rs-table__cell--fixed').exists()).toBe(true)
  })

  it('renders summary slot in footer', () => {
    const wrapper = mount(RsTable, {
      props: { columns, data },
      slots: { summary: '<span class="summary-total">合计</span>' },
    })
    expect(wrapper.find('.rs-table__summary .summary-total').text()).toBe('合计')
  })

  it('uses custom column sorter', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns: [{ key: 'name', title: '名称', sortable: true, sorter: (a: { name: string }, b: { name: string }) => b.name.localeCompare(a.name) }],
        data,
      },
    })
    await wrapper.find('th').trigger('click')
    expect(wrapper.findAll('.rs-table__row td')[0].text()).toBe('C')
  })

  it('supports multi-column sort', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        multiSort: true,
        sorts: [],
        'onUpdate:sorts': (value: { key: string; order: 'asc' | 'desc' }[]) => wrapper.setProps({ sorts: value }),
      },
    })
    await wrapper.findAll('th')[0].trigger('click')
    await wrapper.findAll('th')[1].trigger('click')
    expect(wrapper.emitted('update:sorts')?.[1]?.[0]).toEqual([
      { key: 'name', order: 'asc' },
      { key: 'count', order: 'asc' },
    ])
  })

  it('emits rowDrop when rows are reordered', async () => {
    const wrapper = mount(RsTable, {
      props: { columns, data, rowDraggable: true, rowKey: 'id' },
    })
    const handle = wrapper.find('.rs-table__row-drag-handle')
    await handle.trigger('dragstart')
    await wrapper.findAll('.rs-table__row')[1].trigger('drop')
    const emitted = wrapper.emitted('rowDrop')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toEqual(expect.arrayContaining([expect.any(String)]))
  })

  it('reorders columns with columnDraggable', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        columnDraggable: true,
        columnOrder: ['name', 'count'],
        'onUpdate:columnOrder': (value: string[]) => wrapper.setProps({ columnOrder: value }),
      },
    })
    const handle = wrapper.find('.rs-table__column-drag-handle')
    await handle.trigger('dragstart')
    const headers = wrapper.findAll('th')
    await headers[headers.length - 1].trigger('drop')
    expect(wrapper.emitted('update:columnOrder')).toBeTruthy()
  })

  it('emits rowDrop with into position in into drop mode', async () => {
    const onRowDrop = vi.fn()
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data: [
          { id: 'dir', name: 'Folder', status: 'running', count: 0, updatedAt: '' },
          { id: 'file', name: 'File', status: 'running', count: 1, updatedAt: '' },
        ],
        rowDraggable: true,
        rowDragTrigger: 'row',
        rowDropMode: 'into',
        rowDraggableWhen: (row: { id: string }) => row.id !== 'dir',
        rowDropTargetWhen: (row: { id: string }) => row.id === 'dir',
        rowKey: 'id',
        onRowDrop,
      },
    })
    const fileCell = wrapper.findAll('.rs-table__td--row-draggable')[0]
    await fileCell.trigger('dragstart')
    await wrapper.findAll('.rs-table__row')[0].trigger('drop')
    expect(onRowDrop).toHaveBeenCalled()
    const [dragKeys, dropKey, position] = onRowDrop.mock.calls[0] as [string[], string, string]
    expect(dragKeys).toEqual(['file'])
    expect(dropKey).toBe('dir')
    expect(position).toBe('into')
  })
})
