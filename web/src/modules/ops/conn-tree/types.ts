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
  /**
   * 查询执行模式（Kingbase 等）：
   * - paged：默认，逐条 query.exec + 游标续取
   * - batch：同连接 query.execBatch（临时表 / SET 跨语句可见）
   * 其它协议可忽略。
   */
  queryExecMode?: 'paged' | 'batch'
  /** 表设计 / 对象脚本：create 打开新建；alter 打开编辑。 */
  designMode?: 'create' | 'alter'
  /** 对象脚本种类（各协议扩展；达梦含 package/trigger/synonym/sequence；SQLite 含 index） */
  objectKind?:
    | 'view'
    | 'procedure'
    | 'function'
    | 'materializedView'
    | 'materialized_view'
    | 'dictionary'
    | 'package'
    | 'trigger'
    | 'synonym'
    | 'sequence'
    | 'index'
}

