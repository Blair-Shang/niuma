import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { registerConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { registerConnTreeTabSync } from '@/modules/ops/conn-tree/tab-sync'
import { redisConnectionNavStrategy } from '@/modules/redis/conn-nav-strategy'
import { redisConnTreeProvider } from '@/modules/redis/conn-tree-provider'
import { redisConnTreeTabSync } from '@/modules/redis/conn-tree-tab-sync'
import { registerForm } from '@/modules/redis/register-conn-form'

let registered = false

/** Redis 完整自注册。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('redis', redisConnectionNavStrategy)
  registerConnTreeProvider('redis', redisConnTreeProvider)
  registerConnTreeTabSync('redis', redisConnTreeTabSync)
}
