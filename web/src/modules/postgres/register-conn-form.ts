import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { postgresConnectionFormAdapter } from '@/modules/postgres/connection-form-adapter'
import PostgresConnectionFields from '@/modules/postgres/components/PostgresConnectionFields.vue'
import PostgresSslFields from '@/modules/postgres/components/PostgresSslFields.vue'
import PostgresAdvancedFields from '@/modules/postgres/components/PostgresAdvancedFields.vue'

let registered = false

export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('postgres', postgresConnectionFormAdapter)
  registerConnectionKind('postgres', {
    options: PostgresConnectionFields,
    ssl: PostgresSslFields,
    advanced: PostgresAdvancedFields,
    supportsTunnel: true,
  })
}
