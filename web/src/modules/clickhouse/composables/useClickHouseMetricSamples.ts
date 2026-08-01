import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { clickhouseApi } from '@/api/clickhouse'
import type { ClickHouseMetricsSnapshotResult } from '@/api/types/clickhouse'

export type MetricSample = {
  tsMs: number
  memoryTracking: number | null
  queryMetric: number | null
  mergeMetric: number | null
  delayedInserts: number | null
  processCount: number | null
  runningMerges: number | null
  maxPartsInPartition: number | null
  maxReplicaDelaySecs: number | null
}

const MAX_SAMPLES = 90
const SAMPLE_INTERVAL_MS = 5000

function toSample(snap: ClickHouseMetricsSnapshotResult): MetricSample {
  return {
    tsMs: snap.tsMs || Date.now(),
    memoryTracking: snap.memoryTracking ?? null,
    queryMetric: snap.queryMetric ?? null,
    mergeMetric: snap.mergeMetric ?? null,
    delayedInserts: snap.delayedInserts ?? null,
    processCount: snap.processCount ?? null,
    runningMerges: snap.runningMerges ?? null,
    maxPartsInPartition: snap.maxPartsInPartition ?? null,
    maxReplicaDelaySecs: snap.maxReplicaDelaySecs ?? null,
  }
}

/**
 * 监控面板活跃时按固定间隔拉取轻量快照，维护环缓冲供趋势图使用。
 */
export function useClickHouseMetricSamples(opts: {
  sessionId: Ref<string | null>
  active: Ref<boolean>
}) {
  const samples = ref<MetricSample[]>([])
  const sampleError = ref<string | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null
  let inflight = false

  function clearSamples(): void {
    samples.value = []
    sampleError.value = null
  }

  function pushSample(s: MetricSample): void {
    const next = samples.value.slice()
    const last = next[next.length - 1]
    if (last && s.tsMs - last.tsMs < 1500) {
      next[next.length - 1] = s
    } else {
      next.push(s)
    }
    if (next.length > MAX_SAMPLES) next.splice(0, next.length - MAX_SAMPLES)
    samples.value = next
  }

  async function takeSample(): Promise<void> {
    const sid = opts.sessionId.value
    if (!sid || !opts.active.value || inflight) return
    inflight = true
    try {
      const snap = await clickhouseApi.metaMetricsSnapshot({ sessionId: sid })
      pushSample(toSample(snap))
      sampleError.value = null
    } catch (e) {
      sampleError.value = e instanceof Error ? e.message : String(e)
    } finally {
      inflight = false
    }
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function start(): void {
    stop()
    if (!opts.active.value || !opts.sessionId.value) return
    void takeSample()
    timer = setInterval(() => {
      void takeSample()
    }, SAMPLE_INTERVAL_MS)
  }

  watch(
    () => [opts.sessionId.value, opts.active.value] as const,
    ([sid, active], prev) => {
      if (!sid || !active) {
        stop()
        if (!sid) clearSamples()
        return
      }
      if (!prev || prev[0] !== sid) clearSamples()
      start()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => stop())

  /** 短暂缺失用上一有效值填补，避免趋势图因偶发 null 断线 */
  function carryForward(values: Array<number | null>): Array<number | null> {
    let last: number | null = null
    return values.map((v) => {
      if (v != null && Number.isFinite(v)) {
        last = v
        return v
      }
      return last
    })
  }

  const series = computed(() => ({
    memory: carryForward(samples.value.map((s) => s.memoryTracking)),
    query: carryForward(samples.value.map((s) => s.queryMetric)),
    merge: carryForward(samples.value.map((s) => s.mergeMetric ?? s.runningMerges)),
    delayed: carryForward(samples.value.map((s) => s.delayedInserts)),
    processes: carryForward(samples.value.map((s) => s.processCount)),
    maxParts: carryForward(samples.value.map((s) => s.maxPartsInPartition)),
    replicaDelay: carryForward(samples.value.map((s) => s.maxReplicaDelaySecs)),
  }))

  const timestamps = computed(() => samples.value.map((s) => s.tsMs))

  const sampleCount = computed(() => samples.value.length)

  return {
    samples,
    series,
    timestamps,
    sampleCount,
    sampleError,
    takeSample,
    clearSamples,
  }
}
