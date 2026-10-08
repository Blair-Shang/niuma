<script setup lang="ts">
import { RsCodeEditor, RsEmpty, RsTabs, type RsTabItem } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { formatBytes, formatDuration, formatHexDump, formatHexDumpFromHex, isLargeText, prettyJson, statusTone } from '../../utils/format'
import type { ApiExchange, ApiResponseView } from '../../types'

const props = defineProps<{
  exchange: ApiExchange | null
  sending?: boolean
  live?: boolean
}>()

const { t } = useI18n()
const appStore = useAppStore()
const view = ref<ApiResponseView>('pretty')

watch(
  () => props.exchange?.protocol,
  (protocol, prev) => {
    if (!protocol) return
    if (prev && prev === protocol) return
    view.value = protocol === 'TCP' || protocol === 'UDP' ? 'hex' : 'pretty'
  },
)

watch(
  () => props.exchange?.binary,
  (binary) => {
    if (binary) view.value = 'hex'
  },
)

const redirectText = computed(() => {
  const hops = props.exchange?.redirects
  if (!hops?.length) return ''
  const chain = hops.map((hop) => `${hop.status} ${hop.url}`).join(' → ')
  return `${t('modules.api.redirected', { n: hops.length })} · ${chain}`
})

const items = computed<RsTabItem[]>(() => [
  { value: 'pretty', label: t('modules.api.pretty') },
  { value: 'raw', label: t('modules.api.raw') },
  { value: 'headers', label: t('modules.api.responseHeaders') },
  { value: 'hex', label: t('modules.api.hex') },
])

const tone = computed(() => statusTone(props.exchange?.status ?? null, props.exchange?.ok ?? false))

const errorText = computed(() => props.exchange?.error ?? '')

const statusLabel = computed(() => {
  const ex = props.exchange
  if (!ex) return ''
  if (ex.error && ex.status == null) return t('modules.api.requestFailed')
  if (ex.status != null) return `${ex.status} ${ex.statusText}`.trim()
  return ex.statusText || t('modules.api.statusConnected')
})

const largeBody = computed(() => {
  const ex = props.exchange
  if (!ex) return false
  return isLargeText(ex.body) || isLargeText(ex.hex ?? '')
})

const editorText = computed(() => {
  const ex = props.exchange
  if (!ex) return ''
  if (view.value === 'headers') {
    return ex.headers.map((row) => `${row.key}: ${row.value}`).join('\n')
  }
  if (ex.binary && view.value !== 'hex') return t('modules.api.binaryBody')
  if (largeBody.value) return view.value === 'hex' ? ex.hex || ex.body : ex.body
  if (view.value === 'hex') return ex.hex ? formatHexDumpFromHex(ex.hex) : formatHexDump(ex.body)
  if (view.value === 'pretty') return prettyJson(ex.body)
  return ex.body
})

const editorLang = computed(() => {
  if (props.exchange?.binary) return 'plaintext'
  if (largeBody.value) return 'plaintext'
  if (view.value === 'pretty') return 'json'
  return 'plaintext'
})
</script>

<template>
  <div class="nm-api-res">
    <div class="nm-api-res__status">
      <span v-if="!exchange" class="nm-api-res__title">{{ t('modules.api.responseTitle') }}</span>
      <RsTabs
        v-else
        v-model="view"
        class="nm-api-res__views"
        :items="items"
        size="sm"
        variant="line"
        panelless
        borderless
        content-gap="none"
      />
      <div class="nm-api-res__metrics">
        <template v-if="sending">
          <span class="nm-api-res__pulse" />
          <span class="nm-api-res__muted">{{ t('modules.api.sending') }}</span>
        </template>
        <template v-else-if="live || exchange">
          <span v-if="live" class="nm-api-res__pulse" />
          <span class="nm-api-res__code" :class="`nm-api-res__code--${tone}`">{{ statusLabel }}</span>
          <span v-if="exchange" class="nm-api-res__meta">{{ formatDuration(exchange.durationMs) }}</span>
          <span v-if="exchange" class="nm-api-res__meta">{{ formatBytes(exchange.sizeBytes) }}</span>
          <span v-if="exchange" class="nm-api-res__meta">{{ exchange.protocol }}</span>
        </template>
      </div>
    </div>

    <p v-if="redirectText" class="nm-api-res__hint">{{ redirectText }}</p>
    <p v-if="errorText" class="nm-api-res__error">{{ errorText }}</p>
    <ul v-if="exchange?.checks?.length" class="nm-api-res__checks">
      <li
        v-for="(check, index) in exchange.checks"
        :key="index"
        :class="check.ok ? 'nm-api-res__check--ok' : 'nm-api-res__check--bad'"
      >
        {{ t(`modules.api.checkKind.${check.kind}`) }} · {{ check.detail }}
      </li>
    </ul>
    <p v-if="exchange && largeBody" class="nm-api-res__hint">{{ t('modules.api.largePayload') }}</p>

    <RsEmpty
      v-if="!exchange && !sending && !live"
      fill
      :description="t('modules.api.emptyResponse')"
    />
    <RsCodeEditor
      v-else-if="exchange"
      :model-value="editorText"
      :language="editorLang"
      :theme="appStore.editorTheme"
      :show-toolbar="false"
      readonly
      embedded
      height="100%"
    />
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
  gap: var(--rs-space-sm);
  min-height: 2rem;
  padding-inline-end: var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-xs);
  flex-shrink: 0;
  overflow: hidden;
}

.nm-api-res__title {
  padding-inline-start: var(--rs-space-md);
  font-weight: var(--rs-font-weight-medium);
  color: var(--rs-muted);
}

.nm-api-res__views {
  flex: 1;
  min-width: 0;
}

.nm-api-res__metrics {
  display: flex;
  align-items: center;
  gap: var(--rs-space-md);
  margin-inline-start: auto;
  flex-shrink: 0;
  white-space: nowrap;
}

.nm-api-res__code {
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--rs-font-mono);
  font-weight: var(--rs-font-weight-semibold);
  padding: 0 var(--rs-space-xs);
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, currentColor 12%, transparent);
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

.nm-api-res__error {
  margin: 0;
  padding: var(--rs-space-xs) var(--rs-space-md);
  background: color-mix(in srgb, var(--rs-danger) 12%, transparent);
  color: var(--rs-danger);
  font-size: var(--rs-font-size-xs);
  line-height: var(--rs-line-height-normal);
  flex-shrink: 0;
}

.nm-api-res__checks {
  margin: 0;
  padding: var(--rs-space-xs) var(--rs-space-md);
  list-style: none;
  border-bottom: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-xs);
  flex-shrink: 0;
}

.nm-api-res__check--ok {
  color: var(--rs-success);
}

.nm-api-res__check--bad {
  color: var(--rs-danger);
}

.nm-api-res__hint {
  margin: 0;
  padding: var(--rs-space-xs) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  flex-shrink: 0;
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
