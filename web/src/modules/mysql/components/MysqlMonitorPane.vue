<script setup lang="ts">
import {
  RsButton,
  RsConfirmDialog,
  RsEmpty,
  RsIcon,
  RsLoading,
  RsSelect,
  RsTable,
  useRsToast,
  type RsSelectOptions,
  type RsTableColumn,
} from '@niuma/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mysqlApi } from '@/api'
import type {
  MysqlLockInfo,
  MysqlMetaInstanceOverviewResult,
  MysqlProcessInfo,
} from '@/api/types/mysql'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  sessionLabel?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

type MonitorTab = 'instance' | 'processes' | 'locks'
const activeTab = ref<MonitorTab>('instance')

// ─── Auto-refresh ──────────────────────────────────────────────────────────
const autoRefreshSecs = ref('0')
let refreshTimer: ReturnType<typeof setInterval> | null = null
const scopeOk = computed(() => Boolean(props.sessionId))

const autoRefreshOptions = computed<RsSelectOptions>(() => [
  { value: '0', label: t('modules.mysql.monitor.refreshOff') },
  { value: '3', label: t('modules.mysql.monitor.refresh3s') },
  { value: '5', label: t('modules.mysql.monitor.refresh5s') },
  { value: '10', label: t('modules.mysql.monitor.refresh10s') },
])

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
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const parts: string[] = []
  if (d) parts.push(`${d}d`)
  parts.push(`${h}h ${m}m ${s}s`)
  return parts.join(' ')
}

// ─── Processlist ───────────────────────────────────────────────────────────
const processesBusy = ref(false)
const processes = ref<MysqlProcessInfo[]>([])
const highlightedRowKey = ref<string | undefined>(undefined)
const confirmOpen = ref(false)
const pendingKill = ref<{ id: number; queryOnly: boolean } | null>(null)
const killBusy = ref(false)

const processColumns = computed<RsTableColumn[]>(() => [
  { key: 'id', title: t('modules.mysql.monitor.colId'), width: 72 },
  { key: 'user', title: t('modules.mysql.monitor.colUser'), minWidth: 90, ellipsis: true },
  { key: 'host', title: t('modules.mysql.monitor.colHost'), minWidth: 120, ellipsis: true },
  { key: 'db', title: t('modules.mysql.monitor.colDb'), minWidth: 90, ellipsis: true },
  { key: 'command', title: t('modules.mysql.monitor.colCommand'), width: 100 },
  { key: 'time', title: t('modules.mysql.monitor.colTime'), width: 72 },
  { key: 'state', title: t('modules.mysql.monitor.colState'), minWidth: 100, ellipsis: true },
  { key: 'info', title: t('modules.mysql.monitor.colInfo'), minWidth: 180, ellipsis: true },
])

const processRows = computed(() =>
  processes.value.map((p) => ({
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

const selectedId = computed(() => {
  if (!highlightedRowKey.value) return null
  const id = Number(highlightedRowKey.value)
  return Number.isFinite(id) ? id : null
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
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) processesBusy.value = false
  }
}

function onRowClick(row: Record<string, unknown>): void {
  const id = Number(row.id)
  highlightedRowKey.value = Number.isFinite(id) ? String(id) : undefined
}

function askKill(queryOnly: boolean): void {
  if (selectedId.value == null) return
  pendingKill.value = { id: selectedId.value, queryOnly }
  confirmOpen.value = true
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
    await loadProcesses(true)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    killBusy.value = false
  }
}

// ─── Locks ─────────────────────────────────────────────────────────────────
const locksLoading = ref(false)
const locks = ref<MysqlLockInfo[]>([])
const locksTruncated = ref(false)

const lockColumns = computed<RsTableColumn[]>(() => [
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

const lockRows = computed(() =>
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
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) locksLoading.value = false
  }
}

function onLockRowClick(row: Record<string, unknown>): void {
  const pid = Number(row.waitingPid)
  if (!Number.isFinite(pid)) return
  // 跳转到进程列表并高亮对应进程
  activeTab.value = 'processes'
  highlightedRowKey.value = String(pid)
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
  () => [props.sessionId, props.active] as const,
  ([sid, active]) => {
    if (sid && active) {
      void loadCurrentTab()
      setupTimer()
    } else {
      clearTimer()
    }
  },
  { immediate: true },
)

watch(activeTab, () => {
  void loadCurrentTab()
})

watch(autoRefreshSecs, () => setupTimer())

onBeforeUnmount(() => clearTimer())
</script>

<template>
  <div class="nm-mysql-monitor">
    <header class="nm-mysql-monitor__header">
      <div class="nm-mysql-monitor__tabs">
        <button
          v-for="tab in (['instance', 'processes', 'locks'] as const)"
          :key="tab"
          type="button"
          class="nm-mysql-monitor__tab"
          :class="{ 'nm-mysql-monitor__tab--active': activeTab === tab }"
          @click="activeTab = tab"
        >
          {{ t(`modules.mysql.monitor.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`) }}
        </button>
      </div>

      <div class="nm-mysql-monitor__title">
        <RsIcon name="activity" :size="16" />
        <span>{{ t('modules.mysql.session.tabMonitor') }}</span>
        <span v-if="sessionLabel" class="nm-mysql-monitor__label">{{ sessionLabel }}</span>
      </div>

      <div class="nm-mysql-monitor__actions">
        <template v-if="activeTab === 'processes'">
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

    <div class="nm-mysql-monitor__body">
      <!-- 实例概览 -->
      <template v-if="activeTab === 'instance'">
        <RsLoading v-if="overviewLoading && !overview" class="nm-mysql-monitor__loading" />
        <RsEmpty
          v-else-if="!sessionId"
          icon="activity"
          :description="t('modules.mysql.monitor.needSession')"
        />
        <div v-else-if="overview" class="nm-mysql-monitor__overview">
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
            <div v-if="overview.threadsConnected != null" class="nm-mysql-monitor__stat">
              <span class="nm-mysql-monitor__stat-label">{{ t('modules.mysql.monitor.instanceConnected') }}</span>
              <span class="nm-mysql-monitor__stat-value nm-mysql-monitor__stat-value--accent">{{ overview.threadsConnected }}</span>
            </div>
            <div v-if="overview.maxConnections != null" class="nm-mysql-monitor__stat">
              <span class="nm-mysql-monitor__stat-label">{{ t('modules.mysql.monitor.instanceMaxConn') }}</span>
              <span class="nm-mysql-monitor__stat-value">{{ overview.maxConnections }}</span>
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
        <RsEmpty v-else :description="t('modules.mysql.monitor.empty')" />
      </template>

      <!-- 进程列表 -->
      <template v-else-if="activeTab === 'processes'">
        <RsLoading v-if="processesBusy && processes.length === 0" class="nm-mysql-monitor__loading" />
        <RsEmpty
          v-else-if="!sessionId"
          icon="activity"
          :description="t('modules.mysql.monitor.needSession')"
        />
        <RsEmpty
          v-else-if="processes.length === 0 && !processesBusy"
          :description="t('modules.mysql.monitor.empty')"
        />
        <RsTable
          v-else
          v-model:highlighted-row-key="highlightedRowKey"
          :columns="processColumns"
          :data="processRows"
          size="sm"
          fill
          row-key="id"
          @row-click="onRowClick"
        />
      </template>

      <!-- 锁等待 -->
      <template v-else>
        <RsLoading v-if="locksLoading && locks.length === 0" class="nm-mysql-monitor__loading" />
        <RsEmpty
          v-else-if="!sessionId"
          icon="activity"
          :description="t('modules.mysql.monitor.needSession')"
        />
        <RsEmpty
          v-else-if="locks.length === 0 && !locksLoading"
          :description="t('modules.mysql.monitor.locksEmpty')"
        />
        <RsTable
          v-else
          :columns="lockColumns"
          :data="lockRows"
          size="sm"
          fill
          row-key="waitingPid"
          @row-click="onLockRowClick"
        />
        <div v-if="locksTruncated" class="nm-mysql-monitor__truncated">
          {{ t('modules.mysql.monitor.locksTruncated') }}
        </div>
      </template>
    </div>

    <RsConfirmDialog
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
          { id: pendingKill?.id ?? '' },
        )
      "
      :confirm-text="t('modules.mysql.monitor.killConfirm')"
      tone="danger"
      confirm-variant="danger"
      @confirm="confirmKill"
    />
  </div>
</template>

<style scoped>
.nm-mysql-monitor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
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
.nm-mysql-monitor__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
  min-width: 0;
  flex: 1;
}
.nm-mysql-monitor__label {
  color: var(--rs-fg-muted, #6b7280);
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nm-mysql-monitor__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
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
</style>
