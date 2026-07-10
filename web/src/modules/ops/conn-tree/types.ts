import type { ConnItem } from '@/modules/ops/types'

/** 从连接根向下的分段资源路径（各协议自定义 kind）。 */
export interface ConnResourcePath {
  segments: Array<{ kind: string; name: string }>
}

/** Provider 返回的子节点描述（尚未挂上树 key）。 */
export interface ConnResourceDescriptor {
  path: ConnResourcePath
  label: string
  icon?: string
  badge?: string
  collapsible: boolean
}

/** 打开连接 Tab 时附带的资源上下文。 */
export interface ConnOpenContext {
  resourcePath?: ConnResourcePath
}
