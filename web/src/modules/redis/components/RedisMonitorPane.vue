<script setup lang="ts">
import { RsCard, RsEmpty, RsIcon, RsLoading, RsTooltip, RsTooltipProvider } from '@niuma/ui'
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RedisMonitorMetricsResult } from '@/api/types/redis'
import SqlIdeToolbar from '@/modules/database/components/SqlIdeToolbar.vue'
import type { SqlIdeToolbarItem } from '@/modules/database/types/sql-ide-toolbar'
import { useRedisMonitor } from '@/modules/redis/composables/useRedisMonitor'
import { formatBytes, formatUptime } from '@/modules/redis/utils/format'

const props = defineProps<{
  sessionId: string | null
  active: boolean
}>()

interface MonitorRow {
  label: string
  tooltip: string
  value: string
  placeholder?: boolean
}

type MonitorAccent = 'server' | 'clients' | 'memory' | 'throughput' | 'hits' | 'replication'

interface MonitorCard {
  title: string
  icon: string
  accent: MonitorAccent
  rows: MonitorRow[]
}

const { t } = useI18n()
const { metrics, loading, error, collectedAt, autoInterval, refresh, setAutoInterval } = useRedisMonitor(
  () => props.sessionId,
)

const autoOptions = [0, 2, 5, 10, 30] as const

const collectedAtLabel = computed(() => (collectedAt.value ? collectedAt.value.toLocaleTimeString() : '--'))

const toolbarItems = computed((): SqlIdeToolbarItem[] => [
  {
    key: 'refresh',
    icon: 'refresh-cw',
    title: t('modules.redis.monitor.refresh'),
    loading: loading.value,
    disabled: !props.sessionId,
  },
  {
    key: 'auto',
    kind: 'modes',
    align: 'trail',
    label: t('modules.redis.monitor.toolbarAria'),
    value: String(autoInterval.value),
    options: autoOptions.map((opt) => ({
      key: String(opt),
      label: opt === 0 ? t('modules.redis.monitor.autoOff') : `${opt}s`,
    })),
  },
])

function onToolbarAction(key: string): void {
  if (key === 'refresh') void refresh()
}

function onToolbarMode(itemKey: string, value: string): void {
  if (itemKey === 'auto') setAutoInterval(Number.parseInt(value, 10) || 0)
}

function tip(key: string): string {
  return t(`modules.redis.monitor.tooltips.${key}`)
}

function buildCards(m: RedisMonitorMetricsResult): MonitorCard[] {
  const memPct = m.maxMemory > 0 ? Math.min(100, (m.usedMemory / m.maxMemory) * 100) : null
  const cards: MonitorCard[] = [
    {
      title: t('modules.redis.monitor.server'),
      icon: 'server',
      accent: 'server',
      rows: [
        { label: t('modules.redis.monitor.version'), tooltip: tip('version'), value: m.redisVersion || '-' },
        { label: t('modules.redis.monitor.role'), tooltip: tip('role'), value: m.role || '-' },
        { label: t('modules.redis.monitor.uptime'), tooltip: tip('uptime'), value: formatUptime(m.uptimeSeconds) },
      ],
    },
    {
      title: t('modules.redis.monitor.clients'),
      icon: 'users',
      accent: 'clients',
      rows: [
        { label: t('modules.redis.monitor.connectedClients'), tooltip: tip('connectedClients'), value: String(m.connectedClients) },
        { label: t('modules.redis.monitor.blockedClients'), tooltip: tip('blockedClients'), value: String(m.blockedClients) },
        { label: t('modules.redis.monitor.connectedSlaves'), tooltip: tip('connectedSlaves'), value: String(m.connectedSlaves) },
      ],
    },
    {
      title: t('modules.redis.monitor.memory'),
      icon: 'memory-stick',
      accent: 'memory',
      rows: [
        { label: t('modules.redis.monitor.used'), tooltip: tip('used'), value: m.usedMemoryHuman || formatBytes(m.usedMemory) },
        { label: t('modules.redis.monitor.peak'), tooltip: tip('peak'), value: formatBytes(m.usedMemoryPeak) },
        { label: t('modules.redis.monitor.rss'), tooltip: tip('rss'), value: formatBytes(m.usedMemoryRss) },
        { label: t('modules.redis.monitor.fragRatio'), tooltip: tip('fragRatio'), value: m.memFragmentationRatio.toFixed(2) },
        ...(memPct !== null
          ? [{
              label: t('modules.redis.monitor.maxMemory'),
              tooltip: tip('maxMemory'),
              value: `${formatBytes(m.maxMemory)} (${memPct.toFixed(1)}%)`,
            }]
          : []),
        { label: t('modules.redis.monitor.policy'), tooltip: tip('policy'), value: m.maxMemoryPolicy || '-' },
      ],
    },
    {
      title: t('modules.redis.monitor.throughput'),
      icon: 'activity',
      accent: 'throughput',
      rows: [
        { label: t('modules.redis.monitor.opsPerSec'), tooltip: tip('opsPerSec'), value: String(m.instantaneousOpsPerSec) },
        { label: t('modules.redis.monitor.commandsProcessed'), tooltip: tip('commandsProcessed'), value: String(m.totalCommandsProcessed) },
        { label: t('modules.redis.monitor.connectionsReceived'), tooltip: tip('connectionsReceived'), value: String(m.totalConnectionsReceived) },
        { label: t('modules.redis.monitor.rejectedConnections'), tooltip: tip('rejectedConnections'), value: String(m.rejectedConnections) },
        { label: t('modules.redis.monitor.netIn'), tooltip: tip('netIn'), value: formatBytes(m.totalNetInputBytes) },
        { label: t('modules.redis.monitor.netOut'), tooltip: tip('netOut'), value: formatBytes(m.totalNetOutputBytes) },
      ],
    },
    {
      title: t('modules.redis.monitor.keyspaceHits'),
      icon: 'target',
      accent: 'hits',
      rows: [
        { label: t('modules.redis.monitor.hits'), tooltip: tip('hits'), value: String(m.keyspaceHits) },
        { label: t('modules.redis.monitor.misses'), tooltip: tip('misses'), value: String(m.keyspaceMisses) },
        { label: t('modules.redis.monitor.hitRate'), tooltip: tip('hitRate'), value: `${(m.keyspaceHitRate * 100).toFixed(1)}%` },
        { label: t('modules.redis.monitor.expiredKeys'), tooltip: tip('expiredKeys'), value: String(m.expiredKeys) },
        { label: t('modules.redis.monitor.evictedKeys'), tooltip: tip('evictedKeys'), value: String(m.evictedKeys) },
      ],
    },
    {
      title: t('modules.redis.monitor.replication'),
      icon: 'cpu',
      accent: 'replication',
      rows: [
        { label: t('modules.redis.monitor.masterReplOffset'), tooltip: tip('masterReplOffset'), value: String(m.masterReplOffset) },
        { label: t('modules.redis.monitor.latestFork'), tooltip: tip('latestFork'), value: `${m.latestForkUsec}μs` },
        { label: t('modules.redis.monitor.cpuSys'), tooltip: tip('cpuSys'), value: m.usedCpuSys.toFixed(2) },
        { label: t('modules.redis.monitor.cpuUser'), tooltip: tip('cpuUser'), value: m.usedCpuUser.toFixed(2) },
      ],
    },
  ]
  return cards
}

const metricCards = computed(() => {
  if (!metrics.value) {
    return []
  }
  const cards = buildCards(metrics.value)
  const maxRows = Math.max(...cards.map((card) => card.rows.length))
  return cards.map((card) => ({
    ...card,
    rows: [
      ...card.rows,
      ...Array.from({ length: maxRows - card.rows.length }, () => ({
        label: '\u00a0',
        tooltip: '',
        value: '\u00a0',
        placeholder: true,
      })),
    ],
  }))
})

const keyspaceHeaders = computed(() => [
  { label: 'DB', tooltip: '' },
  { label: t('modules.redis.monitor.keys'), tooltip: tip('keys') },
  { label: t('modules.redis.monitor.expires'), tooltip: tip('expires') },
  { label: t('modules.redis.monitor.avgTtl'), tooltip: tip('avgTtl') },
])

watch(
  () => props.active,
  (active) => {
    if (active) {
      if (!metrics.value) {
        void refresh()
      }
      setAutoInterval(autoInterval.value || 5)
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="nm-redis-monitor">
    <SqlIdeToolbar
      :label="t('modules.redis.monitor.toolbarAria')"
      identity-icon="activity"
      :identity="t('modules.redis.session.tabMonitor')"
      :identity-title="t('modules.redis.monitor.updatedAt', { time: collectedAtLabel })"
      :items="toolbarItems"
      @action="onToolbarAction"
      @mode="onToolbarMode"
    />
    <RsTooltipProvider class="nm-redis-monitor__main">
      <div class="nm-redis-monitor__body">
      <p v-if="error" class="nm-redis-monitor__error" role="alert">{{ error }}</p>

      <RsLoading v-if="loading && !metrics" class="nm-redis-monitor__placeholder" show-label :label="t('modules.redis.monitor.loading')" />
      <RsEmpty v-else-if="!metrics" :description="t('modules.redis.monitor.empty')" />

      <div v-else class="nm-redis-monitor__content">
        <div class="nm-redis-monitor__grid">
          <div
            v-for="card in metricCards"
            :key="card.title"
            class="nm-redis-monitor__card-wrap"
            :class="`nm-redis-monitor__card-wrap--${card.accent}`"
          >
            <RsCard variant="plain" :padding="false" radius="md" class="nm-redis-monitor__card">
              <template #header>
                <div class="nm-redis-monitor__card-head">
                  <span class="nm-redis-monitor__card-icon" aria-hidden="true">
                    <RsIcon :name="card.icon" :size="14" />
                  </span>
                  <h3 class="nm-redis-monitor__card-title">{{ card.title }}</h3>
                </div>
              </template>
              <dl class="nm-redis-monitor__kv">
                <div
                  v-for="(row, rowIdx) in card.rows"
                  :key="row.placeholder ? `${card.title}-pad-${rowIdx}` : row.label"
                  class="nm-redis-monitor__kv-row"
                  :class="{ 'nm-redis-monitor__kv-row--placeholder': row.placeholder }"
                >
                  <dt>
                    <RsTooltip v-if="!row.placeholder" :content="row.tooltip" side="top" align="start">
                      <span class="nm-redis-monitor__label">{{ row.label }}</span>
                    </RsTooltip>
                    <span v-else class="nm-redis-monitor__label">{{ row.label }}</span>
                  </dt>
                  <dd :title="row.placeholder ? undefined : row.value">{{ row.value }}</dd>
                </div>
              </dl>
            </RsCard>
          </div>
        </div>

        <div class="nm-redis-monitor__card-wrap nm-redis-monitor__card-wrap--keyspace">
          <RsCard variant="plain" :padding="false" radius="md" class="nm-redis-monitor__card">
            <template #header>
              <div class="nm-redis-monitor__card-head">
                <span class="nm-redis-monitor__card-icon" aria-hidden="true">
                  <RsIcon name="database" :size="14" />
                </span>
                <h3 class="nm-redis-monitor__card-title">{{ t('modules.redis.monitor.keyspace') }}</h3>
              </div>
            </template>
            <RsEmpty v-if="metrics.keyspace.length === 0" :description="t('modules.redis.monitor.keyspaceEmpty')" />
            <table v-else class="nm-redis-monitor__table">
            <thead>
              <tr>
                <th v-for="header in keyspaceHeaders" :key="header.label">
                  <RsTooltip v-if="header.tooltip" :content="header.tooltip" side="top" align="start">
                    <span class="nm-redis-monitor__label">{{ header.label }}</span>
                  </RsTooltip>
                  <template v-else>{{ header.label }}</template>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="db in metrics.keyspace" :key="db.db">
                <td><span class="nm-redis-monitor__db-badge">db{{ db.db }}</span></td>
                <td>{{ db.keys }}</td>
                <td>{{ db.expires }}</td>
                <td>{{ db.avgTtlMs }}ms</td>
              </tr>
            </tbody>
          </table>
          </RsCard>
        </div>
      </div>
      </div>
    </RsTooltipProvider>
  </div>
</template>

<style scoped>
.nm-redis-monitor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-redis-monitor__main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-redis-monitor__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--rs-space-sm);
}

.nm-redis-monitor__error {
  margin: 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-redis-monitor__placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-redis-monitor__content {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
}

.nm-redis-monitor__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: var(--rs-space-sm);
  align-items: stretch;
}

.nm-redis-monitor__card-wrap {
  --nm-monitor-accent: var(--rs-primary);
  --nm-monitor-accent-bg: color-mix(in srgb, var(--nm-monitor-accent) 14%, transparent);
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid color-mix(in srgb, var(--nm-monitor-accent) 20%, var(--rs-border-subtle));
  border-radius: var(--rs-radius);
  overflow: hidden;
  background: color-mix(in srgb, var(--nm-monitor-accent) 7%, var(--rs-surface-elevated));
}

.nm-redis-monitor__card {
  flex: 1;
  min-height: 100%;
  border: none;
  box-shadow: none;
  background: transparent;
}

.nm-redis-monitor__card-wrap::before {
  content: '';
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
  height: 1px;
  background: linear-gradient(
    90deg,
    var(--nm-monitor-accent),
    color-mix(in srgb, var(--nm-monitor-accent) 55%, transparent)
  );
  pointer-events: none;
}

.nm-redis-monitor__card-wrap--server {
  --nm-monitor-accent: var(--rs-info);
}

.nm-redis-monitor__card-wrap--clients {
  --nm-monitor-accent: var(--rs-primary);
}

.nm-redis-monitor__card-wrap--memory {
  --nm-monitor-accent: #a855f7;
}

.nm-redis-monitor__card-wrap--throughput {
  --nm-monitor-accent: var(--rs-success);
}

.nm-redis-monitor__card-wrap--hits {
  --nm-monitor-accent: #06b6d4;
}

.nm-redis-monitor__card-wrap--replication {
  --nm-monitor-accent: var(--rs-warning);
}

.nm-redis-monitor__card-wrap--keyspace {
  --nm-monitor-accent: #ec4899;
}

.nm-redis-monitor__card-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  min-width: 0;
}

.nm-redis-monitor__card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.625rem;
  height: 1.625rem;
  border-radius: var(--rs-radius-full);
  background: var(--nm-monitor-accent-bg);
  color: var(--nm-monitor-accent);
  flex-shrink: 0;
}

.nm-redis-monitor__card-title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--nm-monitor-accent);
}

.nm-redis-monitor__kv {
  margin: 0;
  padding: var(--rs-space-sm) var(--rs-space-md) var(--rs-space-md);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.nm-redis-monitor__kv-row {
  display: flex;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  font-size: var(--rs-font-size-sm);
  border-radius: var(--rs-radius-xs);
  padding: 0.1rem 0.25rem;
  margin-inline: -0.25rem;
  min-height: 1.375rem;
  transition: background var(--rs-transition-fast);
}

.nm-redis-monitor__kv-row:hover {
  background: color-mix(in srgb, var(--nm-monitor-accent) 10%, transparent);
}

.nm-redis-monitor__kv-row--placeholder {
  visibility: hidden;
  pointer-events: none;
}

.nm-redis-monitor__label {
  color: color-mix(in srgb, var(--nm-monitor-accent) 55%, var(--rs-muted));
  border-bottom: 1px dashed color-mix(in srgb, var(--nm-monitor-accent) 35%, transparent);
  cursor: help;
}

.nm-redis-monitor__kv dt {
  min-width: 0;
}

.nm-redis-monitor__kv dd {
  margin: 0;
  font-weight: 600;
  color: var(--rs-text);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.nm-redis-monitor__db-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  background: color-mix(in srgb, var(--nm-monitor-accent) 16%, transparent);
  color: var(--nm-monitor-accent);
}

.nm-redis-monitor__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--rs-font-size-sm);
}

.nm-redis-monitor__table th,
.nm-redis-monitor__table td {
  padding: 0.45rem var(--rs-space-md);
  text-align: left;
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-redis-monitor__table th {
  color: color-mix(in srgb, var(--nm-monitor-accent) 50%, var(--rs-muted));
  font-weight: 600;
  font-size: var(--rs-font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.nm-redis-monitor__table tbody tr {
  transition: background var(--rs-transition-fast);
}

.nm-redis-monitor__table tbody tr:hover {
  background: color-mix(in srgb, var(--nm-monitor-accent) 8%, transparent);
}

.nm-redis-monitor__table tbody tr:last-child td {
  border-bottom: none;
}
</style>
