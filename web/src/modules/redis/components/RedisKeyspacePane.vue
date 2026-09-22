<script setup lang="ts">
import { RsButton, RsConfirmDialog, RsDialog, RsEmpty, RsIcon, RsLoading, RsTable, useRsToast } from '@niuma/ui'
import type { RsTableColumn } from '@niuma/ui'
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { redisApi } from '@/api'
import type { RedisKeyDescriptor } from '@/api/types/redis'
import { formatBytes, formatRedisReply, formatTtl } from '@/modules/redis/utils/format'
import SqlIdeToolbar from '@/modules/database/components/SqlIdeToolbar.vue'
import type { SqlIdeToolbarItem } from '@/modules/database/types/sql-ide-toolbar'
import { redisDatabaseKey } from '@/modules/redis/composables/useRedisDatabase'

const props = defineProps<{
  sessionId: string | null
  active: boolean
}>()

interface KeyRow extends Record<string, unknown> {
  id: string
  key: string
  type: string
  ttlMs: number
  sizeBytes: number
}

const { t } = useI18n()
const toast = useRsToast()
const redisDb = inject(redisDatabaseKey, null)

const pattern = ref('*')
const typeFilter = ref('')
const keys = ref<RedisKeyDescriptor[]>([])
const cursor = ref(0)
const started = ref(false)
const loading = ref(false)

const viewOpen = ref(false)
const viewLoading = ref(false)
const viewKey = ref('')
const viewContent = ref('')

const deleteTarget = ref<RedisKeyDescriptor | null>(null)
const deleting = ref(false)

const typeOptions = computed(() => [
  { value: 'string', label: 'string' },
  { value: 'hash', label: 'hash' },
  { value: 'list', label: 'list' },
  { value: 'set', label: 'set' },
  { value: 'zset', label: 'zset' },
  { value: 'stream', label: 'stream' },
])

const toolbarReady = computed(() => Boolean(props.sessionId))

const toolbarItems = computed((): SqlIdeToolbarItem[] => [
  {
    key: 'scan',
    icon: 'scan-search',
    tone: 'success',
    title: t('modules.redis.keyspace.scan'),
    label: t('modules.redis.keyspace.scan'),
    disabled: !toolbarReady.value,
    loading: loading.value && rows.value.length === 0,
  },
  {
    key: 'pattern',
    kind: 'filter',
    value: pattern.value,
    placeholder: t('modules.redis.keyspace.patternPlaceholder'),
    disabled: !toolbarReady.value || loading.value,
  },
  {
    key: 'type',
    kind: 'select',
    align: 'trail',
    wide: true,
    value: typeFilter.value,
    options: typeOptions.value,
    placeholder: t('modules.redis.keyspace.typeAll'),
    clearable: true,
    disabled: !toolbarReady.value,
    title: t('modules.redis.keyspace.typeAll'),
  },
])

function onToolbarAction(key: string): void {
  if (key === 'scan') restart()
}

function onToolbarFilter(itemKey: string, value: string): void {
  if (itemKey === 'pattern') pattern.value = value
}

function onToolbarSelect(itemKey: string, value: string): void {
  if (itemKey === 'type') typeFilter.value = value
}

const columns = computed((): RsTableColumn<KeyRow>[] => [
  { key: 'key', title: t('modules.redis.keyspace.columns.key'), ellipsis: true, minWidth: 220 },
  { key: 'type', title: t('modules.redis.keyspace.columns.type'), width: 90 },
  { key: 'ttl', title: t('modules.redis.keyspace.columns.ttl'), width: 100, align: 'right' },
  { key: 'size', title: t('modules.redis.keyspace.columns.size'), width: 100, align: 'right' },
  { key: 'actions', title: t('modules.redis.keyspace.columns.actions'), width: 140 },
])

const rows = computed((): KeyRow[] =>
  keys.value.map((k) => ({
    id: k.key,
    key: k.key,
    type: k.type,
    ttlMs: k.ttlMs,
    sizeBytes: k.sizeBytes,
  })),
)

const hasMore = computed(() => started.value && cursor.value !== 0)

const TYPE_BADGE_CLASS: Record<string, string> = {
  string: 'nm-redis-keyspace__type-badge--string',
  hash: 'nm-redis-keyspace__type-badge--hash',
  list: 'nm-redis-keyspace__type-badge--list',
  set: 'nm-redis-keyspace__type-badge--set',
  zset: 'nm-redis-keyspace__type-badge--zset',
  stream: 'nm-redis-keyspace__type-badge--stream',
}

function typeBadgeClass(type: string): string {
  return TYPE_BADGE_CLASS[type] ?? 'nm-redis-keyspace__type-badge--unknown'
}

async function scan(reset: boolean): Promise<void> {
  if (!props.sessionId || loading.value) {
    return
  }
  loading.value = true
  try {
    const result = await redisApi.keyspaceScan({
      sessionId: props.sessionId,
      cursor: reset ? 0 : cursor.value,
      match: pattern.value.trim() || '*',
      type: typeFilter.value || undefined,
      count: 200,
    })
    keys.value = reset ? result.keys : [...keys.value, ...result.keys]
    cursor.value = result.cursor
    started.value = true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.redis.keyspace.scanError'))
  } finally {
    loading.value = false
  }
}

function restart(): void {
  void scan(true)
}

function loadMore(): void {
  void scan(false)
}

/** 依据 key 的类型选择一条只读命令来预览内容，避免误读超大集合导致 IPC 帧过大。 */
function readCommandFor(descriptor: RedisKeyDescriptor): string[] {
  switch (descriptor.type) {
    case 'string':
      return ['GET', descriptor.key]
    case 'hash':
      return ['HGETALL', descriptor.key]
    case 'list':
      return ['LRANGE', descriptor.key, '0', '99']
    case 'set':
      return ['SMEMBERS', descriptor.key]
    case 'zset':
      return ['ZRANGE', descriptor.key, '0', '99', 'WITHSCORES']
    case 'stream':
      return ['XRANGE', descriptor.key, '-', '+', 'COUNT', '100']
    default:
      return ['TYPE', descriptor.key]
  }
}

async function viewValue(row: KeyRow): Promise<void> {
  if (!props.sessionId) {
    return
  }
  viewKey.value = row.key
  viewOpen.value = true
  viewLoading.value = true
  viewContent.value = ''
  try {
    const descriptor: RedisKeyDescriptor = { key: row.key, type: row.type, ttlMs: row.ttlMs, sizeBytes: row.sizeBytes }
    const result = await redisApi.commandExec({ sessionId: props.sessionId, args: readCommandFor(descriptor) })
    viewContent.value = formatRedisReply(result.reply)
  } catch (e) {
    viewContent.value = e instanceof Error ? e.message : t('modules.redis.keyspace.viewError')
  } finally {
    viewLoading.value = false
  }
}

function confirmDelete(row: KeyRow): void {
  deleteTarget.value = { key: row.key, type: row.type, ttlMs: row.ttlMs, sizeBytes: row.sizeBytes }
}

async function doDelete(): Promise<void> {
  if (!props.sessionId || !deleteTarget.value) {
    return
  }
  deleting.value = true
  try {
    await redisApi.commandExec({ sessionId: props.sessionId, args: ['DEL', deleteTarget.value.key] })
    keys.value = keys.value.filter((k) => k.key !== deleteTarget.value?.key)
    toast.success(t('modules.redis.keyspace.deleted'))
    deleteTarget.value = null
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.redis.keyspace.deleteError'))
  } finally {
    deleting.value = false
  }
}

watch(
  () => props.active,
  (active) => {
    if (active && !started.value) {
      void scan(true)
    }
  },
  { immediate: true },
)

watch(
  () => redisDb?.currentDb.value,
  () => {
    if (props.active) {
      void scan(true)
    }
  },
)
</script>

<template>
  <div class="nm-redis-keyspace">
    <SqlIdeToolbar
      :label="t('modules.redis.keyspace.toolbarAria')"
      identity-icon="database"
      :identity="
        t('modules.redis.session.currentDb', { db: redisDb?.currentDb.value ?? 0 })
      "
      :identity-title="t('modules.redis.keyspace.count', { count: rows.length })"
      :items="toolbarItems"
      @action="onToolbarAction"
      @filter="onToolbarFilter"
      @filter-submit="restart"
      @select="onToolbarSelect"
    />

    <div class="nm-redis-keyspace__body">
      <RsLoading v-if="loading && rows.length === 0" class="nm-redis-keyspace__loading" show-label :label="t('modules.redis.keyspace.scanning')" />
      <RsTable v-else :columns="columns" :data="rows" row-key="id" size="sm" striped :bordered="false">
        <template #empty>
          <RsEmpty :description="t('modules.redis.keyspace.empty')" />
        </template>
        <template #key="{ row }">
          <code class="nm-redis-keyspace__key">{{ row.key }}</code>
        </template>
        <template #type="{ row }">
          <span class="nm-redis-keyspace__type-badge" :class="typeBadgeClass(String(row.type))">{{ row.type }}</span>
        </template>
        <template #ttl="{ row }">
          <span class="nm-redis-keyspace__metric">{{ formatTtl(row.ttlMs as number) }}</span>
        </template>
        <template #size="{ row }">
          <span class="nm-redis-keyspace__metric">{{ formatBytes(row.sizeBytes as number) }}</span>
        </template>
        <template #actions="{ row }">
          <div class="nm-redis-keyspace__actions">
            <RsButton size="sm" variant="ghost" @click="viewValue(row as KeyRow)">
              <RsIcon name="eye" :size="14" />
              {{ t('modules.redis.keyspace.view') }}
            </RsButton>
            <RsButton size="sm" variant="ghost" class="nm-redis-keyspace__delete-btn" @click="confirmDelete(row as KeyRow)">
              <RsIcon name="trash-2" :size="14" />
            </RsButton>
          </div>
        </template>
      </RsTable>
    </div>

    <footer v-if="started" class="nm-redis-keyspace__footer">
      <RsButton size="sm" variant="ghost" :disabled="!hasMore" :loading="loading && rows.length > 0" @click="loadMore">
        {{ hasMore ? t('modules.redis.keyspace.loadMore') : t('modules.redis.keyspace.noMore') }}
      </RsButton>
    </footer>

    <RsDialog v-model:open="viewOpen" :title="viewKey" width="lg">
      <template #body>
      <RsLoading v-if="viewLoading" />
      <pre v-else class="nm-redis-keyspace__value">{{ viewContent }}</pre>
      </template>
    </RsDialog>

    <RsConfirmDialog
      :open="deleteTarget !== null"
      :title="t('modules.redis.keyspace.deleteConfirmTitle')"
      :description="deleteTarget ? t('modules.redis.keyspace.deleteConfirmDesc', { key: deleteTarget.key }) : ''"
      :confirm-loading="deleting"
      @update:open="(val: boolean) => { if (!val) deleteTarget = null }"
      @confirm="doDelete"
    />
  </div>
</template>

<style scoped>
.nm-redis-keyspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-redis-keyspace__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--rs-surface);
}

.nm-redis-keyspace__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 10rem;
}

.nm-redis-keyspace__body :deep(.rs-table) {
  border: none;
}

.nm-redis-keyspace__body :deep(.rs-table__th) {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rs-muted);
  background: var(--rs-surface-subtle);
}

.nm-redis-keyspace__body :deep(.rs-empty) {
  padding: var(--rs-space-xl) var(--rs-space-md);
}

.nm-redis-keyspace__key {
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-text);
  word-break: break-all;
}

.nm-redis-keyspace__metric {
  font-variant-numeric: tabular-nums;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-redis-keyspace__type-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 600;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  letter-spacing: 0.02em;
  text-transform: lowercase;
}

.nm-redis-keyspace__type-badge--string {
  background: color-mix(in srgb, var(--rs-primary) 14%, transparent);
  color: var(--rs-primary);
}

.nm-redis-keyspace__type-badge--hash {
  background: color-mix(in srgb, #8b5cf6 16%, transparent);
  color: #7c3aed;
}

.nm-redis-keyspace__type-badge--list {
  background: color-mix(in srgb, var(--rs-success) 16%, transparent);
  color: var(--rs-success);
}

.nm-redis-keyspace__type-badge--set {
  background: color-mix(in srgb, var(--rs-warning) 18%, transparent);
  color: color-mix(in srgb, var(--rs-warning) 80%, #000 20%);
}

.nm-redis-keyspace__type-badge--zset {
  background: color-mix(in srgb, #06b6d4 16%, transparent);
  color: #0891b2;
}

.nm-redis-keyspace__type-badge--stream {
  background: color-mix(in srgb, #ec4899 14%, transparent);
  color: #db2777;
}

.nm-redis-keyspace__type-badge--unknown {
  background: var(--rs-surface-subtle);
  color: var(--rs-muted);
}

.nm-redis-keyspace__actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}

.nm-redis-keyspace__delete-btn {
  color: var(--rs-muted);
}

.nm-redis-keyspace__delete-btn:hover {
  color: var(--rs-danger);
}

.nm-redis-keyspace__footer {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding-top: var(--rs-space-xs);
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-redis-keyspace__value {
  margin: 0;
  max-height: 24rem;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: var(--rs-font-size-sm);
}
</style>
