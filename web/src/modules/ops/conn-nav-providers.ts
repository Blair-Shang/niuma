/**
 * 内置连接导航策略注册入口。
 *
 * 在 `main.ts` → `app.mount()` 之前调用，与 `conn-tree-providers.ts`、
 * `connection-kinds.ts` 并列。
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 新增协议（MySQL）时在本文件追加一行：
 *
 *   import { mysqlConnectionNavStrategy } from '@/modules/mysql/conn-nav-strategy'
 *   registerConnectionNavStrategy('mysql', mysqlConnectionNavStrategy)
 *
 * 并实现 `modules/mysql/conn-nav-strategy.ts`（参考 mongodb 或 ssh）。
 * ──────────────────────────────────────────────────────────────────────────
 */
import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { ftpConnectionNavStrategy } from '@/modules/ftp/conn-nav-strategy'
import { mongodbConnectionNavStrategy } from '@/modules/mongodb/conn-nav-strategy'
import { redisConnectionNavStrategy } from '@/modules/redis/conn-nav-strategy'
import { sshConnectionNavStrategy } from '@/modules/ssh/conn-nav-strategy'

/** 注册内置协议的 L3 连接 → Tab 导航策略 */
export function registerBuiltinConnectionNavStrategies(): void {
  registerConnectionNavStrategy('ssh', sshConnectionNavStrategy)
  registerConnectionNavStrategy('ftp', ftpConnectionNavStrategy)
  registerConnectionNavStrategy('redis', redisConnectionNavStrategy)
  registerConnectionNavStrategy('mongodb', mongodbConnectionNavStrategy)
}
