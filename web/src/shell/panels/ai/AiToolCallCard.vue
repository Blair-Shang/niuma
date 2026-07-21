<script setup lang="ts">
/**
 * 工具调用过程卡：running / ok / error / pending，可展开参数与结果；pending 可 Approve/Reject。
 */
import { computed, ref, watch } from 'vue'
import { RsButton, RsIcon } from '@niuma/ui'
import { useI18n } from 'vue-i18n'

export type AiToolStatus = 'running' | 'ok' | 'error' | 'pending'

const props = withDefaults(
  defineProps<{
    name?: string
    status?: AiToolStatus
    argsSummary?: string
    resultSummary?: string
    error?: string
    source?: string
    risk?: string
    /** 为 true 时展示 Approve/Reject（直播工具卡）。 */
    confirmable?: boolean
  }>(),
  {
    name: '',
    status: 'ok',
    argsSummary: '',
    resultSummary: '',
    error: '',
    source: '',
    risk: '',
    confirmable: false,
  },
)

const emit = defineEmits<{
  approve: []
  reject: []
}>()

const { t } = useI18n()
const open = ref(
  props.status === 'error' || props.status === 'running' || props.status === 'pending',
)
const deciding = ref(false)

watch(
  () => props.status,
  (s) => {
    if (s === 'pending' || s === 'error' || s === 'running') {
      open.value = true
    }
    if (s !== 'pending') {
      deciding.value = false
    }
  },
)

const parsed = computed(() => {
  if (!props.source?.trim()) {
    return null
  }
  try {
    return JSON.parse(props.source) as {
      name?: string
      tool?: string
      status?: AiToolStatus
      args?: unknown
      argsSummary?: string
      result?: unknown
      resultSummary?: string
      error?: string
    }
  } catch {
    return null
  }
})

const displayName = computed(
  () => props.name || parsed.value?.name || parsed.value?.tool || t('ai.toolCall'),
)
const displayStatus = computed((): AiToolStatus => {
  return props.status || parsed.value?.status || 'ok'
})
const argsText = computed(() => {
  if (props.argsSummary) {
    return props.argsSummary
  }
  if (parsed.value?.argsSummary) {
    return parsed.value.argsSummary
  }
  if (parsed.value?.args != null) {
    return JSON.stringify(parsed.value.args, null, 2)
  }
  return props.source && !parsed.value ? props.source : ''
})
const resultText = computed(() => {
  if (props.error || parsed.value?.error) {
    return props.error || parsed.value?.error || ''
  }
  if (props.resultSummary) {
    return props.resultSummary
  }
  if (parsed.value?.resultSummary) {
    return parsed.value.resultSummary
  }
  if (parsed.value?.result != null) {
    return JSON.stringify(parsed.value.result, null, 2)
  }
  return ''
})

const statusLabel = computed(() => {
  const s = displayStatus.value
  if (s === 'running') return t('ai.toolRunning')
  if (s === 'error') return t('ai.toolFailed')
  if (s === 'pending') return t('ai.toolPending')
  return t('ai.toolOk')
})

const riskLabel = computed(() => {
  const r = (props.risk || '').toLowerCase()
  if (r === 'write') return t('ai.toolRiskWrite')
  if (r === 'dangerous') return t('ai.toolRiskDangerous')
  if (r === 'read') return t('ai.toolRiskRead')
  return ''
})

const showConfirm = computed(
  () => props.confirmable && displayStatus.value === 'pending',
)

async function onApprove(): Promise<void> {
  deciding.value = true
  emit('approve')
}

async function onReject(): Promise<void> {
  deciding.value = true
  emit('reject')
}
</script>

<template>
  <div class="nm-ai-tool" :class="`nm-ai-tool--${displayStatus}`">
    <button type="button" class="nm-ai-tool__head" @click="open = !open">
      <span class="nm-ai-tool__icon" aria-hidden="true">
        <RsIcon
          :name="
            displayStatus === 'running'
              ? 'loader-circle'
              : displayStatus === 'error'
                ? 'circle-alert'
                : displayStatus === 'pending'
                  ? 'circle-alert'
                  : 'wrench'
          "
          :size="13"
          :class="{ 'is-spin': displayStatus === 'running' }"
        />
      </span>
      <span class="nm-ai-tool__title">{{ displayName }}</span>
      <span v-if="riskLabel" class="nm-ai-tool__risk">{{ riskLabel }}</span>
      <span class="nm-ai-tool__status">{{ statusLabel }}</span>
      <RsIcon :name="open ? 'chevron-down' : 'chevron-right'" :size="12" class="nm-ai-tool__chev" />
    </button>
    <div v-if="open" class="nm-ai-tool__body">
      <div v-if="argsText" class="nm-ai-tool__section">
        <div class="nm-ai-tool__label">{{ t('ai.toolArgs') }}</div>
        <pre>{{ argsText }}</pre>
      </div>
      <div v-if="resultText" class="nm-ai-tool__section">
        <div class="nm-ai-tool__label">
          {{ displayStatus === 'error' ? t('ai.toolError') : t('ai.toolResult') }}
        </div>
        <pre>{{ resultText }}</pre>
      </div>
      <div v-if="showConfirm" class="nm-ai-tool__actions">
        <p class="nm-ai-tool__hint">{{ t('ai.toolConfirmHint') }}</p>
        <div class="nm-ai-tool__btns">
          <RsButton size="sm" variant="primary" :loading="deciding" @click.stop="onApprove">
            {{ t('ai.toolApprove') }}
          </RsButton>
          <RsButton size="sm" variant="ghost" :disabled="deciding" @click.stop="onReject">
            {{ t('ai.toolReject') }}
          </RsButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nm-ai-tool {
  margin: 0.65em 0;
  border-radius: 10px;
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 3%, transparent);
  overflow: hidden;
}

.nm-ai-tool--running {
  border-color: color-mix(in srgb, var(--nm-aurora-a) 35%, var(--rs-border-subtle));
}

.nm-ai-tool--error {
  border-color: color-mix(in srgb, var(--rs-danger) 35%, var(--rs-border-subtle));
}

.nm-ai-tool--pending {
  border-color: color-mix(in srgb, var(--rs-warning, #d97706) 40%, var(--rs-border-subtle));
}

.nm-ai-tool__head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: var(--rs-text);
  cursor: pointer;
  text-align: left;
}

.nm-ai-tool__icon {
  display: inline-flex;
  color: var(--rs-muted);
}

.nm-ai-tool--running .nm-ai-tool__icon {
  color: color-mix(in srgb, var(--nm-aurora-a) 80%, var(--rs-text));
}

.nm-ai-tool--error .nm-ai-tool__icon {
  color: var(--rs-danger);
}

.nm-ai-tool--pending .nm-ai-tool__icon {
  color: var(--rs-warning, #d97706);
}

.nm-ai-tool__risk {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rs-warning, #d97706);
}

.nm-ai-tool__icon :deep(.is-spin) {
  animation: nm-ai-tool-spin 0.9s linear infinite;
}

@keyframes nm-ai-tool-spin {
  to {
    transform: rotate(360deg);
  }
}

.nm-ai-tool__title {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-ai-tool__status {
  font-size: 11px;
  color: var(--rs-muted);
}

.nm-ai-tool__chev {
  color: var(--rs-muted);
}

.nm-ai-tool__body {
  padding: 0 10px 10px;
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-ai-tool__section {
  margin-top: 8px;
}

.nm-ai-tool__label {
  font-size: 11px;
  font-weight: 500;
  color: var(--rs-muted);
  margin-bottom: 4px;
}

.nm-ai-tool__body pre {
  margin: 0;
  max-height: 10rem;
  overflow: auto;
  padding: 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--rs-text) 5%, transparent);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  color: var(--rs-text);
}

.nm-ai-tool__actions {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nm-ai-tool__hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--rs-muted);
}

.nm-ai-tool__btns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
