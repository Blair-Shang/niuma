<script setup lang="ts">
/**
 * 收发流。自动视图：有文本显示文本，否则 Hex dump。
 */
import { RsButton, RsEmpty } from '@niuma/ui'
import type { ApiSocketDataEvent } from '@/api/types/api-socket'
import type { ApiLiveSocket } from '../types'

defineProps<{
  frames: ApiSocketDataEvent[]
  live: ApiLiveSocket | null
  emptyLog: string
  frameTime: (row: ApiSocketDataEvent) => string
  frameBytes: (row: ApiSocketDataEvent) => number
  framePreview: (row: ApiSocketDataEvent) => string
  formatBytes: (n: number) => string
}>()

const logViewModel = defineModel<'auto' | 'text' | 'hex'>('logView', { required: true })
const logEl = defineModel<HTMLElement | null>('logEl', { default: null })

const emit = defineEmits<{
  clear: []
  scroll: []
}>()
</script>

<template>
  <section class="nm-api-sock__stream">
    <div class="nm-api-sock__stream-bar">
      <span>{{ $t('modules.api.socketLog') }}</span>
      <span class="nm-api-sock__count">{{ frames.length }}</span>
      <div class="nm-api-sock__group nm-api-sock__group--inline">
        <span class="nm-api-sock__group-label">{{ $t('modules.api.socketView') }}</span>
        <fieldset class="nm-api-sock__pills nm-api-sock__pills--sm">
          <legend class="nm-api-sock__sr">{{ $t('modules.api.socketView') }}</legend>
          <button
            v-for="item in (['auto', 'text', 'hex'] as const)"
            :key="item"
            type="button"
            class="nm-api-sock__pill"
            :class="{ 'nm-api-sock__pill--on': logViewModel === item }"
            @click="logViewModel = item"
          >
            {{
              item === 'auto'
                ? $t('modules.api.socketEncodeAuto')
                : item === 'text'
                  ? $t('modules.api.socketViewText')
                  : $t('modules.api.socketViewHex')
            }}
          </button>
        </fieldset>
      </div>
      <RsButton
        variant="ghost"
        size="sm"
        :disabled="frames.length === 0"
        @click="emit('clear')"
      >
        {{ $t('modules.api.socketClear') }}
      </RsButton>
    </div>

    <RsEmpty
      v-if="frames.length === 0"
      fill
      :description="emptyLog"
    />
    <div
      v-else
      :ref="(el) => { logEl = (el as HTMLElement | null) }"
      class="nm-api-sock__frames"
      @scroll="emit('scroll')"
    >
      <article
        v-for="(row, index) in frames"
        :key="`${row.at ?? index}-${row.direction}-${index}`"
        class="nm-api-sock__frame"
        :class="`nm-api-sock__frame--${row.direction}`"
      >
        <div class="nm-api-sock__frame-meta">
          <span class="nm-api-sock__dir">
            {{ row.direction === 'in' ? $t('modules.api.socketIn') : $t('modules.api.socketOut') }}
          </span>
          <span>{{ frameTime(row) }}</span>
          <span>{{ formatBytes(frameBytes(row)) }}</span>
          <span class="nm-api-sock__addr">{{ row.remoteAddr || live?.remoteAddr || '' }}</span>
        </div>
        <pre class="nm-api-sock__frame-body">{{ framePreview(row) }}</pre>
      </article>
    </div>
  </section>
</template>
