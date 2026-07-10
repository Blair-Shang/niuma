import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import RsTree from '../components/RsTree.vue'
import {
  collectHalfCheckedKeys,
  flattenTreeNodeIds,
  getTreeChildren,
  getTreeKey,
  getTreeLabel,
  resolveTreeFieldNames,
  resolveTreeFocusKey,
  splitTreeLabelHighlight,
} from '../components/tree-utils'

const nodes = [
  { key: 'root', label: '根节点', children: [{ key: 'child', label: '子节点' }] },
  { id: 'alt', title: '备用字段' },
]

const checkNodes = [
  {
    key: 'parent',
    label: '父节点',
    children: [
      { key: 'child-a', label: '子 A' },
      { key: 'child-b', label: '子 B' },
    ],
  },
]

describe('RsTree', () => {
  it('renders nodes when defaultExpandAll is true', () => {
    const wrapper = mount(RsTree, {
      props: { nodes, defaultExpandAll: true },
    })
    expect(wrapper.text()).toContain('根节点')
    expect(wrapper.text()).toContain('子节点')
    expect(wrapper.text()).toContain('备用字段')
  })

  it('hides children until expanded', async () => {
    const wrapper = mount(RsTree, {
      props: { nodes: [nodes[0]] },
    })
    expect(wrapper.text()).not.toContain('子节点')
    await wrapper.find('.rs-tree__toggle').trigger('click')
    expect(wrapper.text()).toContain('子节点')
  })

  it('selects a single node via v-model', async () => {
    const wrapper = mount(RsTree, {
      props: {
        nodes: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
        modelValue: '',
        'onUpdate:modelValue': (value: string | string[]) => wrapper.setProps({ modelValue: value }),
      },
    })
    await wrapper.findAll('.rs-tree__label')[1].trigger('click')
    expect(wrapper.props('modelValue')).toBe('b')
    const selected = wrapper.find('.rs-tree__row--selected')
    expect(selected.exists()).toBe(true)
    expect(selected.text()).toContain('B')
  })

  it('highlights multiple selected rows in multiple mode', async () => {
    const wrapper = mount(RsTree, {
      props: {
        nodes: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }],
        multiple: true,
        modelValue: ['a', 'c'],
      },
    })
    expect(wrapper.findAll('.rs-tree__row--selected')).toHaveLength(2)
  })

  it('supports fieldNames mapping', () => {
    const apiNodes = [
      {
        id: '1',
        name: '部门',
        subList: [{ id: '1-1', name: '研发' }],
      },
    ]
    const wrapper = mount(RsTree, {
      props: {
        nodes: apiNodes,
        fieldNames: { key: 'id', label: 'name', children: 'subList' },
        defaultExpandAll: true,
      },
    })
    expect(wrapper.text()).toContain('部门')
    expect(wrapper.text()).toContain('研发')
  })

  it('syncs halfCheckedKeys when partially checked', async () => {
    const updates: string[][] = []
    mount(RsTree, {
      props: {
        nodes: checkNodes,
        checkable: true,
        defaultExpandAll: true,
        checkedKeys: ['child-a'],
        halfCheckedKeys: [],
        'onUpdate:halfCheckedKeys': (value: string[] | undefined) => {
          if (value !== undefined) updates.push(value)
        },
      },
    })
    await flushPromises()
    expect(updates.at(-1)).toEqual(expect.arrayContaining(['parent']))
  })

  it('checks on node click when checkOnClickNode is true', async () => {
    const wrapper = mount(RsTree, {
      props: {
        nodes: [{ key: 'a', label: 'A' }],
        checkable: true,
        checkOnClickNode: true,
        selectable: false,
        checkedKeys: [] as string[],
        'onUpdate:checkedKeys': (value: string[] | undefined) => {
          if (value !== undefined) void wrapper.setProps({ checkedKeys: value })
        },
      },
    })
    await wrapper.find('.rs-tree__label').trigger('click')
    expect(wrapper.props('checkedKeys')).toEqual(['a'])
  })

  it('filters nodes with filter prop and highlights matches', () => {
    const wrapper = mount(RsTree, {
      props: {
        nodes,
        filter: '子节点',
        autoExpandParent: true,
      },
    })
    expect(wrapper.find('.rs-tree__highlight').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('备用字段')
  })

  it('does not render keyword highlight when highlight is false', () => {
    const wrapper = mount(RsTree, {
      props: {
        nodes,
        filter: '子节点',
        highlight: false,
        autoExpandParent: true,
      },
    })
    expect(wrapper.find('.rs-tree__highlight').exists()).toBe(false)
    expect(wrapper.text()).toContain('子节点')
  })

  it('shows empty state when filter has no matches', () => {
    const wrapper = mount(RsTree, {
      props: { nodes, filter: '不存在的内容' },
    })
    expect(wrapper.find('.rs-tree__empty').exists()).toBe(true)
  })

  it('loads children lazily on expand', async () => {
    const loadData = vi.fn(async (node: { key?: string }) => {
      if (node.key === 'lazy-root') {
        ;(node as { children?: unknown[] }).children = [{ key: 'lazy-child', label: '异步子节点' }]
      }
    })
    const lazyNodes = [{ key: 'lazy-root', label: '异步根', isLeaf: false }]
    const wrapper = mount(RsTree, {
      props: {
        nodes: lazyNodes,
        lazy: true,
        loadData,
      },
    })
    await wrapper.find('.rs-tree__toggle').trigger('click')
    await vi.waitFor(() => expect(loadData).toHaveBeenCalled())
    await wrapper.setProps({ nodes: [{ key: 'lazy-root', label: '异步根', children: [{ key: 'lazy-child', label: '异步子节点' }] }] })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('异步子节点')
  })

  it('supports keyboard navigation', async () => {
    const wrapper = mount(RsTree, {
      props: {
        nodes: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
      },
      attachTo: document.body,
    })
    await flushPromises()
    const treeEl = wrapper.get('.rs-tree').element as HTMLElement
    treeEl.focus()
    treeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.rs-tree__row--focused').text()).toContain('B')
    wrapper.unmount()
  })

  it('exposes focusNode', async () => {
    const wrapper = mount(RsTree, {
      props: {
        nodes: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
      },
    })
    const vm = wrapper.vm as { focusNode: (key: string) => void }
    vm.focusNode('b')
    await flushPromises()
    expect(wrapper.find('.rs-tree__row--focused').text()).toContain('B')
  })

  it('collapses siblings in accordion mode', async () => {
    const wrapper = mount(RsTree, {
      props: {
        nodes: [
          {
            key: 'root',
            label: '根',
            children: [
              { key: 'a', label: 'A', children: [{ key: 'a-1', label: 'A1' }] },
              { key: 'b', label: 'B', children: [{ key: 'b-1', label: 'B1' }] },
            ],
          },
        ],
        accordion: true,
        expandedKeys: ['root', 'a'],
        'onUpdate:expandedKeys': (value: string[] | undefined) => {
          if (value !== undefined) void wrapper.setProps({ expandedKeys: value })
        },
      },
    })
    const toggles = wrapper.findAll('.rs-tree__toggle')
    await toggles[2].trigger('click')
    expect(wrapper.props('expandedKeys')).toEqual(expect.arrayContaining(['root', 'b']))
    expect(wrapper.props('expandedKeys')).not.toContain('a')
  })

  it('emits node-drop when draggable', async () => {
    const onDrop = vi.fn()
    const wrapper = mount(RsTree, {
      props: {
        nodes: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
        draggable: true,
        onNodeDrop: onDrop,
      },
      attachTo: document.body,
    })
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
    const items = wrapper.findAll('.rs-tree__row')
    await items[0].trigger('dragstart', { dataTransfer })
    await items[1].trigger('drop', { dataTransfer, clientY: 20 })
    expect(onDrop).toHaveBeenCalledWith('a', 'b', expect.any(String))
    wrapper.unmount()
  })

  it('hides drag handle when dragTrigger is row', () => {
    const wrapper = mount(RsTree, {
      props: {
        nodes: [{ key: 'a', label: 'A' }],
        draggable: true,
        dragTrigger: 'row',
      },
    })
    expect(wrapper.find('.rs-tree__drag-handle').exists()).toBe(false)
    expect(wrapper.classes()).toContain('rs-tree--drag-row')
  })

  it('auto virtualizes large flat trees', () => {
    const largeNodes = Array.from({ length: 150 }, (_, index) => ({
      key: String(index),
      label: `Node ${index}`,
    }))
    const wrapper = mount(RsTree, {
      props: { nodes: largeNodes, height: 200 },
    })
    expect(wrapper.classes()).toContain('rs-tree--virtual')
    expect(wrapper.findAll('.rs-tree__item').length).toBeLessThan(largeNodes.length)
  })

  it('expands node on label click when expandOnClickNode is true', async () => {
    const wrapper = mount(RsTree, {
      props: {
        nodes: [nodes[0]],
        expandOnClickNode: true,
        selectable: false,
        expandedKeys: [] as string[],
        'onUpdate:expandedKeys': (value: string[] | undefined) => {
          if (value !== undefined) void wrapper.setProps({ expandedKeys: value })
        },
      },
    })
    await wrapper.find('.rs-tree__label').trigger('click')
    expect(wrapper.props('expandedKeys')).toEqual(['root'])
  })

  it('renders showLine and blockNode classes', () => {
    const wrapper = mount(RsTree, {
      props: { nodes, showLine: true, blockNode: true, defaultExpandAll: true },
    })
    expect(wrapper.classes()).toContain('rs-tree--line')
    expect(wrapper.classes()).toContain('rs-tree--block')
    expect(wrapper.find('.rs-tree__line-guide').exists()).toBe(true)
  })

  it('applies focused row class to the focused node', async () => {
    const wrapper = mount(RsTree, {
      props: {
        nodes: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
      },
    })
    const vm = wrapper.vm as { focusNode: (key: string) => void }
    vm.focusNode('b')
    await flushPromises()
    expect(wrapper.find('.rs-tree__row--focused').text()).toContain('B')
  })

  it('emits node-dblclick on a row that was not focused before the gesture', async () => {
    const onNodeDblclick = vi.fn()
    const wrapper = mount(RsTree, {
      props: {
        nodes: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
        blockNode: true,
        selectable: false,
        onNodeDblclick,
      },
    })
    const rows = wrapper.findAll('.rs-tree__row')
    await rows[0].trigger('click')
    await rows[1].trigger('dblclick')
    expect(onNodeDblclick).toHaveBeenCalledTimes(1)
    expect(onNodeDblclick).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'b', label: 'B' }),
      'b',
    )
  })
})

describe('tree-utils basics', () => {
  it('getTreeKey prefers key then id then label', () => {
    expect(getTreeKey({ key: 'a' })).toBe('a')
    expect(getTreeKey({ id: 'b' })).toBe('b')
    expect(getTreeKey({ label: 'c' })).toBe('c')
  })

  it('supports custom fieldNames', () => {
    const fields = resolveTreeFieldNames({ key: 'id', label: 'name', children: 'subList' })
    expect(getTreeKey({ id: 'x' }, fields)).toBe('x')
    expect(getTreeLabel({ name: '标题' }, fields)).toBe('标题')
    expect(getTreeChildren({ subList: [{ id: '1' }] }, fields)).toHaveLength(1)
  })

  it('splitTreeLabelHighlight marks matched segment', () => {
    const parts = splitTreeLabelHighlight('Hello World', 'wor')
    expect(parts.some((part) => part.highlight && part.text === 'Wor')).toBe(true)
  })

  it('collectHalfCheckedKeys returns parent for partial selection', () => {
    const index = new Map([
      ['parent', { node: {}, parentKey: null, childrenKeys: ['child-a', 'child-b'] }],
      ['child-a', { node: {}, parentKey: 'parent', childrenKeys: [] }],
      ['child-b', { node: {}, parentKey: 'parent', childrenKeys: [] }],
    ])
    expect(collectHalfCheckedKeys(index, new Set(['child-a']), false)).toEqual(['parent'])
  })

  it('resolveTreeFocusKey moves across flat nodes', () => {
    const flat = [
      { key: 'a', node: {}, depth: 0, hasChildren: false, isLast: false, parentKey: null },
      { key: 'b', node: {}, depth: 0, hasChildren: false, isLast: true, parentKey: null },
    ]
    const index = new Map([
      ['a', { node: {}, parentKey: null, childrenKeys: [] }],
      ['b', { node: {}, parentKey: null, childrenKeys: [] }],
    ])
    expect(resolveTreeFocusKey(flat, 'a', 'next', index)).toBe('b')
  })

  it('flattenTreeNodeIds walks the full tree', () => {
    expect(flattenTreeNodeIds(nodes)).toEqual(['root', 'child', 'alt'])
  })

  it('onlyCheckLeaf hides parent checkbox and checks leaves only', async () => {
    const halfUpdates: string[][] = []
    const wrapper = mount(RsTree, {
      props: {
        nodes: checkNodes,
        checkable: true,
        onlyCheckLeaf: true,
        defaultExpandAll: true,
        checkedKeys: [] as string[],
        'onUpdate:checkedKeys': (value: string[] | undefined) => {
          if (value !== undefined) void wrapper.setProps({ checkedKeys: value })
        },
        'onUpdate:halfCheckedKeys': (value: string[] | undefined) => {
          if (value !== undefined) halfUpdates.push(value)
        },
      },
    })
    expect(wrapper.findAll('.rs-tree__checkbox')).toHaveLength(2)
    expect(wrapper.find('.rs-tree__checkbox-spacer').exists()).toBe(true)
    await wrapper.findAll('.rs-tree__checkbox-input')[0].trigger('change')
    expect(wrapper.props('checkedKeys')).toEqual(['child-a'])
    await flushPromises()
    expect(halfUpdates.at(-1)).toEqual(['parent'])
  })
})
