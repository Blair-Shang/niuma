import type { ConnTreeNode } from '@/modules/ops/composables/useConnTree'

/** 在树中查找从根到 targetKey 的 key 路径（含目标）。 */
export function findPathToKey(nodes: readonly ConnTreeNode[], targetKey: string): string[] | null {
  for (const node of nodes) {
    const key = node.key
    if (!key) {
      continue
    }
    if (key === targetKey) {
      return [key]
    }
    const children = node.children as ConnTreeNode[] | undefined
    if (children?.length) {
      const childPath = findPathToKey(children, targetKey)
      if (childPath) {
        return [key, ...childPath]
      }
    }
  }
  return null
}

/** 按 key 查找节点（深度优先）。 */
export function findNodeByKey(nodes: readonly ConnTreeNode[], targetKey: string): ConnTreeNode | null {
  for (const node of nodes) {
    if (node.key === targetKey) {
      return node
    }
    const children = node.children as ConnTreeNode[] | undefined
    if (children?.length) {
      const found = findNodeByKey(children, targetKey)
      if (found) {
        return found
      }
    }
  }
  return null
}

/** 合并展开键（不删除已有展开状态）。 */
export function mergeExpandedKeys(current: readonly string[], extra: readonly string[]): string[] {
  if (extra.length === 0) {
    return [...current]
  }
  return [...new Set([...current, ...extra])]
}
