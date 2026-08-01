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
import { damengApi } from '@/api/dameng'
import type {
  DamengLockInfo,
  DamengMetaInstanceOverviewResult,
  DamengProcessInfo,
} from '@/api/types/dameng'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

type MonitorTab = 'instance' | 'processes' | 'locks'
type ProcessRow = Record<string, unknown> & { __rowKey: string; id: number; time: number; command: string }
type LockRow = Record<string, unknown> & { waitingPid: number; blockingPid: number }

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
  { value: '0', label: t('modules.dameng.monitor.refreshOff') },
  { value: '3', label: t('modules.dameng.monitor.refresh3s') },
  { value: '5', label: t('modules.dameng.monitor.refresh5s') },
  { value: '10', label: t('modules.dameng.monitor.refresh10s') },
])

const monitorTabs = computed(() =>
  (['instance', 'processes', 'locks'] as const).map((tab) => ({
    id: tab,
    label: t(`modules.dameng.monitor.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`),
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
const overview = ref<DamengMetaInstanceOverviewResult | null>(null)

async function loadOverview(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) overviewLoading.value = true
  try {
    overview.value = await damengApi.metaInstanceOverview({ sessionId: props.sessionId })
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
const processes = ref<DamengProcessInfo[]>([])
const processFilter = ref('all')
const processQuery = ref('')
const highlightedRowKey = ref<string | undefined>(undefined)
const detailOpen = ref(false)
const detailProcess = ref<DamengProcessInfo | null>(null)
const confirmOpen = ref(false)
const pendingKill = ref<{
  id: number
  user?: string
  host?: string
} | null>(null)
const killBusy = ref(false)

const processFilterOptions = computed<RsSelectOptions>(() => [
  { value: 'all', label: t('modules.dameng.monitor.filterAll') },
  { value: 'active', label: t('modules.dameng.monitor.filterActive') },
  { value: 'idle', label: t('modules.dameng.monitor.filterIdle') },
  { value: 'query', label: t('modules.dameng.monitor.filterQuery') },
  { value: 'long', label: t('modules.dameng.monitor.filterLong') },
])

/** 达梦 STATE：IDLE 空闲；其余（ACTIVE 等）视为活动。兼容旧 Sleep 值。 */
function isIdleState(p: Pick<DamengProcessInfo, 'command' | 'state'>): boolean {
  const s = (p.state ?? p.command ?? '').toLowerCase()
  return s === 'idle' || s === 'sleep'
}

const filteredProcesses = computed(() => {
  const q = processQuery.value.trim().toLowerCase()
  const filter = processFilter.value
  return processes.value.filter((p) => {
    const idle = isIdleState(p)
    const hasInfo = Boolean(p.info?.trim())
    if (filter === 'active' && idle) return false
    if (filter === 'idle' && !idle) return false
    if (filter === 'query' && !hasInfo) return false
    if (filter === 'long' && (idle || (p.time ?? 0) < LONG_RUNNING_SECS)) return false
    if (!q) return true
    const hay = [p.user, p.host, p.db, p.command, p.state, p.info, String(p.id)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
})

function isLongRunning(p: Pick<DamengProcessInfo, 'command' | 'state' | 'time'>): boolean {
  return !isIdleState(p) && (p.time ?? 0) >= LONG_RUNNING_SECS
}

const processColumns = computed((): RsTableColumn<ProcessRow>[] => [
  { key: 'id', title: t('modules.dameng.monitor.colId'), width: 72 },
  { key: 'user', title: t('modules.dameng.monitor.colUser'), minWidth: 90, ellipsis: true },
  { key: 'host', title: t('modules.dameng.monitor.colHost'), minWidth: 120, ellipsis: true },
  { key: 'db', title: t('modules.dameng.monitor.colDb'), minWidth: 90, ellipsis: true },
  { key: 'command', title: t('modules.dameng.monitor.colCommand'), width: 100 },
  {
    key: 'time',
    title: t('modules.dameng.monitor.colTime'),
    width: 88,
    render: (row: ProcessRow) => {
      const long = isLongRunning(row)
      return h(
        'span',
        {
          class: long ? 'nm-dameng-monitor__time--long' : undefined,
          title: long ? t('modules.dameng.monitor.longRunningTip', { n: LONG_RUNNING_SECS }) : undefined,
        },
        String(row.time ?? ''),
      ) as unknown as string
    },
  },
  { key: 'info', title: t('modules.dameng.monitor.colInfo'), minWidth: 180, ellipsis: true },
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
    { key: 'id', label: t('modules.dameng.monitor.colId'), value: String(p.id) },
    { key: 'user', label: t('modules.dameng.monitor.colUser'), value: p.user || '—' },
    { key: 'host', label: t('modules.dameng.monitor.colHost'), value: p.host || '—' },
    { key: 'db', label: t('modules.dameng.monitor.colDb'), value: p.db || '—' },
    { key: 'command', label: t('modules.dameng.monitor.colCommand'), value: p.command || '—' },
    { key: 'time', label: t('modules.dameng.monitor.colTime'), value: String(p.time ?? 0) },
    { key: 'info', label: t('modules.dameng.monitor.colInfo'), value: p.info?.trim() || '—' },
  ]
})

async function loadProcesses(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) processesBusy.value = true
  try {
    const result = await damengApi.metaProcesslist({ sessionId: props.sessionId })
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
    toast.error(t('modules.dameng.monitor.sessionNotFound'))
    return
  }
  highlightedRowKey.value = String(proc.id)
  detailProcess.value = proc
  detailOpen.value = true
}

/** 达梦仅支持 SP_CLOSE_SESSION，无「只取消语句」能力。 */
function askKill(proc?: DamengProcessInfo | null): void {
  const target = proc ?? selectedProcess.value
  if (!target) return
  pendingKill.value = {
    id: target.id,
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
      label: t('modules.dameng.monitor.viewDetail'),
      icon: 'info',
    },
    { key: 'sep-ops', label: '', separator: true },
    {
      key: 'kill-conn',
      label: t('modules.dameng.monitor.killConn'),
      icon: 'unplug',
      danger: true,
    },
  ]
}

function onProcessContextMenuSelect(key: string, row: ProcessRow | null): void {
  if (!row) return
  if (key === 'process-detail') openProcessDetail(row)
  else if (key === 'kill-conn') {
    const proc = processes.value.find((p) => p.id === row.id) ?? null
    askKill(proc)
  }
}

async function confirmKill(): Promise<void> {
  if (!props.sessionId || !pendingKill.value) return
  killBusy.value = true
  try {
    await damengApi.metaKill({
      sessionId: props.sessionId,
      id: pendingKill.value.id,
    })
    toast.success(t('modules.dameng.monitor.killConnOk'))
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

// ─── Locks ───────────────────────────────────────────────────────────────────
const locksLoading = ref(false)
const locks = ref<DamengLockInfo[]>([])
const locksTruncated = ref(false)
const locksUnavailable = ref(false)
const locksMessage = ref('')

const lockColumns = computed<RsTableColumn<LockRow>[]>(() => [
  { key: 'waitingPid', title: t('modules.dameng.monitor.lockWaitPid'), width: 80 },
  { key: 'blockingPid', title: t('modules.dameng.monitor.lockBlockPid'), width: 80 },
  { key: 'waitingUser', title: t('modules.dameng.monitor.lockWaitUser'), minWidth: 90, ellipsis: true },
  { key: 'blockingUser', title: t('modules.dameng.monitor.lockBlockUser'), minWidth: 90, ellipsis: true },
  { key: 'lockType', title: t('modules.dameng.monitor.lockType'), width: 80 },
  { key: 'lockMode', title: t('modules.dameng.monitor.lockMode'), width: 80 },
  { key: 'objectName', title: t('modules.dameng.monitor.lockObject'), minWidth: 120, ellipsis: true },
  { key: 'waitAge', title: t('modules.dameng.monitor.lockWaitAge'), width: 90 },
  { key: 'waitingQuery', title: t('modules.dameng.monitor.lockWaitQuery'), minWidth: 200, ellipsis: true },
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
    const result = await damengApi.metaLocks({ sessionId: props.sessionId })
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
      label: `${t('modules.dameng.monitor.jumpToProcess')} (#${row.waitingPid})`,
      icon: 'arrow-right',
    },
  ]
  if (row.blockingPid > 0) {
    items.push({
      key: 'jump-blocking',
      label: `${t('modules.dameng.monitor.jumpToProcess')} (#${row.blockingPid})`,
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
  <div class="nm-dameng-monitor">
    <div ref="dialogHostEl" class="nm-dameng-monitor__dialog-mount" aria-hidden="true" />

    <header class="nm-dameng-monitor__header">
      <div class="nm-dameng-monitor__tabs">
        <button
          v-for="tab in monitorTabs"
          :key="tab.id"
          type="button"
          class="nm-dameng-monitor__tab"
          :class="{ 'nm-dameng-monitor__tab--active': activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="nm-dameng-monitor__actions">
        <template v-if="activeTab === 'processes'">
          <span v-if="selectedProcess" class="nm-dameng-monitor__selected">
            #{{ selectedProcess.id }}
            <template v-if="selectedProcess.user"> · {{ selectedProcess.user }}</template>
            <template v-if="selectedProcess.host">@{{ selectedProcess.host }}</template>
          </span>
          <RsButton
            size="sm"
            variant="danger"
            :disabled="selectedId == null || killBusy"
            @click="askKill()"
          >
            {{ t('modules.dameng.monitor.killConn') }}
          </RsButton>
        </template>
        <RsSelect
          v-model="autoRefreshSecs"
          size="sm"
          :options="autoRefreshOptions"
          :placeholder="t('modules.dameng.monitor.autoRefresh')"
        />
        <RsButton size="sm" variant="ghost" icon="refresh-cw" :loading="loading" @click="loadCurrentTab()">
          {{ t('modules.dameng.monitor.refresh') }}
        </RsButton>
      </div>
    </header>

    <div
      v-if="activeTab === 'processes' && scopeOk"
      class="nm-dameng-monitor__filters"
    >
      <RsSelect
        v-model="processFilter"
        size="sm"
        :options="processFilterOptions"
        class="nm-dameng-monitor__filter-select"
      />
      <RsInput
        v-model="processQuery"
        size="sm"
        clearable
        class="nm-dameng-monitor__filter-input"
        :placeholder="t('modules.dameng.monitor.filterPlaceholder')"
      />
      <span class="nm-dameng-monitor__filter-meta">
        {{ filteredProcesses.length }} / {{ processes.length }}
      </span>
    </div>


    <div class="nm-dameng-monitor__body">
      <!-- 实例概览 -->
      <template v-if="activeTab === 'instance'">
        <RsLoading v-if="overviewLoading && !overview" class="nm-dameng-monitor__loading" />
        <RsEmpty
          v-else-if="!sessionId"
          radius="none"
          icon-radius="none"
          :description="t('modules.dameng.monitor.needSession')"
        />
        <div v-else-if="overview" class="nm-dameng-monitor__overview">
          <div v-if="overview.statusPartial" class="nm-dameng-monitor__banner nm-dameng-monitor__banner--warn">
            {{ t('modules.dameng.monitor.statusPartial') }}
            <span v-if="overview.warnings?.length"> — {{ overview.warnings.join('; ') }}</span>
          </div>
          <div class="nm-dameng-monitor__overview-grid">
            <div class="nm-dameng-monitor__stat">
              <span class="nm-dameng-monitor__stat-label">{{ t('modules.dameng.monitor.instanceVersion') }}</span>
              <span class="nm-dameng-monitor__stat-value">{{ overview.version }}</span>
            </div>
            <div v-if="overview.versionComment" class="nm-dameng-monitor__stat">
              <span class="nm-dameng-monitor__stat-label">{{ t('modules.dameng.monitor.instanceComment') }}</span>
              <span class="nm-dameng-monitor__stat-value nm-dameng-monitor__stat-value--muted">{{ overview.versionComment }}</span>
            </div>
            <div v-if="overview.currentUser" class="nm-dameng-monitor__stat">
              <span class="nm-dameng-monitor__stat-label">{{ t('modules.dameng.monitor.instanceUser') }}</span>
              <span class="nm-dameng-monitor__stat-value">{{ overview.currentUser }}</span>
            </div>
            <div v-if="overview.serverAddr" class="nm-dameng-monitor__stat">
              <span class="nm-dameng-monitor__stat-label">{{ t('modules.dameng.monitor.instanceAddr') }}</span>
              <span class="nm-dameng-monitor__stat-value">{{ overview.serverAddr }}</span>
            </div>
            <div v-if="overview.uptimeSeconds != null" class="nm-dameng-monitor__stat">
              <span class="nm-dameng-monitor__stat-label">{{ t('modules.dameng.monitor.instanceUptime') }}</span>
              <span class="nm-dameng-monitor__stat-value">{{ formatUptime(overview.uptimeSeconds) }}</span>
            </div>
            <div v-if="overview.databaseCount != null" class="nm-dameng-monitor__stat">
              <span class="nm-dameng-monitor__stat-label">{{ t('modules.dameng.monitor.instanceSchemas') }}</span>
              <span class="nm-dameng-monitor__stat-value nm-dameng-monitor__stat-value--accent">{{ overview.schemaCount ?? overview.databaseCount }}</span>
            </div>
            <div class="nm-dameng-monitor__stat">
              <span class="nm-dameng-monitor__stat-label">{{ t('modules.dameng.monitor.instanceConnected') }}</span>
              <span class="nm-dameng-monitor__stat-value nm-dameng-monitor__stat-value--accent">
                {{ overview.threadsConnected ?? '—' }}<template v-if="overview.maxConnections"> / {{ overview.maxConnections }}</template>
              </span>
            </div>
            <div v-if="overview.questions != null" class="nm-dameng-monitor__stat">
              <span class="nm-dameng-monitor__stat-label">{{ t('modules.dameng.monitor.instanceQuestions') }}</span>
              <span class="nm-dameng-monitor__stat-value">{{ overview.questions }}</span>
            </div>
            <div v-if="overview.slowQueries != null" class="nm-dameng-monitor__stat">
              <span class="nm-dameng-monitor__stat-label">{{ t('modules.dameng.monitor.instanceSlowQueries') }}</span>
              <span class="nm-dameng-monitor__stat-value" :class="overview.slowQueries > 0 ? 'nm-dameng-monitor__stat-value--warn' : ''">{{ overview.slowQueries }}</span>
            </div>
          </div>
        </div>
        <RsEmpty v-else radius="none" icon-radius="none" :description="t('modules.dameng.monitor.empty')" />
      </template>

      <!-- 进程列表 -->
      <template v-else-if="activeTab === 'processes'">
        <RsLoading v-if="processesBusy && processes.length === 0" class="nm-dameng-monitor__loading" />
        <RsEmpty
          v-else-if="!sessionId"
          radius="none"
          icon-radius="none"
          :description="t('modules.dameng.monitor.needSession')"
        />
        <RsEmpty
          v-else-if="filteredProcesses.length === 0 && !processesBusy"
          radius="none"
          icon-radius="none"
          :description="
            processes.length === 0
              ? t('modules.dameng.monitor.empty')
              : t('modules.dameng.monitor.filterEmpty')
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

      <!-- 锁等待 -->
      <template v-else-if="activeTab === 'locks'">
        <RsLoading v-if="locksLoading && locks.length === 0 && !locksUnavailable" class="nm-dameng-monitor__loading" />
        <RsEmpty
          v-else-if="!sessionId"
          radius="none"
          icon-radius="none"
          :description="t('modules.dameng.monitor.needSession')"
        />
        <RsEmpty
          v-else-if="locksUnavailable"
          radius="none"
          icon-radius="none"
          :description="t('modules.dameng.monitor.locksUnavailable', { msg: locksMessage || '—' })"
        />
        <RsEmpty
          v-else-if="locks.length === 0 && !locksLoading"
          radius="none"
          icon-radius="none"
          :description="t('modules.dameng.monitor.locksEmpty')"
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
        <div v-if="locksTruncated" class="nm-dameng-monitor__truncated">
          {{ t('modules.dameng.monitor.locksTruncated') }}
        </div>
      </template>
    </div>

    <RsDialog
      v-if="dialogTeleportReady"
      v-model:open="detailOpen"
      :title="t('modules.dameng.monitor.sessionDetailTitle')"
      width="md"
      layout="confirm"
      :modal="false"
      :show-overlay="false"
      :teleport-to="dialogHostEl ?? undefined"
      :resizable="false"
      :fullscreenable="false"
    >
      <template #body>
        <dl v-if="detailProcess" class="nm-dameng-monitor__detail">
          <div v-for="item in detailRows" :key="item.key" class="nm-dameng-monitor__detail-row">
            <dt>{{ item.label }}</dt>
            <dd :class="{ 'nm-dameng-monitor__detail-query': item.key === 'info' }">
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
          @click="askKill(detailProcess)"
        >
          {{ t('modules.dameng.monitor.killConn') }}
        </RsButton>
        <RsButton variant="primary" size="sm" @click="detailOpen = false">
          {{ t('common.close') }}
        </RsButton>
      </template>
    </RsDialog>

    <RsConfirmDialog
      v-if="dialogTeleportReady"
      v-model:open="confirmOpen"
      :title="t('modules.dameng.monitor.killConnTitle')"
      :description="
        t('modules.dameng.monitor.killConnDesc', {
          id: pendingKill?.id ?? '',
          who:
            pendingKill?.user || pendingKill?.host
              ? `${pendingKill?.user ?? ''}${pendingKill?.host ? '@' + pendingKill.host : ''}`
              : '',
        })
      "
      :confirm-text="t('modules.dameng.monitor.killConfirm')"
      tone="danger"
      confirm-variant="danger"
      :show-overlay="false"
      :teleport-to="dialogHostEl ?? undefined"
      @confirm="confirmKill"
    />
  </div>
</template>

<style scoped>
.nm-dameng-monitor {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
  color: var(--rs-text);
}
.nm-dameng-monitor__dialog-mount {
  position: absolute;
  inset: 0;
  z-index: var(--rs-z-modal);
  pointer-events: none;
}
.nm-dameng-monitor__dialog-mount :deep(.rs-dialog__content),
.nm-dameng-monitor__dialog-mount :deep(.rs-confirm-dialog__content) {
  pointer-events: auto;
}
.nm-dameng-monitor__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.nm-dameng-monitor__tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.nm-dameng-monitor__tab {
  padding: 3px 10px;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: var(--rs-radius-sm, 4px);
  cursor: pointer;
  background: transparent;
  color: var(--rs-muted);
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.nm-dameng-monitor__tab:hover {
  background: var(--rs-surface-hover);
  color: var(--rs-text);
}
.nm-dameng-monitor__tab--active {
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
  color: var(--rs-primary);
  border-color: color-mix(in srgb, var(--rs-primary) 28%, transparent);
  font-weight: 500;
}
.nm-dameng-monitor__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}
.nm-dameng-monitor__selected {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
}
.nm-dameng-monitor__filters {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}
.nm-dameng-monitor__filter-select {
  width: 140px;
  flex-shrink: 0;
}
.nm-dameng-monitor__filter-input {
  width: 220px;
  flex-shrink: 1;
  min-width: 120px;
}
.nm-dameng-monitor__filter-input--wide {
  width: 320px;
}
.nm-dameng-monitor__filter-meta {
  font-size: 12px;
  color: var(--rs-muted);
  white-space: nowrap;
}
.nm-dameng-monitor__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.nm-dameng-monitor__loading {
  margin: auto;
}
.nm-dameng-monitor__overview {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  background: var(--rs-bg);
}
.nm-dameng-monitor__banner {
  margin-bottom: 12px;
  padding: 8px 12px;
  font-size: 12px;
  border-radius: var(--rs-radius-sm, 4px);
}
.nm-dameng-monitor__banner--warn {
  background: color-mix(in srgb, var(--rs-warning) 12%, transparent);
  color: var(--rs-warning);
}
.nm-dameng-monitor__overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.nm-dameng-monitor__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md, 6px);
  background: var(--rs-surface-elevated);
}
.nm-dameng-monitor__stat-label {
  font-size: 11px;
  color: var(--rs-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.nm-dameng-monitor__stat-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--rs-text);
  word-break: break-all;
}
.nm-dameng-monitor__stat-value--muted {
  font-size: 13px;
  font-weight: 400;
  color: var(--rs-muted);
}
.nm-dameng-monitor__stat-value--accent {
  color: var(--rs-primary);
}
.nm-dameng-monitor__stat-value--warn {
  color: var(--rs-warning);
}
.nm-dameng-monitor__truncated {
  flex-shrink: 0;
  padding: 4px 12px;
  font-size: 11px;
  color: var(--rs-muted);
  border-top: 1px solid var(--rs-border-subtle);
}
.nm-dameng-monitor__detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}
.nm-dameng-monitor__detail-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.nm-dameng-monitor__detail-row dt {
  margin: 0;
  font-size: 12px;
  color: var(--rs-muted);
}
.nm-dameng-monitor__detail-row dd {
  margin: 0;
  font-size: 12px;
  word-break: break-word;
  color: var(--rs-text);
}
.nm-dameng-monitor__detail-query {
  font-family: var(--rs-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  white-space: pre-wrap;
  max-height: 240px;
  overflow: auto;
}
:deep(.nm-dameng-monitor__time--long) {
  color: var(--rs-warning);
  font-weight: 600;
}
</style>
