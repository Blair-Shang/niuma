import type { RsTreeNode } from '@niuma/ui'
import type { ComputedRef, Ref } from 'vue'
import { nextTick } from 'vue'
import { findNodeByKey, findPathToKey, mergeExpandedKeys } from '@/modules/ops/conn-tree/focus-utils'
import type { ConnTreeNode } from '@/modules/ops/composables/useConnTree'
import type { useConnTreeChildren } from '@/modules/ops/composables/useConnTreeChildren'

type TreeChildrenApi = ReturnType<typeof useConnTreeChildren>

export type RsTreeExpose = {
  focusNode: (key: string) => void
}

/**
 * 将侧栏连接树聚焦到指定节点：展开祖先、必要时懒加载子节点，再调用 RsTree.focusNode。
 */
export function useConnTreeFocus(options: {
  treeRef: Ref<RsTreeExpose | null>
  nodes: ComputedRef<ConnTreeNode[]>
  expandedKeys: Ref<string[]>
  treeChildren: TreeChildrenApi
}) {
  async function applyTreeFocus(targetKey: string): Promise<void> {
    const path = findPathToKey(options.nodes.value, targetKey)
    if (!path) {
      return
    }

    const ancestorKeys = path.slice(0, -1)
    options.expandedKeys.value = mergeExpandedKeys(options.expandedKeys.value, ancestorKeys)

    const connKey = path.find((k) => k.startsWith('conn:'))
    if (connKey && targetKey.startsWith('res:') && !options.treeChildren.isLoaded(connKey)) {
      const connNode = findNodeByKey(options.nodes.value, connKey)
      if (connNode) {
        await options.treeChildren.loadData(connNode as RsTreeNode, connKey)
      }
    }

    await nextTick()
    options.treeRef.value?.focusNode(targetKey)
  }

  return { applyTreeFocus }
}
