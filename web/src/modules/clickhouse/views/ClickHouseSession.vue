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
  clickhouseFeatureEmbedsChrome,
  clickhousePaneRegistry,
  normalizeClickHouseFeature,
  type ClickHouseSessionTab,
} from '@/modules/clickhouse/pane-registry'
import type {
  ClickHouseObjectKind,
  ClickHouseObjectScriptMode,
} from '@/modules/clickhouse/types/object-script'

const props = defineProps<{
  profileId: string
  database?: string
  table?: string
  isView?: boolean
  designMode?: ClickHouseObjectScriptMode
  objectKind?: ClickHouseObjectKind
  objectName?: string
  draftSql?: string
  initialTab?: ClickHouseSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const profile = ref<ConnectionProfile | null>(null)
const connecting = ref(true)
const error = ref<string | null>(null)

const { sessionId, acquireSession, reconnectSession } = useSessionLease({
  kind: 'clickhouse',
  profileId: () => props.profileId,
  tabId: () => props.tabId,
})

const sessionLabel = computed(() => profile.value?.hostAddress || profile.value?.profileName || 'ClickHouse')
const feature = normalizeClickHouseFeature(props.initialTab)
const embedsChrome = clickhouseFeatureEmbedsChrome(feature)
const pane = clickhousePaneRegistry[feature].resolvePane({
  database: props.database,
  table: props.table,
  isView: props.isView,
  designMode: props.designMode,
  objectKind: props.objectKind,
  objectName: props.objectName,
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
    table: props.table,
    isView: props.isView,
    designMode: props.designMode,
    objectKind: props.objectKind,
    objectName: props.objectName,
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
  <div class="nm-clickhouse-session">
    <RsLoading v-if="connecting" class="nm-clickhouse-session__state" />
    <div v-else-if="error" class="nm-clickhouse-session__state">
      <RsEmpty icon="circle-alert" :description="error" />
      <button type="button" @click="onReconnect">{{ t('modules.clickhouse.session.reconnect') }}</button>
    </div>
    <div v-else class="nm-clickhouse-session__body" :class="{ 'nm-clickhouse-session__body--embed': embedsChrome }">
      <PaneView v-bind="paneProps" />
    </div>
  </div>
</template>

<style scoped>
.nm-clickhouse-session,
.nm-clickhouse-session__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.nm-clickhouse-session__state {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
}
</style>
