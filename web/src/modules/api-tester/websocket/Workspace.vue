<script setup lang="ts">
/**
 * WebSocket 客户端。连接保存在 store，切走页签不会断开。
 */
import type { ApiSocketDataEvent } from '@/api/types/api-socket'
import { RsButton, RsSplitPane, type RsSplitPaneItem } from '@niuma/ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiRequest } from '../types'
import { useApiRequestPersist } from '../composables/useApiRequestPersist'
import { useApiTesterStore } from '../stores/api-tester'
import { formatBytes, formatHexDumpFromHex } from '../utils/format'
import ApiKvEditor from '../layout/ApiKvEditor.vue'
import WsCompose from './components/WsCompose.vue'
import WsStream from './components/WsStream.vue'

const splitPanes: RsSplitPaneItem[] = [
  { key: 'stream', size: 68, min: 28, resizerHandle: true },
  { key: 'compose', size: 32, min: 16 },
]

const props = defineProps<{
  request: ApiRequest
  requestId?: string
}>()

const { t } = useI18n()
const api = useApiTesterStore()
useApiRequestPersist(() => props.request)

const headersOpen = ref(false)
const messageKind = ref<'text' | 'json' | 'base64'>('text')
const logView = ref<'auto' | 'text' | 'hex'>('auto')
const logEl = ref<HTMLElement | null>(null)
const composeError = ref('')
let pinBottom = true

const requestId = computed(() => props.requestId)
const sending = computed(() => Boolean(requestId.value && api.sending[requestId.value]))
const live = computed(() => (requestId.value ? api.sockets[requestId.value] ?? null : null))
const frames = computed(() => (requestId.value ? api.socketLogs[requestId.value] ?? [] : []))
const exchange = computed(() => (requestId.value ? api.exchanges[requestId.value] ?? null : null))
const connected = computed(() => live.value?.kind === 'websocket' && live.value.state === 'connected')

const urlModel = computed({
  get: () => props.request.url,
  set: (value: string) => {
    props.request.url = value
  },
})

const protocolsModel = computed({
  get: () => props.request.wsProtocols ?? '',
  set: (value: string) => {
    props.request.wsProtocols = value
  },
})

const headersModel = computed({
  get: () => props.request.headers,
  set: (value) => {
    props.request.headers = value
  },
})

const bodyModel = computed({
  get: () => props.request.body,
  set: (value: string) => {
    props.request.body = value
  },
})

const statusLabel = computed(() => {
  if (sending.value) return t('modules.api.sending')
  if (connected.value) return t('modules.api.wsConnected')
  if (exchange.value?.error) return exchange.value.error
  return t('modules.api.wsIdle')
})

watch(frames, async () => {
  await nextTick()
  if (!pinBottom || !logEl.value) return
  logEl.value.scrollTop = logEl.value.scrollHeight
})

function toggleTls(): void {
  props.request.insecureTLS = props.request.insecureTLS !== true
}

function onConnect(): void {
  const id = requestId.value
  if (!id) return
  composeError.value = ''
  void api.connectWebSocket(id)
}

function onClose(): void {
  const id = requestId.value
  if (id) api.closeSocket(id)
}

function onClear(): void {
  const id = requestId.value
  if (id) api.clearSocketLog(id)
}

function onSend(): void {
  const id = requestId.value
  if (!id || !connected.value) return
  const data = bodyModel.value
  if (!data.trim()) return
  if (messageKind.value === 'json') {
    try {
      JSON.parse(data)
    } catch {
      composeError.value = t('modules.api.wsJson')
      return
    }
  }
  composeError.value = ''
  const encoding = messageKind.value === 'base64' ? 'base64' : 'utf8'
  void api.sendWebSocket(id, data, encoding).catch((error: unknown) => {
    composeError.value = error instanceof Error ? error.message : String(error)
  })
}

function onComposeKey(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return
  event.preventDefault()
  onSend()
}

function frameBytes(row: ApiSocketDataEvent): number {
  if (typeof row.bytes === 'number') return row.bytes
  if (row.hex) return Math.floor(row.hex.length / 2)
  return row.data ? new TextEncoder().encode(row.data).length : 0
}

function frameTime(row: ApiSocketDataEvent): string {
  if (!row.at) return ''
  const date = new Date(row.at)
  if (Number.isNaN(date.getTime())) return row.at
  return date.toLocaleTimeString()
}

function framePreview(row: ApiSocketDataEvent): string {
  if (logView.value === 'hex' || (logView.value === 'auto' && !row.data && row.hex)) {
    return row.hex ? formatHexDumpFromHex(row.hex) : ''
  }
  return row.data || (row.hex ? `<${frameBytes(row)} B>` : '')
}

function onLogScroll(): void {
  const el = logEl.value
  if (!el) return
  pinBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
}
</script>

<template>
  <div class="nm-api-ws">
    <header class="nm-api-ws__chrome">
      <div class="nm-api-ws__toolbar">
        <span class="nm-api-ws__badge">WS</span>
        <input
          v-model="urlModel"
          class="nm-api-ws__url"
          spellcheck="false"
          :placeholder="t('modules.api.wsUrlPlaceholder')"
          :aria-label="t('modules.api.wsUrl')"
          @keydown.enter.prevent="onConnect"
        />
        <RsButton
          variant="text"
          size="sm"
          radius="sm"
          :tone="request.insecureTLS ? 'danger' : 'neutral'"
          @click="toggleTls"
        >
          TLS
        </RsButton>
        <RsButton v-if="!connected" variant="primary" size="sm" :disabled="sending || !request.url.trim()" @click="onConnect">
          {{ sending ? t('modules.api.sending') : t('modules.api.connect') }}
        </RsButton>
        <RsButton v-else variant="default" size="sm" @click="onClose">
          {{ t('modules.api.closeSocket') }}
        </RsButton>
        <RsButton
          :variant="headersOpen ? 'default' : 'ghost'"
          size="sm"
          radius="sm"
          @click="headersOpen = !headersOpen"
        >
          {{ t('modules.api.headers') }}
        </RsButton>
      </div>
      <p class="nm-api-ws__status" :class="{ 'nm-api-ws__status--on': connected, 'nm-api-ws__status--err': Boolean(exchange?.error) && !connected }">
        {{ statusLabel }}
      </p>
      <div v-if="headersOpen" class="nm-api-ws__headers">
        <label class="nm-api-ws__label">
          {{ t('modules.api.wsProtocols') }}
          <input v-model="protocolsModel" class="nm-api-ws__protocols" spellcheck="false" placeholder="chat, soap" />
        </label>
        <ApiKvEditor v-model="headersModel" table />
      </div>
    </header>
    <RsSplitPane :panes="splitPanes" orientation="vertical" class="nm-api-ws__split" with-handle>
      <template #stream>
        <WsStream
          v-model:log-view="logView"
          v-model:log-el="logEl"
          :frames="frames"
          :empty-log="t('modules.api.wsEmpty')"
          :frame-time="frameTime"
          :frame-bytes="frameBytes"
          :frame-preview="framePreview"
          :format-bytes="formatBytes"
          @clear="onClear"
          @scroll="onLogScroll"
        />
      </template>
      <template #compose>
        <WsCompose
          v-model="bodyModel"
          v-model:kind="messageKind"
          :error="composeError"
          :can-send="connected && Boolean(bodyModel.trim())"
          @send="onSend"
          @keydown="onComposeKey"
        />
      </template>
    </RsSplitPane>
  </div>
</template>

<style src="./ws.css"></style>
