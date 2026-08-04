import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { sqlserverConnectionFormAdapter } from '@/modules/sqlserver/connection-form-adapter'
import SqlServerConnectionFields from '@/modules/sqlserver/components/SqlServerConnectionFields.vue'
import SqlServerAdvancedFields from '@/modules/sqlserver/components/SqlServerAdvancedFields.vue'

let registered = false

export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('sqlserver', sqlserverConnectionFormAdapter)
  registerConnectionKind('sqlserver', {
    options: SqlServerConnectionFields,
    advanced: SqlServerAdvancedFields,
    supportsTunnel: true,
  })
}
