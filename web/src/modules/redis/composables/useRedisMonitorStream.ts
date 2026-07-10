import { inject, onBeforeUnmount, ref } from 'vue'
import { redisApi } from '@/api'
import { subscribeBridgeEventByPrefix } from '@/api/event-bus'
import type { RedisMonitorEvent, RedisMonitorLineEvent } from '@/api/types/redis'
import { SESSION_RELEASE_CLEANUP_KEY } from '@/modules/connection/session-release'

export type RedisMonitorStreamState = 'idle' | 'starting' | 'ready' | 'closed' | 'lost'

/**
 * 实时 `MONITOR` 命令流：通过 `redis.monitor.stream.start` 打开，随后的每条命令经
 * `redis.monitor.line` Bridge 事件推送（见 `useSshTerminal` 的同款事件订阅模式）。
 *
 * `MONITOR` 会让服务器把每一条收到的命令都发给本连接，对生产环境有实打实的性能开销，
 * 因此调用方应当只在用户主动停留在「实时监控」标签页时才 `start`，离开时立即 `stop`。
 */
export function useRedisMonitorStream() {
  const monitorId = ref<string | null>(null)
  const state = ref<RedisMonitorStreamState>('idle')
  const message = ref('')

  let offEvent: (() => void) | null = null

  function ensureSubscribed(onLine: (event: RedisMonitorLineEvent) => void): void {
    if (offEvent) {
      return
    }
    offEvent = subscribeBridgeEventByPrefix('redis.monitor.', (detail) => {
      if (typeof detail !== 'object' || detail === null || !('type' in detail)) {
        return
      }
      const event = detail as RedisMonitorEvent
      if (!monitorId.value || event.monitorId !== monitorId.value) {
        return
      }
      if (event.type === 'redis.monitor.line') {
        onLine(event)
        return
      }
      state.value = event.state
      message.value = event.message
    })
  }

  async function start(sessionId: string, onLine: (event: RedisMonitorLineEvent) => void): Promise<void> {
    if (monitorId.value) {
      return
    }
    ensureSubscribed(onLine)
    state.value = 'starting'
    message.value = ''
    const result = await redisApi.monitorStreamStart({ sessionId })
    monitorId.value = result.monitorId
  }

  async function stop(): Promise<void> {
    const id = monitorId.value
    if (!id) {
      return
    }
    monitorId.value = null
    state.value = 'closed'
    try {
      await redisApi.monitorStreamStop({ monitorId: id })
    } catch {
      // 停止失败不影响前端状态：后端会在会话关闭时一并清理监控子任务。
    }
  }

  const registerReleaseCleanup = inject(SESSION_RELEASE_CLEANUP_KEY, null)
  registerReleaseCleanup?.(() => stop())

  onBeforeUnmount(() => {
    offEvent?.()
    offEvent = null
    void stop()
  })

  return { monitorId, state, message, start, stop }
}
