<script setup lang="ts">
import { RsButton, RsIcon, RsLoading, useRsToast } from '@niuma/ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi } from '@/api'
import type { ConnectionProfile } from '@/api/types/connection'
import { useSessionLease } from '@/modules/connection/useSessionLease'
import MongoCollectionsPane from '@/modules/mongodb/components/MongoCollectionsPane.vue'
import MongoConsolePane from '@/modules/mongodb/components/MongoConsolePane.vue'
import MongoMonitorPane from '@/modules/mongodb/components/MongoMonitorPane.vue'
import MongoQueryPane from '@/modules/mongodb/components/MongoQueryPane.vue'
import MongoSchemaPane from '@/modules/mongodb/components/MongoSchemaPane.vue'
import MongoToolsPane from '@/modules/mongodb/components/MongoToolsPane.vue'
import MongoLivePane from '@/modules/mongodb/components/MongoLivePane.vue'

const props = defineProps<{
  profileId: string
  database?: string
  collection?: string
  tabId?: string
}>()

type MongoSessionTab = 'collections' | 'query' | 'schema' | 'console' | 'tools' | 'live' | 'monitor'

const { t } = useI18n()
const toast = useRsToast()

const profile = ref<ConnectionProfile | null>(null)
const connecting = ref(true)
const error = ref<string | null>(null)
const activeTab = ref<MongoSessionTab>(props.collection ? 'collections' : 'collections')

const { sessionId, acquireSession, reconnectSession } = useSessionLease({
  kind: 'mongodb',
  profileId: () => props.profileId,
  tabId: () => props.tabId,
})

const tabs = computed((): Array<{ value: MongoSessionTab; label: string; icon: string }> => [
  { value: 'collections', label: t('modules.mongodb.session.tabCollections'), icon: 'table' },
  { value: 'query', label: t('modules.mongodb.session.tabQuery'), icon: 'code' },
  { value: 'schema', label: t('modules.mongodb.session.tabSchema'), icon: 'list-tree' },
  { value: 'console', label: t('modules.mongodb.session.tabConsole'), icon: 'terminal' },
  { value: 'tools', label: t('modules.mongodb.session.tabTools'), icon: 'wrench' },
  { value: 'live', label: t('modules.mongodb.session.tabLive'), icon: 'radio' },
  { value: 'monitor', label: t('modules.mongodb.session.tabMonitor'), icon: 'activity' },
])

function sessionLabel(): string {
  const p = profile.value
  if (!p) {
    return 'MongoDB'
  }
  return p.profileName || p.hostAddress || 'MongoDB'
}

async function loadProfile(): Promise<void> {
  const result = await connectionApi.get({ profileId: props.profileId })
  profile.value = result.profile
}

async function openSession(): Promise<void> {
  connecting.value = true
  error.value = null
  try {
    await loadProfile()
    await acquireSession()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.mongodb.session.connectError')
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
    error.value = e instanceof Error ? e.message : t('modules.mongodb.session.connectError')
    toast.error(error.value)
  } finally {
    connecting.value = false
  }
}

onMounted(() => {
  void openSession()
})
</script>

<template>
  <div class="nm-mongo-session">
    <header class="nm-mongo-session__header">
      <div class="nm-mongo-session__title">
        <RsIcon name="database" :size="16" />
        <span class="nm-mongo-session__name">{{ sessionLabel() }}</span>
        <span v-if="profile" class="nm-mongo-session__addr">{{ profile.hostAddress }}:{{ profile.portNumber || 27017 }}</span>
        <span
          class="nm-mongo-session__status"
          :class="{
            'nm-mongo-session__status--ok': sessionId && !connecting,
            'nm-mongo-session__status--busy': connecting,
          }"
        >
          {{ connecting ? t('modules.mongodb.session.connecting') : t('modules.mongodb.session.connected') }}
        </span>
      </div>

      <nav class="nm-mongo-session__tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          role="tab"
          class="nm-mongo-session__tab"
          :class="{ 'nm-mongo-session__tab--active': activeTab === tab.value }"
          :aria-selected="activeTab === tab.value"
          @click="activeTab = tab.value"
        >
          <RsIcon :name="tab.icon" :size="14" class="nm-mongo-session__tab-icon" />
          <span class="nm-mongo-session__tab-label">{{ tab.label }}</span>
        </button>
      </nav>

      <div class="nm-mongo-session__actions">
        <RsButton size="sm" variant="ghost" :loading="connecting" @click="reconnect">
          {{ t('modules.mongodb.session.reconnect') }}
        </RsButton>
      </div>
    </header>

    <p v-if="error" class="nm-mongo-session__error" role="alert">{{ error }}</p>

    <RsLoading
      v-if="connecting && !sessionId"
      class="nm-mongo-session__loading"
      :label="t('modules.mongodb.session.connecting')"
      show-label
    />

    <div v-else class="nm-mongo-session__body">
      <MongoCollectionsPane
        v-show="activeTab === 'collections'"
        :session-id="sessionId"
        :profile-id="profileId"
        :initial-database="database"
        :initial-collection="collection"
        :active="activeTab === 'collections'"
      />
      <MongoQueryPane
        v-show="activeTab === 'query'"
        :session-id="sessionId"
        :initial-database="database"
        :initial-collection="collection"
        :active="activeTab === 'query'"
      />
      <MongoSchemaPane
        v-show="activeTab === 'schema'"
        :session-id="sessionId"
        :initial-database="database"
        :initial-collection="collection"
        :active="activeTab === 'schema'"
      />
      <MongoConsolePane
        v-show="activeTab === 'console'"
        :session-id="sessionId"
        :host-address="profile?.hostAddress"
        :port-number="profile?.portNumber"
      />
      <MongoToolsPane
        v-show="activeTab === 'tools'"
        :session-id="sessionId"
        :initial-database="database"
        :initial-collection="collection"
        :active="activeTab === 'tools'"
      />
      <MongoLivePane
        v-show="activeTab === 'live'"
        :session-id="sessionId"
        :initial-database="database"
        :initial-collection="collection"
        :active="activeTab === 'live'"
      />
      <MongoMonitorPane v-show="activeTab === 'monitor'" :session-id="sessionId" :active="activeTab === 'monitor'" />
    </div>
  </div>
</template>

<style scoped>
.nm-mongo-session {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-mongo-session__header {
  display: flex;
  align-items: center;
  gap: var(--rs-space-md);
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-mongo-session__title {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
}

.nm-mongo-session__name {
  font-weight: 600;
  font-size: var(--rs-font-size-sm);
}

.nm-mongo-session__addr {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-family: var(--rs-font-mono);
}

.nm-mongo-session__status {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-mongo-session__status--ok {
  color: var(--rs-success);
}

.nm-mongo-session__status--busy {
  color: var(--rs-warning);
}

.nm-mongo-session__tabs {
  display: flex;
  gap: 2px;
  flex: 1;
  justify-content: center;
  flex-wrap: wrap;
}

.nm-mongo-session__tab {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs);
  padding: var(--rs-space-xs) var(--rs-space-sm);
  border: none;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
  cursor: pointer;
}

.nm-mongo-session__tab--active {
  background: var(--rs-accent-subtle);
  color: var(--rs-accent);
}

.nm-mongo-session__actions {
  flex-shrink: 0;
}

.nm-mongo-session__error {
  margin: 0;
  padding: var(--rs-space-sm) var(--rs-space-md);
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-mongo-session__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-mongo-session__body {
  flex: 1;
  min-height: 0;
}
</style>
