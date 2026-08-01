import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { kingbaseConnectionFormAdapter } from '@/modules/kingbase/connection-form-adapter'
import KingbaseConnectionFields from '@/modules/kingbase/components/KingbaseConnectionFields.vue'
import KingbaseSslFields from '@/modules/kingbase/components/KingbaseSslFields.vue'
import KingbaseAdvancedFields from '@/modules/kingbase/components/KingbaseAdvancedFields.vue'

let registered = false

export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('kingbase', kingbaseConnectionFormAdapter)
  registerConnectionKind('kingbase', {
    options: KingbaseConnectionFields,
    ssl: KingbaseSslFields,
    advanced: KingbaseAdvancedFields,
    supportsTunnel: true,
  })
}
