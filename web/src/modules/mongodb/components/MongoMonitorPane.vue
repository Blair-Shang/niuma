<script setup lang="ts">
import { RsButton, RsDialog, RsIcon, RsInput, RsLoading, RsStatCard, RsTable, RsTooltip, useRsToast } from '@niuma/ui'
import type { RsTableColumn } from '@niuma/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import type { MongoMonitorStatsResult, MongoProfilingStatus, MongoSlowLogEntry } from '@/api/types/mongodb'

const props = defineProps<{
  sessionId: string | null
  /** 当前 Tab 上下文中的数据库；未指定时由后端回退到会话默认库 */
  database?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

const stats = ref<MongoMonitorStatsResult | null>(null)
const currentOps = ref<unknown[]>([])
const initialLoading = ref(false)
const refreshing = ref(false)
const lastUpdated = ref<Date | null>(null)
const autoRefreshSecs = ref(5)
const showRaw = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const OPCOUNTER_KEYS = ['insert', 'query', 'update', 'delete', 'getmore', 'command'] as const
const DEFAULT_SLOW_OP_WARN_SECS = 1
const DEFAULT_SLOW_OP_DANGER_SECS = 10
const CONN_WARN_RATIO = 0.65
const CONN_DANGER_RATIO = 0.85
const OPS_RATE_WARN = 2000
const OPS_RATE_DANGER = 5000

type DurationTone = 'normal' | 'warn' | 'danger'
type HealthLevel = 'warn' | 'critical'

interface HealthAlert {
  level: HealthLevel
  text: string
}

interface OpcountersSnapshot {
  at: number
  values: Record<string, number>
}

const prevOpcountersSnap = ref<OpcountersSnapshot | null>(null)
const opRates = ref<Record<string, number> | null>(null)
const totalOpRate = ref<number | null>(null)

const slowLogCount = ref('20')
const slowLogLoading = ref(false)
const slowLogLoaded = ref(false)
const slowLogProfiling = ref<MongoProfilingStatus | null>(null)
const slowLogEntries = ref<MongoSlowLogEntry[]>([])
const profilerDraftEnabled = ref(false)
const profilerSlowMs = ref('100')
const profilerStatusLoading = ref(false)
const profilerSaving = ref(false)
const profilerStatusKnown = ref(false)
const slowOpWarnSecs = ref(String(DEFAULT_SLOW_OP_WARN_SECS))
const slowOpDangerSecs = ref(String(DEFAULT_SLOW_OP_DANGER_SECS))

// ── Utility helpers ──────────────────────────────────────────────────────────

function dig(obj: Record<string, unknown>, ...keys: string[]): unknown {
  let cur: unknown = obj
  for (const k of keys) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

function str(obj: Record<string, unknown>, ...keys: string[]): string {
  const v = dig(obj, ...keys)
  return v !== undefined && v !== null && String(v) !== '' ? String(v) : '—'
}

function num(obj: Record<string, unknown>, ...keys: string[]): number | null {
  const v = dig(obj, ...keys)
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const n = Number(v); return Number.isNaN(n) ? null : n }
  return null
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fmtMB(mb: number): string {
  return mb < 1024 ? `${mb} MB` : `${(mb / 1024).toFixed(2)} GB`
}

function loc(n: number | null): string {
  return n !== null ? n.toLocaleString() : '—'
}

function connectionAccent(cur: number | null, avail: number | null): OverviewCard['accent'] {
  if (cur === null || avail === null) return 'primary'
  const total = cur + avail
  if (total <= 0) return 'primary'
  const ratio = cur / total
  if (ratio >= CONN_DANGER_RATIO) return 'danger'
  if (ratio >= CONN_WARN_RATIO) return 'warning'
  return 'primary'
}

function parsePositiveNumber(raw: string, fallback: number): number {
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const slowOpWarnThreshold = computed(() => parsePositiveNumber(slowOpWarnSecs.value, DEFAULT_SLOW_OP_WARN_SECS))
const slowOpDangerThreshold = computed(() =>
  Math.max(parsePositiveNumber(slowOpDangerSecs.value, DEFAULT_SLOW_OP_DANGER_SECS), slowOpWarnThreshold.value),
)

function durationTone(secs: number | null, warnSecs = slowOpWarnThreshold.value, dangerSecs = slowOpDangerThreshold.value): DurationTone {
  if (secs === null) return 'normal'
  if (secs >= dangerSecs) return 'danger'
  if (secs >= warnSecs) return 'warn'
  return 'normal'
}

function updateOpRates(serverStatus: Record<string, unknown>): void {
  const now = Date.now()
  const values: Record<string, number> = {}
  for (const key of OPCOUNTER_KEYS) {
    values[key] = num(serverStatus, 'opcounters', key) ?? 0
  }
  const prev = prevOpcountersSnap.value
  prevOpcountersSnap.value = { at: now, values }
  if (!prev) {
    opRates.value = null
    totalOpRate.value = null
    return
  }
  const elapsedSec = (now - prev.at) / 1000
  if (elapsedSec < 0.5) return
  const rates: Record<string, number> = {}
  let total = 0
  for (const key of OPCOUNTER_KEYS) {
    const delta = Math.max(0, values[key] - prev.values[key])
    const rate = delta / elapsedSec
    rates[key] = rate
    total += rate
  }
  opRates.value = rates
  totalOpRate.value = total
}

function resetRateSnapshot(): void {
  prevOpcountersSnap.value = null
  opRates.value = null
  totalOpRate.value = null
}

function resetProfilerState(): void {
  slowLogProfiling.value = null
  profilerStatusKnown.value = false
  profilerDraftEnabled.value = false
  profilerSlowMs.value = '100'
}

function resetSlowLog(): void {
  slowLogLoaded.value = false
  slowLogEntries.value = []
  resetProfilerState()
}

function syncProfilerFromServer(p: MongoProfilingStatus): void {
  slowLogProfiling.value = p
  profilerStatusKnown.value = true
  profilerDraftEnabled.value = p.enabled
  profilerSlowMs.value = String(p.slowms > 0 ? p.slowms : 100)
}

function formatSlowLogDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${ms}ms`
}

function slowLogDurationTone(
  ms: number,
  warnMs = slowOpWarnThreshold.value * 1000,
  dangerMs = slowOpDangerThreshold.value * 1000,
): DurationTone {
  if (ms >= dangerMs) return 'danger'
  if (ms >= warnMs) return 'warn'
  return 'normal'
}

// ── Overview cards ────────────────────────────────────────────────────────────

interface OverviewCard {
  key: string
  label: string
  value: string
  sub?: string
  accent: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  tooltip: string
}

const overviewCards = computed((): OverviewCard[] => {
  const s = stats.value?.serverStatus
  if (!s) return []

  const connCur = num(s, 'connections', 'current')
  const connAvail = num(s, 'connections', 'available')
  const connCreated = num(s, 'connections', 'totalCreated')

  return [
    {
      key: 'version',
      label: t('modules.mongodb.monitor.version'),
      value: str(s, 'version'),
      sub: str(s, 'process') !== '—' ? str(s, 'process') : undefined,
      accent: 'info',
      tooltip: t('modules.mongodb.monitor.tooltipVersion'),
    },
    {
      key: 'uptime',
      label: t('modules.mongodb.monitor.uptime'),
      value: (() => { const u = num(s, 'uptime'); return u !== null ? fmtUptime(u) : '—' })(),
      sub: str(s, 'host') !== '—' ? str(s, 'host') : undefined,
      accent: 'success',
      tooltip: t('modules.mongodb.monitor.tooltipUptime'),
    },
    {
      key: 'connections',
      label: t('modules.mongodb.monitor.connections'),
      value: connCur !== null ? String(connCur) : '—',
      sub: connCur !== null && connAvail !== null
        ? t('modules.mongodb.monitor.connectionsDesc', { used: connCur, total: connCur + connAvail })
        : undefined,
      accent: connectionAccent(connCur, connAvail),
      tooltip: connCreated !== null
        ? t('modules.mongodb.monitor.tooltipConnectionsFull', { created: connCreated.toLocaleString() })
        : t('modules.mongodb.monitor.tooltipConnections'),
    },
    {
      key: 'engine',
      label: t('modules.mongodb.monitor.storageEngine'),
      value: str(s, 'storageEngine', 'name'),
      accent: 'info',
      tooltip: t('modules.mongodb.monitor.tooltipStorageEngine'),
    },
  ]
})

// ── Op counters ───────────────────────────────────────────────────────────────

interface OpCounter {
  key: string
  label: string
  value: string
  rate?: string
  icon: string
  tooltip: string
}

const opcounters = computed((): OpCounter[] => {
  const s = stats.value?.serverStatus
  if (!s) return []
  const rates = opRates.value
  const defs = [
    { key: 'insert', label: t('modules.mongodb.monitor.opInsert'), icon: 'plus', tooltip: t('modules.mongodb.monitor.tooltipOpInsert') },
    { key: 'query', label: t('modules.mongodb.monitor.opQuery'), icon: 'search', tooltip: t('modules.mongodb.monitor.tooltipOpQuery') },
    { key: 'update', label: t('modules.mongodb.monitor.opUpdate'), icon: 'pencil', tooltip: t('modules.mongodb.monitor.tooltipOpUpdate') },
    { key: 'delete', label: t('modules.mongodb.monitor.opDelete'), icon: 'trash-2', tooltip: t('modules.mongodb.monitor.tooltipOpDelete') },
    { key: 'getmore', label: t('modules.mongodb.monitor.opGetmore'), icon: 'chevrons-right', tooltip: t('modules.mongodb.monitor.tooltipOpGetmore') },
    { key: 'command', label: t('modules.mongodb.monitor.opCommand'), icon: 'terminal', tooltip: t('modules.mongodb.monitor.tooltipOpCommand') },
  ] as const
  return defs.map((def) => ({
    ...def,
    value: loc(num(s, 'opcounters', def.key)),
    rate: rates && rates[def.key] > 0 ? `${rates[def.key].toFixed(1)}/s` : undefined,
  }))
})

// ── Memory ────────────────────────────────────────────────────────────────────

interface StatRow {
  label: string
  value: string
  tooltip: string
}

const memRows = computed((): StatRow[] => {
  const s = stats.value?.serverStatus
  if (!s) return []
  const rows: StatRow[] = []
  const resident = num(s, 'mem', 'resident')
  const virtual_ = num(s, 'mem', 'virtual')
  const lockQueue = num(s, 'globalLock', 'currentQueue', 'total')
  if (resident !== null) rows.push({ label: t('modules.mongodb.monitor.memResident'), value: fmtMB(resident), tooltip: t('modules.mongodb.monitor.tooltipMemResident') })
  if (virtual_ !== null) rows.push({ label: t('modules.mongodb.monitor.memVirtual'), value: fmtMB(virtual_), tooltip: t('modules.mongodb.monitor.tooltipMemVirtual') })
  if (lockQueue !== null) rows.push({ label: t('modules.mongodb.monitor.lockQueue'), value: String(lockQueue), tooltip: t('modules.mongodb.monitor.tooltipLockQueue') })
  return rows
})

// ── DB stats ──────────────────────────────────────────────────────────────────

const dbIsEmpty = computed((): boolean => {
  const d = stats.value?.dbStats
  if (!d) return false
  return num(d, 'collections') === 0 && num(d, 'objects') === 0
})

const dbStatRows = computed((): StatRow[] => {
  const d = stats.value?.dbStats
  if (!d) return []
  const collections = num(d, 'collections')
  const objects = num(d, 'objects')
  const dataSize = num(d, 'dataSize')
  const storageSize = num(d, 'storageSize')
  const indexes = num(d, 'indexes')
  const indexSize = num(d, 'indexSize')
  return [
    { label: t('modules.mongodb.monitor.dbCollections'), value: loc(collections), tooltip: t('modules.mongodb.monitor.tooltipDbCollections') },
    { label: t('modules.mongodb.monitor.dbDocuments'), value: loc(objects), tooltip: t('modules.mongodb.monitor.tooltipDbDocuments') },
    { label: t('modules.mongodb.monitor.dbDataSize'), value: dataSize !== null ? fmtBytes(dataSize) : '—', tooltip: t('modules.mongodb.monitor.tooltipDbDataSize') },
    { label: t('modules.mongodb.monitor.dbStorageSize'), value: storageSize !== null ? fmtBytes(storageSize) : '—', tooltip: t('modules.mongodb.monitor.tooltipDbStorageSize') },
    { label: t('modules.mongodb.monitor.dbIndexes'), value: loc(indexes), tooltip: t('modules.mongodb.monitor.tooltipDbIndexes') },
    { label: t('modules.mongodb.monitor.dbIndexSize'), value: indexSize !== null ? fmtBytes(indexSize) : '—', tooltip: t('modules.mongodb.monitor.tooltipDbIndexSize') },
  ]
})

// ── Current operations (RsTable) ──────────────────────────────────────────────

interface OpRow extends Record<string, unknown> {
  _rowKey: string
  _raw: Record<string, unknown>
  opid: string
  op: string
  ns: string
  client: string
  command: string
  internal: boolean
  duration: string
  durationSecs: number | null
  durationTone: DurationTone
  desc: string
}

const opColumns = computed((): RsTableColumn<OpRow>[] => [
  { key: 'opid', title: t('modules.mongodb.monitor.currentOpId'), width: 70 },
  { key: 'op', title: t('modules.mongodb.monitor.currentOpType'), width: 110 },
  { key: 'ns', title: t('modules.mongodb.monitor.currentOpNs'), minWidth: 140 },
  { key: 'command', title: t('modules.mongodb.monitor.currentOpCommand'), minWidth: 200, ellipsis: true },
  { key: 'client', title: t('modules.mongodb.monitor.currentOpClient'), width: 140 },
  { key: 'duration', title: t('modules.mongodb.monitor.currentOpDuration'), width: 80, align: 'right' },
])

function opSecsRunning(o: Record<string, unknown>): number | null {
  // microsecs_running 为微秒级精确墙钟时长；secs_running 仅整数秒，作为兜底
  if (typeof o['microsecs_running'] === 'number') return (o['microsecs_running'] as number) / 1_000_000
  if (typeof o['secs_running'] === 'number') return o['secs_running'] as number
  return null
}

/** 驱动/副本集长轮询命令：常驻数秒属正常，不计入慢操作 */
const IDLE_COMMAND_NAMES = new Set(['hello', 'ismaster', 'isMaster'])

function isInternalIdleOp(o: Record<string, unknown>): boolean {
  const cmd = o['command']
  if (typeof cmd !== 'object' || cmd === null) return false
  const firstKey = Object.keys(cmd)[0]
  return firstKey !== undefined && IDLE_COMMAND_NAMES.has(firstKey)
}

function opCommandPreview(o: Record<string, unknown>): string {
  const cmd = o['command']
  if (typeof cmd !== 'object' || cmd === null) return '—'
  try {
    const text = JSON.stringify(cmd)
    return text.length > 200 ? `${text.slice(0, 200)}…` : text
  } catch {
    return '—'
  }
}

const slowOpCount = computed(() => {
  const warnSecs = slowOpWarnThreshold.value
  const dangerSecs = slowOpDangerThreshold.value
  let warn = 0
  let danger = 0
  for (const raw of currentOps.value) {
    const o = raw as Record<string, unknown>
    if (isInternalIdleOp(o)) continue
    const secs = opSecsRunning(o)
    if (secs === null) continue
    if (secs >= dangerSecs) danger++
    else if (secs >= warnSecs) warn++
  }
  return { warn, danger, total: warn + danger }
})

const currentOpRows = computed((): OpRow[] =>
  currentOps.value
    .map((raw, idx) => {
      const o = raw as Record<string, unknown>
      const secsRaw = opSecsRunning(o)
      const internal = isInternalIdleOp(o)
      const opid = o['opid'] !== undefined ? String(o['opid']) : `row-${idx}`
      return {
        _rowKey: `${opid}-${idx}`,
        _raw: o,
        opid,
        op: typeof o['op'] === 'string' ? o['op'] : '—',
        ns: typeof o['ns'] === 'string' ? o['ns'] : '—',
        client: typeof o['client'] === 'string' ? o['client'] : '—',
        command: opCommandPreview(o),
        internal,
        duration: secsRaw !== null ? `${secsRaw.toFixed(2)}s` : '—',
        durationSecs: secsRaw,
        durationTone: internal ? 'normal' : durationTone(secsRaw),
        desc: typeof o['desc'] === 'string' ? o['desc'] : '—',
      }
    })
    .sort((a, b) => {
      if (a.internal !== b.internal) return a.internal ? 1 : -1
      return (b.durationSecs ?? -1) - (a.durationSecs ?? -1)
    }),
)

// ── Operation / slow-log detail dialog ────────────────────────────────────────

type DetailKind = 'currentOp' | 'slowLog'

const detailOpen = ref(false)
const detailKind = ref<DetailKind>('currentOp')
const detailRaw = ref<Record<string, unknown> | null>(null)

const detailTitle = computed(() =>
  detailKind.value === 'slowLog'
    ? t('modules.mongodb.slowlog.detailTitle')
    : t('modules.mongodb.monitor.opDetailTitle'),
)

const detailJson = computed(() =>
  detailRaw.value ? JSON.stringify(detailRaw.value, null, 2) : '',
)

function openOpDetail(row: OpRow): void {
  detailKind.value = 'currentOp'
  detailRaw.value = row._raw
  detailOpen.value = true
}

function openSlowLogDetail(row: SlowLogRow): void {
  detailKind.value = 'slowLog'
  detailRaw.value = row._raw
  detailOpen.value = true
}

async function copyDetail(): Promise<void> {
  if (!detailJson.value) return
  try {
    await navigator.clipboard.writeText(detailJson.value)
    toast.success(t('modules.mongodb.monitor.opDetailCopied'))
  } catch {
    toast.error(t('modules.mongodb.monitor.opDetailCopyError'))
  }
}

function pushConnectionAlert(alerts: HealthAlert[], s: Record<string, unknown>): void {
  const connCur = num(s, 'connections', 'current')
  const connAvail = num(s, 'connections', 'available')
  if (connCur === null || connAvail === null) return
  const total = connCur + connAvail
  if (total <= 0) return
  const pct = (connCur / total) * 100
  if (pct >= CONN_DANGER_RATIO * 100) {
    alerts.push({ level: 'critical', text: t('modules.mongodb.monitor.alertConnHigh', { pct: pct.toFixed(0) }) })
  } else if (pct >= CONN_WARN_RATIO * 100) {
    alerts.push({ level: 'warn', text: t('modules.mongodb.monitor.alertConnWarn', { pct: pct.toFixed(0) }) })
  }
}

function pushLockQueueAlert(alerts: HealthAlert[], s: Record<string, unknown>): void {
  const lockQueue = num(s, 'globalLock', 'currentQueue', 'total')
  if (lockQueue === null || lockQueue <= 0) return
  alerts.push({
    level: lockQueue >= 10 ? 'critical' : 'warn',
    text: t('modules.mongodb.monitor.alertLockQueue', { n: lockQueue }),
  })
}

function pushSlowOpAlert(alerts: HealthAlert[]): void {
  const warnSecs = slowOpWarnThreshold.value
  const dangerSecs = slowOpDangerThreshold.value
  if (slowOpCount.value.danger > 0) {
    alerts.push({
      level: 'critical',
      text: t('modules.mongodb.monitor.alertSlowOpDanger', { n: slowOpCount.value.danger, secs: dangerSecs }),
    })
  } else if (slowOpCount.value.warn > 0) {
    alerts.push({
      level: 'warn',
      text: t('modules.mongodb.monitor.alertSlowOpWarn', { n: slowOpCount.value.warn, secs: warnSecs }),
    })
  }
}

function pushOpsRateAlert(alerts: HealthAlert[]): void {
  const rate = totalOpRate.value
  if (rate === null) return
  if (rate >= OPS_RATE_DANGER) {
    alerts.push({ level: 'critical', text: t('modules.mongodb.monitor.alertOpsHigh', { rate: rate.toFixed(0) }) })
  } else if (rate >= OPS_RATE_WARN) {
    alerts.push({ level: 'warn', text: t('modules.mongodb.monitor.alertOpsWarn', { rate: rate.toFixed(0) }) })
  }
}

const healthAlerts = computed((): HealthAlert[] => {
  const s = stats.value?.serverStatus
  if (!s) return []
  const alerts: HealthAlert[] = []
  pushConnectionAlert(alerts, s)
  pushLockQueueAlert(alerts, s)
  pushSlowOpAlert(alerts)
  pushOpsRateAlert(alerts)
  return alerts
})

// ── Slow query log (manual fetch only) ───────────────────────────────────────

interface SlowLogRow extends Record<string, unknown> {
  _rowKey: string
  _raw: Record<string, unknown>
  timestamp: string
  duration: string
  durationMs: number
  durationTone: DurationTone
  op: string
  ns: string
  command: string
  client: string
}

const slowLogColumns = computed((): RsTableColumn<SlowLogRow>[] => [
  { key: 'timestamp', title: t('modules.mongodb.slowlog.columns.time'), width: 170 },
  { key: 'duration', title: t('modules.mongodb.slowlog.columns.duration'), width: 90, align: 'right' },
  { key: 'op', title: t('modules.mongodb.slowlog.columns.op'), width: 90 },
  { key: 'ns', title: t('modules.mongodb.slowlog.columns.ns'), minWidth: 140 },
  { key: 'command', title: t('modules.mongodb.slowlog.columns.command'), minWidth: 200, ellipsis: true },
  { key: 'client', title: t('modules.mongodb.slowlog.columns.client'), width: 130 },
])

const slowLogRows = computed((): SlowLogRow[] => {
  const warnMs = slowOpWarnThreshold.value * 1000
  const dangerMs = slowOpDangerThreshold.value * 1000
  return slowLogEntries.value.map((entry, idx) => ({
    _rowKey: `${entry.timestamp ?? 'row'}-${idx}`,
    _raw: entry.raw ?? (entry as unknown as Record<string, unknown>),
    timestamp: entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—',
    durationMs: entry.durationMs,
    duration: formatSlowLogDuration(entry.durationMs),
    durationTone: slowLogDurationTone(entry.durationMs, warnMs, dangerMs),
    op: entry.op || '—',
    ns: entry.ns || '—',
    command: entry.command || '—',
    client: entry.client || entry.user || '—',
  }))
})

const slowLogProfilerHint = computed(() => {
  const p = slowLogProfiling.value
  if (!p || !profilerStatusKnown.value) return ''
  if (p.level >= 2) {
    return t('modules.mongodb.slowlog.profilerServerAll', { slowms: p.slowms })
  }
  if (p.enabled) {
    return t('modules.mongodb.slowlog.profilerServerOn', { slowms: p.slowms })
  }
  return t('modules.mongodb.slowlog.profilerServerOff', { slowms: p.slowms })
})

async function loadProfilerStatus(): Promise<void> {
  if (!props.sessionId || profilerStatusLoading.value) return
  profilerStatusLoading.value = true
  try {
    const result = await mongodbApi.monitorProfilerStatus({
      sessionId: props.sessionId,
      database: props.database,
    })
    syncProfilerFromServer(result.profiling)
    toast.success(t('modules.mongodb.slowlog.profilerStatusLoaded'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.slowlog.profilerStatusError'))
  } finally {
    profilerStatusLoading.value = false
  }
}

async function applyProfiler(): Promise<void> {
  if (!props.sessionId || profilerSaving.value) return
  profilerSaving.value = true
  try {
    const slowms = Math.round(parsePositiveNumber(profilerSlowMs.value, 100))
    const result = await mongodbApi.monitorProfilerSet({
      sessionId: props.sessionId,
      database: props.database,
      enabled: profilerDraftEnabled.value,
      slowms: profilerDraftEnabled.value ? slowms : undefined,
    })
    syncProfilerFromServer(result.profiling)
    toast.success(t('modules.mongodb.slowlog.profilerApplySuccess'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.slowlog.profilerApplyError'))
  } finally {
    profilerSaving.value = false
  }
}

async function loadSlowLog(): Promise<void> {
  if (!props.sessionId || slowLogLoading.value) return
  slowLogLoading.value = true
  try {
    const parsed = Number.parseInt(slowLogCount.value, 10)
    const result = await mongodbApi.monitorSlowLog({
      sessionId: props.sessionId,
      database: props.database,
      count: Number.isFinite(parsed) && parsed > 0 ? parsed : 20,
    })
    syncProfilerFromServer(result.profiling)
    slowLogEntries.value = result.entries
    slowLogLoaded.value = true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.slowlog.loadError'))
  } finally {
    slowLogLoading.value = false
  }
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────

const intervalOptions = computed(() => [
  { value: 0, label: t('modules.mongodb.monitor.intervalOff') },
  { value: 5, label: '5s' },
  { value: 10, label: '10s' },
  { value: 30, label: '30s' },
  { value: 60, label: '60s' },
])

const lastUpdatedText = computed(() => lastUpdated.value?.toLocaleTimeString() ?? '')

/** 当前监控的数据库范围（优先 Tab 上下文，其次接口返回值） */
const monitorDatabase = computed(() => props.database ?? stats.value?.database ?? '')

/** 当前操作表格固定高度，避免轮询刷新时撑开外层滚动区 */
const OP_TABLE_HEIGHT = 280

// ── Data fetching ─────────────────────────────────────────────────────────────

async function refresh(): Promise<void> {
  if (!props.sessionId) return
  const isInitial = !stats.value
  if (isInitial) initialLoading.value = true
  else refreshing.value = true
  try {
    const [statsResult, opResult] = await Promise.all([
      mongodbApi.monitorStats({
        sessionId: props.sessionId,
        database: props.database,
      }),
      mongodbApi.monitorCurrentOp({ sessionId: props.sessionId, activeOnly: true }),
    ])
    stats.value = statsResult
    currentOps.value = opResult.operations
    updateOpRates(statsResult.serverStatus)
    lastUpdated.value = new Date()
  } finally {
    initialLoading.value = false
    refreshing.value = false
  }
}

function startPolling(): void {
  stopPolling()
  void refresh()
  if (autoRefreshSecs.value > 0) {
    timer = setInterval(() => void refresh(), autoRefreshSecs.value * 1000)
  }
}

function stopPolling(): void {
  if (timer) { clearInterval(timer); timer = null }
}

function onIntervalChange(val: number): void {
  autoRefreshSecs.value = val
  stopPolling()
  if (props.active && props.sessionId && val > 0) {
    timer = setInterval(() => void refresh(), val * 1000)
  }
}

watch(
  () => props.database,
  () => {
    stats.value = null
    currentOps.value = []
    lastUpdated.value = null
    resetRateSnapshot()
    resetSlowLog()
  },
)

watch(
  () => [props.active, props.sessionId, props.database] as const,
  ([active, sid]) => {
    if (active && sid) startPolling()
    else stopPolling()
  },
  { immediate: true },
)

onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="nm-monitor">
    <!-- ── Toolbar ── -->
    <header class="nm-monitor__toolbar">
      <RsButton size="sm" variant="ghost" :loading="refreshing" :disabled="!sessionId" @click="refresh">
        <RsIcon name="refresh-cw" :size="13" />
        <span>{{ t('modules.mongodb.monitor.refresh') }}</span>
      </RsButton>

      <div class="nm-monitor__interval">
        <RsIcon name="timer" :size="13" class="nm-monitor__interval-icon" />
        <select
          id="nm-monitor-interval"
          class="nm-monitor__interval-select"
          :aria-label="t('modules.mongodb.monitor.autoRefresh')"
          :value="autoRefreshSecs"
          @change="onIntervalChange(Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="opt in intervalOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <span v-if="lastUpdatedText" class="nm-monitor__updated">
        <RsIcon name="check-circle-2" :size="11" />
        {{ t('modules.mongodb.monitor.updatedAt', { time: lastUpdatedText }) }}
      </span>
    </header>

    <!-- ── Initial loading ── -->
    <RsLoading
      v-if="initialLoading && !stats"
      class="nm-monitor__loading"
      :label="t('modules.mongodb.monitor.loading')"
      show-label
    />

    <!-- ── Dashboard ── -->
    <div v-else-if="stats" class="nm-monitor__body">

      <!-- Scope banner -->
      <div v-if="monitorDatabase" class="nm-monitor__scope">
        <RsIcon name="database" :size="13" class="nm-monitor__scope-icon" />
        <span class="nm-monitor__scope-label">{{ t('modules.mongodb.monitor.scope') }}</span>
        <span class="nm-monitor__scope-db">{{ monitorDatabase }}</span>
        <span class="nm-monitor__scope-hint">{{ t('modules.mongodb.monitor.scopeHint') }}</span>
      </div>

      <!-- Health strip -->
      <div
        class="nm-monitor__health"
        :class="healthAlerts.length ? 'nm-monitor__health--issues' : 'nm-monitor__health--ok'"
      >
        <RsIcon
          :name="healthAlerts.length ? 'alert-triangle' : 'check-circle-2'"
          :size="13"
          class="nm-monitor__health-icon"
        />
        <div class="nm-monitor__health-body">
          <span class="nm-monitor__health-title">
            {{ healthAlerts.length > 0
              ? t('modules.mongodb.monitor.healthIssues', { n: healthAlerts.length })
              : t('modules.mongodb.monitor.healthOk') }}
          </span>
          <span v-if="healthAlerts.length === 0" class="nm-monitor__health-sub">
            {{ t('modules.mongodb.monitor.healthNoIssue') }}
          </span>
          <ul v-else class="nm-monitor__health-list">
            <li
              v-for="(alert, idx) in healthAlerts"
              :key="idx"
              class="nm-monitor__health-item"
              :class="`nm-monitor__health-item--${alert.level}`"
            >
              {{ alert.text }}
            </li>
          </ul>
        </div>
      </div>

      <!-- Overview cards -->
      <div class="nm-monitor__cards">
        <RsTooltip
          v-for="card in overviewCards"
          :key="card.key"
          :content="card.tooltip"
          side="bottom"
        >
          <RsStatCard
            :label="card.label"
            :value="card.value"
            :description="card.sub"
            :accent="card.accent"
            class="nm-monitor__stat-card"
          />
        </RsTooltip>
      </div>

      <!-- Middle row: opcounters + memory -->
      <div class="nm-monitor__mid">
        <!-- Op counters -->
        <section class="nm-monitor__section">
          <div class="nm-monitor__section-head">
            <RsIcon name="activity" :size="13" class="nm-monitor__section-icon" />
            <span>{{ t('modules.mongodb.monitor.opcounters') }}</span>
            <span class="nm-monitor__section-hint">{{ t('modules.mongodb.monitor.opcountersHint') }}</span>
            <RsTooltip v-if="totalOpRate !== null" :content="t('modules.mongodb.monitor.tooltipOpsRate')" side="bottom">
              <span class="nm-monitor__rate-badge">
                {{ t('modules.mongodb.monitor.opsPerSec', { rate: totalOpRate.toFixed(1) }) }}
              </span>
            </RsTooltip>
            <span v-if="opRates" class="nm-monitor__section-hint nm-monitor__section-hint--rate">
              {{ t('modules.mongodb.monitor.opcountersRateHint') }}
            </span>
          </div>
          <div class="nm-monitor__op-grid">
            <RsTooltip
              v-for="op in opcounters"
              :key="op.key"
              :content="op.tooltip"
              side="top"
            >
              <div class="nm-monitor__op-item" :class="`nm-monitor__op-item--${op.key}`">
                <div class="nm-monitor__op-icon">
                  <RsIcon :name="op.icon" :size="12" />
                </div>
                <div class="nm-monitor__op-label">{{ op.label }}</div>
                <div class="nm-monitor__op-value">{{ op.value }}</div>
                <div v-if="op.rate" class="nm-monitor__op-rate">{{ op.rate }}</div>
              </div>
            </RsTooltip>
          </div>
        </section>

        <!-- Memory -->
        <section v-if="memRows.length" class="nm-monitor__section nm-monitor__section--compact">
          <div class="nm-monitor__section-head">
            <RsIcon name="cpu" :size="13" class="nm-monitor__section-icon" />
            <span>{{ t('modules.mongodb.monitor.memStats') }}</span>
          </div>
          <div class="nm-monitor__stat-rows">
            <RsTooltip v-for="(row, idx) in memRows" :key="row.label" :content="row.tooltip" side="left">
              <div class="nm-monitor__stat-row" :class="{ 'nm-monitor__stat-row--alt': idx % 2 === 1 }">
                <span class="nm-monitor__stat-label">
                  {{ row.label }}
                  <RsIcon name="info" :size="10" class="nm-monitor__info-icon" />
                </span>
                <span class="nm-monitor__stat-value">{{ row.value }}</span>
              </div>
            </RsTooltip>
          </div>
        </section>
      </div>

      <!-- Database stats: full-width row -->
      <section v-if="dbStatRows.length" class="nm-monitor__section nm-monitor__section--db">
        <div class="nm-monitor__section-head">
          <RsIcon name="database" :size="13" class="nm-monitor__section-icon" />
          <span>{{ t('modules.mongodb.monitor.dbStats') }}</span>
          <span v-if="monitorDatabase" class="nm-monitor__db-badge">{{ monitorDatabase }}</span>
        </div>
        <div v-if="dbIsEmpty" class="nm-monitor__db-empty-hint">
          <RsIcon name="info" :size="11" />
          {{ t('modules.mongodb.monitor.dbEmptyHint', { name: monitorDatabase }) }}
        </div>
        <div class="nm-monitor__db-grid">
          <RsTooltip
            v-for="row in dbStatRows"
            :key="row.label"
            :content="row.tooltip"
            side="top"
          >
            <div class="nm-monitor__db-cell">
              <span class="nm-monitor__db-cell-label">
                {{ row.label }}
                <RsIcon name="info" :size="10" class="nm-monitor__info-icon" />
              </span>
              <span
                class="nm-monitor__db-cell-value"
                :class="{ 'nm-monitor__stat-value--zero': row.value === '0' || row.value === '0 B' }"
              >{{ row.value }}</span>
            </div>
          </RsTooltip>
        </div>
      </section>

      <!-- Current operations -->
      <section class="nm-monitor__section nm-monitor__section--table">
        <div class="nm-monitor__section-head">
          <RsIcon name="zap" :size="13" class="nm-monitor__section-icon" />
          <span>{{ t('modules.mongodb.monitor.currentOp') }}</span>
          <span class="nm-monitor__badge">{{ currentOpRows.length }}</span>
          <span
            v-if="slowOpCount.total > 0"
            class="nm-monitor__badge nm-monitor__badge--danger nm-monitor__badge--nowrap"
          >
            {{ t('modules.mongodb.monitor.slowOpCount', { n: slowOpCount.total }) }}
          </span>
        </div>

        <div class="nm-monitor__threshold-bar">
          <RsIcon name="sliders-horizontal" :size="12" class="nm-monitor__threshold-icon" />
          <span class="nm-monitor__threshold-label">{{ t('modules.mongodb.monitor.slowOpThreshold') }}</span>
          <div class="nm-monitor__threshold-field">
            <span>{{ t('modules.mongodb.monitor.slowOpThresholdWarn') }}</span>
            <RsInput
              v-model="slowOpWarnSecs"
              class="nm-monitor__threshold-input"
              size="sm"
              autocomplete="off"
              inputmode="decimal"
            />
            <span class="nm-monitor__threshold-unit">s</span>
          </div>
          <div class="nm-monitor__threshold-field">
            <span>{{ t('modules.mongodb.monitor.slowOpThresholdDanger') }}</span>
            <RsInput
              v-model="slowOpDangerSecs"
              class="nm-monitor__threshold-input"
              size="sm"
              autocomplete="off"
              inputmode="decimal"
            />
            <span class="nm-monitor__threshold-unit">s</span>
          </div>
          <span class="nm-monitor__threshold-hint">{{ t('modules.mongodb.monitor.slowOpThresholdHint') }}</span>
          <span class="nm-monitor__section-hint nm-monitor__section-hint--inline">
            {{ t('modules.mongodb.monitor.currentOpRowHint') }}
          </span>
        </div>

        <div class="nm-monitor__table-wrap" :style="{ height: `${OP_TABLE_HEIGHT}px` }">
          <RsTable
            :columns="opColumns"
            :data="currentOpRows"
            row-key="_rowKey"
            fill
            size="sm"
            striped
            @row-click="openOpDetail"
          >
            <template #empty>
              <div class="nm-monitor__empty-ops-inline">
                <RsIcon name="check-circle-2" :size="15" class="nm-monitor__empty-icon" />
                {{ t('modules.mongodb.monitor.noCurrentOps') }}
              </div>
            </template>
            <!-- Op type badge -->
            <template #cell-op="{ row }">
              <span class="nm-monitor__op-badge" :class="`nm-monitor__op-badge--${row.op}`">{{ row.op }}</span>
              <RsTooltip v-if="row.internal" :content="t('modules.mongodb.monitor.internalOpHint')" side="top">
                <span class="nm-monitor__op-badge nm-monitor__op-badge--internal">
                  {{ t('modules.mongodb.monitor.internalOpBadge') }}
                </span>
              </RsTooltip>
            </template>
            <!-- Command preview -->
            <template #cell-command="{ row }">
              <code class="nm-monitor__slowlog-command">{{ row.command }}</code>
            </template>
            <!-- Duration highlight -->
            <template #cell-duration="{ row }">
              <span
                class="nm-monitor__dur-cell"
                :class="row.durationTone !== 'normal' ? `nm-monitor__dur-cell--${row.durationTone}` : ''"
              >{{ row.duration }}</span>
            </template>
          </RsTable>
        </div>
      </section>

      <!-- Operation / slow-log detail dialog -->
      <RsDialog
        v-model:open="detailOpen"
        :title="detailTitle"
        width="lg"
      >
        <template #body>
        <div class="nm-monitor__op-detail">
          <div class="nm-monitor__op-detail-toolbar">
            <RsButton size="sm" variant="ghost" @click="copyDetail">
              <RsIcon name="copy" :size="13" />
              {{ t('modules.mongodb.monitor.opDetailCopy') }}
            </RsButton>
          </div>
          <pre class="nm-monitor__op-detail-pre">{{ detailJson }}</pre>
        </div>
        </template>
      </RsDialog>

      <!-- Slow query log (manual fetch) -->
      <section class="nm-monitor__section nm-monitor__section--slowlog nm-monitor__section--table">
        <div class="nm-monitor__section-head nm-monitor__section-head--slowlog">
          <div class="nm-monitor__section-head-left">
            <RsIcon name="hourglass" :size="13" class="nm-monitor__section-icon nm-monitor__section-icon--slowlog" />
            <span class="nm-monitor__section-title">{{ t('modules.mongodb.slowlog.title') }}</span>
            <RsTooltip :content="t('modules.mongodb.slowlog.tooltips.hint')" side="bottom">
              <button type="button" class="nm-monitor__info-btn" :aria-label="t('modules.mongodb.slowlog.tooltips.hint')">
                <RsIcon name="info" :size="12" />
              </button>
            </RsTooltip>
            <RsTooltip v-if="slowLogLoaded" :content="t('modules.mongodb.slowlog.entryCount', { count: slowLogRows.length })" side="bottom">
              <span class="nm-monitor__badge nm-monitor__badge--nowrap">{{ slowLogRows.length }}</span>
            </RsTooltip>
          </div>
          <div class="nm-monitor__slowlog-actions">
            <div class="nm-monitor__slowlog-count">
              <span class="nm-monitor__slowlog-count-label">{{ t('modules.mongodb.slowlog.countLabel') }}</span>
              <RsTooltip :content="t('modules.mongodb.slowlog.tooltips.count')" side="top">
                <RsInput
                  v-model="slowLogCount"
                  class="nm-monitor__slowlog-count-input"
                  size="sm"
                  autocomplete="off"
                  placeholder="20"
                  @keydown.enter="loadSlowLog"
                />
              </RsTooltip>
            </div>
            <RsTooltip :content="t('modules.mongodb.slowlog.tooltips.fetch')" side="top">
              <RsButton
                size="sm"
                variant="primary"
                :loading="slowLogLoading"
                :disabled="!sessionId"
                @click="loadSlowLog"
              >
                <RsIcon name="search" :size="13" />
                {{ t('modules.mongodb.slowlog.fetch') }}
              </RsButton>
            </RsTooltip>
          </div>
        </div>

        <p class="nm-monitor__slowlog-hint">
          {{ t('modules.mongodb.slowlog.hint') }}
          <span class="nm-monitor__slowlog-hint-sep">·</span>
          {{ t('modules.mongodb.slowlog.rowHint') }}
        </p>

        <div class="nm-monitor__profiler-bar">
          <span class="nm-monitor__profiler-label">{{ t('modules.mongodb.slowlog.profiler') }}</span>
          <div class="nm-monitor__profiler-toggle">
            <RsTooltip :content="t('modules.mongodb.slowlog.tooltips.profilerOn')" side="top">
              <RsButton
                size="sm"
                :variant="profilerDraftEnabled ? 'primary' : 'ghost'"
                :disabled="profilerSaving"
                @click="profilerDraftEnabled = true"
              >
                {{ t('modules.mongodb.slowlog.profilerOn') }}
              </RsButton>
            </RsTooltip>
            <RsTooltip :content="t('modules.mongodb.slowlog.tooltips.profilerOff')" side="top">
              <RsButton
                size="sm"
                :variant="!profilerDraftEnabled ? 'primary' : 'ghost'"
                :disabled="profilerSaving"
                @click="profilerDraftEnabled = false"
              >
                {{ t('modules.mongodb.slowlog.profilerOff') }}
              </RsButton>
            </RsTooltip>
          </div>
          <div class="nm-monitor__profiler-slowms">
            <span class="nm-monitor__profiler-slowms-label">{{ t('modules.mongodb.slowlog.profilerSlowms') }}</span>
            <RsTooltip :content="t('modules.mongodb.slowlog.tooltips.profilerSlowms')" side="top">
              <RsInput
                v-model="profilerSlowMs"
                class="nm-monitor__profiler-slowms-input"
                size="sm"
                autocomplete="off"
                inputmode="numeric"
                :disabled="!profilerDraftEnabled || profilerSaving"
              />
            </RsTooltip>
            <span class="nm-monitor__profiler-slowms-unit">{{ t('modules.mongodb.slowlog.profilerSlowmsUnit') }}</span>
          </div>
          <RsTooltip :content="t('modules.mongodb.slowlog.tooltips.profilerApply')" side="top">
            <RsButton
              size="sm"
              variant="primary"
              :loading="profilerSaving"
              :disabled="!sessionId"
              @click="applyProfiler"
            >
              {{ t('modules.mongodb.slowlog.profilerApply') }}
            </RsButton>
          </RsTooltip>
          <RsTooltip :content="t('modules.mongodb.slowlog.tooltips.profilerStatusLoad')" side="top">
            <RsButton
              size="sm"
              variant="ghost"
              :loading="profilerStatusLoading"
              :disabled="!sessionId"
              @click="loadProfilerStatus"
            >
              {{ t('modules.mongodb.slowlog.profilerStatusLoad') }}
            </RsButton>
          </RsTooltip>
        </div>

        <p class="nm-monitor__profiler-draft-hint">{{ t('modules.mongodb.slowlog.profilerDraftHint') }}</p>
        <p
          v-if="slowLogProfilerHint"
          class="nm-monitor__slowlog-profiler"
          :class="slowLogProfiling?.enabled ? 'nm-monitor__slowlog-profiler--on' : 'nm-monitor__slowlog-profiler--off'"
        >
          <RsIcon :name="slowLogProfiling?.enabled ? 'check-circle-2' : 'alert-circle'" :size="11" />
          {{ slowLogProfilerHint }}
        </p>

        <div class="nm-monitor__table-wrap" :style="{ height: `${OP_TABLE_HEIGHT}px` }">
          <RsLoading
            v-if="slowLogLoading && slowLogRows.length === 0"
            class="nm-monitor__slowlog-loading"
            :label="t('modules.mongodb.slowlog.loading')"
            show-label
          />
          <RsTable
            v-else
            :columns="slowLogColumns"
            :data="slowLogRows"
            row-key="_rowKey"
            fill
            size="sm"
            striped
            @row-click="openSlowLogDetail"
          >
            <template #empty>
              <div class="nm-monitor__empty-ops-inline">
                <RsIcon name="hourglass" :size="15" class="nm-monitor__empty-icon" />
                {{ slowLogLoaded ? t('modules.mongodb.slowlog.empty') : t('modules.mongodb.slowlog.notFetched') }}
              </div>
            </template>
            <template #cell-op="{ row }">
              <span class="nm-monitor__op-badge" :class="`nm-monitor__op-badge--${row.op}`">{{ row.op }}</span>
            </template>
            <template #cell-duration="{ row }">
              <span
                class="nm-monitor__dur-cell"
                :class="row.durationTone !== 'normal' ? `nm-monitor__dur-cell--${row.durationTone}` : ''"
              >{{ row.duration }}</span>
            </template>
            <template #cell-command="{ row }">
              <code class="nm-monitor__slowlog-command">{{ row.command }}</code>
            </template>
          </RsTable>
        </div>
      </section>

      <!-- Raw data (collapsible) -->
      <section class="nm-monitor__section nm-monitor__section--raw">
        <button class="nm-monitor__raw-toggle" @click="showRaw = !showRaw">
          <RsIcon :name="showRaw ? 'chevron-down' : 'chevron-right'" :size="13" />
          <span>{{ t('modules.mongodb.monitor.rawData') }}</span>
        </button>
        <template v-if="showRaw">
          <pre class="nm-monitor__raw-pre">{{ JSON.stringify(stats.serverStatus, null, 2) }}</pre>
        </template>
      </section>

      <div class="nm-monitor__bottom-pad" />
    </div>

    <!-- ── No data ── -->
    <div v-else class="nm-monitor__empty">
      <RsIcon name="bar-chart-2" :size="32" class="nm-monitor__empty-icon-lg" />
      <p>{{ t('modules.mongodb.monitor.emptyStats') }}</p>
    </div>
  </div>
</template>

<style scoped>
/* ── Root ── */
.nm-monitor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

/* ── Toolbar ── */
.nm-monitor__toolbar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-xs) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
  flex-shrink: 0;
}

/* ── Interval selector ── */
.nm-monitor__interval {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nm-monitor__interval-icon {
  color: var(--rs-muted);
}

.nm-monitor__interval-select {
  appearance: none;
  background: var(--rs-surface-subtle);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  color: var(--rs-foreground);
  font-size: var(--rs-font-size-xs);
  padding: 2px 22px 2px 8px;
  height: 26px;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 6px center;
  transition: border-color 0.15s;
}

.nm-monitor__interval-select:hover { border-color: var(--rs-border); }
.nm-monitor__interval-select:focus { outline: none; border-color: var(--rs-accent); }

.nm-monitor__updated {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  margin-left: auto;
}

/* ── Loading ── */
.nm-monitor__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Scrollable body ── */
.nm-monitor__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--rs-space-md);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--rs-accent) 3%, transparent) 0%, transparent 120px),
    radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--rs-info) 5%, transparent) 0%, transparent 42%),
    radial-gradient(circle at 0% 100%, color-mix(in srgb, var(--rs-success) 4%, transparent) 0%, transparent 38%),
    repeating-linear-gradient(
      90deg,
      color-mix(in srgb, var(--rs-border-subtle) 35%, transparent) 0,
      color-mix(in srgb, var(--rs-border-subtle) 35%, transparent) 1px,
      transparent 1px,
      transparent 24px
    ),
    repeating-linear-gradient(
      0deg,
      color-mix(in srgb, var(--rs-border-subtle) 35%, transparent) 0,
      color-mix(in srgb, var(--rs-border-subtle) 35%, transparent) 1px,
      transparent 1px,
      transparent 24px
    ),
    var(--rs-surface-subtle);
}

.nm-monitor__body > .nm-monitor__scope,
.nm-monitor__body > .nm-monitor__cards,
.nm-monitor__body > .nm-monitor__mid,
.nm-monitor__body > .nm-monitor__section {
  flex-shrink: 0;
}

/* ── Scope banner ── */
.nm-monitor__scope {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--rs-radius-md);
  border: 1px solid color-mix(in srgb, var(--rs-accent) 20%, var(--rs-border-subtle));
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--rs-accent) 8%, var(--rs-surface)),
    color-mix(in srgb, var(--rs-info) 5%, var(--rs-surface))
  );
  box-shadow: 0 1px 2px color-mix(in srgb, var(--rs-foreground) 4%, transparent);
}

.nm-monitor__scope-icon {
  color: var(--rs-accent);
  flex-shrink: 0;
}

.nm-monitor__scope-label {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-monitor__scope-db {
  font-size: var(--rs-font-size-sm);
  font-weight: 700;
  color: var(--rs-foreground);
  font-family: var(--rs-font-mono);
}

.nm-monitor__scope-hint {
  margin-left: auto;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

/* ── Health strip ── */
.nm-monitor__health {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
}

.nm-monitor__health--ok {
  border-color: color-mix(in srgb, var(--rs-success) 25%, var(--rs-border-subtle));
  background: color-mix(in srgb, var(--rs-success) 6%, var(--rs-surface));
}

.nm-monitor__health--issues {
  border-color: color-mix(in srgb, var(--rs-warning) 30%, var(--rs-border-subtle));
  background: color-mix(in srgb, var(--rs-warning) 6%, var(--rs-surface));
}

.nm-monitor__health-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.nm-monitor__health--ok .nm-monitor__health-icon {
  color: var(--rs-success);
}

.nm-monitor__health--issues .nm-monitor__health-icon {
  color: var(--rs-warning);
}

.nm-monitor__health-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.nm-monitor__health-title {
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-foreground);
}

.nm-monitor__health-sub {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-monitor__health-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.nm-monitor__health-item {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-monitor__health-item--warn {
  color: var(--rs-warning);
}

.nm-monitor__health-item--critical {
  color: var(--rs-danger);
  font-weight: 600;
}

.nm-monitor__bottom-pad {
  flex-shrink: 0;
  height: var(--rs-space-md);
}

/* ── Overview cards ── */
.nm-monitor__cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--rs-space-sm);
}

@media (max-width: 900px) {
  .nm-monitor__cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 520px) {
  .nm-monitor__cards { grid-template-columns: 1fr; }
}

.nm-monitor__stat-card {
  width: 100%;
  cursor: default;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.nm-monitor__cards :deep(.rs-stat-card) {
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.nm-monitor__cards :deep(.rs-stat-card:hover) {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--rs-foreground) 8%, transparent);
}

/* ── Middle row ── */
.nm-monitor__mid {
  display: grid;
  grid-template-columns: 1fr 220px;
  gap: var(--rs-space-md);
  align-items: stretch;
}

@media (max-width: 900px) {
  .nm-monitor__mid { grid-template-columns: 1fr; }
}

/* ── Section card ── */
.nm-monitor__section {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  overflow: hidden;
  background: var(--rs-surface);
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--rs-foreground) 4%, transparent),
    0 6px 18px color-mix(in srgb, var(--rs-foreground) 3%, transparent);
  position: relative;
}

.nm-monitor__section::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(
    180deg,
    var(--rs-accent),
    color-mix(in srgb, var(--rs-accent) 35%, transparent)
  );
  opacity: 0.75;
}

.nm-monitor__section--db::before {
  background: linear-gradient(
    180deg,
    var(--rs-info),
    color-mix(in srgb, var(--rs-info) 35%, transparent)
  );
}

.nm-monitor__section--raw::before {
  display: none;
}

.nm-monitor__section--table {
  overflow: hidden;
  flex-shrink: 0;
  border-radius: 0;
}

.nm-monitor__section--slowlog::before {
  background: linear-gradient(
    180deg,
    var(--rs-warning),
    color-mix(in srgb, var(--rs-warning) 35%, transparent)
  );
}

.nm-monitor__section-icon--slowlog {
  color: var(--rs-warning);
}

.nm-monitor__section-head--slowlog {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: nowrap;
}

.nm-monitor__section-head-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-shrink: 0;
}

.nm-monitor__section-title {
  white-space: nowrap;
  font-weight: inherit;
}

.nm-monitor__info-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: none;
  color: var(--rs-muted);
  cursor: help;
}

.nm-monitor__slowlog-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.nm-monitor__slowlog-count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.nm-monitor__slowlog-count-label {
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  color: var(--rs-muted);
  white-space: nowrap;
}

.nm-monitor__slowlog-count-input {
  width: 64px;
}

.nm-monitor__slowlog-hint {
  margin: 0;
  padding: 6px var(--rs-space-md);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-warning) 4%, var(--rs-surface));
}

.nm-monitor__slowlog-hint-sep {
  margin: 0 4px;
  opacity: 0.5;
}

/* ── Profiler controls ── */
.nm-monitor__profiler-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-warning) 5%, var(--rs-surface));
}

.nm-monitor__profiler-label {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-foreground);
  white-space: nowrap;
}

.nm-monitor__profiler-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.nm-monitor__profiler-slowms {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.nm-monitor__profiler-slowms-label,
.nm-monitor__profiler-slowms-unit {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  white-space: nowrap;
}

.nm-monitor__profiler-slowms-input {
  width: 72px;
}

.nm-monitor__profiler-draft-hint {
  margin: 0;
  padding: 5px var(--rs-space-md);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-subtle);
}

/* ── Slow-op threshold bar ── */
.nm-monitor__threshold-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 6px var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-subtle);
}

.nm-monitor__threshold-icon {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-monitor__threshold-label {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-foreground);
  white-space: nowrap;
}

.nm-monitor__threshold-field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  white-space: nowrap;
}

.nm-monitor__threshold-input {
  width: 52px;
}

.nm-monitor__threshold-unit {
  color: var(--rs-muted);
}

.nm-monitor__threshold-hint {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-monitor__section-hint--inline {
  margin-left: auto;
  font-style: italic;
}

.nm-monitor__badge--nowrap {
  white-space: nowrap;
  flex-shrink: 0;
}

.nm-monitor__slowlog-profiler {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 5px var(--rs-space-md);
  font-size: var(--rs-font-size-xs);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-monitor__slowlog-profiler--on {
  color: var(--rs-success);
  background: color-mix(in srgb, var(--rs-success) 6%, var(--rs-surface));
}

.nm-monitor__slowlog-profiler--off {
  color: var(--rs-warning);
  background: color-mix(in srgb, var(--rs-warning) 6%, var(--rs-surface));
}

.nm-monitor__slowlog-loading {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-monitor__slowlog-command {
  font-family: var(--rs-font-mono);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  max-width: 100%;
}

.nm-monitor__section--db {
  flex-shrink: 0;
}

.nm-monitor__section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  /* gradient header background */
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--rs-accent) 5%, var(--rs-surface-subtle)),
    var(--rs-surface-subtle)
  );
}

.nm-monitor__section--compact .nm-monitor__section-head {
  padding: 6px var(--rs-space-sm);
}

.nm-monitor__section-icon {
  color: var(--rs-accent);
}

.nm-monitor__section-hint {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-weight: 400;
  margin-left: 2px;
}

.nm-monitor__section-hint--rate {
  margin-left: auto;
  font-style: italic;
}

.nm-monitor__rate-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  background: color-mix(in srgb, var(--rs-info) 12%, transparent);
  color: var(--rs-info);
  border: 1px solid color-mix(in srgb, var(--rs-info) 22%, transparent);
  margin-left: 4px;
  cursor: default;
}

.nm-monitor__db-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
  background: color-mix(in srgb, var(--rs-accent) 12%, transparent);
  color: var(--rs-accent);
  border: 1px solid color-mix(in srgb, var(--rs-accent) 22%, transparent);
  margin-left: 2px;
}

.nm-monitor__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--rs-accent) 15%, transparent);
  color: var(--rs-accent);
  font-size: 10px;
  font-weight: 600;
}

.nm-monitor__badge--danger {
  background: color-mix(in srgb, var(--rs-danger) 15%, transparent);
  color: var(--rs-danger);
}

/* ── DB stats grid (full-width row) ── */
.nm-monitor__db-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 1px;
  background: var(--rs-border-subtle);
}

@media (max-width: 1100px) {
  .nm-monitor__db-grid { grid-template-columns: repeat(3, 1fr); }
}

@media (max-width: 600px) {
  .nm-monitor__db-grid { grid-template-columns: repeat(2, 1fr); }
}

.nm-monitor__db-cell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--rs-space-md) var(--rs-space-sm);
  background: var(--rs-surface);
  text-align: center;
  cursor: default;
  transition: background 0.12s;
  min-height: 72px;
}

.nm-monitor__db-cell:hover {
  background: color-mix(in srgb, var(--rs-info) 5%, var(--rs-surface));
}

.nm-monitor__db-cell-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  white-space: nowrap;
}

.nm-monitor__db-cell-value {
  font-size: var(--rs-font-size-sm);
  font-weight: 700;
  color: var(--rs-foreground);
  font-variant-numeric: tabular-nums;
}

/* ── Current ops table wrapper ── */
.nm-monitor__table-wrap {
  height: 280px;
  min-height: 280px;
  max-height: 280px;
  overflow: hidden;
  flex-shrink: 0;
}

.nm-monitor__table-wrap :deep(.rs-table-shell) {
  height: 100%;
  min-height: 0;
  border-radius: 0;
}

.nm-monitor__table-wrap :deep(.rs-table) {
  border-radius: 0;
}

.nm-monitor__empty-ops-inline {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: var(--rs-space-md);
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
/* ── DB empty hint ── */
.nm-monitor__db-empty-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  background: color-mix(in srgb, var(--rs-warning) 6%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--rs-warning) 15%, transparent);
}

/* ── Op counters grid ── */
.nm-monitor__op-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--rs-border-subtle);
}

.nm-monitor__op-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: var(--rs-space-md) var(--rs-space-sm);
  background: var(--rs-surface);
  text-align: center;
  cursor: default;
  transition: background 0.12s, transform 0.12s;
  border-top: 2px solid transparent;
}

.nm-monitor__op-item:hover {
  background: color-mix(in srgb, var(--rs-accent) 4%, var(--rs-surface));
  transform: translateY(-1px);
}

.nm-monitor__op-item--insert { border-top-color: color-mix(in srgb, var(--rs-success) 55%, transparent); }
.nm-monitor__op-item--query  { border-top-color: color-mix(in srgb, var(--rs-info) 55%, transparent); }
.nm-monitor__op-item--update { border-top-color: color-mix(in srgb, var(--rs-warning) 55%, transparent); }
.nm-monitor__op-item--delete { border-top-color: color-mix(in srgb, var(--rs-danger) 55%, transparent); }
.nm-monitor__op-item--getmore { border-top-color: color-mix(in srgb, var(--rs-muted) 45%, transparent); }
.nm-monitor__op-item--command { border-top-color: color-mix(in srgb, var(--rs-accent) 55%, transparent); }

.nm-monitor__op-icon {
  width: 28px;
  height: 28px;
  border-radius: var(--rs-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--rs-accent) 10%, transparent);
  color: var(--rs-accent);
  flex-shrink: 0;
}

.nm-monitor__op-label {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  white-space: nowrap;
}

.nm-monitor__op-value {
  font-size: var(--rs-font-size-sm);
  font-weight: 700;
  color: var(--rs-foreground);
  font-variant-numeric: tabular-nums;
}

.nm-monitor__op-rate {
  font-size: 10px;
  font-style: italic;
  color: var(--rs-info);
  font-variant-numeric: tabular-nums;
}

/* ── Stat rows (mem / db stats) ── */
.nm-monitor__stat-rows {
  padding: var(--rs-space-xs) var(--rs-space-xs);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nm-monitor__stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px var(--rs-space-xs);
  border-radius: var(--rs-radius-sm);
  font-size: var(--rs-font-size-sm);
  cursor: default;
  transition: background 0.1s;
}

.nm-monitor__stat-row--alt {
  background: color-mix(in srgb, var(--rs-surface-subtle) 70%, transparent);
}

.nm-monitor__stat-row:hover {
  background: color-mix(in srgb, var(--rs-accent) 6%, var(--rs-surface));
}

.nm-monitor__stat-label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--rs-muted);
}

.nm-monitor__info-icon {
  color: var(--rs-border);
  flex-shrink: 0;
  transition: color 0.1s;
}

.nm-monitor__stat-row:hover .nm-monitor__info-icon {
  color: var(--rs-muted);
}

.nm-monitor__stat-value {
  font-weight: 600;
  color: var(--rs-foreground);
  font-variant-numeric: tabular-nums;
}

.nm-monitor__stat-value--zero {
  color: var(--rs-muted);
  font-weight: 400;
}

/* ── Current ops ── */
.nm-monitor__empty-icon {
  color: var(--rs-success);
}

/* op type badges */
.nm-monitor__op-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  background: var(--rs-surface-subtle);
  color: var(--rs-muted);
  border: 1px solid var(--rs-border-subtle);
}

.nm-monitor__op-badge--query    { color: var(--rs-info);    background: color-mix(in srgb, var(--rs-info)    10%, transparent); border-color: color-mix(in srgb, var(--rs-info)    25%, transparent); }
.nm-monitor__op-badge--insert   { color: var(--rs-success); background: color-mix(in srgb, var(--rs-success) 10%, transparent); border-color: color-mix(in srgb, var(--rs-success) 25%, transparent); }
.nm-monitor__op-badge--update   { color: var(--rs-warning); background: color-mix(in srgb, var(--rs-warning) 10%, transparent); border-color: color-mix(in srgb, var(--rs-warning) 25%, transparent); }
.nm-monitor__op-badge--delete   { color: var(--rs-danger);  background: color-mix(in srgb, var(--rs-danger)  10%, transparent); border-color: color-mix(in srgb, var(--rs-danger)  25%, transparent); }
.nm-monitor__op-badge--command  { color: var(--rs-accent);  background: color-mix(in srgb, var(--rs-accent)  10%, transparent); border-color: color-mix(in srgb, var(--rs-accent)  25%, transparent); }
.nm-monitor__op-badge--getmore  { color: var(--rs-muted);   background: var(--rs-surface-subtle); }
.nm-monitor__op-badge--internal { color: var(--rs-muted);   background: var(--rs-surface-subtle); margin-left: 4px; font-weight: 500; }

/* ── Op detail dialog ── */
.nm-monitor__op-detail {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
  min-width: 0;
}

.nm-monitor__op-detail-toolbar {
  display: flex;
  justify-content: flex-end;
}

.nm-monitor__op-detail-pre {
  margin: 0;
  padding: var(--rs-space-md);
  font-family: var(--rs-font-mono);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  max-height: 55vh;
  overflow: auto;
  background: var(--rs-surface-subtle);
}

.nm-monitor__dur-cell {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--rs-foreground);
}

.nm-monitor__dur-cell--warn {
  color: var(--rs-warning);
}

.nm-monitor__dur-cell--danger {
  color: var(--rs-danger);
}

/* ── Raw data ── */
.nm-monitor__section--raw {
  border-color: var(--rs-border-subtle);
  background: var(--rs-surface);
  box-shadow: none;
}

.nm-monitor__raw-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: var(--rs-space-xs) var(--rs-space-md);
  background: none;
  border: none;
  cursor: pointer;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  text-align: left;
  transition: color 0.12s, background 0.12s;
}

.nm-monitor__raw-toggle:hover {
  background: var(--rs-surface-subtle);
  color: var(--rs-foreground);
}

.nm-monitor__raw-pre {
  margin: 0;
  padding: var(--rs-space-md);
  font-family: var(--rs-font-mono);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  border-top: 1px solid var(--rs-border-subtle);
  max-height: 400px;
  overflow: auto;
  background: var(--rs-surface-subtle);
}

/* ── Empty state ── */
.nm-monitor__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rs-space-sm);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
}

.nm-monitor__empty-icon-lg {
  color: var(--rs-border);
}
</style>
