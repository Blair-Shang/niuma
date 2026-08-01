import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { oracleConnectionFormAdapter } from '@/modules/oracle/connection-form-adapter'
import OracleConnectionFields from '@/modules/oracle/components/OracleConnectionFields.vue'
import OracleSslFields from '@/modules/oracle/components/OracleSslFields.vue'
import OracleAdvancedFields from '@/modules/oracle/components/OracleAdvancedFields.vue'

let registered = false

export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('oracle', oracleConnectionFormAdapter)
  registerConnectionKind('oracle', {
    options: OracleConnectionFields,
    ssl: OracleSslFields,
    advanced: OracleAdvancedFields,
    supportsTunnel: true,
  })
}
