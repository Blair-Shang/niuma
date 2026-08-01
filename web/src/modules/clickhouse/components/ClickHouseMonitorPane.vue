<script setup lang="ts">
import {
  RsButton,
  RsConfirmDialog,
  RsDialog,
  RsEmpty,
  RsIcon,
  RsInput,
  RsLoading,
  RsSelect,
  RsTable,
  RsTooltip,
  useRsToast,
  type RsContextMenuItem,
  type RsSelectOptions,
  type RsTableColumn,
} from '@niuma/ui'
import { computed, h, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { clickhouseApi } from '@/api/clickhouse'
import type {
  ClickHouseClusterHostInfo,
  ClickHouseMergeInfo,
  ClickHouseMetaInstanceOverviewResult,
  ClickHouseMutationInfo,
  ClickHousePartsTableInfo,
  ClickHouseProcessInfo,
  ClickHouseReplicaInfo,
  ClickHouseSlowQueryInfo,
} from '@/api/types/clickhouse'
import { useClickHouseMetricSamples } from '@/modules/clickhouse/composables/useClickHouseMetricSamples'
import MonitorSparkline from '@/modules/clickhouse/components/MonitorSparkline.vue'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

type MonitorTab =
  | 'instance'
  | 'processes'
  | 'merges'
  | 'mutations'
  | 'replicas'
  | 'parts'
  | 'slow'
  | 'clusters'
type ProcessRow = Record<string, unknown> & {
  __rowKey: string
  queryId: string
  elapsed: number
  queryKind: string
  readRows: number
  readBytes: number
  writtenRows: number
  writtenBytes: number
  memoryUsage: number
  peakMemoryUsage: number
  isCancelled: boolean
}
type MutationRow = Record<string, unknown> & { __rowKey: string; partsToDo: number }
type ClusterRow = Record<string, unknown> & { __rowKey: string; errorsCount: number }
type MergeRow = Record<string, unknown> & { __rowKey: string }
type ReplicaRow = Record<string, unknown> & {
  __rowKey: string
  absoluteDelay: number
  isReadonly: boolean
  queueSize: number
}
type PartsRow = Record<string, unknown> & { __rowKey: string; parts: number }
type DiskRow = Record<string, unknown> & { __rowKey: string }
type SlowRow = Record<string, unknown> & { __rowKey: string; queryId: string }

const LONG_RUNNING_SECS = 60
const PARTS_WARN = 300
const REPLICA_DELAY_WARN = 60
const DISK_LOW_RATIO = 0.1
const TOP_HEAVY_N = 5

const activeTab = ref<MonitorTab>('instance')
const autoRefreshSecs = ref('0')
let refreshTimer: ReturnType<typeof setInterval> | null = null
const scopeOk = computed(() => Boolean(props.sessionId))

const dialogHostEl = ref<HTMLElement | null>(null)
const dialogTeleportReady = ref(false)
onMounted(() => {
  dialogTeleportReady.value = dialogHostEl.value != null
})

const autoRefreshOptions = computed<RsSelectOptions>(() => [
  { value: '0', label: t('modules.clickhouse.monitor.refreshOff') },
  { value: '3', label: t('modules.clickhouse.monitor.refresh3s') },
  { value: '5', label: t('modules.clickhouse.monitor.refresh5s') },
  { value: '10', label: t('modules.clickhouse.monitor.refresh10s') },
])

const monitorTabs = computed(() =>
  (
    ['instance', 'processes', 'merges', 'mutations', 'replicas', 'parts', 'slow', 'clusters'] as const
  ).map((tab) => ({
    id: tab,
    label: t(`modules.clickhouse.monitor.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`),
  })),
)

const {
  series: trendSeries,
  timestamps: trendTimestamps,
  sampleCount,
  sampleError,
} = useClickHouseMetricSamples({
  sessionId: toRef(props, 'sessionId'),
  active: toRef(props, 'active'),
})

function clearTimer(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

function setupTimer(): void {
  clearTimer()
  const secs = Number(autoRefreshSecs.value)
  if (!Number.isFinite(secs) || secs <= 0 || !props.active || !scopeOk.value) return
  refreshTimer = setInterval(() => {
    void loadCurrentTab(true)
  }, secs * 1000)
}

function formatElapsed(secs: number): string {
  if (!Number.isFinite(secs)) return '—'
  if (secs < 60) return `${secs.toFixed(1)}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s.toFixed(0)}s`
}

function formatBytes(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} GB`
  return `${(n / 1024 ** 4).toFixed(2)} TB`
}

function formatCount(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat().format(n)
}

function formatUptime(secs?: number | null): string {
  if (secs == null || !Number.isFinite(secs) || secs < 0) return '—'
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatPercent(ratio?: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}

function formatProgress(p?: number | null): string {
  if (p == null || !Number.isFinite(p)) return '—'
  return `${(p * 100).toFixed(1)}%`
}

function isLongRunning(elapsed: number): boolean {
  return elapsed >= LONG_RUNNING_SECS
}

function truncateQuery(q?: string | null, max = 96): string {
  const s = (q ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return '—'
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function goToTab(tab: MonitorTab): void {
  activeTab.value = tab
}

// ─── Instance ───────────────────────────────────────────────────────────────
const overviewBusy = ref(false)
const overview = ref<ClickHouseMetaInstanceOverviewResult | null>(null)
/** 实例页 Top 重操作快照（与进程/Merge Tab 独立，避免互相覆盖） */
const topProcesses = ref<ClickHouseProcessInfo[]>([])
const topMerges = ref<ClickHouseMergeInfo[]>([])

const memoryRatio = computed(() => {
  const used = overview.value?.memoryTracking
  const max = overview.value?.maxServerMemoryBytes || overview.value?.osMemoryTotalBytes
  if (used == null || max == null || max <= 0) return null
  return used / max
})

const diskFreeRatio = computed(() => {
  const total = overview.value?.diskTotalBytes
  const free = overview.value?.diskFreeBytes
  if (total == null || free == null || total <= 0) return null
  return free / total
})

const diskUsedRatio = computed(() => {
  const total = overview.value?.diskTotalBytes
  const used = overview.value?.diskUsedBytes
  if (total == null || used == null || total <= 0) return null
  return used / total
})

type HealthLevel = 'warn' | 'critical'
type HealthAlert = { level: HealthLevel; text: string; tab?: MonitorTab }

function pushAlert(
  alerts: HealthAlert[],
  ok: boolean,
  level: HealthLevel,
  text: string,
  tab?: MonitorTab,
): void {
  if (ok) alerts.push({ level, text, tab })
}

const healthAlerts = computed((): HealthAlert[] => {
  const o = overview.value
  if (!o) return []
  const alerts: HealthAlert[] = []
  const mem = memoryRatio.value
  pushAlert(
    alerts,
    mem != null && mem >= 0.75,
    mem != null && mem >= 0.9 ? 'critical' : 'warn',
    `${t('modules.clickhouse.monitor.instanceMemory')} ${formatPercent(mem)}`,
    'processes',
  )
  const free = diskFreeRatio.value
  pushAlert(
    alerts,
    free != null && free <= DISK_LOW_RATIO,
    free != null && free <= DISK_LOW_RATIO / 2 ? 'critical' : 'warn',
    `${t('modules.clickhouse.monitor.diskFree')} ${formatPercent(free)}`,
  )
  const delayed = o.delayedInserts ?? 0
  pushAlert(
    alerts,
    delayed > 0,
    delayed >= 10 ? 'critical' : 'warn',
    `${t('modules.clickhouse.monitor.instanceDelayedInserts')} ${formatCount(delayed)}`,
    'processes',
  )
  const mutations = o.partMutationMetric ?? 0
  pushAlert(
    alerts,
    mutations > 0,
    mutations >= 5 ? 'critical' : 'warn',
    `${t('modules.clickhouse.monitor.instanceMutations')} ${formatCount(mutations)}`,
    'mutations',
  )
  const maxParts = o.maxPartsInPartition ?? 0
  pushAlert(
    alerts,
    maxParts >= PARTS_WARN,
    maxParts >= PARTS_WARN * 2 ? 'critical' : 'warn',
    t('modules.clickhouse.monitor.partsWarnTip', { n: maxParts }),
    'parts',
  )
  const readonly = o.readonlyReplicaTables ?? o.readonlyReplicaMetric ?? 0
  pushAlert(
    alerts,
    readonly > 0,
    'critical',
    `${t('modules.clickhouse.monitor.instanceReadonlyReplicas')} ${formatCount(readonly)}`,
    'replicas',
  )
  const delay = o.maxReplicaDelaySecs ?? 0
  pushAlert(
    alerts,
    delay >= REPLICA_DELAY_WARN,
    delay >= REPLICA_DELAY_WARN * 5 ? 'critical' : 'warn',
    t('modules.clickhouse.monitor.replicaDelayTip', { n: Math.round(delay) }),
    'replicas',
  )
  return alerts
})

function gaugeWidth(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return '0%'
  return `${Math.min(100, Math.max(0, ratio * 100)).toFixed(1)}%`
}

function gaugeTone(ratio: number | null, kind: 'used' | 'free'): string | undefined {
  if (ratio == null || !Number.isFinite(ratio)) return undefined
  if (kind === 'used') {
    if (ratio >= 0.9) return 'nm-clickhouse-monitor__gauge-fill--danger'
    if (ratio >= 0.75) return 'nm-clickhouse-monitor__gauge-fill--warn'
    return 'nm-clickhouse-monitor__gauge-fill--ok'
  }
  if (ratio <= DISK_LOW_RATIO / 2) return 'nm-clickhouse-monitor__gauge-fill--danger'
  if (ratio <= DISK_LOW_RATIO) return 'nm-clickhouse-monitor__gauge-fill--warn'
  return 'nm-clickhouse-monitor__gauge-fill--ok'
}

const diskColumns = computed((): RsTableColumn<DiskRow>[] => [
  { key: 'name', title: t('modules.clickhouse.monitor.colDiskName'), minWidth: 100 },
  { key: 'type', title: t('modules.clickhouse.monitor.colDiskType'), width: 90 },
  { key: 'used', title: t('modules.clickhouse.monitor.colDiskUsed'), width: 100 },
  { key: 'free', title: t('modules.clickhouse.monitor.colDiskFree'), width: 100 },
  { key: 'total', title: t('modules.clickhouse.monitor.colDiskTotal'), width: 100 },
  { key: 'path', title: t('modules.clickhouse.monitor.colDiskPath'), minWidth: 160, ellipsis: true },
])

const diskRows = computed<DiskRow[]>(() =>
  (overview.value?.disks ?? []).map((d) => ({
    __rowKey: d.name,
    name: d.name,
    type: d.type ?? '',
    used: formatBytes(d.usedBytes),
    free: formatBytes(d.freeBytes),
    total: formatBytes(d.totalBytes),
    path: d.path ?? '',
  })),
)

async function loadOverview(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) overviewBusy.value = true
  const sid = props.sessionId
  try {
    const [ov, proc, merge] = await Promise.all([
      clickhouseApi.metaInstanceOverview({ sessionId: sid }),
      clickhouseApi.metaProcesses({ sessionId: sid }).catch(() => null),
      clickhouseApi.metaMerges({ sessionId: sid }).catch(() => null),
    ])
    overview.value = ov
    topProcesses.value = proc?.processes ?? []
    topMerges.value = merge?.merges ?? []
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) overviewBusy.value = false
  }
}

const topByElapsed = computed(() =>
  [...topProcesses.value]
    .filter((p) => Boolean(p.query?.trim()) || p.elapsed >= 1)
    .sort((a, b) => b.elapsed - a.elapsed)
    .slice(0, TOP_HEAVY_N),
)

const topByMemory = computed(() =>
  [...topProcesses.value]
    .filter((p) => (p.peakMemoryUsage ?? p.memoryUsage ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.peakMemoryUsage ?? b.memoryUsage ?? 0) - (a.peakMemoryUsage ?? a.memoryUsage ?? 0),
    )
    .slice(0, TOP_HEAVY_N),
)

const topMergesByElapsed = computed(() =>
  [...topMerges.value].sort((a, b) => b.elapsed - a.elapsed).slice(0, TOP_HEAVY_N),
)

const hasHeavyOps = computed(
  () =>
    topByElapsed.value.length > 0 ||
    topByMemory.value.length > 0 ||
    topMergesByElapsed.value.length > 0,
)

function openTopProcess(p: ClickHouseProcessInfo): void {
  processes.value = topProcesses.value
  highlightedRowKey.value = p.queryId
  goToTab('processes')
}

// ─── Processes ──────────────────────────────────────────────────────────────
const processesBusy = ref(false)
const processes = ref<ClickHouseProcessInfo[]>([])
const processFilter = ref('all')
const processQuery = ref('')
const highlightedRowKey = ref<string | undefined>(undefined)
const detailOpen = ref(false)
const detailProcess = ref<ClickHouseProcessInfo | null>(null)
const confirmOpen = ref(false)
const pendingKill = ref<{ queryId: string; user?: string; host?: string } | null>(null)
const killBusy = ref(false)

const processFilterOptions = computed<RsSelectOptions>(() => [
  { value: 'all', label: t('modules.clickhouse.monitor.filterAll') },
  { value: 'query', label: t('modules.clickhouse.monitor.filterQuery') },
  { value: 'long', label: t('modules.clickhouse.monitor.filterLong') },
])

const filteredProcesses = computed(() => {
  const q = processQuery.value.trim().toLowerCase()
  const filter = processFilter.value
  return processes.value.filter((p) => {
    const hasQuery = Boolean(p.query?.trim())
    if (filter === 'query' && !hasQuery) return false
    if (filter === 'long' && (p.elapsed ?? 0) < LONG_RUNNING_SECS) return false
    if (!q) return true
    const hay = [p.queryId, p.user, p.host, p.db, p.queryKind, p.query]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
})

const processColumns = computed((): RsTableColumn<ProcessRow>[] => [
  { key: 'queryId', title: t('modules.clickhouse.monitor.colQueryId'), minWidth: 140, ellipsis: true },
  { key: 'user', title: t('modules.clickhouse.monitor.colUser'), minWidth: 90, ellipsis: true },
  { key: 'host', title: t('modules.clickhouse.monitor.colHost'), minWidth: 110, ellipsis: true },
  { key: 'db', title: t('modules.clickhouse.monitor.colDb'), minWidth: 90, ellipsis: true },
  { key: 'queryKind', title: t('modules.clickhouse.monitor.colQueryKind'), width: 90 },
  { key: 'startTime', title: t('modules.clickhouse.monitor.colStartTime'), width: 150 },
  {
    key: 'elapsed',
    title: t('modules.clickhouse.monitor.colElapsed'),
    width: 90,
    render: (row: ProcessRow) => {
      const long = isLongRunning(row.elapsed)
      return h(
        'span',
        {
          class: long ? 'nm-clickhouse-monitor__time--long' : undefined,
          title: long
            ? t('modules.clickhouse.monitor.longRunningTip', { n: LONG_RUNNING_SECS })
            : undefined,
        },
        formatElapsed(row.elapsed),
      ) as unknown as string
    },
  },
  {
    key: 'endTime',
    title: t('modules.clickhouse.monitor.colEndTime'),
    width: 72,
    render: () => t('modules.clickhouse.monitor.timeRunning') as unknown as string,
  },
  {
    key: 'readRows',
    title: t('modules.clickhouse.monitor.colReadRows'),
    width: 90,
    render: (row: ProcessRow) => formatCount(row.readRows) as unknown as string,
  },
  {
    key: 'readBytes',
    title: t('modules.clickhouse.monitor.colReadBytes'),
    width: 90,
    render: (row: ProcessRow) => formatBytes(row.readBytes) as unknown as string,
  },
  {
    key: 'writtenRows',
    title: t('modules.clickhouse.monitor.colWrittenRows'),
    width: 90,
    render: (row: ProcessRow) => formatCount(row.writtenRows) as unknown as string,
  },
  {
    key: 'writtenBytes',
    title: t('modules.clickhouse.monitor.colWrittenBytes'),
    width: 90,
    render: (row: ProcessRow) => formatBytes(row.writtenBytes) as unknown as string,
  },
  {
    key: 'memoryUsage',
    title: t('modules.clickhouse.monitor.colMemory'),
    width: 90,
    render: (row: ProcessRow) => formatBytes(row.memoryUsage) as unknown as string,
  },
  {
    key: 'peakMemoryUsage',
    title: t('modules.clickhouse.monitor.colPeakMemory'),
    width: 90,
    render: (row: ProcessRow) => formatBytes(row.peakMemoryUsage) as unknown as string,
  },
  {
    key: 'isCancelled',
    title: t('modules.clickhouse.monitor.colCancelled'),
    width: 72,
    render: (row: ProcessRow) => (row.isCancelled ? 'Y' : '') as unknown as string,
  },
  { key: 'query', title: t('modules.clickhouse.monitor.colQuery'), minWidth: 160, ellipsis: true },
])

const processRows = computed<ProcessRow[]>(() =>
  filteredProcesses.value.map((p) => ({
    __rowKey: p.queryId,
    queryId: p.queryId,
    user: p.user,
    host: p.host,
    db: p.db ?? '',
    queryKind: p.queryKind ?? '',
    startTime: p.startTime ?? '',
    elapsed: p.elapsed ?? 0,
    readRows: p.readRows ?? 0,
    readBytes: p.readBytes ?? 0,
    writtenRows: p.writtenRows ?? 0,
    writtenBytes: p.writtenBytes ?? 0,
    memoryUsage: p.memoryUsage ?? 0,
    peakMemoryUsage: p.peakMemoryUsage ?? 0,
    isCancelled: Boolean(p.isCancelled),
    query: p.query ?? '',
  })),
)

const selectedProcess = computed(() => {
  if (!highlightedRowKey.value) return null
  return processes.value.find((p) => p.queryId === highlightedRowKey.value) ?? null
})

const detailRows = computed(() => {
  const p = detailProcess.value
  if (!p) return []
  return [
    { key: 'queryId', label: t('modules.clickhouse.monitor.colQueryId'), value: p.queryId },
    { key: 'user', label: t('modules.clickhouse.monitor.colUser'), value: p.user || '—' },
    { key: 'host', label: t('modules.clickhouse.monitor.colHost'), value: p.host || '—' },
    { key: 'address', label: t('modules.clickhouse.monitor.colAddress'), value: p.address || '—' },
    { key: 'db', label: t('modules.clickhouse.monitor.colDb'), value: p.db || '—' },
    { key: 'queryKind', label: t('modules.clickhouse.monitor.colQueryKind'), value: p.queryKind || '—' },
    { key: 'startTime', label: t('modules.clickhouse.monitor.colStartTime'), value: p.startTime || '—' },
    { key: 'elapsed', label: t('modules.clickhouse.monitor.colElapsed'), value: formatElapsed(p.elapsed ?? 0) },
    {
      key: 'endTime',
      label: t('modules.clickhouse.monitor.colEndTime'),
      value: t('modules.clickhouse.monitor.timeRunning'),
    },
    { key: 'readRows', label: t('modules.clickhouse.monitor.colReadRows'), value: formatCount(p.readRows) },
    { key: 'readBytes', label: t('modules.clickhouse.monitor.colReadBytes'), value: formatBytes(p.readBytes) },
    {
      key: 'writtenRows',
      label: t('modules.clickhouse.monitor.colWrittenRows'),
      value: formatCount(p.writtenRows),
    },
    {
      key: 'writtenBytes',
      label: t('modules.clickhouse.monitor.colWrittenBytes'),
      value: formatBytes(p.writtenBytes),
    },
    { key: 'memory', label: t('modules.clickhouse.monitor.colMemory'), value: formatBytes(p.memoryUsage) },
    {
      key: 'peakMemory',
      label: t('modules.clickhouse.monitor.colPeakMemory'),
      value: formatBytes(p.peakMemoryUsage),
    },
    {
      key: 'cancelled',
      label: t('modules.clickhouse.monitor.colCancelled'),
      value: p.isCancelled ? 'Y' : 'N',
    },
    { key: 'query', label: t('modules.clickhouse.monitor.colQuery'), value: p.query?.trim() || '—' },
  ]
})

async function loadProcesses(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) processesBusy.value = true
  try {
    const result = await clickhouseApi.metaProcesses({ sessionId: props.sessionId })
    processes.value = result.processes ?? []
    if (
      highlightedRowKey.value &&
      !processes.value.some((p) => p.queryId === highlightedRowKey.value)
    ) {
      highlightedRowKey.value = undefined
    }
    if (detailProcess.value) {
      const next = processes.value.find((p) => p.queryId === detailProcess.value?.queryId) ?? null
      detailProcess.value = next
      if (!next) detailOpen.value = false
    }
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) processesBusy.value = false
  }
}

function openDetail(p: ClickHouseProcessInfo): void {
  detailProcess.value = p
  detailOpen.value = true
}

function requestKill(p: ClickHouseProcessInfo): void {
  pendingKill.value = { queryId: p.queryId, user: p.user, host: p.host }
  confirmOpen.value = true
}

async function confirmKill(): Promise<void> {
  if (!props.sessionId || !pendingKill.value) return
  killBusy.value = true
  try {
    await clickhouseApi.metaKill({
      sessionId: props.sessionId,
      queryId: pendingKill.value.queryId,
    })
    toast.success(t('modules.clickhouse.monitor.killQueryOk'))
    confirmOpen.value = false
    pendingKill.value = null
    await loadProcesses(true)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    killBusy.value = false
  }
}

function processContextMenuItems(row: ProcessRow | null): RsContextMenuItem[] {
  if (!row) return []
  return [
    { key: 'viewDetail', label: t('modules.clickhouse.monitor.viewDetail'), icon: 'eye' },
    { key: 'killQuery', label: t('modules.clickhouse.monitor.killQuery'), icon: 'x', danger: true },
  ]
}

function onProcessContextSelect(key: string, row: ProcessRow | null): void {
  if (!row) return
  const p = processes.value.find((item) => item.queryId === row.queryId)
  if (!p) return
  if (key === 'viewDetail') openDetail(p)
  else if (key === 'killQuery') requestKill(p)
}

// ─── Merges ─────────────────────────────────────────────────────────────────
const mergesBusy = ref(false)
const merges = ref<ClickHouseMergeInfo[]>([])

const mergeColumns = computed((): RsTableColumn<MergeRow>[] => [
  { key: 'database', title: t('modules.clickhouse.monitor.colDatabase'), minWidth: 100, ellipsis: true },
  { key: 'table', title: t('modules.clickhouse.monitor.colTable'), minWidth: 120, ellipsis: true },
  { key: 'startTime', title: t('modules.clickhouse.monitor.colStartTime'), width: 150 },
  {
    key: 'elapsed',
    title: t('modules.clickhouse.monitor.colElapsed'),
    width: 90,
    render: (row: MergeRow) => formatElapsed(Number(row.elapsed) || 0) as unknown as string,
  },
  {
    key: 'endTime',
    title: t('modules.clickhouse.monitor.colEndTime'),
    width: 72,
    render: () => t('modules.clickhouse.monitor.timeRunning') as unknown as string,
  },
  {
    key: 'progress',
    title: t('modules.clickhouse.monitor.colProgress'),
    width: 80,
    render: (row: MergeRow) => formatProgress(Number(row.progress)) as unknown as string,
  },
  { key: 'numParts', title: t('modules.clickhouse.monitor.colNumParts'), width: 80 },
  { key: 'kind', title: t('modules.clickhouse.monitor.colMergeKind'), width: 90 },
  {
    key: 'size',
    title: t('modules.clickhouse.monitor.colSize'),
    width: 100,
    render: (row: MergeRow) => formatBytes(row.size as number | undefined) as unknown as string,
  },
  {
    key: 'rowsRead',
    title: t('modules.clickhouse.monitor.colReadRows'),
    width: 90,
    render: (row: MergeRow) => formatCount(row.rowsRead as number | undefined) as unknown as string,
  },
  { key: 'partitionId', title: t('modules.clickhouse.monitor.colPartition'), minWidth: 100, ellipsis: true },
])

const mergeRows = computed<MergeRow[]>(() =>
  merges.value.map((m, i) => ({
    __rowKey: `${m.database}.${m.table}-${i}`,
    database: m.database,
    table: m.table,
    startTime: m.startTime ?? '',
    elapsed: m.elapsed,
    progress: m.progress,
    numParts: m.numParts,
    kind: m.isMutation
      ? t('modules.clickhouse.monitor.mergeKindMutation')
      : t('modules.clickhouse.monitor.mergeKindMerge'),
    size: m.totalSizeBytesCompressed ?? undefined,
    rowsRead: m.rowsRead ?? undefined,
    partitionId: m.partitionId ?? '',
  })),
)

async function loadMerges(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) mergesBusy.value = true
  try {
    const result = await clickhouseApi.metaMerges({ sessionId: props.sessionId })
    merges.value = result.merges ?? []
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) mergesBusy.value = false
  }
}

// ─── Mutations ──────────────────────────────────────────────────────────────
const mutationsBusy = ref(false)
const mutations = ref<ClickHouseMutationInfo[]>([])

const mutationColumns = computed((): RsTableColumn<MutationRow>[] => [
  { key: 'database', title: t('modules.clickhouse.monitor.colDatabase'), minWidth: 100, ellipsis: true },
  { key: 'table', title: t('modules.clickhouse.monitor.colTable'), minWidth: 120, ellipsis: true },
  { key: 'mutationId', title: t('modules.clickhouse.monitor.colMutationId'), minWidth: 120, ellipsis: true },
  { key: 'startTime', title: t('modules.clickhouse.monitor.colStartTime'), width: 150 },
  {
    key: 'elapsed',
    title: t('modules.clickhouse.monitor.colElapsed'),
    width: 90,
    render: (row: MutationRow) => formatElapsed(Number(row.elapsed) || 0) as unknown as string,
  },
  {
    key: 'endTime',
    title: t('modules.clickhouse.monitor.colEndTime'),
    width: 72,
    render: () => t('modules.clickhouse.monitor.timeRunning') as unknown as string,
  },
  {
    key: 'partsToDo',
    title: t('modules.clickhouse.monitor.colPartsToDo'),
    width: 90,
    render: (row: MutationRow) =>
      h(
        'span',
        { class: row.partsToDo > 0 ? 'nm-clickhouse-monitor__warn' : undefined },
        formatCount(row.partsToDo),
      ) as unknown as string,
  },
  { key: 'failTime', title: t('modules.clickhouse.monitor.colFailTime'), width: 150 },
  { key: 'failReason', title: t('modules.clickhouse.monitor.colFailReason'), minWidth: 140, ellipsis: true },
  { key: 'command', title: t('modules.clickhouse.monitor.colCommand'), minWidth: 180, ellipsis: true },
])

const mutationRows = computed<MutationRow[]>(() =>
  mutations.value.map((m) => ({
    __rowKey: `${m.database}.${m.table}:${m.mutationId}`,
    database: m.database,
    table: m.table,
    mutationId: m.mutationId,
    startTime: m.createTime ?? '',
    elapsed: m.elapsedSecs ?? 0,
    partsToDo: m.partsToDo ?? 0,
    failTime: m.latestFailTime || '',
    failReason: m.latestFailReason || m.latestFailedPart || '',
    command: m.command ?? '',
  })),
)

async function loadMutations(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) mutationsBusy.value = true
  try {
    const result = await clickhouseApi.metaMutations({ sessionId: props.sessionId })
    mutations.value = result.mutations ?? []
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) mutationsBusy.value = false
  }
}

// ─── Replicas ───────────────────────────────────────────────────────────────
const replicasBusy = ref(false)
const replicas = ref<ClickHouseReplicaInfo[]>([])

const replicaColumns = computed((): RsTableColumn<ReplicaRow>[] => [
  { key: 'database', title: t('modules.clickhouse.monitor.colDatabase'), minWidth: 100, ellipsis: true },
  { key: 'table', title: t('modules.clickhouse.monitor.colTable'), minWidth: 120, ellipsis: true },
  { key: 'leader', title: t('modules.clickhouse.monitor.colLeader'), width: 64 },
  {
    key: 'readonly',
    title: t('modules.clickhouse.monitor.colReadonly'),
    width: 72,
    render: (row: ReplicaRow) =>
      h(
        'span',
        { class: row.isReadonly ? 'nm-clickhouse-monitor__warn' : undefined },
        row.isReadonly ? 'Y' : '',
      ) as unknown as string,
  },
  {
    key: 'absoluteDelay',
    title: t('modules.clickhouse.monitor.colDelay'),
    width: 90,
    render: (row: ReplicaRow) => {
      const delay = row.absoluteDelay
      const warn = delay >= REPLICA_DELAY_WARN
      return h(
        'span',
        {
          class: warn ? 'nm-clickhouse-monitor__warn' : undefined,
          title: warn
            ? t('modules.clickhouse.monitor.replicaDelayTip', { n: REPLICA_DELAY_WARN })
            : undefined,
        },
        formatElapsed(delay),
      ) as unknown as string
    },
  },
  {
    key: 'queueSize',
    title: t('modules.clickhouse.monitor.colQueue'),
    width: 72,
    render: (row: ReplicaRow) =>
      h(
        'span',
        { class: row.queueSize > 0 ? 'nm-clickhouse-monitor__warn' : undefined },
        String(row.queueSize),
      ) as unknown as string,
  },
  { key: 'insertsInQueue', title: t('modules.clickhouse.monitor.colInsertsQueue'), width: 80 },
  { key: 'mergesInQueue', title: t('modules.clickhouse.monitor.colMergesQueue'), width: 80 },
  { key: 'replicas', title: t('modules.clickhouse.monitor.colReplicaCount'), width: 90 },
  {
    key: 'zkEx',
    title: t('modules.clickhouse.monitor.colZkException'),
    minWidth: 140,
    ellipsis: true,
  },
])

const replicaRows = computed<ReplicaRow[]>(() =>
  replicas.value.map((r) => ({
    __rowKey: `${r.database}.${r.table}`,
    database: r.database,
    table: r.table,
    leader: r.isLeader ? 'Y' : '',
    readonly: r.isReadonly ? 'Y' : '',
    isReadonly: r.isReadonly,
    absoluteDelay: r.absoluteDelay ?? 0,
    queueSize: r.queueSize ?? 0,
    insertsInQueue: r.insertsInQueue ?? 0,
    mergesInQueue: r.mergesInQueue ?? 0,
    replicas: `${r.activeReplicas ?? 0}/${r.totalReplicas ?? 0}`,
    zkEx: r.zookeeperException ?? '',
  })),
)

async function loadReplicas(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) replicasBusy.value = true
  try {
    const result = await clickhouseApi.metaReplicas({ sessionId: props.sessionId })
    replicas.value = result.replicas ?? []
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) replicasBusy.value = false
  }
}

// ─── Parts ──────────────────────────────────────────────────────────────────
const partsBusy = ref(false)
const partsTables = ref<ClickHousePartsTableInfo[]>([])
const partsPartial = ref(false)
const partsWarnings = ref<string[]>([])

const partsColumns = computed((): RsTableColumn<PartsRow>[] => [
  { key: 'database', title: t('modules.clickhouse.monitor.colDatabase'), minWidth: 100, ellipsis: true },
  { key: 'table', title: t('modules.clickhouse.monitor.colTable'), minWidth: 120, ellipsis: true },
  {
    key: 'parts',
    title: t('modules.clickhouse.monitor.colParts'),
    width: 90,
    render: (row: PartsRow) => {
      const warn = row.parts >= PARTS_WARN
      return h(
        'span',
        {
          class: warn ? 'nm-clickhouse-monitor__warn' : undefined,
          title: warn ? t('modules.clickhouse.monitor.partsWarnTip', { n: PARTS_WARN }) : undefined,
        },
        formatCount(row.parts),
      ) as unknown as string
    },
  },
  {
    key: 'partitions',
    title: t('modules.clickhouse.monitor.colPartitions'),
    width: 80,
    render: (row: PartsRow) => formatCount(row.partitions as number) as unknown as string,
  },
  {
    key: 'rows',
    title: t('modules.clickhouse.monitor.colRows'),
    width: 110,
    render: (row: PartsRow) => formatCount(row.rows as number) as unknown as string,
  },
  {
    key: 'bytes',
    title: t('modules.clickhouse.monitor.colSize'),
    width: 100,
    render: (row: PartsRow) => formatBytes(row.bytes as number | undefined) as unknown as string,
  },
])

const partsRows = computed<PartsRow[]>(() =>
  partsTables.value.map((p) => ({
    __rowKey: `${p.database}.${p.table}`,
    database: p.database,
    table: p.table,
    parts: p.parts,
    partitions: p.partitions,
    rows: p.rows,
    bytes: p.bytesOnDisk,
  })),
)

async function loadParts(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) partsBusy.value = true
  try {
    const result = await clickhouseApi.metaParts({ sessionId: props.sessionId })
    partsTables.value = result.tables ?? []
    partsPartial.value = Boolean(result.partial)
    partsWarnings.value = result.warnings ?? []
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) partsBusy.value = false
  }
}

// ─── Clusters ───────────────────────────────────────────────────────────────
const clustersBusy = ref(false)
const clusters = ref<ClickHouseClusterHostInfo[]>([])

const clusterColumns = computed((): RsTableColumn<ClusterRow>[] => [
  { key: 'cluster', title: t('modules.clickhouse.monitor.colCluster'), minWidth: 120 },
  { key: 'shardNum', title: t('modules.clickhouse.monitor.colShard'), width: 80 },
  { key: 'replicaNum', title: t('modules.clickhouse.monitor.colReplica'), width: 80 },
  { key: 'hostName', title: t('modules.clickhouse.monitor.colHostName'), minWidth: 120, ellipsis: true },
  { key: 'hostAddress', title: t('modules.clickhouse.monitor.colHostAddress'), minWidth: 120, ellipsis: true },
  { key: 'port', title: t('modules.clickhouse.monitor.colPort'), width: 72 },
  { key: 'isLocal', title: t('modules.clickhouse.monitor.colIsLocal'), width: 80 },
  {
    key: 'errorsCount',
    title: t('modules.clickhouse.monitor.colErrors'),
    width: 80,
    render: (row: ClusterRow) =>
      h(
        'span',
        { class: row.errorsCount > 0 ? 'nm-clickhouse-monitor__warn' : undefined },
        String(row.errorsCount),
      ) as unknown as string,
  },
])

const clusterRows = computed<ClusterRow[]>(() =>
  clusters.value.map((h, i) => ({
    __rowKey: `${h.cluster}-${h.shardNum}-${h.replicaNum}-${i}`,
    cluster: h.cluster,
    shardNum: h.shardNum,
    replicaNum: h.replicaNum,
    hostName: h.hostName,
    hostAddress: h.hostAddress ?? '',
    port: h.port ?? '',
    isLocal: h.isLocal ? 'Y' : '',
    errorsCount: h.errorsCount ?? 0,
  })),
)

async function loadClusters(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) clustersBusy.value = true
  try {
    const result = await clickhouseApi.metaClusters({ sessionId: props.sessionId })
    clusters.value = result.hosts ?? []
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) clustersBusy.value = false
  }
}

// ─── Slow queries ───────────────────────────────────────────────────────────
const slowBusy = ref(false)
const slowQueries = ref<ClickHouseSlowQueryInfo[]>([])
const slowTruncated = ref(false)
const slowWindowMinutes = ref('60')
const slowMinDurationMs = ref('1000')
const slowDetailOpen = ref(false)
const slowDetail = ref<ClickHouseSlowQueryInfo | null>(null)

const slowWindowOptions = computed<RsSelectOptions>(() => [
  { value: '15', label: t('modules.clickhouse.monitor.slowWindow15m') },
  { value: '60', label: t('modules.clickhouse.monitor.slowWindow1h') },
  { value: '360', label: t('modules.clickhouse.monitor.slowWindow6h') },
  { value: '1440', label: t('modules.clickhouse.monitor.slowWindow24h') },
])

const slowMinOptions = computed<RsSelectOptions>(() => [
  { value: '1000', label: t('modules.clickhouse.monitor.slowMin1s') },
  { value: '5000', label: t('modules.clickhouse.monitor.slowMin5s') },
  { value: '30000', label: t('modules.clickhouse.monitor.slowMin30s') },
  { value: '60000', label: t('modules.clickhouse.monitor.slowMin60s') },
])

function formatDurationMs(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return formatElapsed(ms / 1000)
}

const slowColumns = computed((): RsTableColumn<SlowRow>[] => [
  { key: 'startTime', title: t('modules.clickhouse.monitor.colStartTime'), width: 150 },
  { key: 'endTime', title: t('modules.clickhouse.monitor.colEndTime'), width: 150 },
  { key: 'user', title: t('modules.clickhouse.monitor.colUser'), minWidth: 90, ellipsis: true },
  {
    key: 'durationMs',
    title: t('modules.clickhouse.monitor.colDuration'),
    width: 90,
    render: (row: SlowRow) =>
      h(
        'span',
        { class: Number(row.durationMs) >= 30000 ? 'nm-clickhouse-monitor__warn' : undefined },
        formatDurationMs(Number(row.durationMs)),
      ) as unknown as string,
  },
  {
    key: 'readRows',
    title: t('modules.clickhouse.monitor.colReadRows'),
    width: 90,
    render: (row: SlowRow) => formatCount(row.readRows as number) as unknown as string,
  },
  {
    key: 'readBytes',
    title: t('modules.clickhouse.monitor.colReadBytes'),
    width: 90,
    render: (row: SlowRow) => formatBytes(row.readBytes as number) as unknown as string,
  },
  {
    key: 'writtenRows',
    title: t('modules.clickhouse.monitor.colWrittenRows'),
    width: 90,
    render: (row: SlowRow) => formatCount(row.writtenRows as number) as unknown as string,
  },
  {
    key: 'writtenBytes',
    title: t('modules.clickhouse.monitor.colWrittenBytes'),
    width: 90,
    render: (row: SlowRow) => formatBytes(row.writtenBytes as number) as unknown as string,
  },
  {
    key: 'memoryUsage',
    title: t('modules.clickhouse.monitor.colMemory'),
    width: 90,
    render: (row: SlowRow) => formatBytes(row.memoryUsage as number) as unknown as string,
  },
  {
    key: 'peakMemoryUsage',
    title: t('modules.clickhouse.monitor.colPeakMemory'),
    width: 90,
    render: (row: SlowRow) => formatBytes(row.peakMemoryUsage as number) as unknown as string,
  },
  { key: 'type', title: t('modules.clickhouse.monitor.colType'), width: 120, ellipsis: true },
  { key: 'query', title: t('modules.clickhouse.monitor.colQuery'), minWidth: 180, ellipsis: true },
])

const slowRows = computed<SlowRow[]>(() =>
  slowQueries.value.map((q) => ({
    __rowKey: `${q.queryId}-${q.eventTime}`,
    queryId: q.queryId,
    startTime: q.startTime ?? '',
    endTime: q.eventTime,
    eventTime: q.eventTime,
    user: q.user,
    durationMs: q.durationMs,
    readRows: q.readRows,
    readBytes: q.readBytes,
    writtenRows: q.writtenRows,
    writtenBytes: q.writtenBytes,
    memoryUsage: q.memoryUsage,
    peakMemoryUsage: q.peakMemoryUsage,
    type: q.type,
    query: q.query ?? '',
  })),
)

const slowDetailRows = computed(() => {
  const q = slowDetail.value
  if (!q) return []
  return [
    { key: 'queryId', label: t('modules.clickhouse.monitor.colQueryId'), value: q.queryId },
    { key: 'startTime', label: t('modules.clickhouse.monitor.colStartTime'), value: q.startTime || '—' },
    { key: 'endTime', label: t('modules.clickhouse.monitor.colEndTime'), value: q.eventTime || '—' },
    { key: 'user', label: t('modules.clickhouse.monitor.colUser'), value: q.user || '—' },
    {
      key: 'duration',
      label: t('modules.clickhouse.monitor.colDuration'),
      value: formatDurationMs(q.durationMs),
    },
    { key: 'readRows', label: t('modules.clickhouse.monitor.colReadRows'), value: formatCount(q.readRows) },
    { key: 'readBytes', label: t('modules.clickhouse.monitor.colReadBytes'), value: formatBytes(q.readBytes) },
    {
      key: 'writtenRows',
      label: t('modules.clickhouse.monitor.colWrittenRows'),
      value: formatCount(q.writtenRows),
    },
    {
      key: 'writtenBytes',
      label: t('modules.clickhouse.monitor.colWrittenBytes'),
      value: formatBytes(q.writtenBytes),
    },
    { key: 'memory', label: t('modules.clickhouse.monitor.colMemory'), value: formatBytes(q.memoryUsage) },
    {
      key: 'peakMemory',
      label: t('modules.clickhouse.monitor.colPeakMemory'),
      value: formatBytes(q.peakMemoryUsage),
    },
    { key: 'type', label: t('modules.clickhouse.monitor.colType'), value: q.type || '—' },
    {
      key: 'exception',
      label: t('modules.clickhouse.monitor.colException'),
      value: q.exception?.trim() || '—',
    },
    { key: 'query', label: t('modules.clickhouse.monitor.colQuery'), value: q.query?.trim() || '—' },
  ]
})

async function loadSlowQueries(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) slowBusy.value = true
  try {
    const result = await clickhouseApi.metaSlowQueries({
      sessionId: props.sessionId,
      windowMinutes: Number(slowWindowMinutes.value) || 60,
      minDurationMs: Number(slowMinDurationMs.value) || 1000,
      limit: 50,
    })
    slowQueries.value = result.queries ?? []
    slowTruncated.value = Boolean(result.truncated)
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) slowBusy.value = false
  }
}

function openSlowDetail(row: SlowRow): void {
  const q = slowQueries.value.find(
    (item) => item.queryId === row.queryId && item.eventTime === row.eventTime,
  )
  if (!q) return
  slowDetail.value = q
  slowDetailOpen.value = true
}

watch([slowWindowMinutes, slowMinDurationMs], () => {
  if (activeTab.value === 'slow' && props.active && props.sessionId) {
    void loadSlowQueries(false)
  }
})

async function loadCurrentTab(quiet = false): Promise<void> {
  switch (activeTab.value) {
    case 'instance':
      await loadOverview(quiet)
      break
    case 'processes':
      await loadProcesses(quiet)
      break
    case 'merges':
      await loadMerges(quiet)
      break
    case 'mutations':
      await loadMutations(quiet)
      break
    case 'replicas':
      await loadReplicas(quiet)
      break
    case 'parts':
      await loadParts(quiet)
      break
    case 'slow':
      await loadSlowQueries(quiet)
      break
    default:
      await loadClusters(quiet)
  }
}

function onRefresh(): void {
  void loadCurrentTab(false)
}

watch(
  () => [props.sessionId, props.active, activeTab.value] as const,
  () => {
    if (props.active && props.sessionId) void loadCurrentTab(false)
    setupTimer()
  },
  { immediate: true },
)

watch(autoRefreshSecs, () => setupTimer())

onBeforeUnmount(() => clearTimer())

const killDesc = computed(() => {
  const k = pendingKill.value
  if (!k) return ''
  const who = [k.user, k.host].filter(Boolean).join('@') || '—'
  return t('modules.clickhouse.monitor.killQueryDesc', { queryId: k.queryId, who })
})

function statTone(
  kind: 'memory' | 'disk' | 'parts' | 'delay' | 'readonly' | 'delayed',
): string | undefined {
  const o = overview.value
  if (!o) return undefined
  if (kind === 'memory' && memoryRatio.value != null && memoryRatio.value >= 0.85) {
    return 'nm-clickhouse-monitor__stat-value--warn'
  }
  if (kind === 'disk' && diskFreeRatio.value != null && diskFreeRatio.value <= DISK_LOW_RATIO) {
    return 'nm-clickhouse-monitor__stat-value--warn'
  }
  if (kind === 'parts' && (o.maxPartsInPartition ?? 0) >= PARTS_WARN) {
    return 'nm-clickhouse-monitor__stat-value--warn'
  }
  if (kind === 'delay' && (o.maxReplicaDelaySecs ?? 0) >= REPLICA_DELAY_WARN) {
    return 'nm-clickhouse-monitor__stat-value--warn'
  }
  if (kind === 'readonly' && ((o.readonlyReplicaTables ?? 0) > 0 || (o.readonlyReplicaMetric ?? 0) > 0)) {
    return 'nm-clickhouse-monitor__stat-value--warn'
  }
  if (kind === 'delayed' && (o.delayedInserts ?? 0) > 0) {
    return 'nm-clickhouse-monitor__stat-value--warn'
  }
  return undefined
}
</script>

<template>
  <div ref="dialogHostEl" class="nm-clickhouse-monitor">
    <header class="nm-clickhouse-monitor__header">
      <div class="nm-clickhouse-monitor__tabs">
        <button
          v-for="tab in monitorTabs"
          :key="tab.id"
          type="button"
          class="nm-clickhouse-monitor__tab"
          :class="{ 'nm-clickhouse-monitor__tab--active': activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="nm-clickhouse-monitor__actions">
        <template v-if="activeTab === 'processes' && selectedProcess">
          <span class="nm-clickhouse-monitor__selected">{{ selectedProcess.queryId }}</span>
          <RsButton size="sm" variant="danger" @click="requestKill(selectedProcess)">
            {{ t('modules.clickhouse.monitor.killQuery') }}
          </RsButton>
        </template>
        <RsSelect
          v-model="autoRefreshSecs"
          :options="autoRefreshOptions"
          size="sm"
          class="nm-clickhouse-monitor__refresh-select"
        />
        <RsButton size="sm" variant="ghost" :disabled="!scopeOk" @click="onRefresh">
          {{ t('modules.clickhouse.monitor.refresh') }}
        </RsButton>
      </div>
    </header>

    <div v-if="!scopeOk" class="nm-clickhouse-monitor__body nm-clickhouse-monitor__body--center">
      <RsEmpty :description="t('modules.clickhouse.monitor.needSession')" />
    </div>

    <!-- Instance -->
    <div v-else-if="activeTab === 'instance'" class="nm-clickhouse-monitor__body nm-clickhouse-monitor__body--scroll">
      <RsLoading v-if="overviewBusy && !overview" class="nm-clickhouse-monitor__loading" />
      <RsEmpty
        v-else-if="!overview"
        :description="t('modules.clickhouse.monitor.instanceEmpty')"
      />
      <div v-else class="nm-clickhouse-monitor__overview">
        <div v-if="overview.partial" class="nm-clickhouse-monitor__banner nm-clickhouse-monitor__banner--flush">
          {{ t('modules.clickhouse.monitor.instancePartial') }}
          <span v-if="overview.warnings?.length"> — {{ overview.warnings.join('; ') }}</span>
        </div>

        <section class="nm-clickhouse-monitor__identity">
          <div class="nm-clickhouse-monitor__identity-main">
            <div class="nm-clickhouse-monitor__identity-icon" aria-hidden="true">
              <RsIcon name="clickhouse" :size="18" />
            </div>
            <div class="nm-clickhouse-monitor__identity-text">
              <div class="nm-clickhouse-monitor__identity-host">
                {{ overview.hostName || overview.serverAddr || '—' }}
              </div>
              <div class="nm-clickhouse-monitor__identity-version">
                ClickHouse {{ overview.version || '—' }}
              </div>
            </div>
          </div>
          <div class="nm-clickhouse-monitor__identity-meta">
            <div class="nm-clickhouse-monitor__chip">
              <span class="nm-clickhouse-monitor__chip-label">{{ t('modules.clickhouse.monitor.instanceUptime') }}</span>
              <span class="nm-clickhouse-monitor__chip-value">{{ formatUptime(overview.uptimeSeconds) }}</span>
            </div>
            <div v-if="overview.currentUser" class="nm-clickhouse-monitor__chip">
              <span class="nm-clickhouse-monitor__chip-label">{{ t('modules.clickhouse.monitor.instanceUser') }}</span>
              <span class="nm-clickhouse-monitor__chip-value">{{ overview.currentUser }}</span>
            </div>
            <div v-if="overview.currentDatabase" class="nm-clickhouse-monitor__chip">
              <span class="nm-clickhouse-monitor__chip-label">{{ t('modules.clickhouse.monitor.instanceDatabase') }}</span>
              <span class="nm-clickhouse-monitor__chip-value">{{ overview.currentDatabase }}</span>
            </div>
          </div>
        </section>

        <div
          class="nm-clickhouse-monitor__health"
          :class="
            healthAlerts.length
              ? 'nm-clickhouse-monitor__health--issues'
              : 'nm-clickhouse-monitor__health--ok'
          "
        >
          <RsIcon
            :name="healthAlerts.length ? 'alert-triangle' : 'check-circle-2'"
            :size="14"
            class="nm-clickhouse-monitor__health-icon"
          />
          <div class="nm-clickhouse-monitor__health-body">
            <span class="nm-clickhouse-monitor__health-title">
              {{
                healthAlerts.length
                  ? t('modules.clickhouse.monitor.healthIssues', { n: healthAlerts.length })
                  : t('modules.clickhouse.monitor.healthOk')
              }}
            </span>
            <span v-if="!healthAlerts.length" class="nm-clickhouse-monitor__health-sub">
              {{ t('modules.clickhouse.monitor.healthNoIssue') }}
            </span>
            <ul v-else class="nm-clickhouse-monitor__health-list">
              <li
                v-for="(alert, idx) in healthAlerts"
                :key="idx"
                class="nm-clickhouse-monitor__health-item"
                :class="[
                  `nm-clickhouse-monitor__health-item--${alert.level}`,
                  alert.tab ? 'nm-clickhouse-monitor__health-item--link' : undefined,
                ]"
              >
                <button
                  v-if="alert.tab"
                  type="button"
                  class="nm-clickhouse-monitor__health-link"
                  @click="goToTab(alert.tab)"
                >
                  {{ alert.text }}
                  <span class="nm-clickhouse-monitor__health-link-hint">
                    → {{ t(`modules.clickhouse.monitor.tab${alert.tab.charAt(0).toUpperCase()}${alert.tab.slice(1)}`) }}
                  </span>
                </button>
                <template v-else>{{ alert.text }}</template>
              </li>
            </ul>
          </div>
        </div>

        <section class="nm-clickhouse-monitor__gauges">
          <div class="nm-clickhouse-monitor__gauge">
            <div class="nm-clickhouse-monitor__gauge-head">
              <span class="nm-clickhouse-monitor__gauge-label">
                {{ t('modules.clickhouse.monitor.instanceMemory') }}
              </span>
              <span class="nm-clickhouse-monitor__gauge-value" :class="statTone('memory')">
                {{ formatBytes(overview.memoryTracking) }}
                <template v-if="overview.maxServerMemoryBytes || overview.osMemoryTotalBytes">
                  / {{ formatBytes(overview.maxServerMemoryBytes || overview.osMemoryTotalBytes) }}
                  · {{ formatPercent(memoryRatio) }}
                </template>
              </span>
            </div>
            <div class="nm-clickhouse-monitor__gauge-track">
              <div
                class="nm-clickhouse-monitor__gauge-fill"
                :class="gaugeTone(memoryRatio, 'used')"
                :style="{ width: gaugeWidth(memoryRatio) }"
              />
            </div>
          </div>
          <div class="nm-clickhouse-monitor__gauge">
            <div class="nm-clickhouse-monitor__gauge-head">
              <span class="nm-clickhouse-monitor__gauge-label">
                {{ t('modules.clickhouse.monitor.instanceDisk') }}
              </span>
              <span class="nm-clickhouse-monitor__gauge-value" :class="statTone('disk')">
                {{ formatBytes(overview.diskUsedBytes) }}
                <template v-if="overview.diskTotalBytes != null">
                  / {{ formatBytes(overview.diskTotalBytes) }}
                  · {{ t('modules.clickhouse.monitor.diskFree') }}
                  {{ formatBytes(overview.diskFreeBytes) }} ({{ formatPercent(diskFreeRatio) }})
                </template>
              </span>
            </div>
            <div class="nm-clickhouse-monitor__gauge-track">
              <div
                class="nm-clickhouse-monitor__gauge-fill"
                :class="gaugeTone(diskUsedRatio, 'used')"
                :style="{ width: gaugeWidth(diskUsedRatio) }"
              />
            </div>
          </div>
        </section>

        <section class="nm-clickhouse-monitor__block">
          <h3 class="nm-clickhouse-monitor__section-title">
            {{ t('modules.clickhouse.monitor.sectionHealth') }}
          </h3>
          <div class="nm-clickhouse-monitor__kpi-grid">
            <div class="nm-clickhouse-monitor__kpi">
              <span class="nm-clickhouse-monitor__kpi-label">{{ t('modules.clickhouse.monitor.instanceQueries') }}</span>
              <span class="nm-clickhouse-monitor__kpi-value">{{ formatCount(overview.queryMetric) }}</span>
            </div>
            <div class="nm-clickhouse-monitor__kpi">
              <span class="nm-clickhouse-monitor__kpi-label">{{ t('modules.clickhouse.monitor.instanceMerges') }}</span>
              <span class="nm-clickhouse-monitor__kpi-value">
                {{ formatCount(overview.mergeMetric ?? overview.runningMerges) }}
              </span>
            </div>
            <div class="nm-clickhouse-monitor__kpi">
              <span class="nm-clickhouse-monitor__kpi-label">{{ t('modules.clickhouse.monitor.instanceMutations') }}</span>
              <span class="nm-clickhouse-monitor__kpi-value">{{ formatCount(overview.partMutationMetric) }}</span>
            </div>
            <div class="nm-clickhouse-monitor__kpi">
              <span class="nm-clickhouse-monitor__kpi-label">{{ t('modules.clickhouse.monitor.instanceDelayedInserts') }}</span>
              <span class="nm-clickhouse-monitor__kpi-value" :class="statTone('delayed')">
                {{ formatCount(overview.delayedInserts) }}
              </span>
            </div>
            <div class="nm-clickhouse-monitor__kpi">
              <span class="nm-clickhouse-monitor__kpi-label">{{ t('modules.clickhouse.monitor.instanceActiveParts') }}</span>
              <span class="nm-clickhouse-monitor__kpi-value">{{ formatCount(overview.activeParts) }}</span>
            </div>
            <div class="nm-clickhouse-monitor__kpi">
              <span class="nm-clickhouse-monitor__kpi-label">{{ t('modules.clickhouse.monitor.instanceMaxParts') }}</span>
              <span class="nm-clickhouse-monitor__kpi-value" :class="statTone('parts')">
                {{ formatCount(overview.maxPartsInPartition) }}
              </span>
            </div>
            <div class="nm-clickhouse-monitor__kpi">
              <RsTooltip
                icon
                :content="t('modules.clickhouse.monitor.instanceMergeTreeBytesTip')"
                side="top"
              >
                <span class="nm-clickhouse-monitor__kpi-label">
                  {{ t('modules.clickhouse.monitor.instanceMergeTreeBytes') }}
                </span>
              </RsTooltip>
              <span class="nm-clickhouse-monitor__kpi-value">{{ formatBytes(overview.mergeTreeBytes) }}</span>
            </div>
            <div class="nm-clickhouse-monitor__kpi">
              <span class="nm-clickhouse-monitor__kpi-label">{{ t('modules.clickhouse.monitor.instanceReplicaTables') }}</span>
              <span class="nm-clickhouse-monitor__kpi-value">{{ formatCount(overview.replicaTableCount) }}</span>
            </div>
            <div class="nm-clickhouse-monitor__kpi">
              <span class="nm-clickhouse-monitor__kpi-label">{{ t('modules.clickhouse.monitor.instanceReadonlyReplicas') }}</span>
              <span class="nm-clickhouse-monitor__kpi-value" :class="statTone('readonly')">
                {{ formatCount(overview.readonlyReplicaTables ?? overview.readonlyReplicaMetric) }}
              </span>
            </div>
            <div class="nm-clickhouse-monitor__kpi">
              <span class="nm-clickhouse-monitor__kpi-label">{{ t('modules.clickhouse.monitor.instanceMaxReplicaDelay') }}</span>
              <span class="nm-clickhouse-monitor__kpi-value" :class="statTone('delay')">
                {{ overview.maxReplicaDelaySecs != null ? formatElapsed(overview.maxReplicaDelaySecs) : '—' }}
              </span>
            </div>
          </div>
        </section>

        <section class="nm-clickhouse-monitor__block">
          <h3 class="nm-clickhouse-monitor__section-title">
            {{ t('modules.clickhouse.monitor.sectionTrends') }}
            <span class="nm-clickhouse-monitor__section-hint">{{ t('modules.clickhouse.monitor.trendsHint') }}</span>
          </h3>
          <div v-if="sampleError" class="nm-clickhouse-monitor__banner">{{ sampleError }}</div>
          <div v-else-if="sampleCount < 2" class="nm-clickhouse-monitor__trends-waiting">
            {{ t('modules.clickhouse.monitor.trendsWaiting') }}
          </div>
          <div v-else class="nm-clickhouse-monitor__trends-grid">
            <MonitorSparkline
              :label="t('modules.clickhouse.monitor.trendMemory')"
              :values="trendSeries.memory"
              :timestamps="trendTimestamps"
              :format-value="formatBytes"
            />
            <MonitorSparkline
              :label="t('modules.clickhouse.monitor.trendQuery')"
              :values="trendSeries.query"
              :timestamps="trendTimestamps"
              :format-value="formatCount"
            />
            <MonitorSparkline
              :label="t('modules.clickhouse.monitor.trendMerge')"
              :values="trendSeries.merge"
              :timestamps="trendTimestamps"
              :format-value="formatCount"
            />
            <MonitorSparkline
              :label="t('modules.clickhouse.monitor.trendDelayed')"
              :values="trendSeries.delayed"
              :timestamps="trendTimestamps"
              :format-value="formatCount"
            />
            <MonitorSparkline
              :label="t('modules.clickhouse.monitor.trendProcesses')"
              :values="trendSeries.processes"
              :timestamps="trendTimestamps"
              :format-value="formatCount"
            />
            <MonitorSparkline
              :label="t('modules.clickhouse.monitor.trendMaxParts')"
              :values="trendSeries.maxParts"
              :timestamps="trendTimestamps"
              :format-value="formatCount"
            />
            <MonitorSparkline
              :label="t('modules.clickhouse.monitor.trendReplicaDelay')"
              :values="trendSeries.replicaDelay"
              :timestamps="trendTimestamps"
              :format-value="(n) => formatElapsed(n)"
            />
          </div>
        </section>

        <section v-if="hasHeavyOps" class="nm-clickhouse-monitor__block">
          <div class="nm-clickhouse-monitor__section-head">
            <h3 class="nm-clickhouse-monitor__section-title">
              {{ t('modules.clickhouse.monitor.sectionHeavy') }}
            </h3>
            <button type="button" class="nm-clickhouse-monitor__section-link" @click="goToTab('processes')">
              {{ t('modules.clickhouse.monitor.viewAllProcesses') }}
            </button>
          </div>
          <div class="nm-clickhouse-monitor__heavy">
            <div v-if="topByElapsed.length" class="nm-clickhouse-monitor__heavy-col">
              <div class="nm-clickhouse-monitor__heavy-title">
                {{ t('modules.clickhouse.monitor.heavyByElapsed') }}
              </div>
              <button
                v-for="p in topByElapsed"
                :key="`elapsed-${p.queryId}`"
                type="button"
                class="nm-clickhouse-monitor__heavy-row"
                @click="openTopProcess(p)"
              >
                <span class="nm-clickhouse-monitor__heavy-metric" :class="{ 'nm-clickhouse-monitor__time--long': isLongRunning(p.elapsed) }">
                  {{ formatElapsed(p.elapsed) }}
                </span>
                <span class="nm-clickhouse-monitor__heavy-meta">
                  {{ formatBytes(p.readBytes) }} · {{ formatBytes(p.peakMemoryUsage ?? p.memoryUsage) }}
                </span>
                <span class="nm-clickhouse-monitor__heavy-query" :title="p.query ?? ''">
                  {{ truncateQuery(p.query) }}
                </span>
              </button>
            </div>
            <div v-if="topByMemory.length" class="nm-clickhouse-monitor__heavy-col">
              <div class="nm-clickhouse-monitor__heavy-title">
                {{ t('modules.clickhouse.monitor.heavyByMemory') }}
              </div>
              <button
                v-for="p in topByMemory"
                :key="`mem-${p.queryId}`"
                type="button"
                class="nm-clickhouse-monitor__heavy-row"
                @click="openTopProcess(p)"
              >
                <span class="nm-clickhouse-monitor__heavy-metric">
                  {{ formatBytes(p.peakMemoryUsage ?? p.memoryUsage) }}
                </span>
                <span class="nm-clickhouse-monitor__heavy-meta">
                  {{ formatElapsed(p.elapsed) }} · {{ formatBytes(p.readBytes) }}
                </span>
                <span class="nm-clickhouse-monitor__heavy-query" :title="p.query ?? ''">
                  {{ truncateQuery(p.query) }}
                </span>
              </button>
            </div>
            <div v-if="topMergesByElapsed.length" class="nm-clickhouse-monitor__heavy-col">
              <div class="nm-clickhouse-monitor__heavy-title">
                {{ t('modules.clickhouse.monitor.heavyMerges') }}
              </div>
              <button
                v-for="(m, i) in topMergesByElapsed"
                :key="`merge-${m.database}.${m.table}-${i}`"
                type="button"
                class="nm-clickhouse-monitor__heavy-row"
                @click="goToTab('merges')"
              >
                <span class="nm-clickhouse-monitor__heavy-metric">{{ formatElapsed(m.elapsed) }}</span>
                <span class="nm-clickhouse-monitor__heavy-meta">
                  {{ m.isMutation ? t('modules.clickhouse.monitor.mergeKindMutation') : t('modules.clickhouse.monitor.mergeKindMerge') }}
                  · {{ formatProgress(m.progress) }}
                </span>
                <span class="nm-clickhouse-monitor__heavy-query">
                  {{ m.database }}.{{ m.table }}
                </span>
              </button>
            </div>
          </div>
        </section>

        <section class="nm-clickhouse-monitor__block">
          <h3 class="nm-clickhouse-monitor__section-title">
            {{ t('modules.clickhouse.monitor.sectionInventory') }}
          </h3>
          <div class="nm-clickhouse-monitor__inventory">
            <div class="nm-clickhouse-monitor__inv-item">
              <span class="nm-clickhouse-monitor__inv-value nm-clickhouse-monitor__stat-value--accent">
                {{ overview.databaseCount ?? '—' }}
              </span>
              <span class="nm-clickhouse-monitor__inv-label">{{ t('modules.clickhouse.monitor.instanceDatabases') }}</span>
            </div>
            <div class="nm-clickhouse-monitor__inv-item">
              <span class="nm-clickhouse-monitor__inv-value">{{ overview.tableCount ?? '—' }}</span>
              <span class="nm-clickhouse-monitor__inv-label">{{ t('modules.clickhouse.monitor.instanceTables') }}</span>
            </div>
            <div class="nm-clickhouse-monitor__inv-item">
              <span class="nm-clickhouse-monitor__inv-value">{{ overview.dictionaryCount ?? '—' }}</span>
              <span class="nm-clickhouse-monitor__inv-label">{{ t('modules.clickhouse.monitor.instanceDictionaries') }}</span>
            </div>
            <div class="nm-clickhouse-monitor__inv-item">
              <span class="nm-clickhouse-monitor__inv-value">{{ overview.processCount ?? '—' }}</span>
              <span class="nm-clickhouse-monitor__inv-label">{{ t('modules.clickhouse.monitor.instanceProcesses') }}</span>
            </div>
            <div class="nm-clickhouse-monitor__inv-item">
              <span class="nm-clickhouse-monitor__inv-value">{{ overview.clusterCount ?? '—' }}</span>
              <span class="nm-clickhouse-monitor__inv-label">{{ t('modules.clickhouse.monitor.instanceClusters') }}</span>
            </div>
          </div>
        </section>

        <section v-if="diskRows.length" class="nm-clickhouse-monitor__block nm-clickhouse-monitor__block--table">
          <h3 class="nm-clickhouse-monitor__section-title">
            {{ t('modules.clickhouse.monitor.sectionDisks') }}
          </h3>
          <RsTable :columns="diskColumns" :data="diskRows" row-key="__rowKey" size="sm" />
        </section>
      </div>
    </div>

    <!-- Processes -->
    <div v-else-if="activeTab === 'processes'" class="nm-clickhouse-monitor__body">
      <div class="nm-clickhouse-monitor__filters">
        <RsSelect v-model="processFilter" :options="processFilterOptions" size="sm" />
        <RsInput
          v-model="processQuery"
          size="sm"
          :placeholder="t('modules.clickhouse.monitor.filterPlaceholder')"
          clearable
        />
      </div>
      <RsLoading v-if="processesBusy" class="nm-clickhouse-monitor__loading" />
      <RsEmpty
        v-else-if="!processRows.length"
        :description="
          processes.length
            ? t('modules.clickhouse.monitor.filterEmpty')
            : t('modules.clickhouse.monitor.empty')
        "
      />
      <RsTable
        v-else
        class="nm-clickhouse-monitor__table"
        :columns="processColumns"
        :data="processRows"
        row-key="__rowKey"
        size="sm"
        :highlighted-row-key="highlightedRowKey"
        :context-menu-items="processContextMenuItems"
        @row-click="(row: ProcessRow) => (highlightedRowKey = row.__rowKey)"
        @row-dblclick="(row: ProcessRow) => {
          const p = processes.find((item) => item.queryId === row.queryId)
          if (p) openDetail(p)
        }"
        @context-menu-select="onProcessContextSelect"
      />
    </div>

    <!-- Merges -->
    <div v-else-if="activeTab === 'merges'" class="nm-clickhouse-monitor__body">
      <RsLoading v-if="mergesBusy" class="nm-clickhouse-monitor__loading" />
      <RsEmpty
        v-else-if="!mergeRows.length"
        :description="t('modules.clickhouse.monitor.mergesEmpty')"
      />
      <RsTable
        v-else
        class="nm-clickhouse-monitor__table"
        :columns="mergeColumns"
        :data="mergeRows"
        row-key="__rowKey"
        size="sm"
      />
    </div>

    <!-- Mutations -->
    <div v-else-if="activeTab === 'mutations'" class="nm-clickhouse-monitor__body">
      <div class="nm-clickhouse-monitor__banner nm-clickhouse-monitor__banner--info nm-clickhouse-monitor__banner--bar">
        {{ t('modules.clickhouse.monitor.mutationsHint') }}
      </div>
      <RsLoading v-if="mutationsBusy" class="nm-clickhouse-monitor__loading" />
      <RsEmpty
        v-else-if="!mutationRows.length"
        :description="t('modules.clickhouse.monitor.mutationsEmpty')"
      />
      <RsTable
        v-else
        class="nm-clickhouse-monitor__table"
        :columns="mutationColumns"
        :data="mutationRows"
        row-key="__rowKey"
        size="sm"
      />
    </div>

    <!-- Replicas -->
    <div v-else-if="activeTab === 'replicas'" class="nm-clickhouse-monitor__body">
      <RsLoading v-if="replicasBusy" class="nm-clickhouse-monitor__loading" />
      <RsEmpty
        v-else-if="!replicaRows.length"
        :description="t('modules.clickhouse.monitor.replicasEmpty')"
      />
      <RsTable
        v-else
        class="nm-clickhouse-monitor__table"
        :columns="replicaColumns"
        :data="replicaRows"
        row-key="__rowKey"
        size="sm"
      />
    </div>

    <!-- Parts -->
    <div v-else-if="activeTab === 'parts'" class="nm-clickhouse-monitor__body">
      <div class="nm-clickhouse-monitor__banner nm-clickhouse-monitor__banner--info nm-clickhouse-monitor__banner--bar">
        {{ t('modules.clickhouse.monitor.partsCostHint') }}
      </div>
      <div
        v-if="partsPartial"
        class="nm-clickhouse-monitor__banner nm-clickhouse-monitor__banner--bar"
      >
        {{ t('modules.clickhouse.monitor.partsPartial') }}
        <span v-if="partsWarnings.length"> — {{ partsWarnings.join('; ') }}</span>
      </div>
      <RsLoading v-if="partsBusy" class="nm-clickhouse-monitor__loading" />
      <RsEmpty
        v-else-if="!partsRows.length"
        :description="t('modules.clickhouse.monitor.partsEmpty')"
      />
      <RsTable
        v-else
        class="nm-clickhouse-monitor__table"
        :columns="partsColumns"
        :data="partsRows"
        row-key="__rowKey"
        size="sm"
      />
    </div>

    <!-- Slow queries -->
    <div v-else-if="activeTab === 'slow'" class="nm-clickhouse-monitor__body">
      <div class="nm-clickhouse-monitor__banner nm-clickhouse-monitor__banner--info nm-clickhouse-monitor__banner--bar">
        {{ t('modules.clickhouse.monitor.slowCostHint') }}
      </div>
      <div class="nm-clickhouse-monitor__filters">
        <RsSelect v-model="slowWindowMinutes" :options="slowWindowOptions" size="sm" />
        <RsSelect v-model="slowMinDurationMs" :options="slowMinOptions" size="sm" />
      </div>
      <div v-if="slowTruncated" class="nm-clickhouse-monitor__banner nm-clickhouse-monitor__banner--bar">
        {{ t('modules.clickhouse.monitor.slowTruncated', { n: 50 }) }}
      </div>
      <RsLoading v-if="slowBusy" class="nm-clickhouse-monitor__loading" />
      <RsEmpty
        v-else-if="!slowRows.length"
        :description="t('modules.clickhouse.monitor.slowEmpty')"
      />
      <RsTable
        v-else
        class="nm-clickhouse-monitor__table"
        :columns="slowColumns"
        :data="slowRows"
        row-key="__rowKey"
        size="sm"
        @row-dblclick="(row: SlowRow) => openSlowDetail(row)"
      />
    </div>

    <!-- Clusters -->
    <div v-else class="nm-clickhouse-monitor__body">
      <RsLoading v-if="clustersBusy" class="nm-clickhouse-monitor__loading" />
      <RsEmpty
        v-else-if="!clusterRows.length"
        :description="t('modules.clickhouse.monitor.clustersEmpty')"
      />
      <RsTable
        v-else
        class="nm-clickhouse-monitor__table"
        :columns="clusterColumns"
        :data="clusterRows"
        row-key="__rowKey"
        size="sm"
      />
    </div>

    <RsDialog
      v-if="dialogTeleportReady"
      v-model:open="detailOpen"
      :title="t('modules.clickhouse.monitor.sessionDetailTitle')"
      width="md"
      :teleport-to="dialogHostEl!"
    >
      <template #body>
        <dl v-if="detailProcess" class="nm-clickhouse-monitor__detail">
          <div v-for="item in detailRows" :key="item.key" class="nm-clickhouse-monitor__detail-row">
            <dt>{{ item.label }}</dt>
            <dd :class="{ 'nm-clickhouse-monitor__detail-query': item.key === 'query' }">
              {{ item.value }}
            </dd>
          </div>
        </dl>
        <RsEmpty v-else :description="t('modules.clickhouse.monitor.sessionNotFound')" />
      </template>
      <template #footer>
        <RsButton
          size="sm"
          variant="danger"
          :disabled="killBusy || !detailProcess"
          @click="detailProcess && requestKill(detailProcess)"
        >
          {{ t('modules.clickhouse.monitor.killQuery') }}
        </RsButton>
      </template>
    </RsDialog>

    <RsConfirmDialog
      v-if="dialogTeleportReady"
      v-model:open="confirmOpen"
      tone="danger"
      :title="t('modules.clickhouse.monitor.killQueryTitle')"
      :description="killDesc"
      :confirm-text="t('modules.clickhouse.monitor.killConfirm')"
      :loading="killBusy"
      :teleport-to="dialogHostEl!"
      @confirm="confirmKill"
    />

    <RsDialog
      v-if="dialogTeleportReady"
      v-model:open="slowDetailOpen"
      :title="t('modules.clickhouse.monitor.sessionDetailTitle')"
      width="md"
      :teleport-to="dialogHostEl!"
    >
      <template #body>
        <dl v-if="slowDetail" class="nm-clickhouse-monitor__detail">
          <div v-for="item in slowDetailRows" :key="item.key" class="nm-clickhouse-monitor__detail-row">
            <dt>{{ item.label }}</dt>
            <dd
              :class="{
                'nm-clickhouse-monitor__detail-query': item.key === 'query' || item.key === 'exception',
              }"
            >
              {{ item.value }}
            </dd>
          </div>
        </dl>
        <RsEmpty v-else :description="t('modules.clickhouse.monitor.sessionNotFound')" />
      </template>
    </RsDialog>
  </div>
</template>

<style scoped>
.nm-clickhouse-monitor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface, var(--rs-bg));
}
.nm-clickhouse-monitor__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.nm-clickhouse-monitor__tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
}
.nm-clickhouse-monitor__tab {
  border: 1px solid transparent;
  background: transparent;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
  color: var(--rs-fg-muted);
  border-radius: var(--rs-radius-sm);
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.nm-clickhouse-monitor__tab:hover {
  background: var(--rs-bg-elevated, var(--rs-bg-muted));
  color: var(--rs-fg);
}
.nm-clickhouse-monitor__tab--active {
  color: var(--rs-accent, #2563eb);
  background: var(--rs-accent-subtle, color-mix(in srgb, var(--rs-accent, #2563eb) 12%, transparent));
  border-color: var(--rs-accent-border, color-mix(in srgb, var(--rs-accent, #2563eb) 28%, transparent));
  font-weight: 500;
}
.nm-clickhouse-monitor__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}
.nm-clickhouse-monitor__selected {
  font-size: 12px;
  color: var(--rs-fg-muted);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.nm-clickhouse-monitor__refresh-select {
  width: 110px;
}
.nm-clickhouse-monitor__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
  gap: 0;
  overflow: hidden;
}
.nm-clickhouse-monitor__body--scroll {
  overflow: auto;
}
.nm-clickhouse-monitor__body--center {
  align-items: center;
  justify-content: center;
}
.nm-clickhouse-monitor__filters {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--rs-border-subtle);
}
.nm-clickhouse-monitor__table {
  flex: 1;
  min-height: 0;
}
.nm-clickhouse-monitor__loading {
  margin: auto;
}
.nm-clickhouse-monitor__time--long,
.nm-clickhouse-monitor__warn,
.nm-clickhouse-monitor__stat-value--warn {
  color: var(--rs-danger, #dc2626);
  font-weight: 600;
}
.nm-clickhouse-monitor__overview {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.nm-clickhouse-monitor__banner {
  font-size: 12px;
  color: var(--rs-warning, #b45309);
  background: color-mix(in srgb, var(--rs-warning, #d97706) 10%, transparent);
  padding: 6px 10px;
}
.nm-clickhouse-monitor__banner--flush {
  border-bottom: 1px solid var(--rs-border-subtle);
}
.nm-clickhouse-monitor__banner--bar {
  flex-shrink: 0;
  border-radius: 0;
  border-bottom: 1px solid var(--rs-border-subtle);
}
.nm-clickhouse-monitor__banner--info {
  color: var(--rs-fg-muted);
  background: var(--rs-bg-muted);
}
.nm-clickhouse-monitor__identity {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--rs-border-subtle);
  background:
    linear-gradient(
      120deg,
      color-mix(in srgb, var(--rs-accent, #2563eb) 8%, transparent) 0%,
      transparent 55%
    ),
    var(--rs-surface, var(--rs-bg));
}
.nm-clickhouse-monitor__identity-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.nm-clickhouse-monitor__identity-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--rs-radius-md, 6px);
  color: var(--rs-accent, #2563eb);
  background: color-mix(in srgb, var(--rs-accent, #2563eb) 14%, transparent);
  flex-shrink: 0;
}
.nm-clickhouse-monitor__identity-text {
  min-width: 0;
}
.nm-clickhouse-monitor__identity-host {
  font-size: 16px;
  font-weight: 650;
  line-height: 1.25;
  color: var(--rs-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nm-clickhouse-monitor__identity-version {
  margin-top: 2px;
  font-size: 12px;
  color: var(--rs-fg-muted);
  font-variant-numeric: tabular-nums;
}
.nm-clickhouse-monitor__identity-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.nm-clickhouse-monitor__chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 88px;
  padding: 6px 10px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, var(--rs-surface, var(--rs-bg)) 80%, transparent);
}
.nm-clickhouse-monitor__chip-label {
  font-size: 10px;
  color: var(--rs-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.nm-clickhouse-monitor__chip-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--rs-fg);
  font-variant-numeric: tabular-nums;
}
.nm-clickhouse-monitor__health {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--rs-border-subtle);
}
.nm-clickhouse-monitor__health--ok {
  background: color-mix(in srgb, var(--rs-success, #16a34a) 8%, transparent);
}
.nm-clickhouse-monitor__health--issues {
  background: color-mix(in srgb, var(--rs-warning, #d97706) 10%, transparent);
}
.nm-clickhouse-monitor__health-icon {
  margin-top: 1px;
  flex-shrink: 0;
}
.nm-clickhouse-monitor__health--ok .nm-clickhouse-monitor__health-icon {
  color: var(--rs-success, #16a34a);
}
.nm-clickhouse-monitor__health--issues .nm-clickhouse-monitor__health-icon {
  color: var(--rs-warning, #d97706);
}
.nm-clickhouse-monitor__health-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.nm-clickhouse-monitor__health-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--rs-fg);
}
.nm-clickhouse-monitor__health-sub {
  font-size: 11px;
  color: var(--rs-fg-muted);
}
.nm-clickhouse-monitor__health-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nm-clickhouse-monitor__health-item {
  font-size: 11px;
  color: var(--rs-fg-muted);
}
.nm-clickhouse-monitor__health-item--warn {
  color: var(--rs-warning, #d97706);
}
.nm-clickhouse-monitor__health-item--critical {
  color: var(--rs-danger, #dc2626);
  font-weight: 600;
}
.nm-clickhouse-monitor__health-link {
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.nm-clickhouse-monitor__health-link:hover {
  text-decoration: underline;
}
.nm-clickhouse-monitor__health-link-hint {
  font-size: 10px;
  opacity: 0.75;
  font-weight: 500;
}
.nm-clickhouse-monitor__section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.nm-clickhouse-monitor__section-link {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 11px;
  color: var(--rs-accent, #2563eb);
  cursor: pointer;
}
.nm-clickhouse-monitor__section-link:hover {
  text-decoration: underline;
}
.nm-clickhouse-monitor__heavy {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  margin: 0 -14px -12px;
  border-top: 1px solid var(--rs-border-subtle);
}
@media (max-width: 960px) {
  .nm-clickhouse-monitor__heavy {
    grid-template-columns: 1fr;
  }
}
.nm-clickhouse-monitor__heavy-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 8px 10px 10px;
}
.nm-clickhouse-monitor__heavy-col + .nm-clickhouse-monitor__heavy-col {
  border-left: 1px solid var(--rs-border-subtle);
}
@media (max-width: 960px) {
  .nm-clickhouse-monitor__heavy-col + .nm-clickhouse-monitor__heavy-col {
    border-left: none;
    border-top: 1px solid var(--rs-border-subtle);
  }
}
.nm-clickhouse-monitor__heavy-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--rs-fg-muted);
  margin-bottom: 6px;
}
.nm-clickhouse-monitor__heavy-row {
  display: grid;
  grid-template-columns: 64px 1fr;
  grid-template-rows: auto auto;
  column-gap: 8px;
  row-gap: 1px;
  align-items: baseline;
  width: 100%;
  margin: 0;
  padding: 5px 4px;
  border: none;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.nm-clickhouse-monitor__heavy-row:hover {
  background: var(--rs-bg-elevated, var(--rs-bg-muted));
}
.nm-clickhouse-monitor__heavy-metric {
  grid-row: 1 / span 2;
  align-self: center;
  font-size: 12px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--rs-fg);
}
.nm-clickhouse-monitor__heavy-meta {
  font-size: 10px;
  color: var(--rs-fg-muted);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nm-clickhouse-monitor__heavy-query {
  font-size: 11px;
  color: var(--rs-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nm-clickhouse-monitor__gauges {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  border-bottom: 1px solid var(--rs-border-subtle);
}
@media (max-width: 720px) {
  .nm-clickhouse-monitor__gauges {
    grid-template-columns: 1fr;
  }
}
.nm-clickhouse-monitor__gauge {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
}
.nm-clickhouse-monitor__gauge + .nm-clickhouse-monitor__gauge {
  border-left: 1px solid var(--rs-border-subtle);
}
@media (max-width: 720px) {
  .nm-clickhouse-monitor__gauge + .nm-clickhouse-monitor__gauge {
    border-left: none;
    border-top: 1px solid var(--rs-border-subtle);
  }
}
.nm-clickhouse-monitor__gauge-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.nm-clickhouse-monitor__gauge-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--rs-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.nm-clickhouse-monitor__gauge-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--rs-fg);
  text-align: right;
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}
.nm-clickhouse-monitor__gauge-track {
  height: 6px;
  border-radius: 999px;
  background: var(--rs-bg-muted);
  overflow: hidden;
}
.nm-clickhouse-monitor__gauge-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--rs-accent, #2563eb);
  transition: width 0.25s ease;
}
.nm-clickhouse-monitor__gauge-fill--ok {
  background: var(--rs-success, #16a34a);
}
.nm-clickhouse-monitor__gauge-fill--warn {
  background: var(--rs-warning, #d97706);
}
.nm-clickhouse-monitor__gauge-fill--danger {
  background: var(--rs-danger, #dc2626);
}
.nm-clickhouse-monitor__block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--rs-border-subtle);
}
.nm-clickhouse-monitor__block--table {
  padding-bottom: 0;
}
.nm-clickhouse-monitor__section-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--rs-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}
.nm-clickhouse-monitor__section-hint {
  font-size: 11px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: var(--rs-fg-muted);
  opacity: 0.85;
}
.nm-clickhouse-monitor__kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}
.nm-clickhouse-monitor__kpi {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md, 6px);
  background: var(--rs-bg-elevated, var(--rs-bg-muted));
}
.nm-clickhouse-monitor__kpi-label {
  font-size: 11px;
  color: var(--rs-fg-muted);
}
.nm-clickhouse-monitor__kpi-value {
  font-size: 15px;
  font-weight: 650;
  color: var(--rs-fg);
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}
.nm-clickhouse-monitor__trends-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}
.nm-clickhouse-monitor__trends-waiting {
  font-size: 12px;
  color: var(--rs-fg-muted);
}
.nm-clickhouse-monitor__inventory {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
}
.nm-clickhouse-monitor__inv-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md, 6px);
  background: var(--rs-bg-elevated, var(--rs-bg-muted));
}
.nm-clickhouse-monitor__inv-value {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
  color: var(--rs-fg);
}
.nm-clickhouse-monitor__inv-label {
  font-size: 11px;
  color: var(--rs-fg-muted);
}
.nm-clickhouse-monitor__stat-value--accent {
  color: var(--rs-accent, var(--rs-fg));
}
.nm-clickhouse-monitor__detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}
.nm-clickhouse-monitor__detail-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.nm-clickhouse-monitor__detail-row dt {
  margin: 0;
  font-size: 12px;
  color: var(--rs-fg-muted);
}
.nm-clickhouse-monitor__detail-row dd {
  margin: 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.nm-clickhouse-monitor__detail-query {
  font-family: var(--rs-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  white-space: pre-wrap;
  max-height: 240px;
  overflow: auto;
}
</style>
