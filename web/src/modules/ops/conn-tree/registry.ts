import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourceDescriptor, ConnResourcePath } from '@/modules/ops/conn-tree/types'

/** 各连接类型向运维树贡献懒加载子节点的 Provider。 */
export interface ConnTreeChildProvider {
  canExpand(conn: ConnItem): boolean
  loadChildren(conn: ConnItem, parentPath?: ConnResourcePath): Promise<ConnResourceDescriptor[]>
  activate?(conn: ConnItem, path: ConnResourcePath): void
}

const _registry: Record<string, ConnTreeChildProvider> = {}

export function registerConnTreeProvider(kind: string, provider: ConnTreeChildProvider): void {
  _registry[kind] = provider
}

export function getConnTreeProvider(kind: string): ConnTreeChildProvider | undefined {
  return _registry[kind]
}
