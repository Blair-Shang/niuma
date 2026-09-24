<script setup lang="ts">
/**
 * 发送坞。编码默认自动，由后台 Detect 落地；行尾单独标注。
 * 正文用 RsCodeEditor（与 HTTP Body 同一套），Ctrl+Enter 发送。
 */
import { computed } from 'vue'
import { RsButton, RsCodeEditor, RsInput } from '@niuma/ui'
import { useAppStore } from '@/stores/app'
import type { SocketEncode, SocketLineEnd } from '../utils/socket-payload'

defineProps<{
  canSend: boolean
  canRepeat: boolean
  repeating: boolean
  encodeHint: string
  sendLabel: string
  placeholder?: string
  showBroadcast?: boolean
}>()

const encode = defineModel<SocketEncode>('encode', { required: true })
const lineEnd = defineModel<SocketLineEnd>('lineEnd', { required: true })
const body = defineModel<string>('body', { required: true })
const broadcast = defineModel<boolean>('broadcast', { required: true })
const repeatMs = defineModel<number>('repeatMs', { required: true })
const repeatText = computed({
  get: () => String(repeatMs.value),
  set: (value: string) => {
    const n = Number(value)
    if (Number.isFinite(n)) repeatMs.value = n
  },
})

const emit = defineEmits<{
  send: []
  toggleRepeat: []
  keydown: [event: KeyboardEvent]
}>()

const appStore = useAppStore()

const encodings: { id: SocketEncode; labelKey: string }[] = [
  { id: 'auto', labelKey: 'modules.api.socketEncodeAuto' },
  { id: 'utf8', labelKey: 'modules.api.socketEncodeUtf8' },
  { id: 'hex', labelKey: 'modules.api.hex' },
  { id: 'base64', labelKey: 'modules.api.socketEncodeBase64' },
]

const lineEnds: { id: SocketLineEnd; labelKey: string }[] = [
  { id: 'none', labelKey: 'modules.api.socketLineNone' },
  { id: 'lf', labelKey: 'modules.api.socketLineLf' },
  { id: 'cr', labelKey: 'modules.api.socketLineCr' },
  { id: 'crlf', labelKey: 'modules.api.socketLineCrlf' },
]
</script>

<template>
  <footer class="nm-api-sock__compose">
    <div class="nm-api-sock__compose-bar">
      <div class="nm-api-sock__group">
        <span class="nm-api-sock__group-label">{{ $t('modules.api.socketEncode') }}</span>
        <fieldset class="nm-api-sock__pills">
          <legend class="nm-api-sock__sr">{{ $t('modules.api.socketEncode') }}</legend>
          <button
            v-for="item in encodings"
            :key="item.id"
            type="button"
            class="nm-api-sock__pill"
            :class="{ 'nm-api-sock__pill--on': encode === item.id }"
            @click="encode = item.id"
          >
            {{ $t(item.labelKey) }}
          </button>
        </fieldset>
      </div>
      <div v-if="showBroadcast" class="nm-api-sock__group">
        <span class="nm-api-sock__group-label">{{ $t('modules.api.socketBroadcast') }}</span>
        <fieldset class="nm-api-sock__pills">
          <legend class="nm-api-sock__sr">{{ $t('modules.api.socketBroadcast') }}</legend>
          <button
            type="button"
            class="nm-api-sock__pill"
            :class="{ 'nm-api-sock__pill--on': broadcast }"
            @click="broadcast = !broadcast"
          >
            255.255.255.255
          </button>
        </fieldset>
      </div>
      <div class="nm-api-sock__group">
        <span class="nm-api-sock__group-label">{{ $t('modules.api.socketLineEnd') }}</span>
        <fieldset class="nm-api-sock__pills">
          <legend class="nm-api-sock__sr">{{ $t('modules.api.socketLineEnd') }}</legend>
          <button
            v-for="item in lineEnds"
            :key="item.id"
            type="button"
            class="nm-api-sock__pill"
            :class="{ 'nm-api-sock__pill--on': lineEnd === item.id }"
            @click="lineEnd = item.id"
          >
            {{ $t(item.labelKey) }}
          </button>
        </fieldset>
      </div>
    </div>
    <div class="nm-api-sock__draft" @keydown="emit('keydown', $event)">
      <RsCodeEditor
        v-model="body"
        language="plaintext"
        :theme="appStore.editorTheme"
        :placeholder="placeholder"
        :show-toolbar="false"
        :fold-gutter="false"
        embedded
        height="100%"
      />
    </div>
    <div class="nm-api-sock__compose-foot">
      <span class="nm-api-sock__hint">{{ encodeHint }} · {{ $t('modules.api.socketPayloadHint') }}</span>
      <label class="nm-api-sock__repeat">
        <span>{{ $t('modules.api.socketRepeat') }}</span>
        <RsInput
          v-model="repeatText"
          size="sm"
          radius="sm"
          suffix="ms"
          class="nm-api-sock__repeat-ms"
          inputmode="numeric"
          :disabled="repeating"
          :aria-label="$t('modules.api.socketRepeat')"
        />
      </label>
      <RsButton
        variant="default"
        size="sm"
        :disabled="!canRepeat"
        @click="emit('toggleRepeat')"
      >
        {{ repeating ? $t('modules.api.socketRepeatStop') : $t('modules.api.socketRepeatStart') }}
      </RsButton>
      <RsButton
        variant="primary"
        size="sm"
        :disabled="!canSend"
        @click="emit('send')"
      >
        {{ sendLabel }}
      </RsButton>
    </div>
  </footer>
</template>
