<script setup lang="ts">
import { RsEmpty, RsIcon, RsLoading, useRsToast } from '@niuma/ui'
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
  normalizeOracleFeature,
  oracleFeatureEmbedsChrome,
  oraclePaneRegistry,
  type OracleSessionTab,
} from '@/modules/oracle/pane-registry'
import type { OracleObjectKind, OracleObjectScriptMode } from '@/modules/oracle/types/object-script'
import { useSessionActionStore } from '@/stores/session-actions'

const props = defineProps<{
  profileId: string
  schema?: string
  table?: string
  isView?: boolean
  objectKind?: OracleObjectKind
  objectName?: string
  routine?: string
  routineKind?: OracleObjectKind
  designMode?: OracleObjectScriptMode
  draftSql?: string
  initialTab?: OracleSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const sessionActions = useSessionActionStore()

/** 与 MysqlSession 一致：feature 在 Tab 生命周期内固定，禁止 :key 导致子面板重挂载 */
const feature = normalizeOracleFeature(props.initialTab)
const featureDef = oraclePaneRegistry[feature]
const embedsChrome = oracleFeatureEmbedsChrome(feature)

const profile = ref<ConnectionProfile | null>(null)
const connecting = ref(true)
const error = ref<string | null>(null)

const profileSchema = computed(() => {
  const raw = profile.value?.connectionOptions?.schema
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
})

const effectiveSchema = computed(() => props.schema?.trim() || profileSchema.value)

const { sessionId, acquireSession, reconnectSession } = useSessionLease({
  kind: 'oracle',
  profileId: () => props.profileId,
  tabId: () => props.tabId,
})

const sessionLabel = computed(() => {
  const p = profile.value
  return p?.profileName || p?.hostAddress || 'Oracle'
})

const pane = featureDef.resolvePane()
const PaneView = defineAsyncComponent(pane.loader as () => Promise<{ default: Component }>)

/** keep-alive 可见性：切 Shell Tab 时交接 Monaco layout（对齐 MysqlSession） */
const paneActive = ref(true)
onActivated(() => {
  paneActive.value = true
})
onDeactivated(() => {
  paneActive.value = false
})

const paneProps = computed(() => ({
  ...pane.buildProps({
    sessionId: sessionId.value,
    profileId: props.profileId,
    schema: effectiveSchema.value,
    table: props.table,
    isView: props.isView,
    initialSql: props.initialSql,
    autoRunInitialSql: props.autoRunInitialSql,
    objectKind: props.objectKind,
    objectName: props.objectName,
    routine: props.routine,
    routineKind: props.routineKind,
    designMode: props.designMode,
    draftSql: props.draftSql,
    tabId: props.tabId,
    sessionLabel: sessionLabel.value,
  }),
  active: paneActive.value,
}))

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
    toast.info(t('modules.oracle.session.reconnected'))
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

/** Oracle 查询/设计断线会 requestReconnect；MySQL Session 暂无此路径，保留监听但不改变挂载结构 */
watch(
  () => sessionActions.reconnectSignals[props.profileId],
  (val) => {
    if (val) void onReconnect()
  },
)

onMounted(() => {
  void connectSession()
})
</script>

<template>
  <div class="nm-oracle-session">
    <RsLoading v-if="connecting" class="nm-oracle-session__loading" />

    <div v-else-if="error" class="nm-oracle-session__error">
      <RsEmpty icon="circle-alert" :description="error" />
      <button type="button" class="nm-oracle-session__retry" @click="onReconnect">
        {{ t('modules.oracle.session.reconnect') }}
      </button>
    </div>

    <template v-else>
      <header v-if="!embedsChrome" class="nm-oracle-session__header">
        <div class="nm-oracle-session__title">
          <RsIcon name="database" :size="16" />
          <span>{{ sessionLabel }}</span>
          <span v-if="effectiveSchema" class="nm-oracle-session__scope">{{ effectiveSchema }}</span>
        </div>
      </header>
      <div class="nm-oracle-session__body">
        <PaneView v-bind="paneProps" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.nm-oracle-session {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-oracle-session__loading,
.nm-oracle-session__error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rs-space-md);
}

.nm-oracle-session__retry {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  padding: 0.35rem 0.75rem;
  background: var(--rs-bg-elevated, var(--rs-bg));
  cursor: pointer;
}

.nm-oracle-session__header {
  display: flex;
  align-items: center;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-oracle-session__title {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-oracle-session__scope {
  color: var(--rs-fg-muted);
  font-weight: 400;
}

.nm-oracle-session__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
