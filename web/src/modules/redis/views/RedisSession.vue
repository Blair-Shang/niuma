<script setup lang="ts">
import { RsLoading, useRsToast } from '@niuma/ui'
import { computed, onActivated, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi } from '@/api'
import type { ConnectionProfile } from '@/api/types/connection'
import { useSessionLease } from '@/modules/connection/useSessionLease'
import { resourceTreeKey } from '@/modules/ops/conn-tree/keys'
import RedisConsolePane from '@/modules/redis/components/RedisConsolePane.vue'
import RedisKeyspacePane from '@/modules/redis/components/RedisKeyspacePane.vue'
import RedisLiveMonitorPane from '@/modules/redis/components/RedisLiveMonitorPane.vue'
import RedisMonitorPane from '@/modules/redis/components/RedisMonitorPane.vue'
import RedisSlowlogPane from '@/modules/redis/components/RedisSlowlogPane.vue'
import {
  createRedisDatabaseState,
  readRedisDatabaseFromOptions,
  redisDatabaseKey,
} from '@/modules/redis/composables/useRedisDatabase'
import SqlIdeToolbar from '@/modules/database/components/SqlIdeToolbar.vue'
import type {
  SqlIdeToolbarIdentityPart,
  SqlIdeToolbarItem,
} from '@/modules/database/types/sql-ide-toolbar'
import { useSessionActionStore } from '@/stores/session-actions'
import { useConnTreeSyncStore } from '@/stores/conn-tree-sync'
import { useTabStore } from '@/stores/tab'

const props = defineProps<{
  profileId: string
  /** 来自连接树或 Tab；打开后 SELECT 到该库 */
  database?: number
  /** 所属工作区 Tab，用于树高亮仅由激活会话上报 */
  tabId?: string
}>()

type RedisSessionTab = 'console' | 'keyspace' | 'monitor' | 'slowlog' | 'live'

const { t } = useI18n()
const toast = useRsToast()
const sessionActionStore = useSessionActionStore()
const connTreeSync = useConnTreeSyncStore()
const tabStore = useTabStore()

const profile = ref<ConnectionProfile | null>(null)
const connecting = ref(true)
const error = ref<string | null>(null)
const activeTab = ref<RedisSessionTab>('console')
const switchingDb = ref(false)
/** Registry scoped key 用的逻辑库（在 loadProfile 后写入） */
const scopeDatabase = ref(props.database ?? 0)

const { sessionId, acquireSession, reconnectSession } = useSessionLease({
  kind: 'redis',
  profileId: () => props.profileId,
  tabId: () => props.tabId,
  database: () => scopeDatabase.value,
  onAcquired: async () => {
    if (props.database !== undefined && props.database !== redisDb.currentDb.value) {
      await redisDb.selectDatabase(props.database)
    }
    publishTreeFocus()
  },
})

const redisDb = createRedisDatabaseState(() => sessionId.value, scopeDatabase.value, 'standalone')
provide(redisDatabaseKey, redisDb)

const dbOptions = computed(() =>
  Array.from({ length: 16 }, (_, i) => ({ value: String(i), label: `DB ${i}` })),
)

const paneDefs: Array<{
  key: RedisSessionTab
  icon: string
  labelKey: string
  hintKey: string
}> = [
  { key: 'console', icon: 'terminal', labelKey: 'tabConsole', hintKey: 'tabConsoleHint' },
  { key: 'keyspace', icon: 'key-round', labelKey: 'tabKeyspace', hintKey: 'tabKeyspaceHint' },
  { key: 'monitor', icon: 'activity', labelKey: 'tabMonitor', hintKey: 'tabMonitorHint' },
  { key: 'slowlog', icon: 'timer', labelKey: 'tabSlowlog', hintKey: 'tabSlowlogHint' },
  { key: 'live', icon: 'radio', labelKey: 'tabLive', hintKey: 'tabLiveHint' },
]

const identityParts = computed((): SqlIdeToolbarIdentityPart[] => {
  const name = sessionLabel()
  const p = profile.value
  const endpoint = p ? `${p.hostAddress}:${p.portNumber}` : ''
  const parts: SqlIdeToolbarIdentityPart[] = [
    { icon: 'redis', text: name, title: endpoint ? `${name} · ${endpoint}` : name },
  ]
  if (!redisDb.canSwitchDb.value) {
    parts.push({
      icon: 'database',
      text: t('modules.redis.session.currentDb', { db: redisDb.currentDb.value }),
      title: t('modules.redis.session.currentDbHint'),
    })
  }
  return parts
})

const toolbarItems = computed((): SqlIdeToolbarItem[] => {
  const items: SqlIdeToolbarItem[] = []
  if (redisDb.canSwitchDb.value) {
    items.push({
      key: 'db',
      kind: 'select',
      value: String(redisDb.currentDb.value),
      options: dbOptions.value,
      disabled: !sessionId.value || connecting.value || switchingDb.value,
      title: t('modules.redis.session.currentDbHint'),
    })
    items.push({ key: 'sep-panes', sep: true })
  }
  for (const pane of paneDefs) {
    items.push({
      key: pane.key,
      icon: pane.icon,
      label: t(`modules.redis.session.${pane.labelKey}`),
      title: t(`modules.redis.session.${pane.hintKey}`),
      active: activeTab.value === pane.key,
    })
  }
  items.push({
    key: 'reconnect',
    icon: 'refresh-cw',
    title: t('modules.redis.session.reconnect'),
    disabled: connecting.value,
    loading: connecting.value && Boolean(sessionId.value),
    align: 'trail',
  })
  return items
})

function isRedisSessionTab(key: string): key is RedisSessionTab {
  return paneDefs.some((pane) => pane.key === key)
}

function onToolbarAction(key: string): void {
  if (key === 'reconnect') {
    void reconnect()
    return
  }
  if (isRedisSessionTab(key)) {
    activeTab.value = key
  }
}

function onToolbarSelect(itemKey: string, value: string): void {
  if (itemKey === 'db') {
    const db = Number.parseInt(value, 10)
    if (Number.isFinite(db)) void switchDatabase(db)
  }
}

function sessionLabel(): string {
  const p = profile.value
  if (!p) {
    return 'Redis'
  }
  return p.profileName || p.hostAddress || 'Redis'
}

async function loadProfile(): Promise<void> {
  const result = await connectionApi.get({ profileId: props.profileId })
  profile.value = result.profile
  if (!result.profile) {
    return
  }
  const { database: profileDb, topology: topo } = readRedisDatabaseFromOptions(result.profile.connectionOptions)
  const db = props.database ?? profileDb
  scopeDatabase.value = db
  redisDb.reset(db, topo)
}

async function switchDatabase(db: number): Promise<void> {
  if (!redisDb.canSwitchDb.value || db === redisDb.currentDb.value || switchingDb.value) {
    return
  }
  switchingDb.value = true
  try {
    const ok = await redisDb.selectDatabase(db)
    if (!ok) {
      toast.error(t('modules.redis.session.selectDbError'))
    }
  } finally {
    switchingDb.value = false
  }
}

function isOwningActiveTab(): boolean {
  const tab = tabStore.activeTab
  if (!tab || tab.moduleId !== 'redis') {
    return false
  }
  if (props.tabId) {
    return tab.tabId === props.tabId
  }
  return tab.props.profileId === props.profileId
}

function publishTreeFocus(): void {
  if (!sessionId.value || !isOwningActiveTab() || !redisDb.canSwitchDb.value) {
    return
  }
  const key = resourceTreeKey(props.profileId, {
    segments: [{ kind: 'db', name: String(redisDb.currentDb.value) }],
  })
  connTreeSync.requestFocus(key)
}

async function openSession(): Promise<void> {
  connecting.value = true
  error.value = null
  try {
    await acquireSession()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.redis.session.connectError')
    toast.error(error.value)
  } finally {
    connecting.value = false
  }
}

async function reconnect(): Promise<void> {
  connecting.value = true
  error.value = null
  try {
    await reconnectSession()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.redis.session.connectError')
    toast.error(error.value)
  } finally {
    connecting.value = false
  }
}

onMounted(async () => {
  try {
    await loadProfile()
    await openSession()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.redis.loadError')
    connecting.value = false
  }
})

onActivated(() => {
  publishTreeFocus()
})

watch(
  () => redisDb.currentDb.value,
  () => {
    publishTreeFocus()
  },
)

watch(
  () => sessionActionStore.reconnectSignals[props.profileId],
  (val) => {
    if (val) {
      void reconnect()
    }
  },
)
</script>

<template>
  <div class="nm-redis-session">
    <SqlIdeToolbar
      :label="t('modules.redis.session.toolbarAria')"
      identity-icon="redis"
      :identity-parts="identityParts"
      :items="toolbarItems"
      @action="onToolbarAction"
      @select="onToolbarSelect"
    />

    <p v-if="error" class="nm-redis-session__error" role="alert">{{ error }}</p>

    <RsLoading
      v-if="connecting && !sessionId"
      class="nm-redis-session__loading"
      :label="t('modules.redis.session.connecting')"
      show-label
    />

    <div v-else class="nm-redis-session__body">
      <RedisConsolePane
        v-show="activeTab === 'console'"
        :session-id="sessionId"
        :tab-id="tabId"
        :host-address="profile?.hostAddress"
        :port-number="profile?.portNumber"
      />
      <RedisKeyspacePane v-show="activeTab === 'keyspace'" :session-id="sessionId" :active="activeTab === 'keyspace'" />
      <RedisMonitorPane v-show="activeTab === 'monitor'" :session-id="sessionId" :active="activeTab === 'monitor'" />
      <RedisSlowlogPane v-show="activeTab === 'slowlog'" :session-id="sessionId" :active="activeTab === 'slowlog'" />
      <RedisLiveMonitorPane v-show="activeTab === 'live'" :session-id="sessionId" :active="activeTab === 'live'" />
    </div>
  </div>
</template>

<style scoped>
.nm-redis-session {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-redis-session__error {
  margin: 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
  flex-shrink: 0;
}

.nm-redis-session__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-redis-session__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-redis-session__body > * {
  flex: 1;
  min-height: 0;
}
</style>
