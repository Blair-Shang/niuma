<script setup lang="ts">
import { RsEmpty, RsIcon, RsLoading, useRsToast } from '@niuma/ui'
import {
  computed,
  defineAsyncComponent,
  onActivated,
  onDeactivated,
  onMounted,
  provide,
  ref,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi } from '@/api'
import type { ConnectionProfile } from '@/api/types/connection'
import { useSessionLease } from '@/modules/connection/useSessionLease'
import {
  normalizeVastFeature,
  vastPaneRegistry,
  type VastSessionTab,
} from '@/modules/vastbase/pane-registry'
import { VAST_SESSION_HEADER_ACTIONS_KEY } from '@/modules/vastbase/session-chrome'

const props = defineProps<{
  profileId: string
  database?: string
  schema?: string
  table?: string
  routine?: string
  routineKind?: 'function' | 'procedure'
  args?: string
  oid?: number
  initialTab?: VastSessionTab
  initialSql?: string
  draftSql?: string
  autoRunInitialSql?: boolean
  designMode?: 'create' | 'alter'
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()

const feature = normalizeVastFeature(props.initialTab)
const featureDef = vastPaneRegistry[feature]

/** 自带顶栏的面板，避免与 Session header 叠成两行 */
const embedsChrome =
  feature === 'query' ||
  feature === 'call' ||
  feature === 'browse' ||
  feature === 'debug' ||
  feature === 'monitor' ||
  feature === 'overview' ||
  feature === 'tools'

/** 子面板（如 DDL）经 Teleport 挂工具按钮到顶栏右侧 */
const headerActionsEl = ref<HTMLElement | null>(null)
provide(VAST_SESSION_HEADER_ACTIONS_KEY, headerActionsEl)

const profile = ref<ConnectionProfile | null>(null)
const connecting = ref(true)
const error = ref<string | null>(null)

const { sessionId, acquireSession, reconnectSession } = useSessionLease({
  kind: 'vastbase',
  profileId: () => props.profileId,
  tabId: () => props.tabId,
})

const scopeLabel = computed(() => {
  if (feature === 'query') {
    return effectiveDatabase.value || t('modules.vastbase.session.connectionRoot')
  }
  if (feature === 'design' && props.designMode === 'create') {
    const parts = [effectiveDatabase.value, props.schema].filter(Boolean)
    return parts.length
      ? `${parts.join('.')} · ${t('modules.vastbase.session.tabDesignCreate')}`
      : t('modules.vastbase.session.tabDesignCreate')
  }
  const leaf =
    props.routine && props.args
      ? `${props.routine}(${props.args})`
      : (props.table ?? props.routine)
  const parts = [effectiveDatabase.value, props.schema, leaf].filter(Boolean)
  return parts.length ? parts.join('.') : t('modules.vastbase.session.connectionRoot')
})

const sessionLabel = computed(() => {
  const p = profile.value
  return p?.profileName || p?.hostAddress || 'Vastbase'
})

/** 顶栏悬浮完整身份（连接名 + 库.schema.对象），截断后仍可看全名 */
const identityTitle = computed(() => {
  const parts = [sessionLabel.value, scopeLabel.value].filter(Boolean)
  return parts.join(' · ')
})

/** Tab 未带库名时回退连接配置中的默认库，避免工具栏空白/只显示截断字符 */
const profileDatabase = computed(() => {
  const raw = profile.value?.connectionOptions?.database
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
})

const effectiveDatabase = computed(() => props.database || profileDatabase.value)

const pane = featureDef.resolvePane({
  database: effectiveDatabase.value,
  schema: props.schema,
  table: props.table,
  routine: props.routine,
  routineKind: props.routineKind,
  args: props.args,
  oid: props.oid,
  designMode: props.designMode,
})

const PaneView = defineAsyncComponent(pane.loader)

/** keep-alive 可见性：失活时关掉 Monaco automaticLayout，避免切 Shell Tab 卡主线程 */
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
    database: effectiveDatabase.value,
    schema: props.schema,
    table: props.table,
    routine: props.routine,
    routineKind: props.routineKind,
    args: props.args,
    oid: props.oid,
    designMode: props.designMode,
    initialSql: props.initialSql,
    draftSql: props.draftSql,
    tabId: props.tabId,
    autoRunInitialSql: props.autoRunInitialSql,
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
  <div class="nm-vast-session">
    <RsLoading v-if="connecting" class="nm-vast-session__loading" />

    <div v-else-if="error" class="nm-vast-session__error">
      <RsEmpty icon="circle-alert" :description="error" />
      <button type="button" class="nm-vast-session__retry" @click="onReconnect">
        {{ t('modules.vastbase.session.reconnect') }}
      </button>
    </div>

    <template v-else>
      <header v-if="!embedsChrome" class="nm-vast-session__header">
        <div class="nm-vast-session__title" :title="identityTitle">
          <RsIcon name="vastbase" :size="16" class="nm-vast-session__brand" />
          <span class="nm-vast-session__session">{{ sessionLabel }}</span>
          <span class="nm-vast-session__scope">{{ scopeLabel }}</span>
          <span class="nm-vast-session__feature">
            <RsIcon :name="featureDef.icon" :size="14" />
            {{ t(featureDef.labelKey) }}
          </span>
        </div>
        <div ref="headerActionsEl" class="nm-vast-session__actions" />
      </header>

      <div class="nm-vast-session__body">
        <PaneView v-bind="paneProps" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.nm-vast-session {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-vast-session__loading,
.nm-vast-session__error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rs-space-md);
}

.nm-vast-session__retry {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  padding: 0.35rem 0.75rem;
  background: var(--rs-bg-elevated, var(--rs-bg));
  cursor: pointer;
}

.nm-vast-session__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
  padding: 0 var(--rs-space-sm);
  height: 32px;
  overflow: hidden;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-subtle);
}

.nm-vast-session__title {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-vast-session__brand {
  flex-shrink: 0;
}

/* 连接名：禁止 CJK 按字换行；偏短时优先保完整，再挤时省略 */
.nm-vast-session__session {
  flex-shrink: 0;
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 库.schema.长对象名：占剩余空间，超出省略 */
.nm-vast-session__scope {
  color: var(--rs-muted);
  font-weight: 400;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-vast-session__feature {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: var(--rs-space-xs);
  padding: 0.1rem 0.45rem;
  border-radius: var(--rs-radius-sm);
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.12));
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  flex-shrink: 0;
  white-space: nowrap;
}

.nm-vast-session__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
  margin-left: auto;
}

.nm-vast-session__body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
}

.nm-vast-session__body > * {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  width: 100%;
  height: 100%;
}
</style>
