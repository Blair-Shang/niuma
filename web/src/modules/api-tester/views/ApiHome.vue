<script setup lang="ts">
/**
 * API 请求页签壳：按 method 查 paneKind，ensureApiPane 后懒加载工作台。
 * 对齐 VastSession：壳不拼面板回调，新协议只加 catalog + {kind}/register。
 */
import { RsButton, RsEmpty } from '@niuma/ui'
import { computed, onActivated, onDeactivated, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabStore } from '@/stores/tab'
import { apiPaneComponent, paneKindOf } from '../layout/pane-registry'
import { useApiTesterStore } from '../stores/api-tester'
import { splitSocketUrl } from '../utils/request-kind'

const props = defineProps<{
  tabId?: string
  requestId?: string
}>()

const { t } = useI18n()
const tabStore = useTabStore()
const api = useApiTesterStore()

const request = computed(() => api.requestById(props.requestId))
const sending = computed(() => Boolean(props.requestId && api.sending[props.requestId]))
const paneKind = computed(() => paneKindOf(request.value?.method ?? 'GET'))
const paneScope = computed(() => ({
  method: request.value?.method,
  listen: request.value ? splitSocketUrl(request.value.url).listen : false,
}))
const paneKey = computed(() => `${paneKind.value}:${paneScope.value.listen ? 'listen' : 'dial'}`)
const PaneView = computed(() => apiPaneComponent(paneKind.value, paneScope.value))

const paneProps = computed(() => {
  const req = request.value
  if (!req) return {}
  return {
    request: req,
    requestId: props.requestId,
    tabId: props.tabId,
  }
})

watch(
  () =>
    [props.tabId, props.requestId, request.value?.method, request.value?.name, request.value?.url] as const,
  () => {
    api.syncTabTitle(props.tabId, props.requestId)
  },
  { immediate: true },
)

function onNewRequest(): void {
  api.addRequest({ draftsName: t('modules.api.drafts') })
}

function onGlobalKey(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return
  if (!props.requestId) return
  if (props.tabId && tabStore.activeTabId !== props.tabId) return
  event.preventDefault()
  if (sending.value) api.cancel(props.requestId)
  else void api.send(props.requestId)
}

// keep-alive 首次插入会先 mounted 再 activated。只在 activated 注册，
// 避免 Ctrl+Enter 挂上两份监听。切走时 deactivated 卸掉；当前页随壳销毁
// 不再走 deactivated，由 unmounted 收尾。
onActivated(() => window.addEventListener('keydown', onGlobalKey))
onDeactivated(() => window.removeEventListener('keydown', onGlobalKey))
onUnmounted(() => window.removeEventListener('keydown', onGlobalKey))
</script>

<template>
  <div class="nm-api-home">
    <component
      :is="PaneView"
      v-if="request"
      :key="paneKey"
      class="nm-api-home__pane"
      v-bind="paneProps"
    />
    <RsEmpty
      v-else
      fill
      :description="t('modules.api.emptyRequest')"
    >
      <RsButton size="sm" variant="primary" @click="onNewRequest">
        {{ t('modules.api.newRequest') }}
      </RsButton>
    </RsEmpty>
  </div>
</template>

<style scoped>
.nm-api-home {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-api-home__pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
