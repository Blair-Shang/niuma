import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { damengConnectionFormAdapter } from '@/modules/dameng/connection-form-adapter'
import DamengConnectionFields from '@/modules/dameng/components/DamengConnectionFields.vue'
import DamengSslFields from '@/modules/dameng/components/DamengSslFields.vue'
import DamengAdvancedFields from '@/modules/dameng/components/DamengAdvancedFields.vue'

let registered = false

export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('dameng', damengConnectionFormAdapter)
  registerConnectionKind('dameng', {
    options: DamengConnectionFields,
    ssl: DamengSslFields,
    advanced: DamengAdvancedFields,
    supportsProxy: false,
    supportsTunnel: true,
  })
}
