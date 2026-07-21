import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { vastbaseConnectionFormAdapter } from '@/modules/vastbase/connection-form-adapter'
import VastConnectionFields from '@/modules/vastbase/components/VastConnectionFields.vue'
import VastSslFields from '@/modules/vastbase/components/VastSslFields.vue'
import VastAdvancedFields from '@/modules/vastbase/components/VastAdvancedFields.vue'

let registered = false

/**
 * 仅注册 Vastbase 连接表单（对话框路径）。
 * 字段组件与本模块同 chunk：ensureConnKindForm 完成后同步可用，避免对话框先矮后高跳动。
 */
export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('vastbase', vastbaseConnectionFormAdapter)
  registerConnectionKind('vastbase', {
    options: VastConnectionFields,
    ssl: VastSslFields,
    advanced: VastAdvancedFields,
    supportsTunnel: true,
  })
}
