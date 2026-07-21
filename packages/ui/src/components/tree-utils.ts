import type { RsComponentSize } from '../theme/types'

export interface RsTreeNode {
  key?: string
  id?: string
  label?: string
  title?: string
  children?: RsTreeNode[]
  disabled?: boolean
  isLeaf?: boolean
  icon?: string
  disableCheckbox?: boolean
  loading?: boolean
  [key: string]: unknown
}

export interface RsTreeFieldNames {
  key?: string
  label?: string
  children?: string
  disabled?: string
  isLeaf?: string
  icon?: string
  disableCheckbox?: string
  loading?: string
}

export interface RsTreeFlatNode {
  key: string
  node: RsTreeNode
  depth: number
  hasChildren: boolean
  isLast: boolean
  parentKey: string | null
  /**
   * showLine 用：下标对应祖先深度 `0..depth-1`。
   * `true` 表示该祖先不是同级最后一项，竖线需贯穿当前行；`false` 则留空缺口。
   */
  levelLines: boolean[]
}

export interface RsTreeNodeIndex {
  node: RsTreeNode
  parentKey: string | null
  childrenKeys: string[]
}

export type RsTreeCheckState = 'checked' | 'indeterminate' | 'unchecked'
export type RsTreeFocusMove = 'next' | 'prev' | 'parent' | 'first' | 'last'
export type RsTreeDropPosition = 'before' | 'inside' | 'after'
/** handle=显示拖拽手柄；row=整行拖拽且不显示手柄 */
export type RsTreeDragTrigger = 'handle' | 'row'
export type RsTreeSize = RsComponentSize

export const DEFAULT_TREE_FIELD_NAMES: Required<RsTreeFieldNames> = {
  key: 'key',
  label: 'label',
  children: 'children',
  disabled: 'disabled',
  isLeaf: 'isLeaf',
  icon: 'icon',
  disableCheckbox: 'disableCheckbox',
  loading: 'loading',
}

export const TREE_ROW_HEIGHT = { sm: 28, md: 32, lg: 40 } as const
export const TREE_INDENT_BY_SIZE = { sm: 16, md: 20, lg: 24 } as const

export function resolveTreeFieldNames(fieldNames?: RsTreeFieldNames): Required<RsTreeFieldNames> {
  return { ...DEFAULT_TREE_FIELD_NAMES, ...fieldNames }
}

export function resolveTreeRowHeight(size: RsTreeSize = 'md', custom?: number): number {
  if (custom !== undefined) return custom
  return TREE_ROW_HEIGHT[size]
}

export function resolveTreeIndent(size: RsTreeSize = 'md'): number {
  return TREE_INDENT_BY_SIZE[size]
}

function readNodeField(node: RsTreeNode, field: string): unknown {
  return node[field]
}

export function getTreeKey(node: RsTreeNode, fields = DEFAULT_TREE_FIELD_NAMES): string {
  const mapped = readNodeField(node, fields.key)
  if (mapped !== undefined && mapped !== null && mapped !== '') return String(mapped)
  if (node.key !== undefined && node.key !== '') return String(node.key)
  if (node.id !== undefined && node.id !== '') return String(node.id)
  const label = readNodeField(node, fields.label) ?? node.label ?? node.title
  return String(label ?? '')
}

export function getTreeLabel(node: RsTreeNode, fields = DEFAULT_TREE_FIELD_NAMES): string {
  const mapped = readNodeField(node, fields.label)
  if (mapped !== undefined && mapped !== null && mapped !== '') return String(mapped)
  if (node.label !== undefined && node.label !== '') return String(node.label)
  if (node.title !== undefined && node.title !== '') return String(node.title)
  return getTreeKey(node, fields)
}

export function getTreeChildren(node: RsTreeNode, fields = DEFAULT_TREE_FIELD_NAMES): RsTreeNode[] {
  const mapped = readNodeField(node, fields.children)
  if (Array.isArray(mapped)) return mapped as RsTreeNode[]
  return node.children ?? []
}

export function getTreeIsLeaf(node: RsTreeNode, fields = DEFAULT_TREE_FIELD_NAMES): boolean {
  return Boolean(readNodeField(node, fields.isLeaf) ?? node.isLeaf)
}

export function isTreeNodeDisabled(node: RsTreeNode, fields = DEFAULT_TREE_FIELD_NAMES): boolean {
  return Boolean(readNodeField(node, fields.disabled) ?? node.disabled)
}

export function isTreeCheckboxDisabled(
  node: RsTreeNode,
  fields = DEFAULT_TREE_FIELD_NAMES,
  options: { onlyCheckLeaf?: boolean; lazy?: boolean } = {},
): boolean {
  if (isTreeNodeDisabled(node, fields)) return true
  if (options.onlyCheckLeaf && hasTreeChildren(node, fields, options.lazy ?? false)) return true
  return Boolean(readNodeField(node, fields.disableCheckbox) ?? node.disableCheckbox)
}

export function shouldShowTreeCheckbox(
  node: RsTreeNode,
  fields = DEFAULT_TREE_FIELD_NAMES,
  options: { onlyCheckLeaf?: boolean; lazy?: boolean } = {},
): boolean {
  if (!options.onlyCheckLeaf) return true
  return !hasTreeChildren(node, fields, options.lazy ?? false)
}

export function isTreeNodeLoading(
  node: RsTreeNode,
  key: string,
  loadingKeys: ReadonlySet<string>,
  fields = DEFAULT_TREE_FIELD_NAMES,
): boolean {
  return loadingKeys.has(key) || Boolean(readNodeField(node, fields.loading) ?? node.loading)
}

export function hasTreeChildren(
  node: RsTreeNode,
  fields = DEFAULT_TREE_FIELD_NAMES,
  lazy = false,
): boolean {
  if (getTreeIsLeaf(node, fields)) return false
  if (getTreeChildren(node, fields).length > 0) return true
  return lazy
}

export function flattenTreeNodeIds(
  nodes: readonly RsTreeNode[],
  fields = DEFAULT_TREE_FIELD_NAMES,
): string[] {
  return nodes.flatMap((node) => [
    getTreeKey(node, fields),
    ...flattenTreeNodeIds(getTreeChildren(node, fields), fields),
  ])
}

export function collectExpandableKeys(
  nodes: readonly RsTreeNode[],
  fields = DEFAULT_TREE_FIELD_NAMES,
  lazy = false,
): string[] {
  const keys: string[] = []
  function walk(items: readonly RsTreeNode[]): void {
    for (const node of items) {
      const key = getTreeKey(node, fields)
      if (hasTreeChildren(node, fields, lazy)) {
        keys.push(key)
        walk(getTreeChildren(node, fields))
      }
    }
  }
  walk(nodes)
  return keys
}

export function buildTreeNodeIndex(
  nodes: readonly RsTreeNode[],
  fields = DEFAULT_TREE_FIELD_NAMES,
  lazy = false,
): Map<string, RsTreeNodeIndex> {
  const map = new Map<string, RsTreeNodeIndex>()
  function walk(items: readonly RsTreeNode[], parentKey: string | null): void {
    for (const node of items) {
      const key = getTreeKey(node, fields)
      const childrenKeys = hasTreeChildren(node, fields, lazy)
        ? getTreeChildren(node, fields).map((child) => getTreeKey(child, fields))
        : []
      map.set(key, { node, parentKey, childrenKeys })
      if (getTreeChildren(node, fields).length > 0) walk(getTreeChildren(node, fields), key)
    }
  }
  walk(nodes, null)
  return map
}

export function collectDescendantKeys(
  key: string,
  index: ReadonlyMap<string, RsTreeNodeIndex>,
): string[] {
  const entry = index.get(key)
  if (!entry) return []
  const result: string[] = []
  for (const childKey of entry.childrenKeys) {
    result.push(childKey, ...collectDescendantKeys(childKey, index))
  }
  return result
}

export function collectHalfCheckedKeys(
  index: ReadonlyMap<string, RsTreeNodeIndex>,
  checkedKeys: ReadonlySet<string>,
  checkStrictly: boolean,
  onlyCheckLeaf = false,
): string[] {
  if (checkStrictly && !onlyCheckLeaf) return []
  const half: string[] = []
  for (const key of index.keys()) {
    if (resolveTreeCheckState(key, checkedKeys, index, checkStrictly, onlyCheckLeaf) === 'indeterminate') {
      half.push(key)
    }
  }
  return half
}

export function flattenVisibleTreeNodes(
  nodes: readonly RsTreeNode[],
  expandedKeys: ReadonlySet<string>,
  fields = DEFAULT_TREE_FIELD_NAMES,
  lazy = false,
  depth = 0,
  parentKey: string | null = null,
  /** 路径上各祖先是否为同级最后一项（长度 = depth） */
  ancestorIsLast: readonly boolean[] = [],
): RsTreeFlatNode[] {
  const result: RsTreeFlatNode[] = []
  nodes.forEach((node, index) => {
    const key = getTreeKey(node, fields)
    const hasChildren = hasTreeChildren(node, fields, lazy)
    const isLast = index === nodes.length - 1
    // 祖先非末项 → 画贯穿竖线；末项 → 该列断开，避免「幽灵」延伸
    const levelLines = ancestorIsLast.map((last) => !last)
    result.push({ key, node, depth, hasChildren, isLast, parentKey, levelLines })
    if (hasChildren && expandedKeys.has(key)) {
      result.push(
        ...flattenVisibleTreeNodes(
          getTreeChildren(node, fields),
          expandedKeys,
          fields,
          lazy,
          depth + 1,
          key,
          [...ancestorIsLast, isLast],
        ),
      )
    }
  })
  return result
}

export function defaultTreeFilterNode(
  node: RsTreeNode,
  keyword: string,
  fields = DEFAULT_TREE_FIELD_NAMES,
): boolean {
  return getTreeLabel(node, fields).toLowerCase().includes(keyword.trim().toLowerCase())
}

export function filterTreeNodes(
  nodes: readonly RsTreeNode[],
  keyword: string,
  options: {
    fieldNames?: RsTreeFieldNames
    filterNode?: (node: RsTreeNode, keyword: string) => boolean
  } = {},
): RsTreeNode[] {
  const fields = resolveTreeFieldNames(options.fieldNames)
  const query = keyword.trim()
  if (!query) return [...nodes]

  const match = options.filterNode ?? ((node, value) => defaultTreeFilterNode(node, value, fields))

  function filterNode(node: RsTreeNode): RsTreeNode | null {
    const children = getTreeChildren(node, fields)
    const filteredChildren = children
      .map(filterNode)
      .filter((item): item is RsTreeNode => item !== null)

    if (match(node, query)) return { ...node, children }
    if (filteredChildren.length > 0) return { ...node, children: filteredChildren }
    return null
  }

  return nodes
    .map(filterNode)
    .filter((item): item is RsTreeNode => item !== null)
}

export function splitTreeLabelHighlight(
  label: string,
  keyword: string,
): Array<{ text: string; highlight: boolean }> {
  const query = keyword.trim()
  if (!query) return [{ text: label, highlight: false }]

  const lowerLabel = label.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerLabel.indexOf(lowerQuery)
  if (index < 0) return [{ text: label, highlight: false }]

  const parts: Array<{ text: string; highlight: boolean }> = []
  if (index > 0) parts.push({ text: label.slice(0, index), highlight: false })
  parts.push({ text: label.slice(index, index + query.length), highlight: true })
  if (index + query.length < label.length) {
    parts.push({ text: label.slice(index + query.length), highlight: false })
  }
  return parts
}

export function resolveTreeCheckState(
  key: string,
  checkedKeys: ReadonlySet<string>,
  index: ReadonlyMap<string, RsTreeNodeIndex>,
  checkStrictly: boolean,
  onlyCheckLeaf = false,
): RsTreeCheckState {
  if (checkStrictly && !onlyCheckLeaf) return checkedKeys.has(key) ? 'checked' : 'unchecked'

  const entry = index.get(key)
  if (!entry || entry.childrenKeys.length === 0) {
    return checkedKeys.has(key) ? 'checked' : 'unchecked'
  }

  const childStates = entry.childrenKeys.map((childKey) =>
    resolveTreeCheckState(childKey, checkedKeys, index, checkStrictly, onlyCheckLeaf),
  )

  if (childStates.every((state) => state === 'checked')) return 'checked'
  if (childStates.some((state) => state === 'checked' || state === 'indeterminate')) return 'indeterminate'
  return 'unchecked'
}

export function toggleTreeCheck(
  key: string,
  checkedKeys: ReadonlySet<string>,
  index: ReadonlyMap<string, RsTreeNodeIndex>,
  checkStrictly: boolean,
  onlyCheckLeaf = false,
): string[] {
  const next = new Set(checkedKeys)
  const current = resolveTreeCheckState(key, next, index, checkStrictly, onlyCheckLeaf)
  const shouldCheck = current !== 'checked'

  if (checkStrictly && !onlyCheckLeaf) {
    if (shouldCheck) next.add(key)
    else next.delete(key)
    return [...next]
  }

  if (onlyCheckLeaf) {
    const entry = index.get(key)
    if (!entry || entry.childrenKeys.length > 0) return [...checkedKeys]
    if (shouldCheck) next.add(key)
    else next.delete(key)
    return [...next]
  }

  for (const id of [key, ...collectDescendantKeys(key, index)]) {
    if (shouldCheck) next.add(id)
    else next.delete(id)
  }

  let parentKey = index.get(key)?.parentKey ?? null
  while (parentKey) {
    const parent = index.get(parentKey)
    if (!parent) break
    const allChecked = parent.childrenKeys.every(
      (childKey) => resolveTreeCheckState(childKey, next, index, false, onlyCheckLeaf) === 'checked',
    )
    if (allChecked) next.add(parentKey)
    else next.delete(parentKey)
    parentKey = parent.parentKey
  }

  return [...next]
}

export function resolveAccordionExpandedKeys(
  key: string,
  expandedKeys: readonly string[],
  index: ReadonlyMap<string, RsTreeNodeIndex>,
  rootKeys: readonly string[],
): string[] {
  const parentKey = index.get(key)?.parentKey ?? null
  const siblings = parentKey ? (index.get(parentKey)?.childrenKeys ?? []) : [...rootKeys]
  const next = new Set(expandedKeys)
  for (const sibling of siblings) {
    if (sibling !== key) next.delete(sibling)
  }
  next.add(key)
  return [...next]
}

export function resolveTreeFocusKey(
  flatNodes: readonly RsTreeFlatNode[],
  currentKey: string | null,
  move: RsTreeFocusMove,
  index: ReadonlyMap<string, RsTreeNodeIndex>,
): string | null {
  const keys = flatNodes.map((item) => item.key)
  if (keys.length === 0) return null
  if (!currentKey) return keys[0] ?? null

  const currentIndex = keys.indexOf(currentKey)
  if (currentIndex < 0) return keys[0] ?? null

  switch (move) {
    case 'next':
      return keys[Math.min(currentIndex + 1, keys.length - 1)] ?? null
    case 'prev':
      return keys[Math.max(currentIndex - 1, 0)] ?? null
    case 'first':
      return keys[0] ?? null
    case 'last':
      return keys[keys.length - 1] ?? null
    case 'parent':
      return index.get(currentKey)?.parentKey ?? currentKey
    default:
      return currentKey
  }
}

export function resolveTreeVirtualEnabled(options: {
  virtual?: boolean
  flatCount: number
  virtualThreshold?: number
}): boolean {
  if (options.virtual) return true
  return options.flatCount > (options.virtualThreshold ?? 100)
}

export function sliceVirtualTreeNodes(
  nodes: readonly RsTreeFlatNode[],
  scrollTop: number,
  viewportHeight: number,
  itemHeight: number,
  overscan = 4,
): {
  nodes: RsTreeFlatNode[]
  paddingTop: number
  paddingBottom: number
} {
  if (nodes.length === 0) return { nodes: [], paddingTop: 0, paddingBottom: 0 }

  const totalHeight = nodes.length * itemHeight
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + overscan * 2
  const end = Math.min(nodes.length, start + visibleCount)

  return {
    nodes: nodes.slice(start, end),
    paddingTop: start * itemHeight,
    paddingBottom: Math.max(0, totalHeight - end * itemHeight),
  }
}
