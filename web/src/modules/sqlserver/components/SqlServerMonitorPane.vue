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
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { sqlserverApi } from '@/api/sqlserver'
import type { SqlServerProcessInfo } from '@/api/types/sqlserver'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  sessionLabel?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

type ProcessRow = Record<string, unknown> & { __rowKey: string; sessionId: number }

const LONG_RUNNING_MS = 60_000

const loading = ref(false)
const processes = ref<SqlServerProcessInfo[]>([])
const filter = ref('all')
const query = ref('')
const highlightedRowKey = ref<string | undefined>()
const autoRefreshSecs = ref('0')
const detailOpen = ref(false)
const detailProcess = ref<SqlServerProcessInfo | null>(null)
const confirmOpen = ref(false)
const pendingKill = ref<SqlServerProcessInfo | null>(null)
const killBusy = ref(false)

const dialogHostEl = ref<HTMLElement | null>(null)
const dialogTeleportReady = ref(false)
let refreshTimer: ReturnType<typeof setInterval> | null = null

function syncDialogMount(): void {
  dialogTeleportReady.value = dialogHostEl.value != null
}

onMounted(syncDialogMount)
onActivated(syncDialogMount)
onDeactivated(() => {
  detailOpen.value = false
  confirmOpen.value = false
  dialogTeleportReady.value = false
  clearTimer()
})

const scopeOk = computed(() => Boolean(props.sessionId))

const autoRefreshOptions = computed<RsSelectOptions>(() => [
  { value: '0', label: t('modules.sqlserver.monitor.refreshOff') },
  { value: '5', label: t('modules.sqlserver.monitor.refresh5s') },
  { value: '10', label: t('modules.sqlserver.monitor.refresh10s') },
  { value: '30', label: t('modules.sqlserver.monitor.refresh30s') },
])

const filterOptions = computed<RsSelectOptions>(() => [
  { value: 'all', label: t('modules.sqlserver.monitor.filterAll') },
  { value: 'running', label: t('modules.sqlserver.monitor.filterRunning') },
  { value: 'sleeping', label: t('modules.sqlserver.monitor.filterSleeping') },
  { value: 'blocked', label: t('modules.sqlserver.monitor.filterBlocked') },
  { value: 'long', label: t('modules.sqlserver.monitor.filterLong') },
])

const filteredProcesses = computed(() => {
  const q = query.value.trim().toLowerCase()
  return processes.value.filter((p) => {
    const status = (p.status ?? '').toLowerCase()
    if (filter.value === 'running' && status !== 'running') return false
    if (filter.value === 'sleeping' && status !== 'sleeping') return false
    if (filter.value === 'blocked' && !(p.blockingSessionId && p.blockingSessionId > 0)) return false
    if (filter.value === 'long' && (p.elapsedMs ?? 0) < LONG_RUNNING_MS) return false
    if (!q) return true
    const hay = [
      p.loginName,
      p.hostName,
      p.programName,
      p.status,
      p.database,
      p.command,
      p.waitType,
      p.info,
      String(p.sessionId),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
})

const columns = computed((): RsTableColumn<ProcessRow>[] => [
  { key: 'sessionId', title: t('modules.sqlserver.monitor.colSession'), width: 72, align: 'right' },
  { key: 'loginName', title: t('modules.sqlserver.monitor.colLogin'), width: 96, ellipsis: true },
  { key: 'hostName', title: t('modules.sqlserver.monitor.colHost'), width: 110, ellipsis: true },
  { key: 'database', title: t('modules.sqlserver.monitor.colDatabase'), width: 100, ellipsis: true },
  { key: 'status', title: t('modules.sqlserver.monitor.colStatus'), width: 88, ellipsis: true },
  { key: 'command', title: t('modules.sqlserver.monitor.colCommand'), width: 88, ellipsis: true },
  { key: 'waitType', title: t('modules.sqlserver.monitor.colWait'), minWidth: 120, ellipsis: true },
  { key: 'blockingSessionId', title: t('modules.sqlserver.monitor.colBlocking'), width: 72, align: 'right' },
  { key: 'elapsedMs', title: t('modules.sqlserver.monitor.colElapsed'), width: 80, align: 'right' },
  { key: 'cpuTime', title: t('modules.sqlserver.monitor.colCpu'), width: 64, align: 'right' },
  { key: 'programName', title: t('modules.sqlserver.monitor.colProgram'), minWidth: 120, ellipsis: true },
  { key: 'info', title: t('modules.sqlserver.monitor.colInfo'), minWidth: 280, ellipsis: true },
])

const rows = computed((): ProcessRow[] =>
  filteredProcesses.value.map((p) => ({
    ...p,
    __rowKey: String(p.sessionId),
    blockingSessionId: p.blockingSessionId && p.blockingSessionId > 0 ? p.blockingSessionId : '',
    elapsedMs: formatElapsed(p.elapsedMs),
  })),
)

const selected = computed(
  () => processes.value.find((p) => String(p.sessionId) === highlightedRowKey.value) ?? null,
)

function contextMenuItems(row: ProcessRow | null): RsContextMenuItem[] {
  if (!row) return []
  return [
    { key: 'detail', label: t('modules.sqlserver.monitor.viewDetail'), icon: 'eye' },
    {
      key: 'kill',
      label: t('modules.sqlserver.monitor.kill'),
      icon: 'x',
      danger: true,
    },
  ]
}

const detailRows = computed(() => {
  const p = detailProcess.value
  if (!p) return []
  return [
    { key: 'sessionId', label: t('modules.sqlserver.monitor.colSession'), value: String(p.sessionId) },
    { key: 'loginName', label: t('modules.sqlserver.monitor.colLogin'), value: p.loginName || '—' },
    { key: 'hostName', label: t('modules.sqlserver.monitor.colHost'), value: p.hostName || '—' },
    { key: 'database', label: t('modules.sqlserver.monitor.colDatabase'), value: p.database || '—' },
    { key: 'status', label: t('modules.sqlserver.monitor.colStatus'), value: p.status || '—' },
    { key: 'command', label: t('modules.sqlserver.monitor.colCommand'), value: p.command || '—' },
    { key: 'waitType', label: t('modules.sqlserver.monitor.colWait'), value: p.waitType || '—' },
    {
      key: 'blocking',
      label: t('modules.sqlserver.monitor.colBlocking'),
      value: p.blockingSessionId && p.blockingSessionId > 0 ? String(p.blockingSessionId) : '—',
    },
    { key: 'elapsed', label: t('modules.sqlserver.monitor.colElapsed'), value: formatElapsed(p.elapsedMs) },
    { key: 'cpu', label: t('modules.sqlserver.monitor.colCpu'), value: String(p.cpuTime ?? 0) },
    { key: 'program', label: t('modules.sqlserver.monitor.colProgram'), value: p.programName || '—' },
    { key: 'loginTime', label: t('modules.sqlserver.monitor.colLoginTime'), value: p.loginTime || '—' },
    { key: 'info', label: t('modules.sqlserver.monitor.colInfo'), value: p.info || '—' },
  ]
})

function formatElapsed(ms: number | undefined): string {
  const n = Math.max(0, Math.trunc(ms ?? 0))
  if (n < 1000) return `${n} ms`
  const sec = Math.floor(n / 1000)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

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
    void loadProcesses(true)
  }, secs * 1000)
}

async function loadProcesses(quiet = false): Promise<void> {
  if (!props.sessionId) return
  if (!quiet) loading.value = true
  try {
    const result = await sqlserverApi.metaProcesslist({ sessionId: props.sessionId })
    processes.value = result.processes ?? []
  } catch (e) {
    if (!quiet) toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (!quiet) loading.value = false
  }
}

function onRowClick(row: ProcessRow): void {
  highlightedRowKey.value = String(row.sessionId)
}

function openDetail(row?: ProcessRow | SqlServerProcessInfo | null): void {
  const id = row && 'sessionId' in row ? Number(row.sessionId) : selected.value?.sessionId
  const found = processes.value.find((p) => p.sessionId === id) ?? null
  detailProcess.value = found
  detailOpen.value = Boolean(found)
}

function askKill(target?: SqlServerProcessInfo | null): void {
  const p = target ?? selected.value
  if (!p) return
  pendingKill.value = p
  confirmOpen.value = true
}

async function confirmKill(): Promise<void> {
  if (!props.sessionId || !pendingKill.value) return
  killBusy.value = true
  try {
    await sqlserverApi.metaKill({ sessionId: props.sessionId, id: pendingKill.value.sessionId })
    toast.success(t('modules.sqlserver.monitor.killOk', { id: pendingKill.value.sessionId }))
    confirmOpen.value = false
    detailOpen.value = false
    pendingKill.value = null
    await loadProcesses(true)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    killBusy.value = false
  }
}

function onContextMenuSelect(key: string, row: ProcessRow | null): void {
  if (row) highlightedRowKey.value = String(row.sessionId)
  if (key === 'detail') openDetail(row)
  if (key === 'kill') askKill(row ? processes.value.find((p) => p.sessionId === row.sessionId) : null)
}

watch(
  () => [props.sessionId, props.active] as const,
  ([sessionId, active]) => {
    if (sessionId && active) void loadProcesses()
    setupTimer()
  },
  { immediate: true },
)

watch(autoRefreshSecs, () => setupTimer())
onBeforeUnmount(() => clearTimer())
</script>

<template>
  <div class="nm-sqlserver-monitor" :title="sessionLabel">
    <div ref="dialogHostEl" class="nm-sqlserver-monitor__dialog-mount" />
    <header class="nm-sqlserver-monitor__toolbar">
      <div class="nm-sqlserver-monitor__filters">
        <RsSelect
          v-model="filter"
          size="sm"
          class="nm-sqlserver-monitor__filter-select"
          :options="filterOptions"
        />
        <RsInput
          v-model="query"
          size="sm"
          clearable
          class="nm-sqlserver-monitor__filter-input"
          :placeholder="t('modules.sqlserver.monitor.filterPlaceholder')"
        />
        <span class="nm-sqlserver-monitor__meta">
          {{ filteredProcesses.length }} / {{ processes.length }}
        </span>
      </div>
      <div class="nm-sqlserver-monitor__actions">
        <span v-if="selected" class="nm-sqlserver-monitor__selected">
          #{{ selected.sessionId }}
          <template v-if="selected.loginName"> · {{ selected.loginName }}</template>
        </span>
        <RsSelect
          v-model="autoRefreshSecs"
          size="sm"
          class="nm-sqlserver-monitor__refresh-select"
          :options="autoRefreshOptions"
        />
        <RsButton size="sm" variant="ghost" icon="refresh-cw" :loading="loading" @click="loadProcesses()">
          {{ t('modules.sqlserver.monitor.refresh') }}
        </RsButton>
        <RsButton
          size="sm"
          variant="danger"
          icon="x"
          :disabled="!selected || killBusy"
          @click="askKill()"
        >
          {{ t('modules.sqlserver.monitor.kill') }}
        </RsButton>
      </div>
    </header>

    <RsLoading v-if="loading && processes.length === 0" class="nm-sqlserver-monitor__loading" />
    <RsEmpty
      v-else-if="!sessionId"
      radius="none"
      icon-radius="none"
      :description="t('modules.sqlserver.monitor.needSession')"
    />
    <RsEmpty
      v-else-if="rows.length === 0 && !loading"
      radius="none"
      icon-radius="none"
      :description="
        processes.length === 0
          ? t('modules.sqlserver.monitor.empty')
          : t('modules.sqlserver.monitor.filterEmpty')
      "
    />
    <RsTable
      v-else
      v-model:highlighted-row-key="highlightedRowKey"
      class="nm-sqlserver-monitor__table"
      :columns="columns"
      :data="rows"
      size="sm"
      fill
      resizable
      cell-tooltip
      highlight-row
      row-key="__rowKey"
      :context-menu-items="contextMenuItems"
      @row-click="onRowClick"
      @row-dblclick="openDetail"
      @context-menu-select="onContextMenuSelect"
    />

    <RsDialog
      v-if="dialogTeleportReady"
      v-model:open="detailOpen"
      :title="t('modules.sqlserver.monitor.sessionDetailTitle')"
      width="md"
      layout="form"
      :modal="false"
      :show-overlay="false"
      :teleport-to="dialogHostEl ?? undefined"
      :resizable="false"
      :fullscreenable="false"
    >
      <template #body>
        <dl v-if="detailProcess" class="nm-sqlserver-monitor__detail">
          <div v-for="item in detailRows" :key="item.key" class="nm-sqlserver-monitor__detail-row">
            <dt>{{ item.label }}</dt>
            <dd :class="{ 'nm-sqlserver-monitor__detail-query': item.key === 'info' }">{{ item.value }}</dd>
          </div>
        </dl>
      </template>
      <template #footer>
        <RsButton variant="ghost" size="sm" @click="detailOpen = false">
          {{ t('modules.sqlserver.monitor.close') }}
        </RsButton>
        <RsButton
          variant="danger"
          size="sm"
          :disabled="killBusy || !detailProcess"
          @click="askKill(detailProcess)"
        >
          {{ t('modules.sqlserver.monitor.kill') }}
        </RsButton>
      </template>
    </RsDialog>

    <RsConfirmDialog
      v-if="dialogTeleportReady"
      v-model:open="confirmOpen"
      :title="t('modules.sqlserver.monitor.killTitle')"
      :description="
        t('modules.sqlserver.monitor.killDesc', {
          id: pendingKill?.sessionId ?? '',
          who: pendingKill?.loginName || '—',
        })
      "
      :confirm-text="t('modules.sqlserver.monitor.killConfirm')"
      tone="danger"
      confirm-variant="danger"
      :show-overlay="false"
      :teleport-to="dialogHostEl ?? undefined"
      @confirm="confirmKill"
    />
  </div>
</template>

<style scoped>
.nm-sqlserver-monitor {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  position: relative;
}

.nm-sqlserver-monitor__dialog-mount {
  position: absolute;
  inset: 0;
  z-index: var(--rs-z-modal);
  pointer-events: none;
}

.nm-sqlserver-monitor__dialog-mount :deep(.rs-dialog__content),
.nm-sqlserver-monitor__dialog-mount :deep(.rs-confirm-dialog__content) {
  pointer-events: auto;
}

.nm-sqlserver-monitor__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  padding: 6px 12px;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.nm-sqlserver-monitor__filters,
.nm-sqlserver-monitor__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
}

.nm-sqlserver-monitor__filter-select {
  width: 132px;
  flex-shrink: 0;
}

.nm-sqlserver-monitor__filter-input {
  width: 240px;
  flex: 1 1 160px;
  min-width: 140px;
}

.nm-sqlserver-monitor__refresh-select {
  width: 132px;
  flex-shrink: 0;
}

.nm-sqlserver-monitor__meta,
.nm-sqlserver-monitor__selected {
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  white-space: nowrap;
}

.nm-sqlserver-monitor__loading,
.nm-sqlserver-monitor__table {
  flex: 1;
  min-height: 0;
}

.nm-sqlserver-monitor__detail {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nm-sqlserver-monitor__detail-row {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 8px;
}

.nm-sqlserver-monitor__detail-row dt {
  color: var(--rs-muted);
}

.nm-sqlserver-monitor__detail-query {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
}
</style>
