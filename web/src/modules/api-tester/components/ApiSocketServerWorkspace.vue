<script setup lang="ts">
/**
 * TCP 或 UDP 服务端：绑定端口、看接入、收发。不含拨号，也不在页内改协议或切客户端。
 * 上栏左右拖（接入 / 收发流），下栏与客户端一样上下拖发送坞。
 */
import { RsButton, RsInput, RsSplitPane, type RsSplitPaneItem } from '@niuma/ui'
import type { ApiRequest } from '../types'
import { useApiSocketSession } from '../composables/useApiSocketSession'
import ApiSocketCompose from './ApiSocketCompose.vue'
import ApiSocketStream from './ApiSocketStream.vue'
import './api-socket.css'

const stagePanes: RsSplitPaneItem[] = [
  { key: 'stage', size: 72, min: 28, resizerHandle: true },
  { key: 'compose', size: 28, min: 16 },
]

const bodyPanes: RsSplitPaneItem[] = [
  { key: 'peers', size: 22, min: 16, resizerHandle: true },
  { key: 'stream', size: 78, min: 36 },
]

const props = defineProps<{
  request: ApiRequest
  requestId?: string
}>()

const {
  t,
  host,
  port,
  encode,
  lineEnd,
  logView,
  logEl,
  sending,
  live,
  exchange,
  frames,
  peers,
  selectedPeer,
  replyAddr,
  bodyModel,
  inboundBytes,
  outboundBytes,
  canOpen,
  liveOn,
  canSend,
  encodeHint,
  statusLabel,
  emptyLog,
  onConnect,
  onSend,
  onCancel,
  onClose,
  onClear,
  onComposeKey,
  frameBytes,
  frameTime,
  framePreview,
  onLogScroll,
  formatBytes,
  formatDuration,
} = useApiSocketSession(
  () => props.request,
  () => props.requestId,
  'server',
)
</script>

<template>
  <div class="nm-api-sock">
    <header class="nm-api-sock__chrome">
      <div class="nm-api-sock__toolbar">
        <span class="nm-api-sock__badge nm-api-sock__badge--server">{{ request.method }}</span>
        <span class="nm-api-sock__badge nm-api-sock__badge--server">{{ t('modules.api.socketServer') }}</span>

        <div class="nm-api-sock__endpoint">
          <span class="nm-api-sock__field-label">{{ t('modules.api.socketBind') }}</span>
          <RsInput
            v-model="host"
            size="sm"
            radius="sm"
            class="nm-api-sock__host"
            spellcheck="false"
            :aria-label="t('modules.api.socketBind')"
            placeholder="0.0.0.0"
          />
          <span class="nm-api-sock__colon" aria-hidden="true">:</span>
          <RsInput
            v-model="port"
            size="sm"
            radius="sm"
            class="nm-api-sock__port"
            spellcheck="false"
            :aria-label="t('modules.api.socketPort')"
            placeholder="9000"
          />
        </div>

        <div class="nm-api-sock__actions">
          <RsButton
            v-if="sending"
            variant="default"
            size="sm"
            @click="onCancel"
          >
            {{ t('modules.api.cancel') }}
          </RsButton>
          <template v-else>
            <RsButton
              variant="primary"
              size="sm"
              :disabled="!canOpen || Boolean(live)"
              @click="onConnect"
            >
              {{ t('modules.api.listen') }}
            </RsButton>
            <RsButton
              variant="default"
              size="sm"
              :disabled="!live"
              @click="onClose"
            >
              {{ t('modules.api.closeSocket') }}
            </RsButton>
          </template>
        </div>

        <span
          class="nm-api-sock__status"
          :class="{ 'nm-api-sock__status--err': Boolean(exchange?.error) && !live }"
        >
          <span class="nm-api-sock__pulse" :class="{ 'nm-api-sock__pulse--on': liveOn }" />
          {{ statusLabel }}
        </span>
      </div>

      <div class="nm-api-sock__meta">
        <span>{{ t('modules.api.socketLocal') }} {{ live?.localAddr || '—' }}</span>
        <span>{{ t('modules.api.socketPeers') }} {{ peers.length }}</span>
        <span>RX {{ formatBytes(inboundBytes) }}</span>
        <span>TX {{ formatBytes(outboundBytes) }}</span>
        <span v-if="exchange">{{ formatDuration(exchange.durationMs) }}</span>
      </div>
      <p v-if="exchange?.error" class="nm-api-sock__banner" role="alert">{{ exchange.error }}</p>
    </header>

    <RsSplitPane
      :panes="stagePanes"
      orientation="vertical"
      class="nm-api-sock__split"
      with-handle
    >
      <template #stage>
        <RsSplitPane
          :panes="bodyPanes"
          orientation="horizontal"
          class="nm-api-sock__stage"
          with-handle
        >
          <template #peers>
            <aside class="nm-api-sock__peers" :aria-label="t('modules.api.socketPeers')">
              <div class="nm-api-sock__peers-bar">
                {{ t('modules.api.socketPeers') }}
                <span class="nm-api-sock__count">{{ peers.length }}</span>
              </div>
              <p v-if="peers.length === 0" class="nm-api-sock__peers-empty">
                {{ t('modules.api.emptySocketPeers') }}
              </p>
              <div v-else class="nm-api-sock__peer-list">
                <button
                  v-for="addr in peers"
                  :key="addr"
                  type="button"
                  class="nm-api-sock__peer"
                  :class="{ 'nm-api-sock__peer--on': addr === selectedPeer || (!selectedPeer && addr === replyAddr) }"
                  @click="selectedPeer = selectedPeer === addr ? '' : addr"
                >
                  {{ addr }}
                </button>
              </div>
            </aside>
          </template>
          <template #stream>
            <ApiSocketStream
              :frames="frames"
              :live="live"
              :empty-log="emptyLog"
              v-model:log-view="logView"
              v-model:log-el="logEl"
              :frame-time="frameTime"
              :frame-bytes="frameBytes"
              :frame-preview="framePreview"
              :format-bytes="formatBytes"
              @clear="onClear"
              @scroll="onLogScroll"
            />
          </template>
        </RsSplitPane>
      </template>
      <template #compose>
        <ApiSocketCompose
          class="nm-api-sock__compose--split"
          v-model:encode="encode"
          v-model:line-end="lineEnd"
          v-model:body="bodyModel"
          :can-send="canSend"
          :encode-hint="encodeHint"
          :send-label="t('modules.api.socketReply')"
          :placeholder="encode === 'hex' ? '70 69 6e 67' : ''"
          @send="onSend"
          @keydown="onComposeKey"
        />
      </template>
    </RsSplitPane>
  </div>
</template>
