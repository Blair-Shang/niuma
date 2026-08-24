<script setup lang="ts">
import { RsEmpty, RsLoading, useRsToast } from '@niuma/ui'
import {
  computed,
  defineAsyncComponent,
  onActivated,
  onDeactivated,
  onMounted,
  ref,
  watch,
  type Component,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi } from '@/api'
import type { ConnectionProfile } from '@/api/types/connection'
import { useSessionLease } from '@/modules/connection/useSessionLease'
import {
  normalizeSqlServerFeature,
  sqlserverFeatureEmbedsChrome,
  sqlserverPaneRegistry,
  type SqlServerSessionTab,
} from '@/modules/sqlserver/pane-registry'
import type { SqlServerObjectKind, SqlServerObjectScriptMode } from '@/modules/sqlserver/types/object-script'

const props = defineProps<{
  profileId: string
  database?: string
  schema?: string
  table?: string
  isView?: boolean
  objectKind?: SqlServerObjectKind
  objectName?: string
  routine?: string
  routineKind?: 'procedure' | 'function'
  sequence?: string
  synonym?: string
  designMode?: SqlServerObjectScriptMode
  draftSql?: string
  initialTab?: SqlServerSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const profile = ref<ConnectionProfile | null>(null)
const connecting = ref(true)
const error = ref<string | null>(null)

function resolveConnectDatabase(): string | undefined {
  const fromTab = props.database?.trim()
  if (fromTab) return fromTab
  const raw = profile.value?.connectionOptions?.database
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

const { sessionId, acquireSession, reconnectSession } = useSessionLease({
  kind: 'sqlserver',
  profileId: () => props.profileId,
  tabId: () => props.tabId,
  connectDatabase: resolveConnectDatabase,
})

const sessionLabel = computed(() => profile.value?.hostAddress || profile.value?.profileName || 'SQL Server')
const feature = normalizeSqlServerFeature(props.initialTab)
const embedsChrome = sqlserverFeatureEmbedsChrome(feature)
const pane = sqlserverPaneRegistry[feature].resolvePane({
  database: props.database,
  schema: props.schema,
  table: props.table,
  isView: props.isView,
  objectKind: props.objectKind,
  objectName: props.objectName,
  routine: props.routine,
  routineKind: props.routineKind,
  sequence: props.sequence,
  synonym: props.synonym,
  designMode: props.designMode,
  draftSql: props.draftSql,
})
const PaneView = defineAsyncComponent(pane.loader as () => Promise<{ default: Component }>)
const active = ref(true)
onActivated(() => { active.value = true })
onDeactivated(() => { active.value = false })

const paneProps = computed(() => ({
  ...pane.buildProps({
    sessionId: sessionId.value,
    profileId: props.profileId,
    database: props.database,
    schema: props.schema,
    table: props.table,
    isView: props.isView,
    objectKind: props.objectKind,
    objectName: props.objectName,
    routine: props.routine,
    routineKind: props.routineKind,
    sequence: props.sequence,
    synonym: props.synonym,
    designMode: props.designMode,
    draftSql: props.draftSql,
    initialSql: props.initialSql,
    autoRunInitialSql: props.autoRunInitialSql,
    sessionLabel: sessionLabel.value,
    tabId: props.tabId,
  }),
  active: active.value,
}))

async function connectSession(): Promise<void> {
  connecting.value = true
  error.value = null
  try {
    profile.value = (await connectionApi.get({ profileId: props.profileId })).profile
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

watch(() => props.profileId, () => { void connectSession() })
onMounted(() => { void connectSession() })
</script>

<template>
  <div class="nm-sqlserver-session">
    <RsLoading v-if="connecting" class="nm-sqlserver-session__state" />
    <div v-else-if="error" class="nm-sqlserver-session__state">
      <RsEmpty icon="circle-alert" :description="error" />
      <button type="button" @click="onReconnect">{{ t('modules.sqlserver.session.reconnect') }}</button>
    </div>
    <div v-else class="nm-sqlserver-session__body" :class="{ 'nm-sqlserver-session__body--embed': embedsChrome }">
      <PaneView v-bind="paneProps" />
    </div>
  </div>
</template>

<style scoped>
.nm-sqlserver-session,
.nm-sqlserver-session__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.nm-sqlserver-session__state {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
}
</style>
