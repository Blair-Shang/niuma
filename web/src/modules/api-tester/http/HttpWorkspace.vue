<script setup lang="ts">
/**
 * HTTP 工作台。明文 REST：地址栏 + Params/Headers/Body + 响应。
 * 由 http/register 挂上；会话态读 store。
 */
import { RsSplitPane } from '@niuma/ui'
import type { ApiRequest } from '../types'
import { useApiTesterStore } from '../stores/api-tester'
import ApiRequestBar from './components/ApiRequestBar.vue'
import ApiRequestEditor from './components/ApiRequestEditor.vue'
import ApiResponsePane from './components/ApiResponsePane.vue'
import { useHttpWorkspace } from './composables/useHttpWorkspace'

const props = defineProps<{
  request: ApiRequest
  requestId?: string
}>()

const api = useApiTesterStore()
const { sending, live, exchange, envId, splitPanes, onSend, onCancel, onClose, onCopyCurl } = useHttpWorkspace(props)
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
