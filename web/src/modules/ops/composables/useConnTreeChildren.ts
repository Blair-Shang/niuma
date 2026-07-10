import type { RsTreeNode } from '@niuma/ui'
import { ref } from 'vue'
import type { ConnResourceDescriptor } from '@/modules/ops/conn-tree/types'
import { connMetadataCache } from '@/modules/ops/conn-tree/metadata-cache'
import { getConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { parseConnTreeKey, resourceTreeKey } from '@/modules/ops/conn-tree/keys'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnLeafNode, ConnResourceNode, ConnTreeNode } from '@/modules/ops/composables/useConnTree'

function descriptorToNode(conn: ConnItem, descriptor: ConnResourceDescriptor): ConnResourceNode {
  const searchText = `${descriptor.label} ${descriptor.badge ?? ''}`.trim().toLowerCase()
  return {
    key: resourceTreeKey(conn.profileId, descriptor.path),
    label: descriptor.label,
    isLeaf: !descriptor.collapsible,
    children: descriptor.collapsible ? [] : undefined,
    _type: 'resource',
    _conn: conn,
    _path: descriptor.path,
    _searchText: searchText,
    _badge: descriptor.badge,
    _icon: descriptor.icon,
  }
}

function applyChildCache(nodes: readonly ConnTreeNode[], cache: ReadonlyMap<string, ConnResourceNode[]>): ConnTreeNode[] {
  return nodes.map((node) => {
    const key = node.key
    if (!key) {
      return node
    }
    const cached = cache.get(key)
    if (cached) {
      return {
        ...node,
        isLeaf: false,
        children: cached,
      }
    }
    const children = node.children as ConnTreeNode[] | undefined
    if (children?.length) {
      return {
        ...node,
        children: applyChildCache(children, cache),
      }
    }
    return node
  })
}

/**
 * 懒加载连接树下资源子节点，并将结果合并进展示树。
 */
export function useConnTreeChildren() {
  const childCache = ref(new Map<string, ConnResourceNode[]>())

  function displayNodes(base: readonly ConnTreeNode[]): ConnTreeNode[] {
    return applyChildCache(base, childCache.value)
  }

  function cacheKey(conn: ConnItem, parentPath?: ConnResourceDescriptor['path']): string {
    const tail = parentPath?.segments.map((s) => `${s.kind}:${s.name}`).join('/') ?? 'root'
    return `${conn.kind}:children:${conn.profileId}:${tail}`
  }

  async function loadChildrenForKey(key: string, node: RsTreeNode): Promise<void> {
    const parsed = parseConnTreeKey(key)
    if (parsed.type === 'conn') {
      const conn = (node as ConnLeafNode)._conn
      const provider = getConnTreeProvider(conn.kind)
      if (!provider?.canExpand(conn)) {
        return
      }
      const descriptors = await connMetadataCache.fetch(cacheKey(conn), () => provider.loadChildren(conn))
      childCache.value = new Map(childCache.value).set(key, descriptors.map((d) => descriptorToNode(conn, d)))
      return
    }
    if (parsed.type === 'res') {
      const resource = node as ConnResourceNode
      const provider = getConnTreeProvider(resource._conn.kind)
      if (!provider) {
        return
      }
      const descriptors = await connMetadataCache.fetch(
        cacheKey(resource._conn, resource._path),
        () => provider.loadChildren(resource._conn, resource._path),
      )
      childCache.value = new Map(childCache.value).set(key, descriptors.map((d) => descriptorToNode(resource._conn, d)))
    }
  }

  async function loadData(node: RsTreeNode, key: string): Promise<void> {
    if (childCache.value.has(key)) {
      return
    }
    await loadChildrenForKey(key, node)
  }

  function isLoaded(key: string): boolean {
    return childCache.value.has(key)
  }

  function invalidate(profileId?: string): void {
    childCache.value = new Map()
    if (profileId) {
      connMetadataCache.invalidate(`:${profileId}:`)
    } else {
      connMetadataCache.invalidate()
    }
  }

  return {
    displayNodes,
    loadData,
    isLoaded,
    invalidate,
  }
}
