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
import { mysqlApi } from '@/api'
import type {
  MysqlLockInfo,
  MysqlMetaInstanceOverviewResult,
  MysqlProcessInfo,
  MysqlServerKVItem,
} from '@/api/types/mysql'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

type MonitorTab = 'instance' | 'processes' | 'locks' | 'variables' | 'status'
type ProcessRow = Record<string, unknown> & { __rowKey: string; id: number; time: number; command: string }
type LockRow = Record<string, unknown> & { waitingPid: number; blockingPid: number }
type KVRow = Record<string, unknown> & { name: string; value: string }

const LONG_RUNNING_SECS = 60

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
  { value: '0', label: t('modules.mysql.monitor.refreshOff') },
  { value: '3', label: t('modules.mysql.monitor.refresh3s') },
  { value: '5', label: t('modules.mysql.monitor.refresh5s') },
  { value: '10', label: t('modules.mysql.monitor.refresh10s') },
])

const monitorTabs = computed(() =>
  (['instance', 'processes', 'locks', 'variables', 'status'] as const).map((tab) => ({
    id: tab,
    label: t(`modules.mysql.monitor.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`),
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
const overview = ref<MysqlMetaInstanceOverviewResult | null>(null)

async function loadOverview(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) overviewLoading.value = true
  try {
    overview.value = await mysqlApi.metaInstanceOverview({ sessionId: props.sessionId })
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) overviewLoading.value = false
  }
}

function formatUptime(secs?: number): string {
  if (secs == null) return '—'
  const d = Math.floor(secs / 86400)
  const hrs = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const parts: string[] = []
  if (d) parts.push(`${d}d`)
  parts.push(`${hrs}h ${m}m ${s}s`)
  return parts.join(' ')
}

// ─── Processlist ───────────────────────────────────────────────────────────
const processesBusy = ref(false)
const processes = ref<MysqlProcessInfo[]>([])
const processFilter = ref('all')
const processQuery = ref('')
const highlightedRowKey = ref<string | undefined>(undefined)
const detailOpen = ref(false)
const detailProcess = ref<MysqlProcessInfo | null>(null)
const confirmOpen = ref(false)
const pendingKill = ref<{
  id: number
  queryOnly: boolean
  user?: string
  host?: string
} | null>(null)
const killBusy = ref(false)

const processFilterOptions = computed<RsSelectOptions>(() => [
  { value: 'all', label: t('modules.mysql.monitor.filterAll') },
  { value: 'active', label: t('modules.mysql.monitor.filterActive') },
  { value: 'sleep', label: t('modules.mysql.monitor.filterSleep') },
  { value: 'query', label: t('modules.mysql.monitor.filterQuery') },
  { value: 'long', label: t('modules.mysql.monitor.filterLong') },
])

const filteredProcesses = computed(() => {
  const q = processQuery.value.trim().toLowerCase()
  const filter = processFilter.value
  return processes.value.filter((p) => {
    const cmd = (p.command ?? '').toLowerCase()
    const hasInfo = Boolean(p.info?.trim())
    if (filter === 'active' && cmd === 'sleep') return false
    if (filter === 'sleep' && cmd !== 'sleep') return false
    if (filter === 'query' && !hasInfo) return false
    if (filter === 'long' && (cmd === 'sleep' || (p.time ?? 0) < LONG_RUNNING_SECS)) return false
    if (!q) return true
    const hay = [p.user, p.host, p.db, p.command, p.state, p.info, String(p.id)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
})

function isLongRunning(p: Pick<MysqlProcessInfo, 'command' | 'time'>): boolean {
  return (p.command ?? '').toLowerCase() !== 'sleep' && (p.time ?? 0) >= LONG_RUNNING_SECS
}

const processColumns = computed<RsTableColumn<ProcessRow>[]>(() => [
  { key: 'id', title: t('modules.mysql.monitor.colId'), width: 72 },
  { key: 'user', title: t('modules.mysql.monitor.colUser'), minWidth: 90, ellipsis: true },
  { key: 'host', title: t('modules.mysql.monitor.colHost'), minWidth: 120, ellipsis: true },
  { key: 'db', title: t('modules.mysql.monitor.colDb'), minWidth: 90, ellipsis: true },
  { key: 'command', title: t('modules.mysql.monitor.colCommand'), width: 100 },
  {
    key: 'time',
    title: t('modules.mysql.monitor.colTime'),
    width: 88,
    render: (row: ProcessRow) => {
      const long = isLongRunning(row)
      return h(
        'span',
        {
          class: long ? 'nm-mysql-monitor__time--long' : undefined,
          title: long ? t('modules.mysql.monitor.longRunningTip', { n: LONG_RUNNING_SECS }) : undefined,
        },
        String(row.time ?? ''),
      ) as unknown as string
    },
  },
  { key: 'state', title: t('modules.mysql.monitor.colState'), minWidth: 100, ellipsis: true },
  { key: 'info', title: t('modules.mysql.monitor.colInfo'), minWidth: 180, ellipsis: true },
])

const processRows = computed<ProcessRow[]>(() =>
  filteredProcesses.value.map((p) => ({
    __rowKey: String(p.id),
    id: p.id,
    user: p.user,
    host: p.host,
    db: p.db ?? '',
    command: p.command,
    time: p.time,
    state: p.state ?? '',
    info: p.info ?? '',
  })),
)

const selectedProcess = computed(() => {
  if (!highlightedRowKey.value) return null
  return processes.value.find((p) => String(p.id) === highlightedRowKey.value) ?? null
})

const selectedId = computed(() => selectedProcess.value?.id ?? null)

const detailRows = computed(() => {
  const p = detailProcess.value
  if (!p) return []
  return [
    { key: 'id', label: t('modules.mysql.monitor.colId'), value: String(p.id) },
    { key: 'user', label: t('modules.mysql.monitor.colUser'), value: p.user || '—' },
    { key: 'host', label: t('modules.mysql.monitor.colHost'), value: p.host || '—' },
    { key: 'db', label: t('modules.mysql.monitor.colDb'), value: p.db || '—' },
    { key: 'command', label: t('modules.mysql.monitor.colCommand'), value: p.command || '—' },
    { key: 'time', label: t('modules.mysql.monitor.colTime'), value: String(p.time ?? 0) },
    { key: 'state', label: t('modules.mysql.monitor.colState'), value: p.state || '—' },
    { key: 'info', label: t('modules.mysql.monitor.colInfo'), value: p.info?.trim() || '—' },
  ]
})

async function loadProcesses(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) processesBusy.value = true
  try {
    const result = await mysqlApi.metaProcesslist({ sessionId: props.sessionId })
    processes.value = result.processes ?? []
    if (
      highlightedRowKey.value &&
      !processes.value.some((p) => String(p.id) === highlightedRowKey.value)
    ) {
      highlightedRowKey.value = undefined
    }
    if (detailProcess.value) {
      const next = processes.value.find((p) => p.id === detailProcess.value?.id) ?? null
      detailProcess.value = next
      if (!next) detailOpen.value = false
    }
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) processesBusy.value = false
  }
}

function onRowClick(row: Record<string, unknown>): void {
  const key = row.__rowKey != null ? String(row.__rowKey) : String(row.id ?? '')
  highlightedRowKey.value = key || undefined
}

function openProcessDetail(row: ProcessRow | null): void {
  if (!row) return
  const proc = processes.value.find((p) => p.id === row.id)
  if (!proc) {
    toast.error(t('modules.mysql.monitor.sessionNotFound'))
    return
  }
  highlightedRowKey.value = String(proc.id)
  detailProcess.value = proc
  detailOpen.value = true
}

function askKill(queryOnly: boolean, proc?: MysqlProcessInfo | null): void {
  const target = proc ?? selectedProcess.value
  if (!target) return
  pendingKill.value = {
    id: target.id,
    queryOnly,
    user: target.user,
    host: target.host,
  }
  confirmOpen.value = true
}

function processContextMenuItems(row: ProcessRow | null): RsContextMenuItem[] {
  if (!row) return []
  return [
    {
      key: 'process-detail',
      label: t('modules.mysql.monitor.viewDetail'),
      icon: 'info',
    },
    { key: 'sep-ops', label: '', separator: true },
    {
      key: 'kill-query',
      label: t('modules.mysql.monitor.killQuery'),
      icon: 'circle-x',
    },
    {
      key: 'kill-conn',
      label: t('modules.mysql.monitor.killConn'),
      icon: 'unplug',
      danger: true,
    },
  ]
}

function onProcessContextMenuSelect(key: string, row: ProcessRow | null): void {
  if (!row) return
  if (key === 'process-detail') openProcessDetail(row)
  else if (key === 'kill-query') {
    const proc = processes.value.find((p) => p.id === row.id) ?? null
    askKill(true, proc)
  } else if (key === 'kill-conn') {
    const proc = processes.value.find((p) => p.id === row.id) ?? null
    askKill(false, proc)
  }
}

async function confirmKill(): Promise<void> {
  if (!props.sessionId || !pendingKill.value) return
  killBusy.value = true
  try {
    await mysqlApi.metaKill({
      sessionId: props.sessionId,
      id: pendingKill.value.id,
      queryOnly: pendingKill.value.queryOnly,
    })
    toast.success(
      pendingKill.value.queryOnly
        ? t('modules.mysql.monitor.killQueryOk')
        : t('modules.mysql.monitor.killConnOk'),
    )
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

// ─── Locks + deadlock ──────────────────────────────────────────────────────
const locksLoading = ref(false)
const locks = ref<MysqlLockInfo[]>([])
const locksTruncated = ref(false)
const locksUnavailable = ref(false)
const locksMessage = ref('')
const deadlockBusy = ref(false)
const deadlockExcerpt = ref<string | null>(null)
const deadlockHas = ref(false)
const deadlockLoaded = ref(false)

const lockColumns = computed<RsTableColumn<LockRow>[]>(() => [
  { key: 'waitingPid', title: t('modules.mysql.monitor.lockWaitPid'), width: 80 },
  { key: 'blockingPid', title: t('modules.mysql.monitor.lockBlockPid'), width: 80 },
  { key: 'waitingUser', title: t('modules.mysql.monitor.lockWaitUser'), minWidth: 90, ellipsis: true },
  { key: 'blockingUser', title: t('modules.mysql.monitor.lockBlockUser'), minWidth: 90, ellipsis: true },
  { key: 'lockType', title: t('modules.mysql.monitor.lockType'), width: 80 },
  { key: 'lockMode', title: t('modules.mysql.monitor.lockMode'), width: 80 },
  { key: 'objectName', title: t('modules.mysql.monitor.lockObject'), minWidth: 120, ellipsis: true },
  { key: 'waitAge', title: t('modules.mysql.monitor.lockWaitAge'), width: 90 },
  { key: 'waitingQuery', title: t('modules.mysql.monitor.lockWaitQuery'), minWidth: 200, ellipsis: true },
])

const lockRows = computed<LockRow[]>(() =>
  locks.value.map((l) => ({
    waitingPid: l.waitingPid,
    blockingPid: l.blockingPid,
    waitingUser: l.waitingUser ?? '',
    blockingUser: l.blockingUser ?? '',
    lockType: l.lockType ?? '',
    lockMode: l.lockMode ?? '',
    objectName: l.objectName ?? '',
    waitAge: l.waitAgeSeconds != null ? `${l.waitAgeSeconds}s` : '',
    waitingQuery: l.waitingQuery ?? '',
  })),
)

async function loadLocks(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) locksLoading.value = true
  try {
    const result = await mysqlApi.metaLocks({ sessionId: props.sessionId })
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

async function loadDeadlock(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) deadlockBusy.value = true
  try {
    const result = await mysqlApi.metaInnoDBDeadlock({ sessionId: props.sessionId })
    deadlockHas.value = result.hasDeadlock
    deadlockExcerpt.value = result.excerpt ?? null
    deadlockLoaded.value = true
  } catch (e) {
    deadlockLoaded.value = true
    deadlockHas.value = false
    deadlockExcerpt.value = null
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) deadlockBusy.value = false
  }
}

function jumpToProcess(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0) return
  activeTab.value = 'processes'
  highlightedRowKey.value = String(pid)
  const proc = processes.value.find((p) => p.id === pid)
  if (proc) {
    detailProcess.value = proc
    detailOpen.value = true
  } else {
    void loadProcesses(true).then(() => {
      const next = processes.value.find((p) => p.id === pid)
      if (next) {
        detailProcess.value = next
        detailOpen.value = true
      }
    })
  }
}

function onLockRowClick(row: Record<string, unknown>): void {
  const pid = Number(row.waitingPid)
  if (!Number.isFinite(pid)) return
  jumpToProcess(pid)
}

function lockContextMenuItems(row: LockRow | null): RsContextMenuItem[] {
  if (!row) return []
  const items: RsContextMenuItem[] = [
    {
      key: 'jump-waiting',
      label: `${t('modules.mysql.monitor.jumpToProcess')} (#${row.waitingPid})`,
      icon: 'arrow-right',
    },
  ]
  if (row.blockingPid > 0) {
    items.push({
      key: 'jump-blocking',
      label: `${t('modules.mysql.monitor.jumpToProcess')} (#${row.blockingPid})`,
      icon: 'arrow-right',
    })
  }
  return items
}

function onLockContextMenuSelect(key: string, row: LockRow | null): void {
  if (!row) return
  if (key === 'jump-waiting') jumpToProcess(row.waitingPid)
  else if (key === 'jump-blocking') jumpToProcess(row.blockingPid)
}

// ─── Variables / Status ────────────────────────────────────────────────────
const kvBusy = ref(false)
const variables = ref<MysqlServerKVItem[]>([])
const statusItems = ref<MysqlServerKVItem[]>([])
const kvTruncated = ref(false)
const kvQuery = ref('')

const kvColumns = computed<RsTableColumn<KVRow>[]>(() => [
  { key: 'name', title: t('modules.mysql.monitor.kvName'), minWidth: 220, ellipsis: true },
  { key: 'value', title: t('modules.mysql.monitor.kvValue'), minWidth: 280, ellipsis: true },
])

const filteredKV = computed(() => {
  const source = activeTab.value === 'variables' ? variables.value : statusItems.value
  const q = kvQuery.value.trim().toLowerCase()
  if (!q) return source
  return source.filter(
    (item) =>
      item.name.toLowerCase().includes(q) || item.value.toLowerCase().includes(q),
  )
})

const kvRows = computed<KVRow[]>(() =>
  filteredKV.value.map((item) => ({
    name: item.name,
    value: item.value,
  })),
)

async function loadVariables(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) kvBusy.value = true
  try {
    const result = await mysqlApi.metaServerVariables({ sessionId: props.sessionId })
    variables.value = result.items ?? []
    kvTruncated.value = result.truncated ?? false
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) kvBusy.value = false
  }
}

async function loadStatus(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) kvBusy.value = true
  try {
    const result = await mysqlApi.metaServerStatus({ sessionId: props.sessionId })
    statusItems.value = result.items ?? []
    kvTruncated.value = result.truncated ?? false
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) kvBusy.value = false
  }
}

// ─── Tab switching + loading ───────────────────────────────────────────────
async function loadCurrentTab(quiet = false): Promise<void> {
  if (activeTab.value === 'instance') await loadOverview(quiet)
  else if (activeTab.value === 'processes') await loadProcesses(quiet)
  else if (activeTab.value === 'locks') {
    await Promise.all([loadLocks(quiet), loadDeadlock(quiet)])
  } else if (activeTab.value === 'variables') await loadVariables(quiet)
  else await loadStatus(quiet)
}

const loading = computed(() => {
  if (activeTab.value === 'instance') return overviewLoading.value
  if (activeTab.value === 'processes') return processesBusy.value
  if (activeTab.value === 'locks') return locksLoading.value || deadlockBusy.value
  return kvBusy.value
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
      overview.value != null ||
      processes.value.length > 0 ||
      locks.value.length > 0 ||
      variables.value.length > 0 ||
      statusItems.value.length > 0
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
  if (tab !== 'variables' && tab !== 'status') {
    kvQuery.value = ''
  }
  void loadCurrentTab()
})

watch(autoRefreshSecs, () => setupTimer())

onBeforeUnmount(() => clearTimer())
</script>

<template>
  <div class="nm-mysql-monitor">
    <div ref="dialogHostEl" class="nm-mysql-monitor__dialog-mount" aria-hidden="true" />

    <header class="nm-mysql-monitor__header">
      <div class="nm-mysql-monitor__tabs">
        <button
          v-for="tab in monitorTabs"
          :key="tab.id"
          type="button"
          class="nm-mysql-monitor__tab"
          :class="{ 'nm-mysql-monitor__tab--active': activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="nm-mysql-monitor__actions">
        <template v-if="activeTab === 'processes'">
          <span v-if="selectedProcess" class="nm-mysql-monitor__selected">
            #{{ selectedProcess.id }}
            <template v-if="selectedProcess.user"> · {{ selectedProcess.user }}</template>
            <template v-if="selectedProcess.host">@{{ selectedProcess.host }}</template>
          </span>
          <RsButton
            size="sm"
            variant="ghost"
            :disabled="selectedId == null || killBusy"
            @click="askKill(true)"
          >
            {{ t('modules.mysql.monitor.killQuery') }}
          </RsButton>
          <RsButton
            size="sm"
            variant="danger"
            :disabled="selectedId == null || killBusy"
            @click="askKill(false)"
          >
            {{ t('modules.mysql.monitor.killConn') }}
          </RsButton>
        </template>
        <RsSelect
          v-model="autoRefreshSecs"
          size="sm"
          :options="autoRefreshOptions"
          :placeholder="t('modules.mysql.monitor.autoRefresh')"
        />
        <RsButton size="sm" variant="ghost" icon="refresh-cw" :loading="loading" @click="loadCurrentTab()">
          {{ t('modules.mysql.monitor.refresh') }}
        </RsButton>
      </div>
    </header>

    <div
      v-if="activeTab === 'processes' && scopeOk"
      class="nm-mysql-monitor__filters"
    >
      <RsSelect
        v-model="processFilter"
        size="sm"
        :options="processFilterOptions"
        class="nm-mysql-monitor__filter-select"
      />
      <RsInput
        v-model="processQuery"
        size="sm"
        clearable
        class="nm-mysql-monitor__filter-input"
        :placeholder="t('modules.mysql.monitor.filterPlaceholder')"
      />
      <span class="nm-mysql-monitor__filter-meta">
        {{ filteredProcesses.length }} / {{ processes.length }}
      </span>
    </div>

    <div
      v-else-if="(activeTab === 'variables' || activeTab === 'status') && scopeOk"
      class="nm-mysql-monitor__filters"
    >
      <RsInput
        v-model="kvQuery"
        size="sm"
        clearable
        class="nm-mysql-monitor__filter-input nm-mysql-monitor__filter-input--wide"
        :placeholder="t('modules.mysql.monitor.kvFilterPlaceholder')"
      />
      <span class="nm-mysql-monitor__filter-meta">
        {{ filteredKV.length }} /
        {{ activeTab === 'variables' ? variables.length : statusItems.length }}
        <template v-if="kvTruncated"> · {{ t('modules.mysql.monitor.kvTruncated') }}</template>
      </span>
    </div>

    <div class="nm-mysql-monitor__body">
      <!-- 实例概览 -->
      <template v-if="activeTab === 'instance'">
        <RsLoading v-if="overviewLoading && !overview" class="nm-mysql-monitor__loading" />
        <RsEmpty
          v-else-if="!sessionId"
          radius="none"
          icon-radius="none"
          :description="t('modules.mysql.monitor.needSession')"
        />
        <div v-else-if="overview" class="nm-mysql-monitor__overview">
          <div v-if="overview.statusPartial" class="nm-mysql-monitor__banner nm-mysql-monitor__banner--warn">
            {{ t('modules.mysql.monitor.statusPartial') }}
            <span v-if="overview.warnings?.length"> — {{ overview.warnings.join('; ') }}</span>
          </div>
          <div class="nm-mysql-monitor__overview-grid">
            <div class="nm-mysql-monitor__stat">
              <span class="nm-mysql-monitor__stat-label">{{ t('modules.mysql.monitor.instanceVersion') }}</span>
              <span class="nm-mysql-monitor__stat-value">{{ overview.version }}</span>
            </div>
            <div v-if="overview.versionComment" class="nm-mysql-monitor__stat">
              <span class="nm-mysql-monitor__stat-label">{{ t('modules.mysql.monitor.instanceComment') }}</span>
              <span class="nm-mysql-monitor__stat-value nm-mysql-monitor__stat-value--muted">{{ overview.versionComment }}</span>
            </div>
            <div v-if="overview.currentUser" class="nm-mysql-monitor__stat">
              <span class="nm-mysql-monitor__stat-label">{{ t('modules.mysql.monitor.instanceUser') }}</span>
              <span class="nm-mysql-monitor__stat-value">{{ overview.currentUser }}</span>
            </div>
            <div v-if="overview.serverAddr" class="nm-mysql-monitor__stat">
              <span class="nm-mysql-monitor__stat-label">{{ t('modules.mysql.monitor.instanceAddr') }}</span>
              <span class="nm-mysql-monitor__stat-value">{{ overview.serverAddr }}</span>
            </div>
            <div v-if="overview.uptimeSeconds != null" class="nm-mysql-monitor__stat">
              <span class="nm-mysql-monitor__stat-label">{{ t('modules.mysql.monitor.instanceUptime') }}</span>
              <span class="nm-mysql-monitor__stat-value">{{ formatUptime(overview.uptimeSeconds) }}</span>
            </div>
            <div v-if="overview.databaseCount != null" class="nm-mysql-monitor__stat">
              <span class="nm-mysql-monitor__stat-label">{{ t('modules.mysql.monitor.instanceDatabases') }}</span>
              <span class="nm-mysql-monitor__stat-value nm-mysql-monitor__stat-value--accent">{{ overview.databaseCount }}</span>
            </div>
            <div class="nm-mysql-monitor__stat">
              <span class="nm-mysql-monitor__stat-label">{{ t('modules.mysql.monitor.instanceConnected') }}</span>
              <span class="nm-mysql-monitor__stat-value nm-mysql-monitor__stat-value--accent">
                {{ overview.threadsConnected ?? '—' }}<template v-if="overview.maxConnections"> / {{ overview.maxConnections }}</template>
              </span>
            </div>
            <div v-if="overview.questions != null" class="nm-mysql-monitor__stat">
              <span class="nm-mysql-monitor__stat-label">{{ t('modules.mysql.monitor.instanceQuestions') }}</span>
              <span class="nm-mysql-monitor__stat-value">{{ overview.questions }}</span>
            </div>
            <div v-if="overview.slowQueries != null" class="nm-mysql-monitor__stat">
              <span class="nm-mysql-monitor__stat-label">{{ t('modules.mysql.monitor.instanceSlowQueries') }}</span>
              <span class="nm-mysql-monitor__stat-value" :class="overview.slowQueries > 0 ? 'nm-mysql-monitor__stat-value--warn' : ''">{{ overview.slowQueries }}</span>
            </div>
          </div>
        </div>
        <RsEmpty v-else radius="none" icon-radius="none" :description="t('modules.mysql.monitor.empty')" />
      </template>

      <!-- 进程列表 -->
      <template v-else-if="activeTab === 'processes'">
        <RsLoading v-if="processesBusy && processes.length === 0" class="nm-mysql-monitor__loading" />
        <RsEmpty
          v-else-if="!sessionId"
          radius="none"
          icon-radius="none"
          :description="t('modules.mysql.monitor.needSession')"
        />
        <RsEmpty
          v-else-if="filteredProcesses.length === 0 && !processesBusy"
          radius="none"
          icon-radius="none"
          :description="
            processes.length === 0
              ? t('modules.mysql.monitor.empty')
              : t('modules.mysql.monitor.filterEmpty')
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

      <!-- 锁等待 + 死锁 -->
      <template v-else-if="activeTab === 'locks'">
        <div class="nm-mysql-monitor__locks-layout">
          <div class="nm-mysql-monitor__locks-main">
            <RsLoading v-if="locksLoading && locks.length === 0 && !locksUnavailable" class="nm-mysql-monitor__loading" />
            <RsEmpty
              v-else-if="!sessionId"
              radius="none"
              icon-radius="none"
              :description="t('modules.mysql.monitor.needSession')"
            />
            <RsEmpty
              v-else-if="locksUnavailable"
              radius="none"
              icon-radius="none"
              :description="t('modules.mysql.monitor.locksUnavailable', { msg: locksMessage || '—' })"
            />
            <RsEmpty
              v-else-if="locks.length === 0 && !locksLoading"
              radius="none"
              icon-radius="none"
              :description="t('modules.mysql.monitor.locksEmpty')"
            />
            <RsTable
              v-else
              :columns="lockColumns"
              :data="lockRows"
              size="sm"
              fill
              resizable
              cell-tooltip
              row-key="waitingPid"
              :context-menu-items="lockContextMenuItems"
              @row-click="onLockRowClick"
              @row-dblclick="onLockRowClick"
              @context-menu-select="onLockContextMenuSelect"
            />
            <div v-if="locksTruncated" class="nm-mysql-monitor__truncated">
              {{ t('modules.mysql.monitor.locksTruncated') }}
            </div>
          </div>
          <aside class="nm-mysql-monitor__deadlock">
            <div class="nm-mysql-monitor__deadlock-head">
              <span>{{ t('modules.mysql.monitor.deadlockTitle') }}</span>
              <RsButton size="sm" variant="ghost" icon="refresh-cw" :loading="deadlockBusy" @click="loadDeadlock()">
                {{ t('modules.mysql.monitor.refresh') }}
              </RsButton>
            </div>
            <RsLoading v-if="deadlockBusy && !deadlockLoaded" class="nm-mysql-monitor__loading" />
            <RsEmpty
              v-else-if="!deadlockHas"
              radius="none"
              icon-radius="none"
              :description="t('modules.mysql.monitor.deadlockEmpty')"
            />
            <pre v-else class="nm-mysql-monitor__deadlock-body">{{ deadlockExcerpt }}</pre>
          </aside>
        </div>
      </template>

      <!-- Variables / Status -->
      <template v-else>
        <RsLoading
          v-if="kvBusy && (activeTab === 'variables' ? variables.length === 0 : statusItems.length === 0)"
          class="nm-mysql-monitor__loading"
        />
        <RsEmpty
          v-else-if="!sessionId"
          radius="none"
          icon-radius="none"
          :description="t('modules.mysql.monitor.needSession')"
        />
        <RsEmpty
          v-else-if="filteredKV.length === 0 && !kvBusy"
          radius="none"
          icon-radius="none"
          :description="
            (activeTab === 'variables' ? variables.length : statusItems.length) === 0
              ? t('modules.mysql.monitor.kvEmpty')
              : t('modules.mysql.monitor.filterEmpty')
          "
        />
        <RsTable
          v-else
          :columns="kvColumns"
          :data="kvRows"
          size="sm"
          fill
          resizable
          cell-tooltip
          row-key="name"
        />
      </template>
    </div>

    <RsDialog
      v-if="dialogTeleportReady"
      v-model:open="detailOpen"
      :title="t('modules.mysql.monitor.sessionDetailTitle')"
      width="md"
      layout="confirm"
      :modal="false"
      :show-overlay="false"
      :teleport-to="dialogHostEl ?? undefined"
      :resizable="false"
      :fullscreenable="false"
    >
      <template #body>
        <dl v-if="detailProcess" class="nm-mysql-monitor__detail">
          <div v-for="item in detailRows" :key="item.key" class="nm-mysql-monitor__detail-row">
            <dt>{{ item.label }}</dt>
            <dd :class="{ 'nm-mysql-monitor__detail-query': item.key === 'info' }">
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
          {{ t('modules.mysql.monitor.killQuery') }}
        </RsButton>
        <RsButton
          variant="ghost"
          size="sm"
          :disabled="killBusy || !detailProcess"
          @click="askKill(false, detailProcess)"
        >
          {{ t('modules.mysql.monitor.killConn') }}
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
          ? t('modules.mysql.monitor.killQueryTitle')
          : t('modules.mysql.monitor.killConnTitle')
      "
      :description="
        t(
          pendingKill?.queryOnly
            ? 'modules.mysql.monitor.killQueryDesc'
            : 'modules.mysql.monitor.killConnDesc',
          {
            id: pendingKill?.id ?? '',
            who:
              pendingKill?.user || pendingKill?.host
                ? `${pendingKill?.user ?? ''}${pendingKill?.host ? '@' + pendingKill.host : ''}`
                : '',
          },
        )
      "
      :confirm-text="t('modules.mysql.monitor.killConfirm')"
      tone="danger"
      confirm-variant="danger"
      :show-overlay="false"
      :teleport-to="dialogHostEl ?? undefined"
      @confirm="confirmKill"
    />
  </div>
</template>

<style scoped>
.nm-mysql-monitor {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.nm-mysql-monitor__dialog-mount {
  position: absolute;
  inset: 0;
  z-index: var(--rs-z-modal);
  pointer-events: none;
}
.nm-mysql-monitor__dialog-mount :deep(.rs-dialog__content),
.nm-mysql-monitor__dialog-mount :deep(.rs-confirm-dialog__content) {
  pointer-events: auto;
}
.nm-mysql-monitor__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.nm-mysql-monitor__tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.nm-mysql-monitor__tab {
  padding: 3px 10px;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: var(--rs-radius-sm, 4px);
  cursor: pointer;
  background: transparent;
  color: var(--rs-fg-muted, #6b7280);
  transition: background 0.12s, color 0.12s;
}
.nm-mysql-monitor__tab:hover {
  background: var(--rs-bg-elevated, #f3f4f6);
  color: var(--rs-fg, #111827);
}
.nm-mysql-monitor__tab--active {
  background: var(--rs-accent-subtle, #eff6ff);
  color: var(--rs-accent, #2563eb);
  border-color: var(--rs-accent-border, #bfdbfe);
  font-weight: 500;
}
.nm-mysql-monitor__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}
.nm-mysql-monitor__selected {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--rs-text-muted, #6b7280);
  font-variant-numeric: tabular-nums;
}
.nm-mysql-monitor__filters {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
}
.nm-mysql-monitor__filter-select {
  width: 140px;
  flex-shrink: 0;
}
.nm-mysql-monitor__filter-input {
  width: 220px;
  flex-shrink: 1;
  min-width: 120px;
}
.nm-mysql-monitor__filter-input--wide {
  width: 320px;
}
.nm-mysql-monitor__filter-meta {
  font-size: 12px;
  color: var(--rs-fg-muted, #6b7280);
  white-space: nowrap;
}
.nm-mysql-monitor__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.nm-mysql-monitor__loading {
  margin: auto;
}
.nm-mysql-monitor__overview {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
.nm-mysql-monitor__banner {
  margin-bottom: 12px;
  padding: 8px 12px;
  font-size: 12px;
  border-radius: var(--rs-radius-sm, 4px);
}
.nm-mysql-monitor__banner--warn {
  background: color-mix(in srgb, var(--rs-fg-warning, #d97706) 12%, transparent);
  color: var(--rs-fg-warning, #d97706);
}
.nm-mysql-monitor__overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.nm-mysql-monitor__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border: 1px solid var(--rs-border-subtle, #e5e7eb);
  border-radius: var(--rs-radius-md, 6px);
  background: var(--rs-bg-elevated, #f9fafb);
}
.nm-mysql-monitor__stat-label {
  font-size: 11px;
  color: var(--rs-fg-muted, #6b7280);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.nm-mysql-monitor__stat-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--rs-fg, #111827);
  word-break: break-all;
}
.nm-mysql-monitor__stat-value--muted {
  font-size: 13px;
  font-weight: 400;
  color: var(--rs-fg-muted, #6b7280);
}
.nm-mysql-monitor__stat-value--accent {
  color: var(--rs-accent, #2563eb);
}
.nm-mysql-monitor__stat-value--warn {
  color: var(--rs-fg-warning, #d97706);
}
.nm-mysql-monitor__truncated {
  flex-shrink: 0;
  padding: 4px 12px;
  font-size: 11px;
  color: var(--rs-fg-muted, #6b7280);
  border-top: 1px solid var(--rs-border-subtle, #e5e7eb);
}
.nm-mysql-monitor__locks-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(240px, 0.9fr);
  gap: 0;
}
.nm-mysql-monitor__locks-main {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--rs-border-subtle, #e5e7eb);
}
.nm-mysql-monitor__deadlock {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--rs-bg-elevated, #f9fafb);
}
.nm-mysql-monitor__deadlock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
}
.nm-mysql-monitor__deadlock-body {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--rs-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
.nm-mysql-monitor__detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}
.nm-mysql-monitor__detail-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.nm-mysql-monitor__detail-row dt {
  margin: 0;
  font-size: 12px;
  color: var(--rs-fg-muted, #6b7280);
}
.nm-mysql-monitor__detail-row dd {
  margin: 0;
  font-size: 12px;
  word-break: break-word;
}
.nm-mysql-monitor__detail-query {
  font-family: var(--rs-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  white-space: pre-wrap;
  max-height: 240px;
  overflow: auto;
}
:deep(.nm-mysql-monitor__time--long) {
  color: var(--rs-fg-warning, #d97706);
  font-weight: 600;
}
@media (max-width: 960px) {
  .nm-mysql-monitor__locks-layout {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(180px, 1fr) minmax(160px, 0.7fr);
  }
  .nm-mysql-monitor__locks-main {
    border-right: none;
    border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  }
}
</style>
