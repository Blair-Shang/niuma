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
  RsTabs,
  RsToolbar,
  useRsToast,
} from '@niuma/ui'
import type { RsContextMenuItem, RsSelectOptions, RsTabItem, RsTableColumn } from '@niuma/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { vastbaseApi } from '@/api'
import type {
  VastActivitySession,
  VastLockBlockingEdge,
  VastLockInfo,
  VastMetaInstanceOverviewResult,
} from '@/api/types/vastbase'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  /** 连接显示名（与 Session 顶栏合并后由面板自绘） */
  sessionLabel?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

type Section = 'instance' | 'sessions' | 'locks'
type BackendAction = 'cancel' | 'terminate'

const section = ref<Section>('instance')
const loading = ref(false)
const instance = ref<VastMetaInstanceOverviewResult | null>(null)
const sessions = ref<VastActivitySession[]>([])
const locks = ref<VastLockInfo[]>([])
const blockingEdges = ref<VastLockBlockingEdge[]>([])
const sessionsTruncated = ref(false)
const locksTruncated = ref(false)
const listLimit = ref(500)
const highlightedSessionKey = ref<string | undefined>()
const detailOpen = ref(false)
const detailSession = ref<VastActivitySession | null>(null)
const autoRefreshSecs = ref('0')
const sessionFilter = ref('all')
const sessionQuery = ref('')
const lockWaitingOnly = ref(false)
const actionBusy = ref(false)
const confirmOpen = ref(false)
const pendingAction = ref<BackendAction | null>(null)
const pendingPid = ref<number | null>(null)
const sessionGone = ref(false)

/**
 * Dialog Portal 挂载点：挂到当前面板，无遮罩、非 modal，避免挡住 Shell Tab 切换。
 */
const dialogHostEl = ref<HTMLElement | null>(null)
const dialogTeleportReady = ref(false)

onMounted(() => {
  dialogTeleportReady.value = dialogHostEl.value != null
})

let refreshTimer: ReturnType<typeof setInterval> | null = null

const scopeOk = computed(() => !!(props.sessionId || props.profileId))

const autoRefreshMs = computed(() => {
  const n = Number(autoRefreshSecs.value)
  return Number.isFinite(n) && n > 0 ? n * 1000 : 0
})

const filteredSessions = computed(() => {
  const q = sessionQuery.value.trim().toLowerCase()
  const filter = sessionFilter.value
  return sessions.value.filter((s) => {
    const state = (s.state ?? '').toLowerCase()
    if (filter === 'active' && (state === '' || state === 'idle')) return false
    if (filter === 'idle' && state !== 'idle') return false
    if (
      filter === 'waiting' &&
      !s.waiting &&
      !s.waitEvent &&
      !state.includes('wait')
    ) {
      return false
    }
    if (!q) return true
    const hay = [
      s.userName,
      s.database,
      s.state,
      s.waitEvent,
      s.applicationName,
      s.query,
      s.sessionId,
      s.queryId,
      String(s.pid),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
})

const filteredLocks = computed(() => {
  if (!lockWaitingOnly.value) return locks.value
  return locks.value.filter((l) => !l.granted || !!l.blockedByPid)
})

const blockerByBlocked = computed(() => {
  const map = new Map<number, number>()
  for (const e of blockingEdges.value) {
    if (!map.has(e.blockedPid)) map.set(e.blockedPid, e.blockingPid)
  }
  for (const l of locks.value) {
    if (l.blockedByPid && !map.has(l.pid)) map.set(l.pid, l.blockedByPid)
  }
  return map
})

const tabItems = computed((): RsTabItem[] => [
  { value: 'instance', label: t('modules.vastbase.monitor.tabInstance') },
  {
    value: 'sessions',
    label: t('modules.vastbase.monitor.tabSessions'),
    badge: filteredSessions.value.length || undefined,
  },
  {
    value: 'locks',
    label: t('modules.vastbase.monitor.tabLocks'),
    badge: filteredLocks.value.length || undefined,
  },
])

const intervalOptions = computed((): RsSelectOptions => [
  { value: '0', label: t('modules.vastbase.monitor.autoOff') },
  { value: '5', label: t('modules.vastbase.monitor.autoSecs', { n: 5 }) },
  { value: '10', label: t('modules.vastbase.monitor.autoSecs', { n: 10 }) },
  { value: '30', label: t('modules.vastbase.monitor.autoSecs', { n: 30 }) },
])

const filterOptions = computed((): RsSelectOptions => [
  { value: 'all', label: t('modules.vastbase.monitor.filterAll') },
  { value: 'active', label: t('modules.vastbase.monitor.filterActive') },
  { value: 'waiting', label: t('modules.vastbase.monitor.filterWaiting') },
  { value: 'idle', label: t('modules.vastbase.monitor.filterIdle') },
])

type Row = Record<string, unknown> & { __rowKey: string }

const sessionCols = computed((): RsTableColumn<Row>[] => [
  { key: 'pid', title: 'PID', width: 88, align: 'right' },
  { key: 'userName', title: t('modules.vastbase.monitor.colUser'), minWidth: 72, ellipsis: true },
  { key: 'database', title: t('modules.vastbase.monitor.colDatabase'), minWidth: 88, ellipsis: true },
  {
    key: 'applicationName',
    title: t('modules.vastbase.monitor.colApp'),
    minWidth: 100,
    ellipsis: true,
  },
  { key: 'state', title: t('modules.vastbase.monitor.colState'), minWidth: 72 },
  { key: 'durationMs', title: t('modules.vastbase.monitor.colDuration'), minWidth: 88, align: 'right' },
  {
    key: 'clientAddr',
    title: t('modules.vastbase.monitor.colClientAddr'),
    minWidth: 120,
    ellipsis: true,
  },
  {
    key: 'backendType',
    title: t('modules.vastbase.monitor.colBackendType'),
    minWidth: 88,
    ellipsis: true,
  },
  { key: 'waitEvent', title: t('modules.vastbase.monitor.colWait'), minWidth: 100, ellipsis: true },
  { key: 'query', title: t('modules.vastbase.monitor.colQuery'), minWidth: 200, ellipsis: true },
])

const lockCols = computed((): RsTableColumn<Row>[] => [
  { key: 'pid', title: 'PID', width: 88, align: 'right' },
  {
    key: 'blockedByPid',
    title: t('modules.vastbase.monitor.colBlockedBy'),
    minWidth: 88,
    align: 'right',
  },
  {
    key: 'blockChain',
    title: t('modules.vastbase.monitor.colBlockChain'),
    minWidth: 140,
    ellipsis: true,
  },
  { key: 'lockType', title: t('modules.vastbase.monitor.colLockType'), minWidth: 96 },
  { key: 'mode', title: t('modules.vastbase.monitor.colMode'), minWidth: 100, ellipsis: true },
  { key: 'granted', title: t('modules.vastbase.monitor.colGranted'), minWidth: 72 },
  { key: 'relation', title: t('modules.vastbase.monitor.colRelation'), minWidth: 140, ellipsis: true },
  { key: 'database', title: t('modules.vastbase.monitor.colDatabase'), minWidth: 100, ellipsis: true },
])

const sessionByPid = computed(() => {
  const map = new Map<number, VastActivitySession>()
  for (const s of sessions.value) map.set(s.pid, s)
  return map
})

function formatDurationMs(ms: number | undefined | null): string {
  if (ms == null || ms <= 0) return ''
  return `${Math.round(ms)} ms`
}

function formatClient(s: VastActivitySession): string {
  const addr = (s.clientAddr ?? '').trim()
  if (!addr) return ''
  if (s.clientPort == null || s.clientPort === 0) return addr
  return `${addr}:${s.clientPort}`
}

function canCancelSession(s: VastActivitySession | null | undefined): boolean {
  if (!s) return false
  const state = (s.state ?? '').toLowerCase()
  return state === 'active' || state === 'fastpath function call'
}

function formatBlockChain(pid: number): string {
  const parts: number[] = [pid]
  const seen = new Set<number>([pid])
  let cur = pid
  for (let i = 0; i < 8; i++) {
    const next = blockerByBlocked.value.get(cur)
    if (next == null || seen.has(next)) break
    parts.push(next)
    seen.add(next)
    cur = next
  }
  return parts.length > 1 ? parts.join(' ← ') : ''
}

function isSessionGoneError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e ?? '')).toLowerCase()
  return msg.includes('session not found')
}

function stopAutoRefreshForGone(): void {
  if (sessionGone.value) return
  sessionGone.value = true
  autoRefreshSecs.value = '0'
  clearRefreshTimer()
  toast.warning(t('modules.vastbase.monitor.sessionGone'))
}

const sessionRows = computed((): Row[] =>
  filteredSessions.value.map((s) => ({
    __rowKey: String(s.pid),
    pid: s.pid,
    userName: s.userName ?? '',
    database: s.database ?? '',
    applicationName: s.applicationName ?? '',
    state: s.state ?? '',
    durationMs: formatDurationMs(s.durationMs),
    clientAddr: formatClient(s),
    backendType: s.backendType ?? '',
    waitEvent: [s.waitEventType, s.waitEvent].filter(Boolean).join(' / ') || s.waitEvent || '',
    query: s.query ?? '',
  })),
)

const lockRows = computed((): Row[] =>
  filteredLocks.value.map((l, i) => ({
    __rowKey: `${l.pid}-${l.lockType}-${i}`,
    pid: l.pid,
    blockedByPid: l.blockedByPid || blockerByBlocked.value.get(l.pid) || '',
    blockChain: formatBlockChain(l.pid),
    lockType: l.lockType ?? '',
    mode: l.mode ?? '',
    granted: l.granted
      ? t('modules.vastbase.session.colTipYes')
      : t('modules.vastbase.session.colTipNo'),
    relation: l.relation ?? '',
    database: l.database ?? '',
  })),
)

const detailRows = computed(() => {
  const s = detailSession.value
  if (!s) return []
  return [
    { key: 'pid', label: 'PID', value: String(s.pid) },
    { key: 'userName', label: t('modules.vastbase.monitor.colUser'), value: s.userName || '—' },
    { key: 'database', label: t('modules.vastbase.monitor.colDatabase'), value: s.database || '—' },
    {
      key: 'applicationName',
      label: t('modules.vastbase.monitor.colApp'),
      value: s.applicationName || '—',
    },
    { key: 'state', label: t('modules.vastbase.monitor.colState'), value: s.state || '—' },
    {
      key: 'durationMs',
      label: t('modules.vastbase.monitor.colDuration'),
      value: formatDurationMs(s.durationMs) || '—',
    },
    {
      key: 'queryStart',
      label: t('modules.vastbase.monitor.colQueryStart'),
      value: s.queryStart || '—',
    },
    {
      key: 'xactStart',
      label: t('modules.vastbase.monitor.colXactStart'),
      value: s.xactStart || '—',
    },
    {
      key: 'waitEventType',
      label: t('modules.vastbase.monitor.colWaitType'),
      value: s.waitEventType || '—',
    },
    { key: 'waitEvent', label: t('modules.vastbase.monitor.colWait'), value: s.waitEvent || '—' },
    {
      key: 'clientAddr',
      label: t('modules.vastbase.monitor.colClientAddr'),
      value: formatClient(s) || '—',
    },
    {
      key: 'backendType',
      label: t('modules.vastbase.monitor.colBackendType'),
      value: s.backendType || '—',
    },
    {
      key: 'sessionId',
      label: t('modules.vastbase.monitor.colSessionId'),
      value: s.sessionId || '—',
    },
    {
      key: 'queryId',
      label: t('modules.vastbase.monitor.colQueryId'),
      value: s.queryId || '—',
    },
    { key: 'query', label: t('modules.vastbase.monitor.colQuery'), value: s.query || '—' },
  ]
})

const detailCanCancel = computed(() => canCancelSession(detailSession.value))

const confirmTitle = computed(() =>
  pendingAction.value === 'terminate'
    ? t('modules.vastbase.monitor.terminateTitle')
    : t('modules.vastbase.monitor.cancelTitle'),
)

const confirmDesc = computed(() =>
  t(
    pendingAction.value === 'terminate'
      ? 'modules.vastbase.monitor.terminateDesc'
      : 'modules.vastbase.monitor.cancelDesc',
    { pid: pendingPid.value ?? '' },
  ),
)

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : t('modules.vastbase.monitor.loadError')
}

function apiBase() {
  return {
    sessionId: props.sessionId ?? undefined,
    profileId: props.profileId,
    database: props.database,
  }
}

function openSessionDetail(row: Row | null): void {
  if (!row) return
  const pid = Number(row.pid)
  const session = sessionByPid.value.get(pid)
  if (!session) {
    toast.error(t('modules.vastbase.monitor.sessionNotFound'))
    return
  }
  highlightedSessionKey.value = row.__rowKey
  detailSession.value = session
  detailOpen.value = true
}

function askBackendAction(action: BackendAction, row: Row | null): void {
  if (!row) return
  const pid = Number(row.pid)
  if (!Number.isFinite(pid) || pid <= 0) return
  highlightedSessionKey.value = row.__rowKey
  pendingAction.value = action
  pendingPid.value = pid
  confirmOpen.value = true
}

function sessionContextMenuItems(row: Row | null): RsContextMenuItem[] {
  if (!row) return []
  const session = sessionByPid.value.get(Number(row.pid))
  return [
    {
      key: 'session-detail',
      label: t('modules.vastbase.monitor.viewSessionDetail'),
      icon: 'info',
    },
    { key: 'sep-ops', label: '', separator: true },
    {
      key: 'session-cancel',
      label: t('modules.vastbase.monitor.cancelQuery'),
      icon: 'circle-x',
      disabled: !canCancelSession(session),
    },
    {
      key: 'session-terminate',
      label: t('modules.vastbase.monitor.terminateSession'),
      icon: 'unplug',
      danger: true,
    },
  ]
}

function onSessionContextMenuSelect(key: string, row: Row | null): void {
  if (key === 'session-detail') openSessionDetail(row)
  else if (key === 'session-cancel') {
    const session = row ? sessionByPid.value.get(Number(row.pid)) : null
    if (!canCancelSession(session)) return
    askBackendAction('cancel', row)
  } else if (key === 'session-terminate') askBackendAction('terminate', row)
}

function onSessionRowDblclick(row: Row): void {
  openSessionDetail(row)
}

function jumpToSession(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0) return
  section.value = 'sessions'
  highlightedSessionKey.value = String(pid)
  const session = sessionByPid.value.get(pid)
  if (session) {
    detailSession.value = session
    detailOpen.value = true
  }
}

function lockContextMenuItems(row: Row | null): RsContextMenuItem[] {
  if (!row) return []
  const items: RsContextMenuItem[] = [
    {
      key: 'lock-jump-pid',
      label: `${t('modules.vastbase.monitor.jumpToSession')} (PID ${row.pid})`,
      icon: 'arrow-right',
    },
  ]
  const blockedBy = Number(row.blockedByPid)
  if (Number.isFinite(blockedBy) && blockedBy > 0) {
    items.push({
      key: 'lock-jump-blocker',
      label: `${t('modules.vastbase.monitor.jumpToSession')} (${t('modules.vastbase.monitor.colBlockedBy')} ${blockedBy})`,
      icon: 'arrow-right',
    })
  }
  return items
}

function onLockContextMenuSelect(key: string, row: Row | null): void {
  if (!row) return
  if (key === 'lock-jump-pid') jumpToSession(Number(row.pid))
  else if (key === 'lock-jump-blocker') jumpToSession(Number(row.blockedByPid))
}

function onLockRowDblclick(row: Row): void {
  jumpToSession(Number(row.pid))
}

async function confirmBackendAction(): Promise<void> {
  const action = pendingAction.value
  const pid = pendingPid.value
  if (!action || pid == null || !scopeOk.value) return
  actionBusy.value = true
  try {
    const result =
      action === 'terminate'
        ? await vastbaseApi.metaBackendTerminate({ ...apiBase(), pid })
        : await vastbaseApi.metaBackendCancel({ ...apiBase(), pid })
    if (result.success) {
      toast.success(
        action === 'terminate'
          ? t('modules.vastbase.monitor.terminateOk', { pid })
          : t('modules.vastbase.monitor.cancelOk', { pid }),
      )
    } else {
      toast.warning(t('modules.vastbase.monitor.actionNoEffect', { pid }))
    }
    confirmOpen.value = false
    detailOpen.value = false
    await loadAll({ silent: true })
  } catch (e) {
    if (isSessionGoneError(e)) stopAutoRefreshForGone()
    else toast.error(errMessage(e))
  } finally {
    actionBusy.value = false
  }
}

async function loadAll(opts?: { silent?: boolean }): Promise<void> {
  if (!scopeOk.value || sessionGone.value) return
  if (!props.active && opts?.silent) return
  if (!opts?.silent) loading.value = true
  try {
    const base = apiBase()
    const [instRes, actRes, locksRes] = await Promise.allSettled([
      vastbaseApi.metaInstanceOverview(base),
      vastbaseApi.metaActivity(base),
      vastbaseApi.metaLocks(base),
    ])

    const goneReason =
      (instRes.status === 'rejected' && isSessionGoneError(instRes.reason) && instRes.reason) ||
      (actRes.status === 'rejected' && isSessionGoneError(actRes.reason) && actRes.reason) ||
      (locksRes.status === 'rejected' && isSessionGoneError(locksRes.reason) && locksRes.reason) ||
      null
    if (goneReason) {
      stopAutoRefreshForGone()
      return
    }

    if (instRes.status === 'fulfilled') instance.value = instRes.value
    else if (!opts?.silent) instance.value = null

    if (actRes.status === 'fulfilled') {
      sessions.value = actRes.value.sessions ?? []
      sessionsTruncated.value = !!actRes.value.truncated
      if (actRes.value.limit) listLimit.value = actRes.value.limit
    } else if (!opts?.silent) {
      sessions.value = []
      sessionsTruncated.value = false
    }

    if (locksRes.status === 'fulfilled') {
      locks.value = locksRes.value.locks ?? []
      blockingEdges.value = locksRes.value.blocking ?? []
      locksTruncated.value = !!locksRes.value.truncated
      if (locksRes.value.limit) listLimit.value = locksRes.value.limit
    } else if (!opts?.silent) {
      locks.value = []
      blockingEdges.value = []
      locksTruncated.value = false
    }

    if (!opts?.silent) {
      const firstErr =
        (instRes.status === 'rejected' && instRes.reason) ||
        (actRes.status === 'rejected' && actRes.reason) ||
        (locksRes.status === 'rejected' && locksRes.reason) ||
        null
      if (firstErr) toast.error(errMessage(firstErr))
    }
  } finally {
    if (!opts?.silent) loading.value = false
  }
}

function clearRefreshTimer(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

function setupAutoRefresh(): void {
  clearRefreshTimer()
  if (
    !props.active ||
    !scopeOk.value ||
    sessionGone.value ||
    autoRefreshMs.value <= 0
  ) {
    return
  }
  refreshTimer = setInterval(() => {
    if (props.active && scopeOk.value && !sessionGone.value) void loadAll({ silent: true })
  }, autoRefreshMs.value)
}

watch(
  () => [props.sessionId, props.profileId, props.database, props.active] as const,
  () => {
    sessionGone.value = false
    if (props.active && scopeOk.value) void loadAll()
    setupAutoRefresh()
  },
  { immediate: true },
)

watch(autoRefreshSecs, () => setupAutoRefresh())

watch(section, () => {
  if (section.value !== 'sessions') {
    detailOpen.value = false
    detailSession.value = null
  }
})

onBeforeUnmount(() => clearRefreshTimer())
</script>

<template>
  <div class="nm-vast-monitor">
    <div ref="dialogHostEl" class="nm-vast-monitor__dialog-mount" aria-hidden="true" />

    <RsToolbar size="sm" compact border="bottom" :label="t('modules.vastbase.session.tabMonitor')">
      <template #left>
        <div class="nm-vast-monitor__identity" :title="sessionLabel || undefined">
          <RsIcon name="vastbase" :size="15" />
          <span v-if="sessionLabel" class="nm-vast-monitor__session">{{ sessionLabel }}</span>
          <span class="nm-vast-monitor__feature">
            <RsIcon name="activity" :size="12" />
            {{ t('modules.vastbase.session.tabMonitor') }}
          </span>
        </div>
        <RsTabs
          v-model="section"
          :items="tabItems"
          size="sm"
          panelless
          class="nm-vast-monitor__tabs"
        />
      </template>
      <template #right>
        <RsSelect
          v-model="autoRefreshSecs"
          size="sm"
          :options="intervalOptions"
          class="nm-vast-monitor__interval"
          :aria-label="t('modules.vastbase.monitor.autoRefresh')"
        />
        <RsButton variant="ghost" size="sm" icon="refresh-cw" :loading="loading" @click="loadAll()">
          {{ t('modules.vastbase.structure.refresh') }}
        </RsButton>
      </template>
    </RsToolbar>

    <div
      v-if="section === 'sessions' && scopeOk"
      class="nm-vast-monitor__filters"
    >
      <RsSelect
        v-model="sessionFilter"
        size="sm"
        :options="filterOptions"
        class="nm-vast-monitor__filter-select"
      />
      <RsInput
        v-model="sessionQuery"
        size="sm"
        clearable
        class="nm-vast-monitor__filter-input"
        :placeholder="t('modules.vastbase.monitor.filterPlaceholder')"
      />
      <span class="nm-vast-monitor__filter-meta">
        {{ filteredSessions.length }} / {{ sessions.length }}
        <template v-if="sessionsTruncated">
          · {{ t('modules.vastbase.monitor.listTruncated', { limit: listLimit }) }}
        </template>
      </span>
    </div>

    <div
      v-else-if="section === 'locks' && scopeOk"
      class="nm-vast-monitor__filters"
    >
      <RsButton
        size="sm"
        :variant="lockWaitingOnly ? 'default' : 'ghost'"
        @click="lockWaitingOnly = !lockWaitingOnly"
      >
        {{ t('modules.vastbase.monitor.lockWaitingOnly') }}
      </RsButton>
      <span class="nm-vast-monitor__filter-meta">
        {{ filteredLocks.length }} / {{ locks.length }}
        <template v-if="locksTruncated">
          · {{ t('modules.vastbase.monitor.listTruncated', { limit: listLimit }) }}
        </template>
      </span>
    </div>

    <div
      class="nm-vast-monitor__body"
      :class="{ 'nm-vast-monitor__body--pad': section === 'instance' || !scopeOk }"
    >
      <RsLoading v-if="loading && !instance && section === 'instance'" class="nm-vast-monitor__loader" />
      <RsEmpty
        v-else-if="!scopeOk"
        icon="activity"
        :description="t('modules.vastbase.monitor.needConnection')"
      />

      <template v-else-if="section === 'instance'">
        <template v-if="instance">
          <dl class="nm-vast-monitor__meta">
            <div class="nm-vast-monitor__meta-row">
              <dt>{{ t('modules.vastbase.monitor.version') }}</dt>
              <dd>{{ instance.versionNum || instance.version }}</dd>
            </div>
            <div v-if="instance.currentUser" class="nm-vast-monitor__meta-row">
              <dt>{{ t('modules.vastbase.monitor.currentUser') }}</dt>
              <dd>{{ instance.currentUser }}</dd>
            </div>
            <div v-if="instance.currentDatabase" class="nm-vast-monitor__meta-row">
              <dt>{{ t('modules.vastbase.monitor.currentDatabase') }}</dt>
              <dd>{{ instance.currentDatabase }}</dd>
            </div>
            <div v-if="instance.serverAddr" class="nm-vast-monitor__meta-row">
              <dt>{{ t('modules.vastbase.monitor.serverAddr') }}</dt>
              <dd>{{ instance.serverAddr }}</dd>
            </div>
            <div v-if="instance.startTime" class="nm-vast-monitor__meta-row">
              <dt>{{ t('modules.vastbase.monitor.startTime') }}</dt>
              <dd>{{ instance.startTime }}</dd>
            </div>
            <div class="nm-vast-monitor__meta-row">
              <dt>{{ t('modules.vastbase.monitor.databaseCount') }}</dt>
              <dd>{{ instance.databaseCount }}</dd>
            </div>
            <div class="nm-vast-monitor__meta-row">
              <dt>{{ t('modules.vastbase.monitor.backends') }}</dt>
              <dd>
                {{ instance.activeBackends
                }}<template v-if="instance.maxConnections"> / {{ instance.maxConnections }}</template>
              </dd>
            </div>
          </dl>
          <p class="nm-vast-monitor__hint">{{ instance.version }}</p>
        </template>
        <RsEmpty
          v-else-if="!loading"
          icon="activity"
          :description="t('modules.vastbase.monitor.loadError')"
        />
      </template>

      <RsTable
        v-else-if="section === 'sessions'"
        v-model:highlighted-row-key="highlightedSessionKey"
        :columns="sessionCols"
        :data="sessionRows"
        row-key="__rowKey"
        size="sm"
        fill
        resizable
        column-layout="auto"
        cell-tooltip
        highlight-row
        :context-menu-items="sessionContextMenuItems"
        class="nm-vast-monitor__table"
        @context-menu-select="onSessionContextMenuSelect"
        @row-dblclick="onSessionRowDblclick"
      />

      <RsTable
        v-else-if="section === 'locks'"
        :columns="lockCols"
        :data="lockRows"
        size="sm"
        fill
        resizable
        column-layout="auto"
        cell-tooltip
        :context-menu-items="lockContextMenuItems"
        class="nm-vast-monitor__table"
        @context-menu-select="onLockContextMenuSelect"
        @row-dblclick="onLockRowDblclick"
      />
    </div>

    <RsDialog
      v-if="dialogTeleportReady"
      v-model:open="detailOpen"
      :title="t('modules.vastbase.monitor.sessionDetailTitle')"
      width="md"
      layout="form"
      :modal="false"
      :show-overlay="false"
      :teleport-to="dialogHostEl ?? undefined"
      :resizable="false"
      :fullscreenable="false"
    >
      <template #body>
        <dl v-if="detailSession" class="nm-vast-monitor__detail">
          <div v-for="item in detailRows" :key="item.key" class="nm-vast-monitor__detail-row">
            <dt>{{ item.label }}</dt>
            <dd :class="{ 'nm-vast-monitor__detail-query': item.key === 'query' }">
              {{ item.value }}
            </dd>
          </div>
        </dl>
      </template>
      <template #footer>
        <RsButton
          variant="ghost"
          size="sm"
          :disabled="actionBusy || !detailSession || !detailCanCancel"
          @click="detailSession && askBackendAction('cancel', { __rowKey: String(detailSession.pid), pid: detailSession.pid })"
        >
          {{ t('modules.vastbase.monitor.cancelQuery') }}
        </RsButton>
        <RsButton
          variant="ghost"
          size="sm"
          :disabled="actionBusy || !detailSession"
          @click="detailSession && askBackendAction('terminate', { __rowKey: String(detailSession.pid), pid: detailSession.pid })"
        >
          {{ t('modules.vastbase.monitor.terminateSession') }}
        </RsButton>
        <RsButton variant="primary" size="sm" @click="detailOpen = false">
          {{ t('common.close') }}
        </RsButton>
      </template>
    </RsDialog>

    <RsConfirmDialog
      v-if="dialogTeleportReady"
      v-model:open="confirmOpen"
      :title="confirmTitle"
      :description="confirmDesc"
      :tone="pendingAction === 'terminate' ? 'danger' : 'default'"
      :confirm-variant="pendingAction === 'terminate' ? 'danger' : 'primary'"
      :show-overlay="false"
      :teleport-to="dialogHostEl ?? undefined"
      @confirm="confirmBackendAction"
    />
  </div>
</template>

<style scoped>
.nm-vast-monitor {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-vast-monitor__dialog-mount {
  position: absolute;
  inset: 0;
  z-index: var(--rs-z-modal);
  pointer-events: none;
}

.nm-vast-monitor__dialog-mount :deep(.rs-dialog__content),
.nm-vast-monitor__dialog-mount :deep(.rs-confirm-dialog__content) {
  pointer-events: auto;
}

.nm-vast-monitor__identity {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 14rem;
  margin-right: var(--rs-space-xs);
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  flex-shrink: 1;
}

.nm-vast-monitor__tabs {
  width: auto;
  flex: 0 0 auto;
  min-width: 0;
  align-self: center;
}

.nm-vast-monitor__tabs :deep(.rs-tabs__shell),
.nm-vast-monitor__tabs :deep(.rs-tabs__nav),
.nm-vast-monitor__tabs :deep(.rs-tabs__nav-viewport) {
  width: fit-content;
  max-width: 100%;
  background: transparent;
  border: none;
}

.nm-vast-monitor__tabs :deep(.rs-tabs__list) {
  width: fit-content;
  max-width: 100%;
  margin: 0;
  padding: 0;
  gap: var(--rs-space-xs);
  border: none;
  background: transparent;
  align-items: center;
}

.nm-vast-monitor__tabs :deep(.rs-tabs__trigger) {
  min-height: auto;
  margin: 0;
  padding: 0 var(--rs-space-sm);
  background: transparent !important;
  box-shadow: none !important;
  border: none;
}

.nm-vast-monitor__tabs :deep(.rs-tabs__trigger[data-state='active']::after) {
  inset-inline: var(--rs-space-xs);
  bottom: -1px;
}

.nm-vast-monitor__tabs :deep(.rs-tabs__badge) {
  background: transparent;
  padding-inline: 0.25rem;
}

.nm-vast-monitor__session {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-vast-monitor__feature {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.05rem 0.4rem;
  border-radius: var(--rs-radius-sm);
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.12));
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  flex-shrink: 0;
}

.nm-vast-monitor__interval {
  width: 6.5rem;
  flex-shrink: 0;
}

.nm-vast-monitor__filters {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
  padding: var(--rs-space-xs) var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
}

.nm-vast-monitor__filter-select {
  width: 6.5rem;
  flex-shrink: 0;
}

.nm-vast-monitor__filter-input {
  flex: 1;
  min-width: 8rem;
  max-width: 20rem;
}

.nm-vast-monitor__filter-meta {
  margin-left: auto;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.nm-vast-monitor__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.nm-vast-monitor__body--pad {
  gap: var(--rs-space-md);
  padding: var(--rs-space-md);
  overflow: auto;
}

.nm-vast-monitor__loader {
  flex: 1;
}

.nm-vast-monitor__meta {
  display: grid;
  flex-shrink: 0;
  width: 100%;
  max-width: 40rem;
  box-sizing: border-box;
  gap: var(--rs-space-xs);
  margin: 0;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  background: var(--rs-surface-subtle);
}

.nm-vast-monitor__meta-row {
  display: grid;
  grid-template-columns: 8rem 1fr;
  gap: var(--rs-space-sm);
  font-size: var(--rs-font-size-sm);
}

.nm-vast-monitor__meta-row dt {
  margin: 0;
  color: var(--rs-muted);
}

.nm-vast-monitor__meta-row dd {
  margin: 0;
  font-weight: 500;
  word-break: break-all;
}

.nm-vast-monitor__hint {
  margin: 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  word-break: break-all;
}

.nm-vast-monitor__table {
  flex: 1;
  min-height: 0;
}

.nm-vast-monitor__detail {
  display: grid;
  gap: var(--rs-space-sm);
  margin: 0;
}

.nm-vast-monitor__detail-row {
  display: grid;
  grid-template-columns: 6.5rem 1fr;
  gap: var(--rs-space-sm);
  font-size: var(--rs-font-size-sm);
  align-items: start;
}

.nm-vast-monitor__detail-row dt {
  margin: 0;
  color: var(--rs-muted);
}

.nm-vast-monitor__detail-row dd {
  margin: 0;
  font-weight: 500;
  word-break: break-all;
}

.nm-vast-monitor__detail-query {
  white-space: pre-wrap;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-weight: 400;
  max-height: 16rem;
  overflow: auto;
  padding: var(--rs-space-xs) var(--rs-space-sm);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-subtle);
  border: 1px solid var(--rs-border-subtle);
}
</style>
