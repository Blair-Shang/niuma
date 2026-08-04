<script setup lang="ts">
import {
  RsButton,
  RsConfirmDialog,
  RsDialog,
  RsEmpty,
  RsInput,
  RsLoading,
  RsSelect,
  RsTable,
  useRsToast,
  type RsContextMenuItem,
  type RsSelectOptions,
  type RsTableColumn,
} from '@niuma/ui'
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { oracleApi } from '@/api/oracle'
import type {
  OracleLockInfo,
  OracleMetaInstanceOverviewResult,
  OracleProcessInfo,
} from '@/api/types/oracle'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

type MonitorTab = 'instance' | 'processes' | 'locks'
type ProcessRow = Record<string, unknown> & {
  __rowKey: string
  id: number
  serial?: number
  time: number
  command: string
  state?: string
  sqlId?: string
  waitClass?: string
  blockingSession?: number
}
type LockRow = Record<string, unknown> & {
  __rowKey: string
  waitingPid: number
  waitingSerial?: number | string
  blockingPid: number
  blockingSerial?: number | string
}

const LONG_RUNNING_SECS = 60

const activeTab = ref<MonitorTab>('instance')
const autoRefreshSecs = ref('0')
let refreshTimer: ReturnType<typeof setInterval> | null = null
const scopeOk = computed(() => Boolean(props.sessionId))

/** Oracle STATUS：INACTIVE 空闲；ACTIVE 等视为活动。兼容 Idle/Sleep。 */
function isIdleState(p: Pick<OracleProcessInfo, 'command' | 'state'>): boolean {
  const s = (p.command ?? p.state ?? '').toLowerCase()
  return s === 'inactive' || s === 'idle' || s === 'sleep'
}

function processRowKey(p: Pick<OracleProcessInfo, 'id' | 'serial'>): string {
  return p.serial != null && p.serial > 0 ? `${p.id}:${p.serial}` : String(p.id)
}

function lockRowKey(
  l: Pick<
    OracleLockInfo,
    'waitingPid' | 'waitingSerial' | 'blockingPid' | 'blockingSerial' | 'enqueueType' | 'objectName'
  >,
): string {
  return [
    l.waitingPid,
    l.waitingSerial ?? 0,
    l.blockingPid,
    l.blockingSerial ?? 0,
    l.enqueueType ?? '',
    l.objectName ?? '',
  ].join(':')
}

/** 紧凑时长：65 → 1m 5s；3661 → 1h 1m 1s */
function formatDuration(secs?: number | null): string {
  if (secs == null || !Number.isFinite(secs)) return '—'
  const n = Math.max(0, Math.floor(secs))
  if (n < 60) return `${n}s`
  const d = Math.floor(n / 86400)
  const hrs = Math.floor((n % 86400) / 3600)
  const m = Math.floor((n % 3600) / 60)
  const s = n % 60
  const parts: string[] = []
  if (d) parts.push(`${d}d`)
  if (hrs || d) parts.push(`${hrs}h`)
  if (m || hrs || d) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

function formatUptime(secs?: number): string {
  return formatDuration(secs)
}

const dialogHostEl = ref<HTMLElement | null>(null)
const dialogTeleportReady = ref(false)
onMounted(() => {
  dialogTeleportReady.value = dialogHostEl.value != null
})

const autoRefreshOptions = computed<RsSelectOptions>(() => [
  { value: '0', label: t('modules.oracle.monitor.refreshOff') },
  { value: '3', label: t('modules.oracle.monitor.refresh3s') },
  { value: '5', label: t('modules.oracle.monitor.refresh5s') },
  { value: '10', label: t('modules.oracle.monitor.refresh10s') },
])

const monitorTabs = computed(() =>
  (['instance', 'processes', 'locks'] as const).map((tab) => ({
    id: tab,
    label: t(`modules.oracle.monitor.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`),
  })),
)

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

// ─── Instance overview ─────────────────────────────────────────────────────
const overviewLoading = ref(false)
const overview = ref<OracleMetaInstanceOverviewResult | null>(null)

async function loadOverview(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) overviewLoading.value = true
  try {
    overview.value = await oracleApi.metaInstanceOverview({ sessionId: props.sessionId })
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) overviewLoading.value = false
  }
}

// ─── Sessions (processlist) ────────────────────────────────────────────────
const processesBusy = ref(false)
const processes = ref<OracleProcessInfo[]>([])
const processesUnavailable = ref(false)
const processesMessage = ref('')
const processFilter = ref('all')
const processQuery = ref('')
const highlightedRowKey = ref<string | undefined>(undefined)
const detailOpen = ref(false)
const detailProcess = ref<OracleProcessInfo | null>(null)
const confirmOpen = ref(false)
const pendingKill = ref<{
  id: number
  serial?: number
  queryOnly: boolean
  user?: string
  host?: string
} | null>(null)
const killBusy = ref(false)

const processFilterOptions = computed<RsSelectOptions>(() => [
  { value: 'all', label: t('modules.oracle.monitor.filterAll') },
  { value: 'active', label: t('modules.oracle.monitor.filterActive') },
  { value: 'idle', label: t('modules.oracle.monitor.filterIdle') },
  { value: 'query', label: t('modules.oracle.monitor.filterQuery') },
  { value: 'long', label: t('modules.oracle.monitor.filterLong') },
  { value: 'blocked', label: t('modules.oracle.monitor.filterBlocked') },
])

const filteredProcesses = computed(() => {
  const q = processQuery.value.trim().toLowerCase()
  const filter = processFilter.value
  return processes.value.filter((p) => {
    const idle = isIdleState(p)
    const hasInfo = Boolean(p.info?.trim())
    const blocked = (p.blockingSession ?? 0) > 0
    if (filter === 'active' && idle) return false
    if (filter === 'idle' && !idle) return false
    if (filter === 'query' && !hasInfo) return false
    if (filter === 'long' && (idle || (p.time ?? 0) < LONG_RUNNING_SECS)) return false
    if (filter === 'blocked' && !blocked) return false
    if (!q) return true
    const hay = [
      p.user,
      p.host,
      p.db,
      p.command,
      p.state,
      p.waitClass,
      p.sqlId,
      p.info,
      String(p.id),
      p.serial != null ? String(p.serial) : '',
      p.blockingSession != null ? String(p.blockingSession) : '',
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
})

function isLongRunning(p: Pick<OracleProcessInfo, 'command' | 'state' | 'time'>): boolean {
  return !isIdleState(p) && (p.time ?? 0) >= LONG_RUNNING_SECS
}

const processColumns = computed((): RsTableColumn<ProcessRow>[] => [
  { key: 'id', title: t('modules.oracle.monitor.colId'), width: 72 },
  { key: 'serial', title: t('modules.oracle.monitor.colSerial'), width: 80 },
  { key: 'user', title: t('modules.oracle.monitor.colUser'), minWidth: 90, ellipsis: true },
  { key: 'host', title: t('modules.oracle.monitor.colHost'), minWidth: 110, ellipsis: true },
  { key: 'db', title: t('modules.oracle.monitor.colDb'), minWidth: 90, ellipsis: true },
  { key: 'command', title: t('modules.oracle.monitor.colCommand'), width: 96 },
  {
    key: 'time',
    title: t('modules.oracle.monitor.colTime'),
    width: 100,
    render: (row: ProcessRow) => {
      const long = isLongRunning(row)
      return h(
        'span',
        {
          class: long ? 'nm-oracle-monitor__time--long' : undefined,
          title: long
            ? t('modules.oracle.monitor.longRunningTip', { n: LONG_RUNNING_SECS })
            : `${row.time ?? 0}s`,
        },
        formatDuration(row.time),
      ) as unknown as string
    },
  },
  { key: 'state', title: t('modules.oracle.monitor.colState'), minWidth: 130, ellipsis: true },
  { key: 'waitClass', title: t('modules.oracle.monitor.colWaitClass'), width: 100, ellipsis: true },
  { key: 'sqlId', title: t('modules.oracle.monitor.colSqlId'), width: 120, ellipsis: true },
  {
    key: 'blockingSession',
    title: t('modules.oracle.monitor.colBlocking'),
    width: 88,
    render: (row: ProcessRow) => {
      const sid = row.blockingSession
      if (sid == null || sid <= 0) return ''
      return h(
        'span',
        { class: 'nm-oracle-monitor__blocking', title: `SID ${sid}` },
        String(sid),
      ) as unknown as string
    },
  },
  { key: 'info', title: t('modules.oracle.monitor.colInfo'), minWidth: 180, ellipsis: true },
])

const processRows = computed<ProcessRow[]>(() =>
  filteredProcesses.value.map((p) => ({
    __rowKey: processRowKey(p),
    id: p.id,
    serial: p.serial,
    user: p.user,
    host: p.host,
    db: p.db ?? '',
    command: p.command,
    time: p.time,
    state: p.state ?? '',
    waitClass: p.waitClass ?? '',
    sqlId: p.sqlId ?? '',
    blockingSession: p.blockingSession ?? undefined,
    info: p.info ?? '',
  })),
)

const selectedProcess = computed(() => {
  if (!highlightedRowKey.value) return null
  return processes.value.find((p) => processRowKey(p) === highlightedRowKey.value) ?? null
})

const selectedId = computed(() => selectedProcess.value?.id ?? null)

const detailRows = computed(() => {
  const p = detailProcess.value
  if (!p) return []
  return [
    { key: 'id', label: t('modules.oracle.monitor.colId'), value: String(p.id) },
    {
      key: 'serial',
      label: t('modules.oracle.monitor.colSerial'),
      value: p.serial != null ? String(p.serial) : '—',
    },
    { key: 'user', label: t('modules.oracle.monitor.colUser'), value: p.user || '—' },
    { key: 'host', label: t('modules.oracle.monitor.colHost'), value: p.host || '—' },
    { key: 'db', label: t('modules.oracle.monitor.colDb'), value: p.db || '—' },
    { key: 'command', label: t('modules.oracle.monitor.colCommand'), value: p.command || '—' },
    {
      key: 'time',
      label: t('modules.oracle.monitor.colTime'),
      value: `${formatDuration(p.time)} (${p.time ?? 0}s)`,
    },
    { key: 'state', label: t('modules.oracle.monitor.colState'), value: p.state || '—' },
    {
      key: 'waitClass',
      label: t('modules.oracle.monitor.colWaitClass'),
      value: p.waitClass || '—',
    },
    { key: 'sqlId', label: t('modules.oracle.monitor.colSqlId'), value: p.sqlId || '—' },
    {
      key: 'blockingSession',
      label: t('modules.oracle.monitor.colBlocking'),
      value: p.blockingSession != null && p.blockingSession > 0 ? String(p.blockingSession) : '—',
    },
    { key: 'info', label: t('modules.oracle.monitor.colInfo'), value: p.info?.trim() || '—' },
  ]
})

async function loadProcesses(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) processesBusy.value = true
  try {
    await applyProcesslist(props.sessionId)
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) processesBusy.value = false
  }
}

async function applyProcesslist(sessionId: string): Promise<void> {
  const result = await oracleApi.metaProcesslist({ sessionId })
  processes.value = result.processes ?? []
  processesUnavailable.value = result.unavailable ?? false
  processesMessage.value = result.message ?? ''
  if (
    highlightedRowKey.value &&
    !processes.value.some((p) => processRowKey(p) === highlightedRowKey.value)
  ) {
    highlightedRowKey.value = undefined
  }
  if (detailProcess.value) {
    const key = processRowKey(detailProcess.value)
    const next = processes.value.find((p) => processRowKey(p) === key) ?? null
    detailProcess.value = next
    if (!next) detailOpen.value = false
  }
}

function onRowClick(row: Record<string, unknown>): void {
  const key = row.__rowKey != null ? String(row.__rowKey) : String(row.id ?? '')
  highlightedRowKey.value = key || undefined
}

function openProcessDetail(row: ProcessRow | null): void {
  if (!row) return
  const key = row.__rowKey || processRowKey(row)
  const proc = processes.value.find((p) => processRowKey(p) === key)
  if (!proc) {
    toast.error(t('modules.oracle.monitor.sessionNotFound'))
    return
  }
  highlightedRowKey.value = processRowKey(proc)
  detailProcess.value = proc
  detailOpen.value = true
}

function askKill(queryOnly: boolean, proc?: OracleProcessInfo | null): void {
  const target = proc ?? selectedProcess.value
  if (!target) return
  pendingKill.value = {
    id: target.id,
    serial: target.serial,
    queryOnly,
    user: target.user,
    host: target.host,
  }
  confirmOpen.value = true
}

function processContextMenuItems(row: ProcessRow | null): RsContextMenuItem[] {
  if (!row) return []
  const items: RsContextMenuItem[] = [
    {
      key: 'process-detail',
      label: t('modules.oracle.monitor.viewDetail'),
      icon: 'info',
    },
  ]
  if (row.blockingSession != null && row.blockingSession > 0) {
    items.push({
      key: 'jump-blocker',
      label: `${t('modules.oracle.monitor.jumpToProcess')} (#${row.blockingSession})`,
      icon: 'arrow-right',
    })
  }
  items.push(
    { key: 'sep-ops', label: '', separator: true },
    {
      key: 'kill-query',
      label: t('modules.oracle.monitor.killQuery'),
      icon: 'circle-x',
    },
    {
      key: 'kill-conn',
      label: t('modules.oracle.monitor.killConn'),
      icon: 'unplug',
      danger: true,
    },
  )
  return items
}

function onProcessContextMenuSelect(key: string, row: ProcessRow | null): void {
  if (!row) return
  const rowKey = row.__rowKey || processRowKey(row)
  const proc = processes.value.find((p) => processRowKey(p) === rowKey) ?? null
  if (key === 'process-detail') openProcessDetail(row)
  else if (key === 'jump-blocker' && row.blockingSession) jumpToProcess(row.blockingSession)
  else if (key === 'kill-query') askKill(true, proc)
  else if (key === 'kill-conn') askKill(false, proc)
}

async function confirmKill(): Promise<void> {
  if (!props.sessionId || !pendingKill.value) return
  const intendedQueryOnly = pendingKill.value.queryOnly
  killBusy.value = true
  try {
    const result = await oracleApi.metaKill({
      sessionId: props.sessionId,
      id: pendingKill.value.id,
      serial: pendingKill.value.serial,
      queryOnly: pendingKill.value.queryOnly,
    })
    if (intendedQueryOnly && result.queryOnly === false) {
      toast.success(t('modules.oracle.monitor.killFallbackOk'))
    } else if (result.queryOnly) {
      toast.success(t('modules.oracle.monitor.killQueryOk'))
    } else {
      toast.success(t('modules.oracle.monitor.killConnOk'))
    }
    confirmOpen.value = false
    pendingKill.value = null
    detailOpen.value = false
    await loadProcesses(true)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    killBusy.value = false
  }
}

const killConfirmDescription = computed(() => {
  const k = pendingKill.value
  if (!k) return ''
  let who = ''
  if (k.user || k.host) {
    who = `${k.user ?? ''}${k.host ? `@${k.host}` : ''}`
  }
  const key = k.queryOnly
    ? 'modules.oracle.monitor.killQueryDesc'
    : 'modules.oracle.monitor.killConnDesc'
  return t(key, {
    sid: k.id,
    serial: k.serial != null && k.serial > 0 ? k.serial : '?',
    who,
  })
})

// ─── Blocking waits ──────────────────────────────────────────────────────────
const locksLoading = ref(false)
const locks = ref<OracleLockInfo[]>([])
const locksTruncated = ref(false)
const locksUnavailable = ref(false)
const locksMessage = ref('')

const lockColumns = computed<RsTableColumn<LockRow>[]>(() => {
  const cols: RsTableColumn<LockRow>[] = [
    { key: 'waitingPid', title: t('modules.oracle.monitor.lockWaitPid'), width: 80 },
    { key: 'waitingSerial', title: t('modules.oracle.monitor.lockWaitSerial'), width: 96 },
    { key: 'blockingPid', title: t('modules.oracle.monitor.lockBlockPid'), width: 80 },
    { key: 'blockingSerial', title: t('modules.oracle.monitor.lockBlockSerial'), width: 96 },
    { key: 'waitingUser', title: t('modules.oracle.monitor.lockWaitUser'), minWidth: 90, ellipsis: true },
    { key: 'blockingUser', title: t('modules.oracle.monitor.lockBlockUser'), minWidth: 90, ellipsis: true },
    { key: 'waitEvent', title: t('modules.oracle.monitor.lockType'), minWidth: 120, ellipsis: true },
    { key: 'waitClass', title: t('modules.oracle.monitor.lockWaitClass'), width: 100, ellipsis: true },
  ]
  const hasEnqueue = locks.value.some((l) => l.enqueueType || l.lockMode || l.objectName)
  if (hasEnqueue) {
    cols.push(
      { key: 'enqueueType', title: t('modules.oracle.monitor.lockEnqueue'), width: 80 },
      { key: 'lockMode', title: t('modules.oracle.monitor.lockMode'), width: 110, ellipsis: true },
      { key: 'objectName', title: t('modules.oracle.monitor.lockObject'), minWidth: 120, ellipsis: true },
    )
  }
  cols.push(
    {
      key: 'waitAge',
      title: t('modules.oracle.monitor.lockWaitAge'),
      width: 100,
    },
    { key: 'waitingQuery', title: t('modules.oracle.monitor.lockWaitQuery'), minWidth: 200, ellipsis: true },
  )
  return cols
})

const lockRows = computed<LockRow[]>(() =>
  locks.value.map((l) => ({
    __rowKey: lockRowKey(l),
    waitingPid: l.waitingPid,
    waitingSerial: l.waitingSerial ?? '',
    blockingPid: l.blockingPid,
    blockingSerial: l.blockingSerial ?? '',
    waitingUser: l.waitingUser ?? '',
    blockingUser: l.blockingUser ?? '',
    waitEvent: l.waitEvent ?? l.lockType ?? '',
    waitClass: l.waitClass ?? '',
    enqueueType: l.enqueueType ?? '',
    lockMode: l.lockMode ?? '',
    objectName: l.objectName ?? '',
    waitAge:
      l.waitAgeSeconds != null ? formatDuration(l.waitAgeSeconds) : '',
    waitingQuery: l.waitingQuery ?? '',
  })),
)

async function loadLocks(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) locksLoading.value = true
  try {
    const result = await oracleApi.metaLocks({ sessionId: props.sessionId })
    locks.value = result.locks ?? []
    locksTruncated.value = result.truncated ?? false
    locksUnavailable.value = result.unavailable ?? false
    locksMessage.value = result.message ?? ''
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) locksLoading.value = false
  }
}

function jumpToProcess(pid: number, serial?: number): void {
  if (!Number.isFinite(pid) || pid <= 0) return
  activeTab.value = 'processes'
  const apply = (proc: OracleProcessInfo | undefined): void => {
    if (!proc) return
    highlightedRowKey.value = processRowKey(proc)
    detailProcess.value = proc
    detailOpen.value = true
  }
  const match = (list: OracleProcessInfo[]): OracleProcessInfo | undefined => {
    if (serial != null && serial > 0) {
      const exact = list.find((p) => p.id === pid && p.serial === serial)
      if (exact) return exact
    }
    return list.find((p) => p.id === pid)
  }
  const proc = match(processes.value)
  if (proc) {
    apply(proc)
  } else {
    highlightedRowKey.value =
      serial != null && serial > 0 ? `${pid}:${serial}` : String(pid)
    void loadProcesses(true).then(() => {
      apply(match(processes.value))
    })
  }
}

function onLockRowClick(row: Record<string, unknown>): void {
  const pid = Number(row.waitingPid)
  const serial = Number(row.waitingSerial)
  if (!Number.isFinite(pid)) return
  jumpToProcess(pid, Number.isFinite(serial) && serial > 0 ? serial : undefined)
}

function lockContextMenuItems(row: LockRow | null): RsContextMenuItem[] {
  if (!row) return []
  const items: RsContextMenuItem[] = [
    {
      key: 'jump-waiting',
      label: `${t('modules.oracle.monitor.jumpToProcess')} (#${row.waitingPid}${row.waitingSerial ? ',' + row.waitingSerial : ''})`,
      icon: 'arrow-right',
    },
  ]
  if (row.blockingPid > 0) {
    items.push({
      key: 'jump-blocking',
      label: `${t('modules.oracle.monitor.jumpToProcess')} (#${row.blockingPid}${row.blockingSerial ? ',' + row.blockingSerial : ''})`,
      icon: 'arrow-right',
    })
  }
  return items
}

function onLockContextMenuSelect(key: string, row: LockRow | null): void {
  if (!row) return
  if (key === 'jump-waiting') {
    jumpToProcess(
      row.waitingPid,
      typeof row.waitingSerial === 'number' ? row.waitingSerial : Number(row.waitingSerial) || undefined,
    )
  } else if (key === 'jump-blocking') {
    jumpToProcess(
      row.blockingPid,
      typeof row.blockingSerial === 'number' ? row.blockingSerial : Number(row.blockingSerial) || undefined,
    )
  }
}

// ─── Tab switching + loading ───────────────────────────────────────────────
async function loadCurrentTab(quiet = false): Promise<void> {
  if (activeTab.value === 'instance') await loadOverview(quiet)
  else if (activeTab.value === 'processes') await loadProcesses(quiet)
  else await loadLocks(quiet)
}

const loading = computed(() => {
  if (activeTab.value === 'instance') return overviewLoading.value
  if (activeTab.value === 'processes') return processesBusy.value
  return locksLoading.value
})

watch(
  () => props.sessionId,
  (sid) => {
    if (sid && props.active) {
      void loadCurrentTab()
      setupTimer()
    } else {
      clearTimer()
    }
  },
  { immediate: true },
)

/** keep-alive 切回：恢复定时器；已有数据则静默刷新，避免整页 loading。 */
watch(
  () => props.active,
  (active) => {
    if (!props.sessionId) {
      clearTimer()
      return
    }
    if (!active) {
      clearTimer()
      return
    }
    const hasData =
      overview.value != null || processes.value.length > 0 || locks.value.length > 0
    if (hasData) {
      void loadCurrentTab(true)
    } else {
      void loadCurrentTab()
    }
    setupTimer()
  },
)

watch(activeTab, (tab) => {
  if (tab !== 'processes') {
    detailOpen.value = false
    detailProcess.value = null
  }
  void loadCurrentTab()
})

watch(autoRefreshSecs, () => setupTimer())

onBeforeUnmount(() => clearTimer())
</script>

<template>
  <div class="nm-oracle-monitor">
    <div ref="dialogHostEl" class="nm-oracle-monitor__dialog-mount" aria-hidden="true" />

    <header class="nm-oracle-monitor__header">
      <div class="nm-oracle-monitor__tabs">
        <button
          v-for="tab in monitorTabs"
          :key="tab.id"
          type="button"
          class="nm-oracle-monitor__tab"
          :class="{ 'nm-oracle-monitor__tab--active': activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="nm-oracle-monitor__actions">
        <template v-if="activeTab === 'processes'">
          <span v-if="selectedProcess" class="nm-oracle-monitor__selected">
            SID {{ selectedProcess.id }}
            <template v-if="selectedProcess.serial">,{{ selectedProcess.serial }}</template>
            <template v-if="selectedProcess.user"> · {{ selectedProcess.user }}</template>
            <template v-if="selectedProcess.host">@{{ selectedProcess.host }}</template>
          </span>
          <RsButton
            size="sm"
            variant="ghost"
            :disabled="selectedId == null || killBusy"
            @click="askKill(true)"
          >
            {{ t('modules.oracle.monitor.killQuery') }}
          </RsButton>
          <RsButton
            size="sm"
            variant="danger"
            :disabled="selectedId == null || killBusy"
            @click="askKill(false)"
          >
            {{ t('modules.oracle.monitor.killConn') }}
          </RsButton>
        </template>
        <RsSelect
          v-model="autoRefreshSecs"
          size="sm"
          :options="autoRefreshOptions"
          :placeholder="t('modules.oracle.monitor.autoRefresh')"
        />
        <RsButton size="sm" variant="ghost" icon="refresh-cw" :loading="loading" @click="loadCurrentTab()">
          {{ t('modules.oracle.monitor.refresh') }}
        </RsButton>
      </div>
    </header>

    <div
      v-if="activeTab === 'processes' && scopeOk"
      class="nm-oracle-monitor__filters"
    >
      <RsSelect
        v-model="processFilter"
        size="sm"
        :options="processFilterOptions"
        class="nm-oracle-monitor__filter-select"
      />
      <RsInput
        v-model="processQuery"
        size="sm"
        clearable
        class="nm-oracle-monitor__filter-input"
        :placeholder="t('modules.oracle.monitor.filterPlaceholder')"
      />
      <span class="nm-oracle-monitor__filter-meta">
        {{ filteredProcesses.length }} / {{ processes.length }}
      </span>
    </div>


    <div class="nm-oracle-monitor__body">
      <!-- 实例概览 -->
      <template v-if="activeTab === 'instance'">
        <RsLoading v-if="overviewLoading && !overview" class="nm-oracle-monitor__loading" />
        <RsEmpty
          v-else-if="!sessionId"
          radius="none"
          icon-radius="none"
          :description="t('modules.oracle.monitor.needSession')"
        />
        <div v-else-if="overview" class="nm-oracle-monitor__overview">
          <div v-if="overview.statusPartial" class="nm-oracle-monitor__banner nm-oracle-monitor__banner--warn">
            {{ t('modules.oracle.monitor.statusPartial') }}
            <span v-if="overview.warnings?.length"> — {{ overview.warnings.join('; ') }}</span>
          </div>
          <div class="nm-oracle-monitor__overview-grid">
            <div class="nm-oracle-monitor__stat">
              <span class="nm-oracle-monitor__stat-label">{{ t('modules.oracle.monitor.instanceVersion') }}</span>
              <span class="nm-oracle-monitor__stat-value">{{ overview.version }}</span>
            </div>
            <div v-if="overview.versionComment" class="nm-oracle-monitor__stat">
              <span class="nm-oracle-monitor__stat-label">{{ t('modules.oracle.monitor.instanceComment') }}</span>
              <span class="nm-oracle-monitor__stat-value nm-oracle-monitor__stat-value--muted">{{ overview.versionComment }}</span>
            </div>
            <div v-if="overview.currentDatabase" class="nm-oracle-monitor__stat">
              <span class="nm-oracle-monitor__stat-label">{{ t('modules.oracle.monitor.instancePdb') }}</span>
              <span class="nm-oracle-monitor__stat-value">{{ overview.currentDatabase }}</span>
            </div>
            <div v-if="overview.currentUser" class="nm-oracle-monitor__stat">
              <span class="nm-oracle-monitor__stat-label">{{ t('modules.oracle.monitor.instanceUser') }}</span>
              <span class="nm-oracle-monitor__stat-value">{{ overview.currentUser }}</span>
            </div>
            <div v-if="overview.currentSchema" class="nm-oracle-monitor__stat">
              <span class="nm-oracle-monitor__stat-label">{{ t('modules.oracle.monitor.instanceSchema') }}</span>
              <span class="nm-oracle-monitor__stat-value">{{ overview.currentSchema }}</span>
            </div>
            <div v-if="overview.serverAddr" class="nm-oracle-monitor__stat">
              <span class="nm-oracle-monitor__stat-label">{{ t('modules.oracle.monitor.instanceAddr') }}</span>
              <span class="nm-oracle-monitor__stat-value">{{ overview.serverAddr }}</span>
            </div>
            <div v-if="overview.uptimeSeconds != null" class="nm-oracle-monitor__stat">
              <span class="nm-oracle-monitor__stat-label">{{ t('modules.oracle.monitor.instanceUptime') }}</span>
              <span class="nm-oracle-monitor__stat-value">{{ formatUptime(overview.uptimeSeconds) }}</span>
            </div>
            <div v-if="overview.databaseCount != null" class="nm-oracle-monitor__stat">
              <span class="nm-oracle-monitor__stat-label">{{ t('modules.oracle.monitor.instanceSchemas') }}</span>
              <span class="nm-oracle-monitor__stat-value nm-oracle-monitor__stat-value--accent">{{ overview.schemaCount ?? overview.databaseCount }}</span>
            </div>
            <div class="nm-oracle-monitor__stat">
              <span class="nm-oracle-monitor__stat-label">{{ t('modules.oracle.monitor.instanceConnected') }}</span>
              <span class="nm-oracle-monitor__stat-value nm-oracle-monitor__stat-value--accent">
                {{ overview.threadsConnected ?? '—' }}<template v-if="overview.maxSessions ?? overview.maxConnections"> / {{ overview.maxSessions ?? overview.maxConnections }}</template>
              </span>
            </div>
            <div v-if="overview.activeSessions != null" class="nm-oracle-monitor__stat">
              <span class="nm-oracle-monitor__stat-label">{{ t('modules.oracle.monitor.instanceActive') }}</span>
              <span
                class="nm-oracle-monitor__stat-value"
                :class="overview.activeSessions > 0 ? 'nm-oracle-monitor__stat-value--accent' : ''"
              >{{ overview.activeSessions }}</span>
            </div>
            <div v-if="overview.maxSessions != null" class="nm-oracle-monitor__stat">
              <span class="nm-oracle-monitor__stat-label">{{ t('modules.oracle.monitor.instanceMaxSessions') }}</span>
              <span class="nm-oracle-monitor__stat-value">{{ overview.maxSessions }}</span>
            </div>
            <div v-if="overview.maxProcesses != null" class="nm-oracle-monitor__stat">
              <span class="nm-oracle-monitor__stat-label">{{ t('modules.oracle.monitor.instanceMaxProcesses') }}</span>
              <span class="nm-oracle-monitor__stat-value">{{ overview.maxProcesses }}</span>
            </div>
            <div v-if="overview.executeCount != null" class="nm-oracle-monitor__stat">
              <span class="nm-oracle-monitor__stat-label">{{ t('modules.oracle.monitor.instanceExecuteCount') }}</span>
              <span class="nm-oracle-monitor__stat-value">{{ overview.executeCount.toLocaleString() }}</span>
            </div>
          </div>
        </div>
        <RsEmpty v-else radius="none" icon-radius="none" :description="t('modules.oracle.monitor.empty')" />
      </template>

      <!-- 会话列表 -->
      <template v-else-if="activeTab === 'processes'">
        <RsLoading
          v-if="processesBusy && processes.length === 0 && !processesUnavailable"
          class="nm-oracle-monitor__loading"
        />
        <RsEmpty
          v-else-if="!sessionId"
          radius="none"
          icon-radius="none"
          :description="t('modules.oracle.monitor.needSession')"
        />
        <RsEmpty
          v-else-if="processesUnavailable"
          radius="none"
          icon-radius="none"
          :description="t('modules.oracle.monitor.processesUnavailable', { msg: processesMessage || '—' })"
        />
        <RsEmpty
          v-else-if="filteredProcesses.length === 0 && !processesBusy"
          radius="none"
          icon-radius="none"
          :description="
            processes.length === 0
              ? t('modules.oracle.monitor.empty')
              : t('modules.oracle.monitor.filterEmpty')
          "
        />
        <RsTable
          v-else
          v-model:highlighted-row-key="highlightedRowKey"
          :columns="processColumns"
          :data="processRows"
          size="sm"
          fill
          resizable
          cell-tooltip
          highlight-row
          row-key="__rowKey"
          :context-menu-items="processContextMenuItems"
          @row-click="onRowClick"
          @row-dblclick="openProcessDetail"
          @context-menu-select="onProcessContextMenuSelect"
        />
      </template>

      <!-- 阻塞等待 -->
      <template v-else-if="activeTab === 'locks'">
        <RsLoading v-if="locksLoading && locks.length === 0 && !locksUnavailable" class="nm-oracle-monitor__loading" />
        <RsEmpty
          v-else-if="!sessionId"
          radius="none"
          icon-radius="none"
          :description="t('modules.oracle.monitor.needSession')"
        />
        <RsEmpty
          v-else-if="locksUnavailable"
          radius="none"
          icon-radius="none"
          :description="t('modules.oracle.monitor.locksUnavailable', { msg: locksMessage || '—' })"
        />
        <RsEmpty
          v-else-if="locks.length === 0 && !locksLoading"
          radius="none"
          icon-radius="none"
          :description="t('modules.oracle.monitor.locksEmpty')"
        />
        <RsTable
          v-else
          :columns="lockColumns"
          :data="lockRows"
          size="sm"
          fill
          resizable
          cell-tooltip
          row-key="__rowKey"
          :context-menu-items="lockContextMenuItems"
          @row-click="onLockRowClick"
          @row-dblclick="onLockRowClick"
          @context-menu-select="onLockContextMenuSelect"
        />
        <div v-if="locksTruncated" class="nm-oracle-monitor__truncated">
          {{ t('modules.oracle.monitor.locksTruncated') }}
        </div>
      </template>
    </div>

    <RsDialog
      v-if="dialogTeleportReady"
      v-model:open="detailOpen"
      :title="t('modules.oracle.monitor.sessionDetailTitle')"
      width="md"
      layout="confirm"
      :modal="false"
      :show-overlay="false"
      :teleport-to="dialogHostEl ?? undefined"
      :resizable="false"
      :fullscreenable="false"
    >
      <template #body>
        <dl v-if="detailProcess" class="nm-oracle-monitor__detail">
          <div v-for="item in detailRows" :key="item.key" class="nm-oracle-monitor__detail-row">
            <dt>{{ item.label }}</dt>
            <dd :class="{ 'nm-oracle-monitor__detail-query': item.key === 'info' }">
              {{ item.value }}
            </dd>
          </div>
        </dl>
      </template>
      <template #footer>
        <RsButton
          variant="ghost"
          size="sm"
          :disabled="killBusy || !detailProcess"
          @click="askKill(true, detailProcess)"
        >
          {{ t('modules.oracle.monitor.killQuery') }}
        </RsButton>
        <RsButton
          variant="ghost"
          size="sm"
          :disabled="killBusy || !detailProcess"
          @click="askKill(false, detailProcess)"
        >
          {{ t('modules.oracle.monitor.killConn') }}
        </RsButton>
        <RsButton variant="primary" size="sm" @click="detailOpen = false">
          {{ t('common.close') }}
        </RsButton>
      </template>
    </RsDialog>

    <RsConfirmDialog
      v-if="dialogTeleportReady"
      v-model:open="confirmOpen"
      :title="
        pendingKill?.queryOnly
          ? t('modules.oracle.monitor.killQueryTitle')
          : t('modules.oracle.monitor.killConnTitle')
      "
      :description="killConfirmDescription"
      :confirm-text="t('modules.oracle.monitor.killConfirm')"
      tone="danger"
      confirm-variant="danger"
      :show-overlay="false"
      :teleport-to="dialogHostEl ?? undefined"
      @confirm="confirmKill"
    />
  </div>
</template>

<style scoped>
.nm-oracle-monitor {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.nm-oracle-monitor__dialog-mount {
  position: absolute;
  inset: 0;
  z-index: var(--rs-z-modal);
  pointer-events: none;
}
.nm-oracle-monitor__dialog-mount :deep(.rs-dialog__content),
.nm-oracle-monitor__dialog-mount :deep(.rs-confirm-dialog__content) {
  pointer-events: auto;
}
.nm-oracle-monitor__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.nm-oracle-monitor__tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.nm-oracle-monitor__tab {
  padding: 3px 10px;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: var(--rs-radius-sm, 4px);
  cursor: pointer;
  background: transparent;
  color: var(--rs-fg-muted, #6b7280);
  transition: background 0.12s, color 0.12s;
}
.nm-oracle-monitor__tab:hover {
  background: var(--rs-bg-elevated, #f3f4f6);
  color: var(--rs-fg, #111827);
}
.nm-oracle-monitor__tab--active {
  background: var(--rs-accent-subtle, #eff6ff);
  color: var(--rs-accent, #2563eb);
  border-color: var(--rs-accent-border, #bfdbfe);
  font-weight: 500;
}
.nm-oracle-monitor__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}
.nm-oracle-monitor__selected {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--rs-text-muted, #6b7280);
  font-variant-numeric: tabular-nums;
}
.nm-oracle-monitor__filters {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
}
.nm-oracle-monitor__filter-select {
  width: 160px;
  flex-shrink: 0;
}
.nm-oracle-monitor__filter-input {
  width: 260px;
  flex-shrink: 1;
  min-width: 120px;
}
.nm-oracle-monitor__filter-meta {
  font-size: 12px;
  color: var(--rs-fg-muted, #6b7280);
  white-space: nowrap;
}
.nm-oracle-monitor__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.nm-oracle-monitor__loading {
  margin: auto;
}
.nm-oracle-monitor__overview {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
.nm-oracle-monitor__banner {
  margin-bottom: 12px;
  padding: 8px 12px;
  font-size: 12px;
  border-radius: var(--rs-radius-sm, 4px);
}
.nm-oracle-monitor__banner--warn {
  background: color-mix(in srgb, var(--rs-fg-warning, #d97706) 12%, transparent);
  color: var(--rs-fg-warning, #d97706);
}
.nm-oracle-monitor__overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.nm-oracle-monitor__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border: 1px solid var(--rs-border-subtle, #e5e7eb);
  border-radius: var(--rs-radius-md, 6px);
  background: var(--rs-bg-elevated, #f9fafb);
}
.nm-oracle-monitor__stat-label {
  font-size: 11px;
  color: var(--rs-fg-muted, #6b7280);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.nm-oracle-monitor__stat-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--rs-fg, #111827);
  word-break: break-all;
}
.nm-oracle-monitor__stat-value--muted {
  font-size: 13px;
  font-weight: 400;
  color: var(--rs-fg-muted, #6b7280);
}
.nm-oracle-monitor__stat-value--accent {
  color: var(--rs-accent, #2563eb);
}
.nm-oracle-monitor__truncated {
  flex-shrink: 0;
  padding: 4px 12px;
  font-size: 11px;
  color: var(--rs-fg-muted, #6b7280);
  border-top: 1px solid var(--rs-border-subtle, #e5e7eb);
}
.nm-oracle-monitor__detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}
.nm-oracle-monitor__detail-row {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.nm-oracle-monitor__detail-row dt {
  margin: 0;
  font-size: 12px;
  color: var(--rs-fg-muted, #6b7280);
}
.nm-oracle-monitor__detail-row dd {
  margin: 0;
  font-size: 12px;
  word-break: break-word;
}
.nm-oracle-monitor__detail-query {
  font-family: var(--rs-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  white-space: pre-wrap;
  max-height: 240px;
  overflow: auto;
}
:deep(.nm-oracle-monitor__time--long) {
  color: var(--rs-fg-warning, #d97706);
  font-weight: 600;
}
:deep(.nm-oracle-monitor__blocking) {
  color: var(--rs-fg-warning, #d97706);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
