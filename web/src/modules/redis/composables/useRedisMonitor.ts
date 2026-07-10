import { onBeforeUnmount, ref } from 'vue'
import { redisApi } from '@/api'
import type { RedisMonitorMetricsResult } from '@/api/types/redis'

/**
 * Redis `INFO` 派生指标轮询（对应后端短窗口缓存的 `redis.monitor.metrics`）。
 *
 * 与 SSH 监控面板一致的轮询模型：MONITOR 命令流是单独的推流通道（见
 * `useRedisMonitorStream`），常规仪表盘指标走轮询即可，实现简单且服务端已有缓存兜底。
 */
export function useRedisMonitor(sessionId: () => string | null) {
  const metrics = ref<RedisMonitorMetricsResult | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const collectedAt = ref<Date | null>(null)
  const autoInterval = ref(5)

  let timer: ReturnType<typeof setInterval> | undefined

  async function refresh(): Promise<void> {
    const id = sessionId()
    if (!id || loading.value) {
      return
    }
    loading.value = true
    error.value = null
    try {
      metrics.value = await redisApi.monitorMetrics({ sessionId: id })
      collectedAt.value = new Date()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to collect Redis metrics'
    } finally {
      loading.value = false
    }
  }

  function applyAutoInterval(): void {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
    if (autoInterval.value > 0) {
      timer = setInterval(() => {
        void refresh()
      }, autoInterval.value * 1000)
    }
  }

  function setAutoInterval(seconds: number): void {
    autoInterval.value = seconds
    applyAutoInterval()
  }

  onBeforeUnmount(() => {
    if (timer) {
      clearInterval(timer)
    }
  })

  return { metrics, loading, error, collectedAt, autoInterval, refresh, setAutoInterval }
}
