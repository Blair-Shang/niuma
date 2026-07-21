<script setup lang="ts">
import { RsEmpty, RsIcon, RsLoading, useRsToast } from '@niuma/ui'
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi } from '@/api'
import type { ConnectionProfile } from '@/api/types/connection'
import { useSessionLease } from '@/modules/connection/useSessionLease'
import {
  mysqlFeatureEmbedsChrome,
  mysqlPaneRegistry,
  normalizeMysqlFeature,
  type MysqlSessionTab,
} from '@/modules/mysql/pane-registry'

const props = defineProps<{
  profileId: string
  database?: string
  table?: string
  routine?: string
  routineKind?: 'procedure' | 'function'
  initialTab?: MysqlSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  /** design 面板模式：create=新建表；alter=修改表（默认） */
  designMode?: 'create' | 'alter'
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()

const feature = normalizeMysqlFeature(props.initialTab)
const featureDef = mysqlPaneRegistry[feature]
const embedsChrome = mysqlFeatureEmbedsChrome(feature)

const profile = ref<ConnectionProfile | null>(null)
const connecting = ref(true)
const error = ref<string | null>(null)

const { sessionId, acquireSession, reconnectSession } = useSessionLease({
  kind: 'mysql',
  profileId: () => props.profileId,
  tabId: () => props.tabId,
})

const profileDatabase = computed(() => {
  const raw = profile.value?.connectionOptions?.database
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
})

const effectiveDatabase = computed(() => props.database || profileDatabase.value)

const sessionLabel = computed(() => {
  const p = profile.value
  return p?.profileName || p?.hostAddress || 'MySQL'
})

const pane = featureDef.resolvePane({
  database: effectiveDatabase.value,
  table: props.table,
  routine: props.routine,
  routineKind: props.routineKind,
  designMode: props.designMode,
})
const PaneView = defineAsyncComponent(pane.loader)

const paneProps = computed(() =>
  pane.buildProps({
    sessionId: sessionId.value,
    profileId: props.profileId,
    database: effectiveDatabase.value,
    table: props.table,
    routine: props.routine,
    routineKind: props.routineKind,
    initialSql: props.initialSql,
    autoRunInitialSql: props.autoRunInitialSql,
    sessionLabel: sessionLabel.value,
    designMode: props.designMode,
  }),
)

async function loadProfile(): Promise<void> {
  const result = await connectionApi.get({ profileId: props.profileId })
  profile.value = result.profile
}

async function connectSession(): Promise<void> {
  connecting.value = true
  error.value = null
  try {
    await loadProfile()
    await acquireSession()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    toast.error(error.value)
  } finally {
    connecting.value = false
  }
}

async function onReconnect(): Promise<void> {
  connecting.value = true
  error.value = null
  try {
    await reconnectSession()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    connecting.value = false
  }
}

watch(
  () => props.profileId,
  () => {
    void connectSession()
  },
)

onMounted(() => {
  void connectSession()
})
</script>

<template>
  <div class="nm-mysql-session">
    <RsLoading v-if="connecting" class="nm-mysql-session__loading" />

    <div v-else-if="error" class="nm-mysql-session__error">
      <RsEmpty icon="circle-alert" :description="error" />
      <button type="button" class="nm-mysql-session__retry" @click="onReconnect">
        {{ t('modules.mysql.session.reconnect') }}
      </button>
    </div>

    <template v-else>
      <header v-if="!embedsChrome" class="nm-mysql-session__header">
        <div class="nm-mysql-session__title">
          <RsIcon name="mysql" :size="16" />
          <span>{{ sessionLabel }}</span>
          <span v-if="effectiveDatabase" class="nm-mysql-session__scope">{{ effectiveDatabase }}</span>
        </div>
      </header>
      <div class="nm-mysql-session__body">
        <PaneView v-bind="paneProps" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.nm-mysql-session {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-mysql-session__loading,
.nm-mysql-session__error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rs-space-md);
}

.nm-mysql-session__retry {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  padding: 0.35rem 0.75rem;
  background: var(--rs-bg-elevated, var(--rs-bg));
  cursor: pointer;
}

.nm-mysql-session__header {
  display: flex;
  align-items: center;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-mysql-session__title {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-mysql-session__scope {
  color: var(--rs-fg-muted);
  font-weight: 400;
}

.nm-mysql-session__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
