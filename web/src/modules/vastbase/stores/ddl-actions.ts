import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { VastDdlAction } from '@/api/types/vastbase'
import {
  dismissOtherDdlDialogs,
  registerDdlDialogClear,
} from '@/modules/ops/conn-tree/ddl-dialog-exclusive'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'

export type VastDdlDialogKind =
  | 'danger'
  | 'rename'
  | 'create_database'
  | 'create_schema'
  | 'alter_owner'
  | 'grant'

/** GRANT/REVOKE 目标对象类型（例程区分 FUNCTION / PROCEDURE）。 */
export type VastGrantTarget = 'table' | 'view' | 'schema' | 'function' | 'procedure'

export interface VastDatabaseCreateOptions {
  owner: string
  encoding: string
  template: string
  lcCollate: string
  lcCtype: string
}

export interface VastPendingDdlAction {
  /** 发起 DDL 时的连接快照，供执行成功后刷新连接树（避免再 list 查 profile）。 */
  conn: ConnItem
  /** DDL 成功后优先刷新该树节点（如库下列 schema 列表）。 */
  refreshPath?: ConnResourcePath
  /**
   * 刷新 refreshPath 时是否级联清掉子孙缓存。
   * 默认 true；重命名/仅刷新名单时用 false，避免把已展开的兄弟分支折叠掉。
   */
  refreshDeep?: boolean
  /** 额外作废的路径（如 rename/drop 前的旧对象子树）。 */
  prunePaths?: ConnResourcePath[]
  /** grant 对话框不走 ddl.exec，可用占位 action。 */
  action: VastDdlAction
  profileId: string
  database?: string
  schema?: string
  name: string
  /** 例程参数签名；grant 时亦复用为例程 identity args */
  args?: string
  oid?: number
  title: string
  description: string
  kind?: VastDdlDialogKind
  /** rename 时的建议新名 */
  newName?: string
  /** create_database 表单默认值 */
  createOptions?: VastDatabaseCreateOptions
  /** GRANT/REVOKE 目标对象类型 */
  grantTarget?: VastGrantTarget
}

/**
 * Vastbase 树 DDL 确认队列（由 VastDdlActionHost 按 kind 分发到各对话框组件）。
 * 模块内状态，勿放入全局 `stores/`。
 */
export const useVastDdlActionStore = defineStore('vastbase-ddl-actions', () => {
  const pending = ref<VastPendingDdlAction | null>(null)
  const busy = ref(false)

  function request(action: VastPendingDdlAction): void {
    dismissOtherDdlDialogs('vastbase-ddl-actions')
    pending.value = {
      kind: 'danger',
      ...action,
    }
  }

  function clear(): void {
    pending.value = null
    busy.value = false
  }

  registerDdlDialogClear('vastbase-ddl-actions', clear)

  return { pending, busy, request, clear }
})
