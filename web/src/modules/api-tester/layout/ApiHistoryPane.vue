<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDuration, statusTone } from '../utils/format'
import {
  formatHistoryClock,
  formatHistoryDateLabel,
  groupHistoryByDay,
  historyDayKind,
} from '../utils/history-groups'
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

const { t, locale } = useI18n()

const visible = computed(() => {
  const keyword = props.filter.trim().toLowerCase()
  if (!keyword) return props.items
  return props.items.filter((item) => {
    const hay = `${item.method} ${item.requestName} ${item.url} ${item.httpStatus ?? ''}`.toLowerCase()
    return hay.includes(keyword)
  })
})

const groups = computed(() => groupHistoryByDay(visible.value))

function dayLabel(day: string): string {
  const kind = historyDayKind(day)
  if (kind === 'today') return t('modules.api.historyToday')
  if (kind === 'yesterday') return t('modules.api.historyYesterday')
  return formatHistoryDateLabel(day, locale.value)
}
</script>

<template>
  <div class="nm-api-hist">
    <section v-for="group in groups" :key="group.day" class="nm-api-hist__group">
      <h3 class="nm-api-hist__day">{{ dayLabel(group.day) }}</h3>
      <button
        v-for="item in group.items"
        :key="item.historyId"
        type="button"
        class="nm-api-hist__row"
        @click="emit('open', item.historyId)"
        @contextmenu="emit('row-context', item.historyId)"
      >
        <span class="nm-api-hist__line">
          <ApiMethodBadge :method="item.method" compact />
          <span class="nm-api-hist__name">{{ item.requestName }}</span>
          <span
            class="nm-api-hist__status"
            :class="`nm-api-hist__status--${statusTone(item.httpStatus, item.exchange?.ok ?? item.httpStatus != null)}`"
          >
            {{ item.httpStatus ?? '—' }}
          </span>
        </span>
        <span class="nm-api-hist__line nm-api-hist__line--sub">
          <span class="nm-api-hist__url">{{ item.url }}</span>
          <span class="nm-api-hist__when">
            {{ formatHistoryClock(item.createdAt, locale) }}
            <template v-if="item.durationMs"> · {{ formatDuration(item.durationMs) }}</template>
          </span>
        </span>
      </button>
    </section>
    <p v-if="visible.length === 0" class="nm-api-hist__empty">{{ t('modules.api.historyEmpty') }}</p>
  </div>
</template>

<style scoped>
.nm-api-hist {
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.nm-api-hist__group + .nm-api-hist__group {
  margin-top: 0.15rem;
}

.nm-api-hist__day {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 0.4rem 0.45rem 0.2rem;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--rs-muted);
  background: var(--nm-sidebar-bg, var(--rs-bg));
}

.nm-api-hist__row {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  width: 100%;
  margin: 0;
  padding: 0.38rem 0.45rem;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.nm-api-hist__row:hover {
  background: color-mix(in srgb, var(--rs-text) 6%, transparent);
}

.nm-api-hist__line {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.nm-api-hist__line--sub {
  padding-left: 0.1rem;
}

.nm-api-hist__name,
.nm-api-hist__url {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-api-hist__name {
  flex: 1;
  font-size: var(--rs-font-size-sm);
  font-weight: 500;
}

.nm-api-hist__status {
  flex-shrink: 0;
  min-width: 1.75rem;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
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

.nm-api-hist__url {
  flex: 1;
  font-size: 11px;
  color: var(--rs-muted);
}

.nm-api-hist__when {
  flex-shrink: 0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--rs-muted);
}

.nm-api-hist__empty {
  margin: 1.5rem 0.75rem;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
  text-align: center;
}
</style>
