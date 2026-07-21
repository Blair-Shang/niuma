import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { redisConnectionFormAdapter } from '@/modules/redis/connection-form-adapter'
import RedisConnectionFields from '@/modules/redis/components/RedisConnectionFields.vue'

let registered = false

/**
 * 仅注册 Redis 连接表单（对话框路径）。
 * 字段组件与本模块同 chunk：ensureConnKindForm 完成后同步可用，避免对话框先矮后高跳动。
 */
export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('redis', redisConnectionFormAdapter)
  registerConnectionKind('redis', {
    options: RedisConnectionFields,
    credentialHint: 'modules.redis.form.passwordHint',
    passwordOptional: true,
    supportsTunnel: true,
  })
}
