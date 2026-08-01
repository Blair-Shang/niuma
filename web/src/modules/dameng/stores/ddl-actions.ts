import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'

export type DamengDdlDialogKind = 'danger' | 'rename' | 'create_schema'

export type DamengDdlAction =
  | 'drop_table'
  | 'drop_view'
  | 'drop_procedure'
  | 'drop_function'
  | 'drop_sequence'
  | 'drop_package'
  | 'drop_synonym'
  | 'drop_trigger'
  | 'drop_schema'
  | 'truncate_table'
  | 'rename_table'
  | 'rename_view'
  | 'rename_sequence'
  | 'create_schema'

export interface DamengCreateSchemaOptions {
  password: string
  /** 默认 true：GRANT RESOURCE, PUBLIC */
  grantResource?: boolean
}

export interface DamengPendingDdlAction {
  conn: ConnItem
  refreshPath?: ConnResourcePath
  refreshDeep?: boolean
  prunePaths?: ConnResourcePath[]
  action: DamengDdlAction
  profileId: string
  schema?: string
  name: string
  title: string
  description: string
  kind?: DamengDdlDialogKind
  newName?: string
  createOptions?: DamengCreateSchemaOptions
}

/**
 * 达梦树 DDL 确认队列（由 DamengDdlActionHost 按 kind 分发）。
 * 模块内状态，勿放入全局 `stores/`。
 */
export const useDamengDdlActionStore = defineStore('dameng-ddl-actions', () => {
  const pending = ref<DamengPendingDdlAction | null>(null)
  const busy = ref(false)

  function request(action: DamengPendingDdlAction): void {
    pending.value = {
      kind: 'danger',
      ...action,
    }
  }

  function clear(): void {
    pending.value = null
    busy.value = false
  }

  return { pending, busy, request, clear }
})
