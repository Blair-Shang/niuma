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
  /** 打开 Session 时默认激活的 Tab 名（协议特定，如 'query' / 'schema'）。 */
  initialTab?: string
  /** 可选：预填 SQL（Vastbase 新建对象模板等）。 */
  initialSql?: string
  /** Vastbase：带 initialSql 时是否自动执行（生成 SELECT/COUNT）。 */
  autoRunInitialSql?: boolean
  /** Vastbase 表设计：create 打开可视化新建表。 */
  designMode?: 'create' | 'alter'
}

