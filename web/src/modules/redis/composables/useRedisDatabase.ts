import type { InjectionKey, Ref } from 'vue'
import { ref } from 'vue'
import { redisApi } from '@/api'
import type { RedisConnectionOptions, RedisTopology } from '@/api/types/redis'
import { DEFAULT_REDIS_OPTIONS } from '@/api/types/redis'

/** Redis 会话内当前逻辑库上下文（由 RedisSession provide，子面板 inject）。 */
export interface RedisDatabaseContext {
  currentDb: Ref<number>
  canSwitchDb: Ref<boolean>
  /** 通过 SELECT 切换逻辑库；成功返回 true。 */
  selectDatabase: (db: number) => Promise<boolean>
  /** 控制台执行 SELECT 成功后同步当前库（不再重复发命令）。 */
  applySelectFromCommand: (db: number) => void
  /** 重连后按连接配置恢复初始库。 */
  reset: (database: number, topology: RedisTopology) => void
}

export const redisDatabaseKey: InjectionKey<RedisDatabaseContext> = Symbol('redisDatabase')

/** 从连接配置解析初始逻辑库与是否允许切换（集群模式仅 db0）。 */
export function readRedisDatabaseFromOptions(
  options: Record<string, unknown> | undefined,
): { database: number; topology: RedisTopology } {
  const opts = options as RedisConnectionOptions | undefined
  return {
    database: opts?.database ?? DEFAULT_REDIS_OPTIONS.database,
    topology: opts?.topology ?? DEFAULT_REDIS_OPTIONS.topology,
  }
}

/** 解析命令行是否为 SELECT <index>。 */
export function parseSelectDatabase(args: string[]): number | null {
  if (args.length < 2 || args[0].toUpperCase() !== 'SELECT') {
    return null
  }
  const db = Number.parseInt(args[1], 10)
  if (Number.isNaN(db) || db < 0) {
    return null
  }
  return db
}

/** 创建会话级逻辑库状态（standalone/sentinel 可切换，cluster 固定 0）。 */
export function createRedisDatabaseState(
  sessionId: () => string | null,
  initialDatabase: number,
  topology: RedisTopology,
): RedisDatabaseContext {
  const currentDb = ref(initialDatabase)
  const canSwitchDb = ref(topology !== 'cluster')

  async function selectDatabase(db: number): Promise<boolean> {
    if (!canSwitchDb.value) {
      return false
    }
    const id = sessionId()
    if (!id) {
      return false
    }
    try {
      await redisApi.commandExec({ sessionId: id, args: ['SELECT', String(db)] })
      currentDb.value = db
      return true
    } catch {
      return false
    }
  }

  function applySelectFromCommand(db: number): void {
    if (canSwitchDb.value) {
      currentDb.value = db
    }
  }

  function reset(database: number, nextTopology: RedisTopology): void {
    currentDb.value = database
    canSwitchDb.value = nextTopology !== 'cluster'
  }

  return {
    currentDb,
    canSwitchDb,
    selectDatabase,
    applySelectFromCommand,
    reset,
  }
}
