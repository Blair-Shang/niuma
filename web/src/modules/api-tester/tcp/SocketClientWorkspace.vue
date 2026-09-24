<script setup lang="ts">
/**
 * TCP / UDP 客户端：拨号对端、收发。tcp/udp register 按 listen 挂上。
 */
import { RsButton, RsInput, RsSplitPane, type RsSplitPaneItem } from '@niuma/ui'
import type { ApiRequest } from '../types'
import { useApiSocketSession } from './composables/useApiSocketSession'
import ApiSocketCompose from './components/ApiSocketCompose.vue'
import ApiSocketFrame from './components/ApiSocketFrame.vue'
import ApiSocketStream from './components/ApiSocketStream.vue'
import './socket.css'

const splitPanes: RsSplitPaneItem[] = [
  { key: 'stream', size: 72, min: 28, resizerHandle: true },
  { key: 'compose', size: 28, min: 16 },
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
  frameMode,
  frameDelimiter,
  lengthOffset,
  lengthSize,
  lengthEndian,
  lengthAdjust,
  broadcast,
  repeatMs,
  repeating,
  canRepeat,
  logView,
  logEl,
  sending,
  live,
  exchange,
  frames,
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
  onToggleRepeat,
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
  'client',
)
</script>

<template>
  <div class="nm-api-sock">
    <header class="nm-api-sock__chrome">
      <div class="nm-api-sock__toolbar">
        <span class="nm-api-sock__badge">{{ request.method }}</span>
        <span class="nm-api-sock__badge">{{ t('modules.api.socketClient') }}</span>

        <div class="nm-api-sock__endpoint">
          <span class="nm-api-sock__field-label">{{ t('modules.api.socketTarget') }}</span>
          <RsInput
            v-model="host"
            size="sm"
            radius="sm"
            class="nm-api-sock__host"
            spellcheck="false"
            :aria-label="t('modules.api.socketTarget')"
            placeholder="127.0.0.1"
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
          <RsButton v-if="sending" variant="default" size="sm" @click="onCancel">
            {{ t('modules.api.cancel') }}
          </RsButton>
          <template v-else>
            <RsButton variant="primary" size="sm" :disabled="!canOpen || Boolean(live)" @click="onConnect">
              {{ t('modules.api.connect') }}
            </RsButton>
            <RsButton variant="default" size="sm" :disabled="!live" @click="onClose">
              {{ t('modules.api.closeSocket') }}
            </RsButton>
          </template>
        </div>

        <span class="nm-api-sock__status" :class="{ 'nm-api-sock__status--err': Boolean(exchange?.error) && !live }">
          <span class="nm-api-sock__pulse" :class="{ 'nm-api-sock__pulse--on': liveOn }" />
          {{ statusLabel }}
        </span>
      </div>

      <div class="nm-api-sock__meta">
        <span>{{ t('modules.api.socketPeer') }} {{ live?.remoteAddr || '—' }}</span>
        <span>{{ t('modules.api.socketLocal') }} {{ live?.localAddr || '—' }}</span>
        <span>{{ t('modules.api.socketOut') }} {{ formatBytes(outboundBytes) }}</span>
        <span>{{ t('modules.api.socketIn') }} {{ formatBytes(inboundBytes) }}</span>
        <span v-if="exchange">{{ formatDuration(exchange.durationMs) }}</span>
        <ApiSocketFrame
          v-if="request.method === 'TCP'"
          v-model:mode="frameMode"
          v-model:delimiter="frameDelimiter"
          v-model:length-offset="lengthOffset"
          v-model:length-size="lengthSize"
          v-model:length-endian="lengthEndian"
          v-model:length-adjust="lengthAdjust"
          :locked="Boolean(live)"
        />
      </div>
      <p v-if="exchange?.error" class="nm-api-sock__banner" role="alert">{{ exchange.error }}</p>
    </header>

    <RsSplitPane :panes="splitPanes" orientation="vertical" class="nm-api-sock__split" with-handle>
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
      <template #compose>
        <ApiSocketCompose
          class="nm-api-sock__compose--split"
          v-model:encode="encode"
          v-model:line-end="lineEnd"
          v-model:body="bodyModel"
          v-model:broadcast="broadcast"
          v-model:repeat-ms="repeatMs"
          :repeating="repeating"
          :can-send="canSend"
          :can-repeat="canRepeat"
          :show-broadcast="request.method === 'UDP'"
          :encode-hint="encodeHint"
          :send-label="t('modules.api.send')"
          :placeholder="encode === 'hex' ? '70 69 6e 67' : ''"
          @send="onSend"
          @toggle-repeat="onToggleRepeat"
          @keydown="onComposeKey"
        />
      </template>
    </RsSplitPane>
  </div>
</template>
