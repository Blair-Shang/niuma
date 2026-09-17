<script setup lang="ts">
import { RsCard, RsEmpty, RsIcon, RsLoading, RsTable, useRsToast } from '@niuma/ui'
import type { RsTableColumn } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { redisApi } from '@/api'
import SqlIdeToolbar from '@/modules/database/components/SqlIdeToolbar.vue'
import type { SqlIdeToolbarItem } from '@/modules/database/types/sql-ide-toolbar'

const props = defineProps<{
  sessionId: string | null
  active: boolean
}>()

interface SlowlogRow extends Record<string, unknown> {
  id: number
  timestamp: number
  durationUs: number
  command: string
  clientAddr: string
  clientName: string
}

type DurationTone = 'normal' | 'warn' | 'danger'

const { t } = useI18n()
const toast = useRsToast()

const count = ref('20')
const loading = ref(false)
const loaded = ref(false)
const rows = ref<SlowlogRow[]>([])

const columns = computed((): RsTableColumn<SlowlogRow>[] => [
  { key: 'id', title: 'ID', width: 90, align: 'right' },
  { key: 'time', title: t('modules.redis.slowlog.columns.time'), width: 170 },
  { key: 'duration', title: t('modules.redis.slowlog.columns.duration'), width: 110, align: 'right' },
  { key: 'command', title: t('modules.redis.slowlog.columns.command'), ellipsis: true, minWidth: 260 },
  { key: 'clientAddr', title: t('modules.redis.slowlog.columns.client'), width: 160 },
])

const entryCountLabel = computed(() => t('modules.redis.slowlog.entryCount', { count: rows.value.length }))

const countOptions = [
  { value: '10', label: '10' },
  { value: '20', label: '20' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
]

const toolbarItems = computed((): SqlIdeToolbarItem[] => [
  {
    key: 'count',
    kind: 'select',
    value: count.value,
    options: countOptions,
    title: t('modules.redis.slowlog.tooltips.count'),
    disabled: !props.sessionId,
  },
  {
    key: 'refresh',
    icon: 'refresh-cw',
    title: t('modules.redis.slowlog.refresh'),
    loading: loading.value,
    disabled: !props.sessionId,
    align: 'trail',
  },
])

function onToolbarAction(key: string): void {
  if (key === 'refresh') void load()
}

function onToolbarSelect(itemKey: string, value: string): void {
  if (itemKey === 'count' && value) {
    count.value = value
    void load()
  }
}

function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString()
}

function formatDuration(us: number): string {
  if (us >= 1000) {
    return `${(us / 1000).toFixed(2)}ms`
  }
  return `${us}μs`
}

function durationTone(us: number): DurationTone {
  if (us >= 10_000) {
    return 'danger'
  }
  if (us >= 1_000) {
    return 'warn'
  }
  return 'normal'
}

async function load(): Promise<void> {
  if (!props.sessionId || loading.value) {
    return
  }
  loading.value = true
  try {
    const parsed = Number.parseInt(count.value, 10)
    const result = await redisApi.monitorSlowlog({
      sessionId: props.sessionId,
      count: Number.isFinite(parsed) && parsed > 0 ? parsed : 20,
    })
    rows.value = result.entries.map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      durationUs: entry.durationUs,
      command: entry.command.join(' '),
      clientAddr: entry.clientAddr,
      clientName: entry.clientName,
    }))
    loaded.value = true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.redis.slowlog.loadError'))
  } finally {
    loading.value = false
  }
}

watch(
  () => props.active,
  (active) => {
    if (active && !loaded.value) {
      void load()
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="nm-redis-slowlog">
    <SqlIdeToolbar
      :label="t('modules.redis.slowlog.toolbarAria')"
      identity-icon="hourglass"
      :identity="t('modules.redis.slowlog.title')"
      :identity-title="loaded ? entryCountLabel : t('modules.redis.slowlog.tooltips.hint')"
      :items="toolbarItems"
      @action="onToolbarAction"
      @select="onToolbarSelect"
    />
    <div class="nm-redis-slowlog__main">
      <div class="nm-redis-slowlog__card-wrap">
        <RsCard variant="plain" :padding="false" radius="none" class="nm-redis-slowlog__card">
          <template #header>
            <div class="nm-redis-slowlog__card-head">
              <span class="nm-redis-slowlog__card-icon" aria-hidden="true">
                <RsIcon name="hourglass" :size="14" />
              </span>
              <h3 class="nm-redis-slowlog__card-title">{{ t('modules.redis.slowlog.title') }}</h3>
            </div>
          </template>

          <div class="nm-redis-slowlog__body">
            <RsLoading
              v-if="loading && rows.length === 0"
              class="nm-redis-slowlog__loading"
              show-label
              :label="t('modules.redis.slowlog.loading')"
            />
            <RsTable v-else :columns="columns" :data="rows" row-key="id" size="sm" striped :bordered="false">
              <template #empty>
                <RsEmpty :description="t('modules.redis.slowlog.empty')" />
              </template>
              <template #id="{ row }">
                <span class="nm-redis-slowlog__id">#{{ row.id }}</span>
              </template>
              <template #time="{ row }">
                <span class="nm-redis-slowlog__time">{{ formatTime(row.timestamp as number) }}</span>
              </template>
              <template #duration="{ row }">
                <span
                  class="nm-redis-slowlog__duration"
                  :class="`nm-redis-slowlog__duration--${durationTone(row.durationUs as number)}`"
                >
                  {{ formatDuration(row.durationUs as number) }}
                </span>
              </template>
              <template #command="{ row }">
                <code class="nm-redis-slowlog__command">{{ row.command }}</code>
              </template>
              <template #clientAddr="{ row }">
                <div class="nm-redis-slowlog__client">
                  <span class="nm-redis-slowlog__client-addr">{{ row.clientAddr || '-' }}</span>
                  <span v-if="row.clientName" class="nm-redis-slowlog__client-name">{{ row.clientName }}</span>
                </div>
              </template>
            </RsTable>
          </div>
        </RsCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nm-redis-slowlog {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-redis-slowlog__main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-redis-slowlog__card-wrap {
  --nm-slowlog-accent: var(--rs-warning);
  --nm-slowlog-accent-bg: color-mix(in srgb, var(--nm-slowlog-accent) 14%, transparent);
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: none;
  border-radius: 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--nm-slowlog-accent) 7%, var(--rs-surface-elevated));
}

.nm-redis-slowlog__card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: none;
  box-shadow: none;
  background: transparent;
  border-radius: 0;
}

.nm-redis-slowlog__card-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  min-width: 0;
}

.nm-redis-slowlog__card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.625rem;
  height: 1.625rem;
  border-radius: var(--rs-radius-full);
  background: var(--nm-slowlog-accent-bg);
  color: var(--nm-slowlog-accent);
  flex-shrink: 0;
}

.nm-redis-slowlog__card-title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--nm-slowlog-accent);
}

.nm-redis-slowlog__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.nm-redis-slowlog__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 12rem;
  padding: var(--rs-space-xl);
}

.nm-redis-slowlog__id {
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
}

.nm-redis-slowlog__time {
  font-variant-numeric: tabular-nums;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-text);
}

.nm-redis-slowlog__duration {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 3.5rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--rs-muted) 12%, transparent);
  color: var(--rs-muted);
}

.nm-redis-slowlog__duration--warn {
  background: color-mix(in srgb, var(--rs-warning) 18%, transparent);
  color: color-mix(in srgb, var(--rs-warning) 85%, #000 15%);
}

.nm-redis-slowlog__duration--danger {
  background: color-mix(in srgb, var(--rs-danger) 16%, transparent);
  color: var(--rs-danger);
}

.nm-redis-slowlog__command {
  display: inline-block;
  max-width: 100%;
  padding: 0.1rem 0.35rem;
  border-radius: var(--rs-radius-xs);
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-text);
  background: color-mix(in srgb, var(--rs-primary) 10%, var(--rs-surface-subtle));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-redis-slowlog__client {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  font-size: var(--rs-font-size-xs);
}

.nm-redis-slowlog__client-addr {
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  color: var(--rs-text);
}

.nm-redis-slowlog__client-name {
  color: var(--rs-muted);
}
</style>
