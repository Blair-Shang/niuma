import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { mysqlConnectionFormAdapter } from '@/modules/mysql/connection-form-adapter'
import MysqlConnectionFields from '@/modules/mysql/components/MysqlConnectionFields.vue'
import MysqlSslFields from '@/modules/mysql/components/MysqlSslFields.vue'
import MysqlAdvancedFields from '@/modules/mysql/components/MysqlAdvancedFields.vue'

let registered = false

/**
 * 仅注册 MySQL 连接表单（对话框路径）。
 * 字段组件与本模块同 chunk：ensureConnKindForm 完成后同步可用，避免对话框先矮后高跳动。
 */
export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('mysql', mysqlConnectionFormAdapter)
  registerConnectionKind('mysql', {
    options: MysqlConnectionFields,
    ssl: MysqlSslFields,
    advanced: MysqlAdvancedFields,
    supportsTunnel: true,
  })
}
