import { registerConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { mongoConnTreeProvider } from '@/modules/mongodb/conn-tree-provider'
import { redisConnTreeProvider } from '@/modules/redis/conn-tree-provider'

/** 注册内置连接树资源 Provider（在 app.mount 前调用）。 */
export function registerBuiltinConnTreeProviders(): void {
  registerConnTreeProvider('redis', redisConnTreeProvider)
  registerConnTreeProvider('mongodb', mongoConnTreeProvider)
}
