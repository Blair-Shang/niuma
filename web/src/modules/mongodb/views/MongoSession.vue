<script setup lang="ts">
import { RsIcon, RsLoading, useRsToast } from '@niuma/ui'
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi } from '@/api'
import type { ConnectionProfile } from '@/api/types/connection'
import { useSessionLease } from '@/modules/connection/useSessionLease'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnItem } from '@/modules/ops/types'
import { mongoPaneRegistry } from '@/modules/mongodb/pane-registry'
import type { MongoSessionTab } from '@/modules/mongodb/pane-registry'
import { useSessionActionStore } from '@/stores/session-actions'

const props = defineProps<{
  profileId: string
  database?: string
  collection?: string
  /**
   * 当前页面显示的功能，由连接树右键菜单等外部触发时传入。
   * 每个功能对应独立的工作区 Tab，不在此组件内切换。
   */
  initialTab?: MongoSessionTab
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const sessionActionStore = useSessionActionStore()

/** 当前展示的功能，全生命周期固定（切换请开新 Tab） */
const feature: MongoSessionTab = props.initialTab ?? 'collections'

const profile = ref<ConnectionProfile | null>(null)
const connecting = ref(true)
const error = ref<string | null>(null)

const { sessionId, acquireSession, reconnectSession } = useSessionLease({
  kind: 'mongodb',
  profileId: () => props.profileId,
  tabId: () => props.tabId,
})

const { connect } = useConnectionNavigation()

/** 从已加载 profile 重建 ConnItem，用于导航到新 Tab */
const connItem = computed((): ConnItem | null => {
  if (!profile.value) return null
  return { ...profile.value, kind: 'mongodb' }
})

/**
 * 从数据库概览打开某集合的特定功能 Tab。
 * 若 database 不在 props 里（来自数据库视图），直接使用 database prop。
 */
function openCollection(database: string, collection: string, feature: string): void {
  const item = connItem.value
  if (!item) return
  connect(item, {
    resourcePath: {
      segments: [
        { kind: 'database', name: database },
        { kind: 'collection', name: collection },
      ],
    },
    initialTab: feature === 'collections' ? undefined : feature,
  })
}

/** 当前功能的注册表定义（面板解析） */
const featureDef = mongoPaneRegistry[feature] ?? mongoPaneRegistry.collections

/** 面板选择在 Tab 生命周期内固定（feature 与库/集合均来自 Tab props） */
const pane = featureDef.resolvePane({
  database: props.database,
  collection: props.collection,
})

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    message,
  )
}

function reloadOnStaleChunk(): void {
  const g = globalThis as typeof globalThis & { __niumaVitePreloadReload?: boolean }
  if (g.__niumaVitePreloadReload) return
  g.__niumaVitePreloadReload = true
  globalThis.location.reload()
}

/** 懒加载的面板组件（按功能拆 chunk，仅加载当前 Tab 所需） */
const PaneView = defineAsyncComponent({
  loader: pane.loader,
  onError(error, retry, fail, attempts) {
    // HMR / 依赖预构建变更时旧 chunk URL 失效：先重试一次，再整页刷新（与 main.ts vite:preloadError 对齐）
    if (isChunkLoadError(error) && attempts <= 1) {
      retry()
      return
    }
    if (isChunkLoadError(error)) {
      reloadOnStaleChunk()
    }
    fail()
  },
})

/** 面板 props（sessionId / profile 变化时自动重算） */
const paneProps = computed(() =>
  pane.buildProps({
    sessionId: sessionId.value,
    database: props.database,
    collection: props.collection,
    hostAddress: profile.value?.hostAddress,
    portNumber: profile.value?.portNumber,
    openCollection,
  }),
)

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

watch(
  () => sessionActionStore.reconnectSignals[props.profileId],
  (val) => {
    if (val) void reconnect()
  },
)
</script>

<template>
  <div class="nm-mongo-session">
    <!-- 连接错误提示 -->
    <p v-if="error" class="nm-mongo-session__error" role="alert">
      <RsIcon name="alert-circle" :size="13" />
      {{ error }}
    </p>

    <!-- 连接中骨架 -->
    <RsLoading
      v-if="connecting"
      class="nm-mongo-session__loading"
      :label="t('modules.mongodb.session.connecting')"
      show-label
    />

    <!-- ── 功能内容区（全高，单一 pane，经注册表懒加载） ── -->
    <div v-else class="nm-mongo-session__body">
      <PaneView v-bind="paneProps" />
    </div>
  </div>
</template>

<style scoped>
/* ── 容器 ── */
.nm-mongo-session {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

/* ── 错误提示 ── */
.nm-mongo-session__error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 6px var(--rs-space-md);
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
  background: color-mix(in srgb, var(--rs-danger) 8%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--rs-danger) 20%, transparent);
  flex-shrink: 0;
}

/* ── 连接中骨架 ── */
.nm-mongo-session__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── 功能内容区 ── */
.nm-mongo-session__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-mongo-session__body > * {
  flex: 1;
  min-height: 0;
}
</style>
