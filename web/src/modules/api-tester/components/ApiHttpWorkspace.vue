<script setup lang="ts">
/**
 * HTTP 工作台。明文 REST：地址栏 + Params/Headers/Body + 响应。
 * 由 apiPaneRegistry kind=http 挂上；会话态读 store，不经页签壳转发。
 */
import { RsSplitPane, useRsToast, type RsSplitPaneItem } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiRequest } from '../types'
import { useApiTesterStore } from '../stores/api-tester'
import ApiRequestBar from './ApiRequestBar.vue'
import ApiRequestEditor from './ApiRequestEditor.vue'
import ApiResponsePane from './ApiResponsePane.vue'

const props = defineProps<{
  request: ApiRequest
  requestId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const api = useApiTesterStore()

const sending = computed(() => Boolean(props.requestId && api.sending[props.requestId]))
const live = computed(() => Boolean(props.requestId && api.sockets[props.requestId]))
const exchange = computed(() => (props.requestId ? api.exchanges[props.requestId] ?? null : null))
const envId = computed({
  get: () => api.envId,
  set: (id: string) => {
    api.envId = id
  },
})

const splitPanes = computed<RsSplitPaneItem[]>(() => [
  { key: 'request', size: 46, min: 22, resizerHandle: true },
  { key: 'response', size: 54, min: 24 },
])

function onSend(): void {
  if (props.requestId) void api.send(props.requestId)
}

function onCancel(): void {
  if (props.requestId) api.cancel(props.requestId)
}

function onClose(): void {
  if (props.requestId) api.closeSocket(props.requestId)
}

async function onCopyCurl(): Promise<void> {
  if (!props.requestId) return
  const text = api.curl(props.requestId)
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('modules.api.copied'))
  } catch {
    toast.error(t('modules.api.copyFailed'))
  }
}
</script>

<template>
  <div class="nm-api-http">
    <ApiRequestBar
      :request="request"
      :environments="api.environments"
      :sending="sending"
      :live="live"
      v-model:env-id="envId"
      @send="onSend"
      @cancel="onCancel"
      @close="onClose"
      @copy-curl="onCopyCurl"
    />
    <RsSplitPane
      :panes="splitPanes"
      orientation="vertical"
      class="nm-api-http__split"
      with-handle
    >
      <template #request>
        <ApiRequestEditor :request="request" />
      </template>
      <template #response>
        <ApiResponsePane :exchange="exchange" :sending="sending" :live="live" />
      </template>
    </RsSplitPane>
  </div>
</template>

<style scoped>
.nm-api-http {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.nm-api-http__split {
  flex: 1;
  min-height: 0;
}

.nm-api-http__split :deep(.rs-split__pane) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
