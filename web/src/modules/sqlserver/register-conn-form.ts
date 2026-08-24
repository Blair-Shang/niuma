import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { sqlserverConnectionFormAdapter } from '@/modules/sqlserver/connection-form-adapter'
import SqlServerConnectionFields from '@/modules/sqlserver/components/SqlServerConnectionFields.vue'
import SqlServerSslFields from '@/modules/sqlserver/components/SqlServerSslFields.vue'
import SqlServerAdvancedFields from '@/modules/sqlserver/components/SqlServerAdvancedFields.vue'

let registered = false

/**
 * 仅注册 SQL Server 连接表单（对话框路径）。
 * 字段组件与本模块同 chunk：ensureConnKindForm 完成后同步可用。
 */
export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('sqlserver', sqlserverConnectionFormAdapter)
  registerConnectionKind('sqlserver', {
    options: SqlServerConnectionFields,
    ssl: SqlServerSslFields,
    advanced: SqlServerAdvancedFields,
    supportsTunnel: true,
  })
}
