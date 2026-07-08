import { describe, expect, it } from 'vitest'
import {
  buildTreeNodeIndex,
  collectHalfCheckedKeys,
  filterTreeNodes,
  flattenVisibleTreeNodes,
  resolveAccordionExpandedKeys,
  resolveTreeCheckState,
  resolveTreeFieldNames,
  resolveTreeFocusKey,
  resolveTreeVirtualEnabled,
  shouldShowTreeCheckbox,
  sliceVirtualTreeNodes,
  splitTreeLabelHighlight,
  toggleTreeCheck,
} from '../components/tree-utils'

const nodes = [
  {
    key: 'root',
    label: '根',
    children: [
      { key: 'child-a', label: '子节点 A' },
      { key: 'child-b', label: '子节点 B' },
    ],
  },
]

describe('tree-utils', () => {
  it('filters nodes by keyword and keeps ancestors', () => {
    const filtered = filterTreeNodes(nodes, 'b')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.children).toHaveLength(1)
    expect(filtered[0]?.children?.[0]?.key).toBe('child-b')
  })

  it('filters with custom filterNode', () => {
    const apiNodes = [{ id: '1', name: 'Alpha' }, { id: '2', name: 'Beta' }]
    const filtered = filterTreeNodes(apiNodes, 'bet', {
      fieldNames: { key: 'id', label: 'name' },
      filterNode: (node, keyword) => String(node.name).toLowerCase().includes(keyword.toLowerCase()),
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.id).toBe('2')
  })

  it('flattens visible nodes based on expanded keys', () => {
    const expanded = new Set(['root'])
    const flat = flattenVisibleTreeNodes(nodes, expanded)
    expect(flat.map((item) => item.key)).toEqual(['root', 'child-a', 'child-b'])
  })

  it('toggles parent-child checks', () => {
    const index = buildTreeNodeIndex(nodes)
    const next = toggleTreeCheck('root', new Set(), index, false)
    expect(next).toEqual(expect.arrayContaining(['root', 'child-a', 'child-b']))
    expect(resolveTreeCheckState('root', new Set(next), index, false)).toBe('checked')
  })

  it('collects half checked keys', () => {
    const index = buildTreeNodeIndex(nodes)
    const half = collectHalfCheckedKeys(index, new Set(['child-a']), false)
    expect(half).toEqual(['root'])
  })

  it('resolves accordion expanded keys', () => {
    const index = buildTreeNodeIndex(nodes)
    const next = resolveAccordionExpandedKeys('child-b', ['root', 'child-a'], index, ['root'])
    expect(next).toEqual(expect.arrayContaining(['root', 'child-b']))
    expect(next).not.toContain('child-a')
  })

  it('supports strict checking', () => {
    const index = buildTreeNodeIndex(nodes)
    const next = toggleTreeCheck('child-a', new Set(), index, true)
    expect(next).toEqual(['child-a'])
    expect(resolveTreeCheckState('root', new Set(next), index, true)).toBe('unchecked')
  })

  it('enables virtual scroll by threshold', () => {
    expect(resolveTreeVirtualEnabled({ flatCount: 50 })).toBe(false)
    expect(resolveTreeVirtualEnabled({ flatCount: 150 })).toBe(true)
    expect(resolveTreeVirtualEnabled({ virtual: true, flatCount: 10 })).toBe(true)
  })

  it('slices virtual tree nodes', () => {
    const flat = Array.from({ length: 200 }, (_, index) => ({
      key: String(index),
      node: { key: String(index), label: `N${index}` },
      depth: 0,
      hasChildren: false,
      isLast: index === 199,
      parentKey: null,
    }))
    const slice = sliceVirtualTreeNodes(flat, 320, 200, 32, 2)
    expect(slice.nodes.length).toBeLessThan(flat.length)
    expect(slice.paddingTop).toBeGreaterThan(0)
  })

  it('highlights label segments', () => {
    const parts = splitTreeLabelHighlight('RsTree 组件', 'tree')
    expect(parts.find((part) => part.highlight)?.text).toBe('Tree')
  })

  it('maps field names', () => {
    const fields = resolveTreeFieldNames({ key: 'id', label: 'title', children: 'items' })
    expect(fields.key).toBe('id')
    expect(fields.children).toBe('items')
  })

  it('moves focus within flat nodes', () => {
    const flat = flattenVisibleTreeNodes(nodes, new Set(['root']))
    const index = buildTreeNodeIndex(nodes)
    expect(resolveTreeFocusKey(flat, 'child-a', 'next', index)).toBe('child-b')
    expect(resolveTreeFocusKey(flat, 'child-b', 'parent', index)).toBe('root')
  })

  it('supports onlyCheckLeaf mode', () => {
    const index = buildTreeNodeIndex(nodes)
    const root = nodes[0]!
    expect(shouldShowTreeCheckbox(root)).toBe(true)
    expect(shouldShowTreeCheckbox(root, undefined, { onlyCheckLeaf: true })).toBe(false)
    const next = toggleTreeCheck('child-a', new Set(), index, false, true)
    expect(next).toEqual(['child-a'])
    expect(resolveTreeCheckState('root', new Set(next), index, false, true)).toBe('indeterminate')
    const both = toggleTreeCheck('child-b', new Set(next), index, false, true)
    expect(resolveTreeCheckState('root', new Set(both), index, false, true)).toBe('checked')
    expect(collectHalfCheckedKeys(index, new Set(next), false, true)).toEqual(['root'])
  })
})
