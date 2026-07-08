import { type Ref, onBeforeUnmount, ref } from 'vue'
import { sshApi } from '@/api'
import type { SshMonitorMetricsResult } from '@/api/types/ssh'

export type { SshDiskPartition } from '@/api/types/ssh'

/** 带采集时间戳的指标快照 */
export interface SshMetrics extends SshMonitorMetricsResult {
  collectedAt: Date
}

export type MonitorAutoInterval = 3 | 5 | 10 | 30 | 60 | 0

/**
 * SSH 主机系统监控 composable。
 *
 * 通过 `ssh.monitor.metrics` Bridge 接口采集指标；
 * Shell 脚本编译在后端 ssh-service 二进制中，前端不接触任何命令字符串。
 */
export function useSshMonitor(sessionId: Ref<string | null>) {
  const metrics = ref<SshMetrics | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const autoInterval = ref<MonitorAutoInterval>(10)

  let timer: ReturnType<typeof setInterval> | null = null

  async function refresh(): Promise<void> {
    if (!sessionId.value || loading.value) return
    loading.value = true
    error.value = null
    try {
      const result = await sshApi.monitorMetrics({ sessionId: sessionId.value })
      metrics.value = { ...result, collectedAt: new Date() }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to collect metrics'
    } finally {
      loading.value = false
    }
  }

  function applyAutoInterval(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    if (autoInterval.value > 0) {
      timer = setInterval(() => { void refresh() }, autoInterval.value * 1000)
    }
  }

  function stopAutoInterval(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function setAutoInterval(val: MonitorAutoInterval): void {
    autoInterval.value = val
    applyAutoInterval()
  }

  onBeforeUnmount(() => {
    stopAutoInterval()
  })

  return {
    metrics,
    loading,
    error,
    autoInterval,
    refresh,
    setAutoInterval,
    applyAutoInterval,
    stopAutoInterval,
  }
}
