<script setup lang="ts">
import { RsCodeEditor, RsEmpty, RsTabs, type RsTabItem } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { formatBytes, formatDuration, formatHexDump, formatHexDumpFromHex, prettyJson, statusTone } from '../utils/format'
import type { ApiExchange, ApiResponseView } from '../types'

const props = defineProps<{
  exchange: ApiExchange | null
  sending?: boolean
  live?: boolean
}>()

const { t } = useI18n()
const appStore = useAppStore()
const view = ref<ApiResponseView>('pretty')

watch(
  () => props.exchange,
  (ex) => {
    if (!ex) return
    view.value = ex.protocol === 'TCP' || ex.protocol === 'UDP' ? 'hex' : 'pretty'
  },
)

const items = computed<RsTabItem[]>(() => [
  { value: 'pretty', label: t('modules.api.pretty') },
  { value: 'raw', label: t('modules.api.raw') },
  { value: 'headers', label: t('modules.api.responseHeaders') },
  { value: 'hex', label: t('modules.api.hex') },
])

const tone = computed(() => statusTone(props.exchange?.status ?? null, props.exchange?.ok ?? false))

const statusLabel = computed(() => {
  const ex = props.exchange
  if (!ex) return ''
  if (ex.error) return ex.error
  if (ex.status != null) return `${ex.status} ${ex.statusText}`.trim()
  return ex.statusText || t('modules.api.statusConnected')
})

const editorText = computed(() => {
  const ex = props.exchange
  if (!ex) return ''
  if (view.value === 'headers') {
    return ex.headers.map((row) => `${row.key}: ${row.value}`).join('\n')
  }
  if (view.value === 'hex') return ex.hex ? formatHexDumpFromHex(ex.hex) : formatHexDump(ex.body)
  if (view.value === 'pretty') return prettyJson(ex.body)
  return ex.body
})

const editorLang = computed(() => {
  if (view.value === 'pretty') return 'json'
  return 'plaintext'
})
</script>

<template>
  <div class="nm-api-res">
    <div class="nm-api-res__status">
      <template v-if="sending">
        <span class="nm-api-res__pulse" />
        <span class="nm-api-res__muted">{{ t('modules.api.sending') }}</span>
      </template>
      <template v-else-if="live">
        <span class="nm-api-res__pulse" />
        <span class="nm-api-res__code" :class="`nm-api-res__code--${tone}`">{{ statusLabel }}</span>
        <span v-if="exchange" class="nm-api-res__meta">{{ formatDuration(exchange.durationMs) }}</span>
        <span v-if="exchange" class="nm-api-res__meta">{{ formatBytes(exchange.sizeBytes) }}</span>
        <span v-if="exchange" class="nm-api-res__meta">{{ exchange.protocol }}</span>
      </template>
      <template v-else-if="exchange">
        <span class="nm-api-res__code" :class="`nm-api-res__code--${tone}`">{{ statusLabel }}</span>
        <span class="nm-api-res__meta">{{ formatDuration(exchange.durationMs) }}</span>
        <span class="nm-api-res__meta">{{ formatBytes(exchange.sizeBytes) }}</span>
        <span class="nm-api-res__meta">{{ exchange.protocol }}</span>
      </template>
      <span v-else class="nm-api-res__muted">{{ t('modules.api.emptyResponse') }}</span>
    </div>

    <RsEmpty
      v-if="!exchange && !sending && !live"
      fill
      :description="t('modules.api.emptyResponse')"
    />
    <template v-else-if="exchange">
      <RsTabs
        v-model="view"
        :items="items"
        size="sm"
        variant="line"
        panelless
        borderless
        content-gap="none"
      />
      <RsCodeEditor
        :model-value="editorText"
        :language="editorLang"
        :theme="appStore.theme"
        :show-toolbar="false"
        readonly
        embedded
        height="100%"
      />
    </template>
  </div>
</template>

<style scoped>
.nm-api-res {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-api-res__status {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 1.75rem;
  padding: 0.25rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-xs);
  flex-shrink: 0;
}

.nm-api-res__code {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace;
  font-weight: 600;
}

.nm-api-res__code--success {
  color: var(--rs-success);
}

.nm-api-res__code--warning {
  color: var(--rs-warning);
}

.nm-api-res__code--danger {
  color: var(--rs-danger);
}

.nm-api-res__code--muted {
  color: var(--rs-muted);
}

.nm-api-res__meta,
.nm-api-res__muted {
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
}

.nm-api-res__pulse {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 999px;
  background: var(--rs-primary);
  animation: nm-api-pulse 1s ease-in-out infinite;
}

.nm-api-res :deep(.rs-tabs) {
  flex-shrink: 0;
  padding: 0 0.5rem;
}

.nm-api-res :deep(.rs-code-editor) {
  flex: 1;
  min-height: 0;
}

@keyframes nm-api-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
</style>
