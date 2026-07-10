<script setup lang="ts">
import { RsButton, RsIcon, RsLoading, RsSelect, useRsToast } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
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

const dbOptions = computed((): RsSelectOptions =>
  Array.from({ length: 16 }, (_, i) => ({ value: String(i), label: `DB ${i}` })),
)

const currentDbModel = computed({
  get: () => String(redisDb.currentDb.value),
  set: (val: string) => {
    void switchDatabase(Number.parseInt(val, 10))
  },
})

const tabs = computed((): Array<{ value: RedisSessionTab; label: string; icon: string }> => [
  { value: 'console', label: t('modules.redis.session.tabConsole'), icon: 'terminal' },
  { value: 'keyspace', label: t('modules.redis.session.tabKeyspace'), icon: 'key-round' },
  { value: 'monitor', label: t('modules.redis.session.tabMonitor'), icon: 'activity' },
  { value: 'slowlog', label: t('modules.redis.session.tabSlowlog'), icon: 'hourglass' },
  { value: 'live', label: t('modules.redis.session.tabLive'), icon: 'radio' },
])

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
    <header class="nm-redis-session__header">
      <div class="nm-redis-session__title">
        <RsIcon name="redis" :size="16" />
        <span class="nm-redis-session__name">{{ sessionLabel() }}</span>
        <span v-if="profile" class="nm-redis-session__addr">{{ profile.hostAddress }}:{{ profile.portNumber }}</span>
        <RsSelect
          v-if="redisDb.canSwitchDb.value"
          v-model="currentDbModel"
          class="nm-redis-session__db-select"
          size="sm"
          :options="dbOptions"
          :disabled="!sessionId || connecting || switchingDb"
          :title="t('modules.redis.session.currentDbHint')"
        />
        <span
          v-else
          class="nm-redis-session__db"
          :title="t('modules.redis.session.currentDbHint')"
        >
          {{ t('modules.redis.session.currentDb', { db: redisDb.currentDb.value }) }}
        </span>
        <span
          class="nm-redis-session__status"
          :class="{
            'nm-redis-session__status--ok': sessionId && !connecting,
            'nm-redis-session__status--busy': connecting,
          }"
        >
          {{ connecting ? t('modules.redis.session.connecting') : t('modules.redis.session.connected') }}
        </span>
      </div>

      <nav class="nm-redis-session__tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          role="tab"
          class="nm-redis-session__tab"
          :class="{ 'nm-redis-session__tab--active': activeTab === tab.value }"
          :aria-selected="activeTab === tab.value"
          @click="activeTab = tab.value"
        >
          <RsIcon :name="tab.icon" :size="14" class="nm-redis-session__tab-icon" />
          <span class="nm-redis-session__tab-label">{{ tab.label }}</span>
        </button>
      </nav>

      <div class="nm-redis-session__actions">
        <RsButton size="sm" variant="ghost" :loading="connecting" @click="reconnect">
          {{ t('modules.redis.session.reconnect') }}
        </RsButton>
      </div>
    </header>

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

.nm-redis-session__header {
  display: flex;
  align-items: center;
  gap: var(--rs-space-md);
  flex-shrink: 0;
  flex-wrap: wrap;
  padding-block: var(--rs-space-xs);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-redis-session__title {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  font-weight: 600;
  min-width: 0;
}

.nm-redis-session__name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nm-redis-session__addr {
  font-weight: 400;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
  white-space: nowrap;
}

.nm-redis-session__db {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  padding: 0.05rem 0.45rem;
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
  color: var(--rs-primary);
  white-space: nowrap;
}

.nm-redis-session__db-select {
  width: 5.5rem;
  flex-shrink: 0;
}

.nm-redis-session__db-select :deep(.rs-field) {
  margin: 0;
}

.nm-redis-session__status {
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  background: var(--rs-surface-subtle);
  color: var(--rs-muted);
  white-space: nowrap;
}

.nm-redis-session__status--ok {
  background: color-mix(in srgb, var(--rs-success) 16%, transparent);
  color: var(--rs-success);
}

.nm-redis-session__status--busy {
  background: color-mix(in srgb, var(--rs-warning) 16%, transparent);
  color: var(--rs-warning);
}

.nm-redis-session__tabs {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  margin-left: auto;
  flex-wrap: wrap;
}

.nm-redis-session__tab {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  margin: 0;
  height: 1.875rem;
  padding: 0 0.65rem;
  border: 1px solid transparent;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  box-sizing: border-box;
  font-family: inherit;
  font-size: var(--rs-font-size-sm);
  font-weight: 400;
  line-height: 1;
  color: var(--rs-muted);
  cursor: pointer;
  white-space: nowrap;
}

.nm-redis-session__tab-icon {
  flex-shrink: 0;
}

.nm-redis-session__tab :deep(.rs-icon) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.875rem;
  height: 0.875rem;
  line-height: 0;
}

.nm-redis-session__tab :deep(.rs-icon svg) {
  display: block;
}

.nm-redis-session__tab-label {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

.nm-redis-session__tab:hover {
  color: var(--rs-text);
  background: var(--rs-surface-subtle);
}

.nm-redis-session__tab--active {
  color: var(--rs-text);
  background: var(--rs-surface-elevated);
  border-color: var(--rs-border-subtle);
}

.nm-redis-session__actions {
  flex-shrink: 0;
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
