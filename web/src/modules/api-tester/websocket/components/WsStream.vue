<script setup lang="ts">
import { RsButton, RsEmpty } from '@niuma/ui'
import type { ApiSocketDataEvent } from '@/api/types/api-socket'

defineProps<{
  frames: ApiSocketDataEvent[]
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
  <section class="nm-api-ws__stream">
    <div class="nm-api-ws__bar">
      <span>{{ $t('modules.api.socketLog') }}</span>
      <span class="nm-api-ws__count">{{ frames.length }}</span>
      <div class="nm-api-ws__pills">
        <button
          v-for="item in (['auto', 'text', 'hex'] as const)"
          :key="item"
          type="button"
          class="nm-api-ws__pill"
          :class="{ 'nm-api-ws__pill--on': logViewModel === item }"
          @click="logViewModel = item"
        >
          {{ item === 'auto' ? $t('modules.api.socketEncodeAuto') : item === 'text' ? $t('modules.api.socketViewText') : $t('modules.api.socketViewHex') }}
        </button>
      </div>
      <RsButton variant="ghost" size="sm" :disabled="frames.length === 0" @click="emit('clear')">
        {{ $t('modules.api.socketClear') }}
      </RsButton>
    </div>
    <RsEmpty v-if="frames.length === 0" fill :description="emptyLog" />
    <div
      v-else
      :ref="(el) => { logEl = (el as HTMLElement | null) }"
      class="nm-api-ws__frames"
      @scroll="emit('scroll')"
    >
      <article
        v-for="(row, index) in frames"
        :key="`${row.at ?? index}-${row.direction}-${index}`"
        class="nm-api-ws__frame"
        :class="`nm-api-ws__frame--${row.direction}`"
      >
        <header>
          <span>{{ row.direction === 'in' ? $t('modules.api.wsIn') : $t('modules.api.wsOut') }}</span>
          <time>{{ frameTime(row) }}</time>
          <span>{{ formatBytes(frameBytes(row)) }}</span>
        </header>
        <pre>{{ framePreview(row) }}</pre>
      </article>
    </div>
  </section>
</template>
