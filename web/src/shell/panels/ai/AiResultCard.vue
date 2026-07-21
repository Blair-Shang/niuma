<script setup lang="ts">
/**
 * 结构化查询/诊断结果卡（围栏 ```result / ```query-result）。
 */
import { computed } from 'vue'
import { RsIcon } from '@niuma/ui'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  source: string
}>()

const { t } = useI18n()

type ResultPayload = {
  title?: string
  kind?: string
  columns?: string[]
  rows?: unknown[][]
  summary?: string
  error?: string
}

const parsed = computed((): ResultPayload | null => {
  try {
    const v = JSON.parse(props.source.trim()) as ResultPayload
    if (v && typeof v === 'object') {
      return v
    }
  } catch {
    // fallthrough
  }
  return null
})

const title = computed(() => parsed.value?.title || parsed.value?.kind || t('ai.resultBlock'))
const previewRows = computed(() => (parsed.value?.rows ?? []).slice(0, 8))
</script>

<template>
  <div class="nm-ai-result" :class="{ 'nm-ai-result--error': parsed?.error }">
    <div class="nm-ai-result__head">
      <RsIcon :name="parsed?.error ? 'circle-alert' : 'table'" :size="13" />
      <span>{{ title }}</span>
    </div>
    <p v-if="parsed?.summary || parsed?.error" class="nm-ai-result__summary">
      {{ parsed?.error || parsed?.summary }}
    </p>
    <div v-if="parsed?.columns?.length" class="nm-ai-result__table-wrap">
      <table>
        <thead>
          <tr>
            <th v-for="c in parsed.columns" :key="c">{{ c }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in previewRows" :key="ri">
            <td v-for="(cell, ci) in row" :key="ci">{{ cell == null ? '∅' : String(cell) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <pre v-else class="nm-ai-result__raw">{{ source }}</pre>
    <div v-if="(parsed?.rows?.length ?? 0) > 8" class="nm-ai-result__more">
      {{ t('ai.resultTruncated', { n: parsed!.rows!.length - 8 }) }}
    </div>
  </div>
</template>

<style scoped>
.nm-ai-result {
  margin: 0.65em 0;
  border-radius: 10px;
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--nm-elevated-bg) 75%, transparent);
  overflow: hidden;
}

.nm-ai-result--error {
  border-color: color-mix(in srgb, var(--rs-danger) 30%, var(--rs-border-subtle));
}

.nm-ai-result__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 12.5px;
  font-weight: 600;
  border-bottom: 1px solid var(--rs-border-subtle);
  color: var(--rs-text);
}

.nm-ai-result__summary {
  margin: 8px 10px 0;
  font-size: 12px;
  color: var(--rs-muted);
}

.nm-ai-result__table-wrap {
  overflow: auto;
  max-height: 14rem;
  margin: 8px;
}

.nm-ai-result table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
}

.nm-ai-result th,
.nm-ai-result td {
  padding: 5px 8px;
  border: 1px solid var(--rs-border-subtle);
  text-align: left;
  white-space: nowrap;
}

.nm-ai-result th {
  background: color-mix(in srgb, var(--rs-text) 5%, transparent);
  font-weight: 600;
}

.nm-ai-result__raw {
  margin: 8px 10px 10px;
  max-height: 10rem;
  overflow: auto;
  font-size: 11px;
  white-space: pre-wrap;
  color: var(--rs-muted);
}

.nm-ai-result__more {
  padding: 0 10px 8px;
  font-size: 11px;
  color: var(--rs-muted);
}
</style>
