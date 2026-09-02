<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDuration, statusTone } from '../utils/format'
import type { ApiHistoryItem } from '../types'
import ApiMethodBadge from './ApiMethodBadge.vue'

const props = defineProps<{
  items: ApiHistoryItem[]
  filter: string
}>()

const emit = defineEmits<{
  open: [historyId: string]
  'row-context': [historyId: string]
}>()

const { t } = useI18n()

const visible = computed(() => {
  const keyword = props.filter.trim().toLowerCase()
  if (!keyword) return props.items
  return props.items.filter((item) => {
    const hay = `${item.method} ${item.requestName} ${item.url} ${item.httpStatus ?? ''}`.toLowerCase()
    return hay.includes(keyword)
  })
})

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}
</script>

<template>
  <div class="nm-api-hist">
    <button
      v-for="item in visible"
      :key="item.historyId"
      type="button"
      class="nm-api-hist__row"
      @click="emit('open', item.historyId)"
      @contextmenu="emit('row-context', item.historyId)"
    >
      <span class="nm-api-hist__top">
        <ApiMethodBadge :method="item.method" compact />
        <span class="nm-api-hist__name">{{ item.requestName }}</span>
        <span
          class="nm-api-hist__status"
          :class="`nm-api-hist__status--${statusTone(item.httpStatus, item.exchange?.ok ?? item.httpStatus != null)}`"
        >
          {{ item.httpStatus ?? '—' }}
        </span>
      </span>
      <span class="nm-api-hist__url">{{ item.url }}</span>
      <span class="nm-api-hist__meta">
        {{ formatWhen(item.createdAt) }}
        <template v-if="item.durationMs"> · {{ formatDuration(item.durationMs) }}</template>
        <template v-if="item.environmentName"> · {{ item.environmentName }}</template>
      </span>
    </button>
    <p v-if="visible.length === 0" class="nm-api-hist__empty">{{ t('modules.api.historyEmpty') }}</p>
  </div>
</template>

<style scoped>
.nm-api-hist {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.nm-api-hist__row {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  width: 100%;
  padding: 0.4rem 0.45rem;
  border: 0;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.nm-api-hist__row:hover {
  background: var(--rs-fill-hover);
}

.nm-api-hist__top {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.nm-api-hist__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--rs-font-size-sm);
}

.nm-api-hist__status {
  flex-shrink: 0;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.nm-api-hist__status--success {
  color: var(--rs-success);
}

.nm-api-hist__status--warning {
  color: var(--rs-warning);
}

.nm-api-hist__status--danger,
.nm-api-hist__status--muted {
  color: var(--rs-danger);
}

.nm-api-hist__url,
.nm-api-hist__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--rs-text-muted);
}

.nm-api-hist__empty {
  margin: 1.5rem 0.75rem;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text-muted);
  text-align: center;
}
</style>
