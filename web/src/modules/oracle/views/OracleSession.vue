<script setup lang="ts">
import { RsEmpty, RsLoading, useRsToast } from '@niuma/ui'
import { computed, defineAsyncComponent, onActivated, onDeactivated, onMounted, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi } from '@/api'
import type { ConnectionProfile } from '@/api/types/connection'
import { useSessionLease } from '@/modules/connection/useSessionLease'
import { normalizeOracleFeature, oraclePaneRegistry, type OracleSessionTab } from '@/modules/oracle/pane-registry'
import type { OracleObjectKind, OracleObjectScriptMode } from '@/modules/oracle/types/object-script'

const props = defineProps<{
  profileId: string
  schema?: string
  table?: string
  isView?: boolean
  objectKind?: OracleObjectKind
  objectName?: string
  designMode?: OracleObjectScriptMode
  draftSql?: string
  initialTab?: OracleSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  tabId?: string
}>()
const { t } = useI18n()
const toast = useRsToast()
const profile = ref<ConnectionProfile | null>(null)
const connecting = ref(true)
const error = ref<string | null>(null)
const { sessionId, acquireSession, reconnectSession } = useSessionLease({ kind: 'oracle', profileId: () => props.profileId, tabId: () => props.tabId })
const sessionLabel = computed(() => profile.value?.hostAddress || profile.value?.profileName || 'Oracle')
const feature = normalizeOracleFeature(props.initialTab)
const pane = oraclePaneRegistry[feature].resolvePane()
const PaneView = defineAsyncComponent(pane.loader as () => Promise<{ default: Component }>)
const active = ref(true)
onActivated(() => { active.value = true })
onDeactivated(() => { active.value = false })
const paneProps = computed(() => ({
  ...pane.buildProps({
    sessionId: sessionId.value, profileId: props.profileId, schema: props.schema, table: props.table,
    isView: props.isView, initialSql: props.initialSql, autoRunInitialSql: props.autoRunInitialSql,
    objectKind: props.objectKind, objectName: props.objectName, designMode: props.designMode,
    draftSql: props.draftSql, tabId: props.tabId,
    sessionLabel: sessionLabel.value,
  }),
  active: active.value,
}))
async function connectSession(): Promise<void> {
  connecting.value = true; error.value = null
  try { profile.value = (await connectionApi.get({ profileId: props.profileId })).profile; await acquireSession() }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); toast.error(error.value) }
  finally { connecting.value = false }
}
async function onReconnect(): Promise<void> {
  connecting.value = true; error.value = null
  try { await reconnectSession() } catch (e) { error.value = e instanceof Error ? e.message : String(e) } finally { connecting.value = false }
}
watch(() => props.profileId, () => { void connectSession() })
onMounted(() => { void connectSession() })
</script>

<template>
  <div class="nm-oracle-session">
    <RsLoading v-if="connecting" class="nm-oracle-session__state" />
    <div v-else-if="error" class="nm-oracle-session__state"><RsEmpty icon="circle-alert" :description="error" /><button type="button" @click="onReconnect">{{ t('modules.oracle.session.reconnect') }}</button></div>
    <div v-else class="nm-oracle-session__body"><PaneView v-bind="paneProps" /></div>
  </div>
</template>

<style scoped>
.nm-oracle-session, .nm-oracle-session__body { display: flex; flex: 1; flex-direction: column; min-height: 0; height: 100%; }
.nm-oracle-session__state { display: flex; flex: 1; align-items: center; justify-content: center; }
</style>
