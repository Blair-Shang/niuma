import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import RsTable from '../components/RsTable.vue'

vi.mock('../utils/rs-clipboard', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(true),
}))

import { copyTextToClipboard } from '../utils/rs-clipboard'

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
        sort: { key: 'count', order: 'asc' as const },
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
    expect(root.classes()).not.toContain('rs-table--rounded')
    expect(root.classes()).not.toContain('rs-table--bordered')
  })

  it('can enable outer rounded corners', () => {
    const wrapper = mount(RsTable, {
      props: { columns, data, rounded: true },
    })
    expect(wrapper.find('.rs-table').classes()).toContain('rs-table--rounded')
  })

  it('uses column render function', () => {
    const wrapper = mount(RsTable, {
      props: {
        columns: [{ key: 'name', title: '名称', render: (row) => `·${(row as { name: string }).name}·` }],
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
    const text = wrapper.find('.rs-table__cell-tip')
    expect(cell.exists()).toBe(true)
    expect(text.exists()).toBe(true)
    expect(text.text()).toContain('非常非常长')
    expect(text.attributes('data-rs-table-tip-mode')).toBe('overflow')
    expect(cell.attributes('style')).toContain('width: 80px')
  })

  it('shows shared cell tooltip on ellipsis overflow hover', async () => {
    vi.useFakeTimers()
    const wrapper = mount(RsTable, {
      attachTo: document.body,
      props: {
        columns: [{ key: 'name', title: '名称', ellipsis: true, width: 80 }],
        data: [{ id: '1', name: '这是一段非常非常长的文本用于测试省略号效果' }],
        cellTooltipDelay: 0,
      },
    })
    const cell = wrapper.find('.rs-table__ellipsis-text').element as HTMLElement
    Object.defineProperty(cell, 'scrollWidth', { value: 500, configurable: true })
    Object.defineProperty(cell, 'clientWidth', { value: 80, configurable: true })
    await wrapper.find('.rs-table__cell-tip').trigger('pointerover', { pointerType: 'mouse' })
    await vi.runAllTimersAsync()
    await wrapper.vm.$nextTick()
    const tip = document.body.querySelector('.rs-table__shared-tip')
    expect(tip).not.toBeNull()
    expect(tip?.textContent).toContain('非常非常长')
    wrapper.unmount()
    expect(document.body.querySelector('.rs-table__shared-tip')).toBeNull()
    vi.useRealTimers()
  })

  it('shows shared tooltip for column.tooltip', async () => {
    vi.useFakeTimers()
    const wrapper = mount(RsTable, {
      attachTo: document.body,
      props: {
        columns: [{ key: 'name', title: '名称', tooltip: () => '自定义说明' }],
        data: [{ id: '1', name: '短文本' }],
        cellTooltipDelay: 0,
      },
    })
    await wrapper.find('.rs-table__cell-tip').trigger('pointerover', { pointerType: 'mouse' })
    await vi.runAllTimersAsync()
    await wrapper.vm.$nextTick()
    const tip = document.body.querySelector('.rs-table__shared-tip')
    expect(tip?.textContent).toContain('自定义说明')
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('shows shared header tooltip for column.headerTip', async () => {
    vi.useFakeTimers()
    const wrapper = mount(RsTable, {
      attachTo: document.body,
      props: {
        columns: [
          {
            key: 'name',
            title: '名称',
            headerTip: '字段: name\n类型: varchar(64)',
          },
        ],
        data: [{ id: '1', name: 'Alice' }],
        cellTooltipDelay: 0,
      },
    })
    await wrapper.find('.rs-table__th-label--tip').trigger('pointerover', { pointerType: 'mouse' })
    await vi.runAllTimersAsync()
    await wrapper.vm.$nextTick()
    const tip = document.body.querySelector('.rs-table__shared-tip--header')
    expect(tip).not.toBeNull()
    expect(tip?.textContent).toContain('varchar(64)')
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('highlights row on click when highlightRow is enabled', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        rowKey: 'id',
        highlightRow: true,
      },
    })
    await wrapper.findAll('.rs-table__row')[1]?.trigger('click')
    expect(wrapper.emitted('highlightChange')?.[0]?.[0]).toBe('2')
    expect(wrapper.find('.rs-table__row--highlighted').exists()).toBe(true)
  })

  it('highlights row when clicking a data cell', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        rowKey: 'id',
        highlightRow: true,
      },
    })
    const row = wrapper.findAll('.rs-table__row')[1]
    await row.find('.rs-table__td--data').trigger('click')
    expect(wrapper.emitted('highlightChange')?.[0]?.[0]).toBe('2')
    expect(wrapper.find('.rs-table__row--highlighted').exists()).toBe(true)
  })

  it('shows highlight background on striped rows', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        rowKey: 'id',
        striped: true,
        highlightRow: true,
      },
    })
    const stripedRow = wrapper.find('.rs-table__row--striped')
    expect(stripedRow.exists()).toBe(true)
    await stripedRow.find('.rs-table__td--data').trigger('click')
    expect(stripedRow.classes()).toContain('rs-table__row--highlighted')
    expect(wrapper.emitted('highlightChange')?.[0]?.[0]).toBe('2')
  })

  it('highlights row when clicking edit gutter line number', async () => {
    const rows = [{ id: '1', name: 'Alpha', count: 1, status: 'running' as const }]
    const wrapper = mount(RsTable, {
      props: {
        columns: [{ key: 'name', title: '名称' }],
        data: rows,
        rowKey: 'id',
        editable: true,
        highlightRow: true,
      },
    })
    await wrapper.find('.rs-table__td--gutter').trigger('click')
    expect(wrapper.emitted('highlightChange')?.[0]?.[0]).toBe('1')
    expect(wrapper.find('.rs-table__row--highlighted').exists()).toBe(true)
  })

  it('supports inline cell editing commit', async () => {
    const rows = [{ id: '1', name: 'Alpha', count: 1, status: 'running' as const }]
    const wrapper = mount(RsTable, {
      props: {
        columns: [{ key: 'name', title: '名称', editable: true }],
        data: rows,
        rowKey: 'id',
        editable: true,
      },
    })
    expect(wrapper.find('.rs-table__td--gutter').exists()).toBe(true)
    await wrapper.find('.rs-table__cell-body--editable').trigger('dblclick')
    const input = wrapper.find('.rs-table-cell-editor input')
    expect(input.exists()).toBe(true)
    await input.setValue('Beta')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('cellEditCommit')?.[0]?.[3]).toBe('Beta')
    wrapper.unmount()
  })

  it('toggles boolean cells without mounting an editor', async () => {
    const rows = [{ id: '1', name: 'Alpha', active: false }]
    const wrapper = mount(RsTable, {
      props: {
        columns: [
          { key: 'name', title: '名称' },
          { key: 'active', title: '启用', editable: true, valueType: 'boolean' },
        ],
        data: rows,
        rowKey: 'id',
        editable: true,
      },
    })
    const check = wrapper.find('.rs-table__cell-check')
    expect(check.exists()).toBe(true)
    expect(wrapper.find('.rs-table-cell-editor').exists()).toBe(false)
    await check.trigger('click')
    expect(wrapper.emitted('cellEditCommit')?.[0]?.[3]).toBe(true)
    expect(wrapper.find('.rs-table-cell-editor').exists()).toBe(false)
    wrapper.unmount()
  })

  it('refreshes boolean cell after parent commits new row data (v-memo)', async () => {
    const rows = [{ id: '1', name: 'Alpha', active: false }]
    const wrapper = mount(RsTable, {
      props: {
        columns: [
          { key: 'name', title: '名称' },
          { key: 'active', title: '启用', editable: true, valueType: 'boolean' },
        ],
        data: rows,
        rowKey: 'id',
        editable: true,
      },
    })
    await wrapper.find('.rs-table__cell-check').trigger('click')
    const next = (wrapper.emitted('cellEditCommit')?.[0]?.[3] as boolean) ?? true
    await wrapper.setProps({ data: [{ id: '1', name: 'Alpha', active: next }] })
    await wrapper.vm.$nextTick()
    const input = wrapper.find('.rs-table__cell-check input')
    expect((input.element as HTMLInputElement).checked).toBe(next)
    wrapper.unmount()
  })

  it('blocks commit and shows invalid state when validator fails', async () => {
    const rows = [{ id: '1', name: 'Alpha', count: 1 }]
    const wrapper = mount(RsTable, {
      props: {
        columns: [
          {
            key: 'count',
            title: '数量',
            editable: true,
            validator: (value) => (Number(value) >= 0 ? null : '不能为负'),
            parser: (input) => Number(input),
          },
        ],
        data: rows,
        rowKey: 'id',
        editable: true,
      },
    })
    await wrapper.find('.rs-table__cell-body--editable').trigger('dblclick')
    const input = wrapper.find('.rs-table-cell-editor input')
    await input.setValue('-3')
    await wrapper.vm.$nextTick()
    await input.trigger('blur')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cellEditCommit')).toBeUndefined()
    expect(wrapper.emitted('cellEditInvalid')?.[0]?.[3]).toBe('不能为负')
    expect(wrapper.find('.rs-table__td--invalid').exists()).toBe(true)
    wrapper.unmount()
  })

  it('displays NULL placeholder for null cell values', () => {
    const wrapper = mount(RsTable, {
      props: {
        columns: [{ key: 'note', title: '备注', editable: true, nullable: true }],
        data: [{ id: '1', note: null }],
        rowKey: 'id',
        editable: true,
        allowNull: true,
      },
    })
    expect(wrapper.find('.rs-table__cell-body--null').text()).toContain('NULL')
    wrapper.unmount()
  })

  it('batches commit across selected rows for the same column', async () => {
    const rows = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
      { id: '3', name: 'C' },
    ]
    const wrapper = mount(RsTable, {
      props: {
        columns: [{ key: 'name', title: '名称', editable: true }],
        data: rows,
        rowKey: 'id',
        editable: true,
        selectable: true,
        editBatch: true,
        selectedRowKeys: ['1', '2'],
      },
    })
    await wrapper.find('.rs-table__cell-body--editable').trigger('dblclick')
    const input = wrapper.find('.rs-table-cell-editor input')
    await input.setValue('Z')
    await wrapper.vm.$nextTick()
    await input.trigger('blur')
    await wrapper.vm.$nextTick()
    const commits = wrapper.emitted('cellEditCommit') ?? []
    expect(commits.length).toBe(2)
    expect(wrapper.emitted('cellEditBatchCommit')?.[0]?.[1]).toHaveLength(2)
    wrapper.unmount()
  })

  it('supports async validator blocking commit', async () => {
    const rows = [{ id: '1', name: 'Alpha' }]
    const wrapper = mount(RsTable, {
      props: {
        columns: [
          {
            key: 'name',
            title: '名称',
            editable: true,
            validator: async (value) => {
              await Promise.resolve()
              return String(value).length < 2 ? '太短' : null
            },
          },
        ],
        data: rows,
        rowKey: 'id',
        editable: true,
      },
    })
    await wrapper.find('.rs-table__cell-body--editable').trigger('dblclick')
    const input = wrapper.find('.rs-table-cell-editor input')
    await input.setValue('x')
    await wrapper.vm.$nextTick()
    await input.trigger('blur')
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cellEditCommit')).toBeUndefined()
    expect(wrapper.emitted('cellEditInvalid')?.[0]?.[3]).toBe('太短')
    wrapper.unmount()
  })

  it('select editor is not clearable by default', async () => {
    const rows = [{ id: '1', kind: 'a' }]
    const wrapper = mount(RsTable, {
      props: {
        columns: [
          {
            key: 'kind',
            title: '类型',
            editable: true,
            valueType: 'select',
            editorOptions: {
              options: [
                { value: 'a', label: 'A' },
                { value: 'b', label: 'B' },
              ],
            },
          },
        ],
        data: rows,
        rowKey: 'id',
        editable: true,
        allowNull: true,
      },
    })
    await wrapper.find('.rs-table__cell-body--editable').trigger('click')
    expect(wrapper.find('.rs-table-cell-editor').exists()).toBe(true)
    expect(wrapper.find('.rs-select__clear').exists()).toBe(false)
    wrapper.unmount()
  })

  it('opens select editor on click and commits on change', async () => {
    const rows = [{ id: '1', name: 'Alpha', kind: 'a' }]
    const wrapper = mount(RsTable, {
      props: {
        columns: [
          {
            key: 'kind',
            title: '类型',
            editable: true,
            valueType: 'select',
            editorOptions: {
              options: [
                { value: 'a', label: 'A' },
                { value: 'b', label: 'B' },
              ],
            },
          },
        ],
        data: rows,
        rowKey: 'id',
        editable: true,
      },
    })
    await wrapper.find('.rs-table__cell-body--editable').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.rs-table-cell-editor--select').exists()).toBe(true)
    const select = wrapper.findComponent({ name: 'RsSelect' })
    expect(select.exists()).toBe(true)
    select.vm.$emit('update:modelValue', 'b')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cellEditCommit')?.[0]?.[3]).toBe('b')
    wrapper.unmount()
  })

  it('multiple select commits joined values when dropdown closes', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const rows = [{ id: '1', cols: 'a' }]
    const wrapper = mount(RsTable, {
      props: {
        columns: [
          {
            key: 'cols',
            title: '列',
            editable: true,
            valueType: 'select',
            editorOptions: {
              multiple: true,
              clearable: true,
              options: [
                { value: 'a', label: 'A' },
                { value: 'b', label: 'B' },
                { value: 'c', label: 'C' },
              ],
            },
          },
        ],
        data: rows,
        rowKey: 'id',
        editable: true,
      },
    })
    await wrapper.find('.rs-table__cell-body--editable').trigger('click')
    await wrapper.vm.$nextTick()
    const select = wrapper.findComponent({ name: 'RsSelect' })
    expect(select.exists()).toBe(true)
    select.vm.$emit('update:modelValue', ['a', 'b'])
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cellEditCommit')).toBeFalsy()
    select.vm.$emit('update:open', true)
    await wrapper.vm.$nextTick()
    select.vm.$emit('update:open', false)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cellEditCommit')?.[0]?.[3]).toBe('a, b')
    wrapper.unmount()
  })

  it('shows gutter commit while actively editing a changed cell', async () => {
    const rows = [{ id: '1', name: 'Alpha', count: 1, status: 'running' as const }]
    const wrapper = mount(RsTable, {
      props: {
        columns: [{ key: 'name', title: '名称', editable: true }],
        data: rows,
        rowKey: 'id',
        editable: true,
      },
    })
    await wrapper.find('.rs-table__cell-body--editable').trigger('dblclick')
    expect(wrapper.find('.rs-table-edit-gutter__line').exists()).toBe(true)
    const input = wrapper.find('.rs-table-cell-editor input')
    await input.setValue('Beta')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.rs-table-edit-gutter__commit').exists()).toBe(true)
    wrapper.unmount()
  })

  it('stages row edits and commits manually in rowCommit mode', async () => {
    const rows = [{ id: '1', name: 'Alpha', count: 1, status: 'running' as const }]
    const wrapper = mount(RsTable, {
      props: {
        columns: [{ key: 'name', title: '名称', editable: true }],
        data: rows,
        rowKey: 'id',
        editable: true,
        rowCommit: true,
      },
    })
    await wrapper.find('.rs-table__cell-body--editable').trigger('dblclick')
    expect(wrapper.find('.rs-table__th--gutter').exists()).toBe(true)
    expect(wrapper.find('.rs-table__td--gutter').exists()).toBe(true)
    const input = wrapper.find('.rs-table-cell-editor input')
    await input.setValue('Beta')
    await wrapper.vm.$nextTick()
    await input.trigger('blur')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cellEditCommit')).toBeUndefined()
    expect(wrapper.find('.rs-table-edit-gutter__commit').exists()).toBe(true)
    expect(wrapper.find('.rs-table-edit-gutter__commit-hint').text()).toBe('提交')
    await wrapper.find('.rs-table-edit-gutter__commit').trigger('click')
    const payload = wrapper.emitted('rowEditCommit')?.[0]
    expect(payload?.[2]).toEqual([{ colKey: 'name', value: 'Beta', previous: 'Alpha' }])
    wrapper.unmount()
  })

  it('does not show shared tooltip for non-overflow ellipsis cells', async () => {
    vi.useFakeTimers()
    const wrapper = mount(RsTable, {
      attachTo: document.body,
      props: {
        columns: [{ key: 'name', title: '名称', ellipsis: true, width: 240 }],
        data: [{ id: '1', name: '短文本' }],
        cellTooltipDelay: 0,
      },
    })
    await wrapper.find('.rs-table__cell-tip').trigger('pointerover', { pointerType: 'mouse' })
    await vi.runAllTimersAsync()
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('.rs-table__shared-tip')).toBeNull()
    wrapper.unmount()
    vi.useRealTimers()
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

  it('supports row selection without checkbox column', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        selectable: true,
        selectionType: 'row' as const,
        rowKey: 'id',
        selectedRowKeys: [] as string[],
        'onUpdate:selectedRowKeys': (keys: string[]) => wrapper.setProps({ selectedRowKeys: keys }),
      },
    })
    expect(wrapper.find('.rs-table__th--selection').exists()).toBe(false)
    const rows = wrapper.findAll('.rs-table__row')
    await rows[0]!.trigger('click')
    expect(wrapper.props('selectedRowKeys')).toEqual(['1'])
    rows[1]!.element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.props('selectedRowKeys')).toEqual(['1', '2'])
  })

  it('supports shift range row selection without checkbox', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        selectable: true,
        selectionType: 'row' as const,
        rowKey: 'id',
        selectedRowKeys: [] as string[],
        'onUpdate:selectedRowKeys': (keys: string[]) => wrapper.setProps({ selectedRowKeys: keys }),
      },
    })
    const rows = wrapper.findAll('.rs-table__row')
    await rows[0]!.trigger('click')
    expect(wrapper.props('selectedRowKeys')).toEqual(['1'])
    rows[2]!.element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.props('selectedRowKeys')).toEqual(['1', '2', '3'])
  })

  it('supports radio selection', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns,
        data,
        selectable: true,
        selectionType: 'radio' as const,
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
        columns: [{ key: 'name', title: '名称', sortable: true, sorter: (a, b) => (b as { name: string }).name.localeCompare((a as { name: string }).name) }],
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
        rowDraggableWhen: (row) => (row as { id: string }).id !== 'dir',
        rowDropTargetWhen: (row) => (row as { id: string }).id === 'dir',
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

  it('shows filter icon for filterable columns and filters rows', async () => {
    const filterColumns = [
      { key: 'name', title: '名称', filterable: true },
      { key: 'count', title: '数量' },
    ]
    const wrapper = mount(RsTable, {
      props: {
        columns: filterColumns,
        data,
        columnFilters: { name: 'A' },
        'onUpdate:columnFilters': (value: Record<string, string>) =>
          wrapper.setProps({ columnFilters: value }),
      },
    })
    expect(wrapper.find('.rs-table__filter').exists()).toBe(true)
    expect(wrapper.findAll('.rs-table__row')).toHaveLength(1)
    expect(wrapper.find('.rs-table__row td').text()).toBe('A')

    await wrapper.setProps({ columnFilters: {} })
    expect(wrapper.findAll('.rs-table__row')).toHaveLength(3)
  })

  it('highlights active column filter', async () => {
    const wrapper = mount(RsTable, {
      props: {
        columns: [{ key: 'name', title: '名称', filterable: true }],
        data,
        columnFilters: { name: 'B' },
      },
    })
    expect(wrapper.find('.rs-table__filter--active').exists()).toBe(true)
    expect(wrapper.findAll('.rs-table__row')).toHaveLength(1)
    await wrapper.setProps({ columnFilters: {} })
    expect(wrapper.find('.rs-table__filter--active').exists()).toBe(false)
  })

  it('shows default copy actions in context menu on data cell', async () => {
    const wrapper = mount(RsTable, {
      props: { columns, data, rowKey: 'id' },
      attachTo: document.body,
    })
    await wrapper.find('.rs-table__td--data').trigger('contextmenu')
    await wrapper.vm.$nextTick()
    const labels = [...document.body.querySelectorAll('.rs-context-menu__label')].map(
      (node) => node.textContent?.trim(),
    )
    expect(labels).toContain('复制单元格')
    expect(labels).toContain('复制行')
    wrapper.unmount()
  })

  it('copies cell and row text from built-in context menu', async () => {
    const copyMock = vi.mocked(copyTextToClipboard)
    copyMock.mockClear()
    const wrapper = mount(RsTable, {
      props: { columns, data, rowKey: 'id' },
      attachTo: document.body,
    })
    await wrapper.find('.rs-table__td--data').trigger('contextmenu')
    await wrapper.vm.$nextTick()
    const items = document.body.querySelectorAll('.rs-context-menu__item')
    const copyCell = [...items].find((item) => item.textContent?.includes('复制单元格'))
    expect(copyCell).toBeTruthy()
    ;(copyCell as HTMLElement).click()
    await wrapper.vm.$nextTick()
    expect(copyMock).toHaveBeenCalledWith('B')

    copyMock.mockClear()
    await wrapper.find('.rs-table__td--data').trigger('contextmenu')
    await wrapper.vm.$nextTick()
    const copyRow = [...document.body.querySelectorAll('.rs-context-menu__item')].find((item) =>
      item.textContent?.includes('复制行'),
    )
    ;(copyRow as HTMLElement).click()
    await wrapper.vm.$nextTick()
    expect(copyMock).toHaveBeenCalledWith('B\t20')
    wrapper.unmount()
  })

  it('can disable built-in context menu', async () => {
    const wrapper = mount(RsTable, {
      props: { columns, data, rowKey: 'id', contextMenu: false },
    })
    await wrapper.find('.rs-table__td--data').trigger('contextmenu')
    expect(document.body.querySelector('.rs-context-menu__content')).toBeNull()
    wrapper.unmount()
  })
})
