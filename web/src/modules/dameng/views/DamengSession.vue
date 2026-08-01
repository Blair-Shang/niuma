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
} from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi } from '@/api'
import type { ConnectionProfile } from '@/api/types/connection'
import { useSessionLease } from '@/modules/connection/useSessionLease'
import {
  damengFeatureEmbedsChrome,
  damengPaneRegistry,
  normalizeDamengFeature,
  type DamengSessionTab,
} from '@/modules/dameng/pane-registry'
import type { DamengObjectKind } from '@/modules/dameng/types/object-script'

const props = defineProps<{
  profileId: string
  schema?: string
  table?: string
  isView?: boolean
  initialTab?: DamengSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  /** design / objectScript：create=新建；alter=编辑 */
  designMode?: 'create' | 'alter'
  objectKind?: DamengObjectKind
  objectName?: string
  routine?: string
  routineKind?: DamengObjectKind
  draftSql?: string
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()

const feature = normalizeDamengFeature(props.initialTab)
const featureDef = damengPaneRegistry[feature]
const embedsChrome = damengFeatureEmbedsChrome(feature)

const profile = ref<ConnectionProfile | null>(null)
const connecting = ref(true)
const error = ref<string | null>(null)

const { sessionId, acquireSession, reconnectSession } = useSessionLease({
  kind: 'dameng',
  profileId: () => props.profileId,
  tabId: () => props.tabId,
})

const sessionLabel = computed(() => {
  const p = profile.value
  // 优先用文件路径（hostAddress），其次用 profileName
  const raw = p?.hostAddress || p?.profileName || 'Dameng'
  // 只取文件名部分，避免路径过长
  return raw.split(/[/\\]/).pop() || raw
})

const pane = featureDef.resolvePane({
  schema: props.schema,
  table: props.table,
  isView: props.isView,
  designMode: props.designMode,
  objectKind: props.objectKind,
  objectName: props.objectName,
  routine: props.routine,
  routineKind: props.routineKind,
  draftSql: props.draftSql,
})
const PaneView = defineAsyncComponent(pane.loader)

const paneActive = ref(true)
onActivated(() => { paneActive.value = true })
onDeactivated(() => { paneActive.value = false })

const paneProps = computed(() => ({
  ...pane.buildProps({
    sessionId: sessionId.value,
    profileId: props.profileId,
    schema: props.schema,
    table: props.table,
    isView: props.isView,
    initialSql: props.initialSql,
    tabId: props.tabId,
    autoRunInitialSql: props.autoRunInitialSql,
    sessionLabel: sessionLabel.value,
    designMode: props.designMode,
    objectKind: props.objectKind,
    objectName: props.objectName,
    routine: props.routine,
    routineKind: props.routineKind,
    draftSql: props.draftSql,
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
  <div class="nm-dameng-session">
    <RsLoading v-if="connecting" class="nm-dameng-session__loading" />

    <div v-else-if="error" class="nm-dameng-session__error">
      <RsEmpty icon="circle-alert" :description="error" />
      <button type="button" class="nm-dameng-session__retry" @click="onReconnect">
        {{ t('modules.dameng.session.reconnect') }}
      </button>
    </div>

    <template v-else>
      <header v-if="!embedsChrome" class="nm-dameng-session__header">
        <div class="nm-dameng-session__title">
          <RsIcon name="dameng" :size="16" />
          <span>{{ sessionLabel }}</span>
          <span v-if="schema" class="nm-dameng-session__scope">{{ schema }}</span>
        </div>
      </header>
      <div class="nm-dameng-session__body">
        <PaneView v-bind="paneProps" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.nm-dameng-session {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-dameng-session__loading,
.nm-dameng-session__error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rs-space-md);
}

.nm-dameng-session__retry {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  padding: 0.35rem 0.75rem;
  background: var(--rs-bg-elevated, var(--rs-bg));
  cursor: pointer;
}

.nm-dameng-session__header {
  display: flex;
  align-items: center;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-dameng-session__title {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-dameng-session__scope {
  color: var(--rs-fg-muted);
  font-weight: 400;
}

.nm-dameng-session__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
