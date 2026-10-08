<script setup lang="ts">
/**
 * HTTP 工作台。明文 REST：地址栏 + Params/Headers/Auth/Body + 响应。
 * 代码片段以右侧浮层打开，不挤压请求区。由 http/register 挂上；会话态读 store。
 */
import { ref } from 'vue'
import { RsSplitPane } from '@niuma/ui'
import type { ApiRequest } from '../types'
import { useApiTesterStore } from '../stores/api-tester'
import ApiCodeSnippet from './components/ApiCodeSnippet.vue'
import ApiCookiePanel from './components/ApiCookiePanel.vue'
import ApiRequestBar from './components/ApiRequestBar.vue'
import ApiRequestEditor from './components/ApiRequestEditor.vue'
import ApiRequestSettings from './settings/ApiRequestSettings.vue'
import ApiResponsePane from './components/ApiResponsePane.vue'
import { useHttpWorkspace } from './composables/useHttpWorkspace'

const props = defineProps<{
  request: ApiRequest
  requestId?: string
}>()

const api = useApiTesterStore()
const overlay = ref<'code' | 'cookies' | 'settings' | ''>('')
const { sending, live, exchange, envId, splitPanes, onSend, onCancel, onClose } = useHttpWorkspace(props)

function onOverlay(next: 'code' | 'cookies' | 'settings'): void {
  overlay.value = overlay.value === next ? '' : next
}
</script>

<template>
  <div class="nm-api-http">
    <ApiRequestBar
      :request="request"
      :environments="api.environments"
      :sending="sending"
      :live="live"
      :overlay="overlay"
      v-model:env-id="envId"
      @send="onSend"
      @cancel="onCancel"
      @close="onClose"
      @overlay="onOverlay"
    />
    <div class="nm-api-http__body">
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
      <ApiRequestSettings
        v-if="overlay === 'settings'"
        class="nm-api-http__settings"
        :request="request"
        @close="overlay = ''"
      />
      <ApiCookiePanel
        v-if="overlay === 'cookies'"
        class="nm-api-http__cookies"
        @close="overlay = ''"
      />
      <ApiCodeSnippet
        v-if="overlay === 'code'"
        class="nm-api-http__code"
        :request="request"
        :request-id="requestId"
        @close="overlay = ''"
      />
    </div>
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

.nm-api-http__body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}

.nm-api-http__split {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.nm-api-http__settings,
.nm-api-http__cookies {
  position: absolute;
  z-index: 5;
  inset-block: 0;
  inset-inline-end: 0;
  display: flex;
  flex-direction: column;
  width: min(24rem, 46%);
  min-width: 16rem;
  border-inline-start: 1px solid var(--rs-border);
  background: var(--rs-surface);
  box-shadow: -8px 0 24px color-mix(in srgb, var(--rs-text) 10%, transparent);
}

.nm-api-http__code {
  position: absolute;
  z-index: 4;
  inset-block: 0;
  inset-inline-end: 0;
  display: flex;
  flex-direction: column;
  width: min(36rem, 52%);
  min-width: 20rem;
  border-inline-start: 1px solid var(--rs-border);
  background: var(--rs-surface);
  box-shadow: -8px 0 24px color-mix(in srgb, var(--rs-text) 10%, transparent);
}

.nm-api-http__split :deep(.rs-split__pane) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
