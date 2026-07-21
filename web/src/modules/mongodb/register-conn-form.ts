import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { mongodbConnectionFormAdapter } from '@/modules/mongodb/connection-form-adapter'
import MongoConnectionFields from '@/modules/mongodb/components/MongoConnectionFields.vue'

let registered = false

/**
 * 仅注册 MongoDB 连接表单（对话框路径）。
 * 字段组件与本模块同 chunk：ensureConnKindForm 完成后同步可用，避免对话框先矮后高跳动。
 */
export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('mongodb', mongodbConnectionFormAdapter)
  registerConnectionKind('mongodb', {
    options: MongoConnectionFields,
    supportsTunnel: true,
    passwordOptional: true,
  })
}
