<script setup lang="ts">
import {
  RsButton,
  RsEmpty,
  RsIcon,
  RsLoading,
  RsTable,
  useRsToast,
  type RsTableColumn,
} from '@niuma/ui'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mysqlApi } from '@/api'
import type { MysqlColumnInfo, MysqlIndexInfo } from '@/api/types/mysql'
import { selectSeed } from '@/modules/mysql/sql-seed'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  table?: string
  sessionLabel?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

type BrowseSection = 'data' | 'columns' | 'indexes'

const section = ref<BrowseSection>('data')
const loading = ref(false)
const statusText = ref('')
const resultSetId = ref<string | null>(null)
const dataColumns = ref<RsTableColumn[]>([])
const dataRows = ref<Record<string, unknown>[]>([])
const hasMore = ref(false)
const pageLimit = 100

const metaColumns = ref<MysqlColumnInfo[]>([])
const metaIndexes = ref<MysqlIndexInfo[]>([])
const tableComment = ref('')
const metaLoaded = ref(false)

const scopeReady = computed(() => Boolean(props.sessionId && props.database && props.table))

const columnTableColumns = computed<RsTableColumn[]>(() => [
  { key: 'ordinal', title: '#', width: 48 },
  { key: 'name', title: t('modules.mysql.browse.colName'), minWidth: 120, ellipsis: true },
  { key: 'dataType', title: t('modules.mysql.browse.colType'), minWidth: 120, ellipsis: true },
  { key: 'nullable', title: t('modules.mysql.browse.colNullable'), width: 80 },
  { key: 'default', title: t('modules.mysql.browse.colDefault'), minWidth: 100, ellipsis: true },
  { key: 'comment', title: t('modules.mysql.browse.colComment'), minWidth: 120, ellipsis: true },
])

const columnTableRows = computed(() =>
  metaColumns.value.map((c) => ({
    ordinal: c.ordinal,
    name: c.name,
    dataType: c.dataType,
    nullable: c.nullable ? 'YES' : 'NO',
    default: c.default ?? '',
    comment: c.comment ?? '',
  })),
)

const indexTableColumns = computed<RsTableColumn[]>(() => [
  { key: 'name', title: t('modules.mysql.browse.idxName'), minWidth: 120, ellipsis: true },
  { key: 'kind', title: t('modules.mysql.browse.idxKind'), width: 100 },
  { key: 'columns', title: t('modules.mysql.browse.idxColumns'), minWidth: 140, ellipsis: true },
  { key: 'definition', title: t('modules.mysql.browse.idxDef'), minWidth: 180, ellipsis: true },
])

const indexTableRows = computed(() =>
  metaIndexes.value.map((idx) => ({
    name: idx.name,
    kind: idx.primary ? 'PRIMARY' : idx.unique ? 'UNIQUE' : 'INDEX',
    columns: (idx.columns ?? []).join(', '),
    definition: idx.definition,
  })),
)

function cellKey(i: number): string {
  return `c${i}`
}

async function closeResultSet(): Promise<void> {
  if (!props.sessionId || !resultSetId.value) return
  const id = resultSetId.value
  resultSetId.value = null
  await mysqlApi.queryClose({ sessionId: props.sessionId, resultSetId: id }).catch(() => undefined)
}

async function loadMeta(): Promise<void> {
  if (!props.sessionId || !props.database || !props.table) return
  try {
    const [cols, idxs] = await Promise.all([
      mysqlApi.metaColumns({
        sessionId: props.sessionId,
        database: props.database,
        table: props.table,
      }),
      mysqlApi.metaIndexes({
        sessionId: props.sessionId,
        database: props.database,
        table: props.table,
      }),
    ])
    metaColumns.value = cols.columns ?? []
    tableComment.value = cols.tableComment ?? ''
    metaIndexes.value = idxs.indexes ?? []
    metaLoaded.value = true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.browse.metaError'))
  }
}

async function loadData(reset = true): Promise<void> {
  if (!props.sessionId || !props.database || !props.table) return
  loading.value = true
  try {
    if (reset) {
      await closeResultSet()
      const sql = selectSeed(props.database, props.table, pageLimit).trim().replace(/;$/, '')
      const result = await mysqlApi.queryExec({
        sessionId: props.sessionId,
        database: props.database,
        sql,
        limit: pageLimit,
      })
      resultSetId.value = result.resultSetId ?? null
      hasMore.value = Boolean(result.hasMore)
      dataColumns.value = (result.columns ?? []).map((c, i) => ({
        key: cellKey(i),
        title: c.name || `col${i + 1}`,
        ellipsis: true,
        minWidth: 96,
      }))
      dataRows.value = (result.rows ?? []).map((r, idx) => {
        const obj: Record<string, unknown> = { __i: idx }
        r.forEach((v, i) => {
          obj[cellKey(i)] = v
        })
        return obj
      })
      statusText.value = [
        t('modules.mysql.query.rows', { n: result.rowCount }),
        `${result.durationMs} ms`,
        result.hasMore ? t('modules.mysql.query.hasMore') : '',
      ]
        .filter(Boolean)
        .join(' · ')
    } else if (resultSetId.value) {
      const result = await mysqlApi.queryFetch({
        sessionId: props.sessionId,
        resultSetId: resultSetId.value,
        limit: pageLimit,
      })
      hasMore.value = Boolean(result.hasMore)
      const base = dataRows.value.length
      const more = (result.rows ?? []).map((r, idx) => {
        const obj: Record<string, unknown> = { __i: base + idx }
        r.forEach((v, i) => {
          obj[cellKey(i)] = v
        })
        return obj
      })
      dataRows.value = [...dataRows.value, ...more]
      statusText.value = [
        t('modules.mysql.query.fetched', { n: dataRows.value.length, ms: result.durationMs }),
        result.hasMore ? t('modules.mysql.query.hasMore') : '',
      ]
        .filter(Boolean)
        .join(' · ')
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.browse.dataError'))
  } finally {
    loading.value = false
  }
}

async function refresh(): Promise<void> {
  metaLoaded.value = false
  await Promise.all([loadMeta(), loadData(true)])
}

watch(
  () => [props.sessionId, props.database, props.table] as const,
  () => {
    dataColumns.value = []
    dataRows.value = []
    metaColumns.value = []
    metaIndexes.value = []
    tableComment.value = ''
    metaLoaded.value = false
    statusText.value = ''
    void closeResultSet()
    if (props.active && scopeReady.value) {
      void refresh()
    }
  },
  { immediate: true },
)

watch(
  () => props.active,
  (active) => {
    if (active && scopeReady.value && dataColumns.value.length === 0 && !loading.value) {
      void refresh()
    }
  },
)

onUnmounted(() => {
  void closeResultSet()
})
</script>

<template>
  <div class="nm-mysql-browse">
    <header class="nm-mysql-browse__chrome">
      <div class="nm-mysql-browse__identity" :title="sessionLabel">
        <RsIcon name="table" :size="16" />
        <span class="nm-mysql-browse__session">{{ sessionLabel || 'MySQL' }}</span>
        <span v-if="database && table" class="nm-mysql-browse__scope">{{ database }}.{{ table }}</span>
      </div>
      <div class="nm-mysql-browse__actions">
        <div class="nm-mysql-browse__tabs">
          <button
            type="button"
            class="nm-mysql-browse__tab"
            :class="{ 'nm-mysql-browse__tab--active': section === 'data' }"
            @click="section = 'data'"
          >
            {{ t('modules.mysql.browse.tabData') }}
          </button>
          <button
            type="button"
            class="nm-mysql-browse__tab"
            :class="{ 'nm-mysql-browse__tab--active': section === 'columns' }"
            @click="section = 'columns'"
          >
            {{ t('modules.mysql.browse.tabColumns') }}
          </button>
          <button
            type="button"
            class="nm-mysql-browse__tab"
            :class="{ 'nm-mysql-browse__tab--active': section === 'indexes' }"
            @click="section = 'indexes'"
          >
            {{ t('modules.mysql.browse.tabIndexes') }}
          </button>
        </div>
        <RsButton
          v-if="section === 'data' && hasMore"
          size="sm"
          variant="ghost"
          :disabled="loading"
          @click="loadData(false)"
        >
          {{ t('modules.mysql.query.loadMore') }}
        </RsButton>
        <RsButton size="sm" variant="ghost" icon="refresh-cw" :loading="loading" @click="refresh">
          {{ t('modules.mysql.browse.refresh') }}
        </RsButton>
      </div>
    </header>

    <p v-if="tableComment && section !== 'data'" class="nm-mysql-browse__comment">
      {{ tableComment }}
    </p>
    <div v-if="section === 'data' && statusText" class="nm-mysql-browse__status">
      {{ statusText }}
    </div>

    <div class="nm-mysql-browse__body">
      <RsLoading v-if="loading && dataColumns.length === 0 && !metaLoaded" class="nm-mysql-browse__loading" />
      <RsEmpty
        v-else-if="!database || !table"
        icon="table"
        :description="t('modules.mysql.browse.needTable')"
      />
      <template v-else-if="section === 'data'">
        <RsEmpty
          v-if="dataColumns.length === 0 && !loading"
          :description="t('modules.mysql.query.emptyResult')"
        />
        <RsTable
          v-else
          :columns="dataColumns"
          :data="dataRows"
          size="sm"
          fill
          row-key="__i"
        />
      </template>
      <template v-else-if="section === 'columns'">
        <RsEmpty
          v-if="columnTableRows.length === 0 && !loading"
          :description="t('modules.mysql.browse.emptyColumns')"
        />
        <RsTable
          v-else
          :columns="columnTableColumns"
          :data="columnTableRows"
          size="sm"
          fill
          row-key="ordinal"
        />
      </template>
      <template v-else>
        <RsEmpty
          v-if="indexTableRows.length === 0 && !loading"
          :description="t('modules.mysql.browse.emptyIndexes')"
        />
        <RsTable
          v-else
          :columns="indexTableColumns"
          :data="indexTableRows"
          size="sm"
          fill
          row-key="name"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.nm-mysql-browse {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-mysql-browse__chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-mysql-browse__identity {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-mysql-browse__session {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mysql-browse__scope {
  color: var(--rs-fg-muted);
  font-weight: 400;
}

.nm-mysql-browse__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

.nm-mysql-browse__tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-right: var(--rs-space-xs);
}

.nm-mysql-browse__tab {
  border: 1px solid transparent;
  background: transparent;
  color: var(--rs-fg-muted);
  border-radius: var(--rs-radius-sm);
  padding: 0.2rem 0.55rem;
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
}

.nm-mysql-browse__tab--active {
  color: var(--rs-fg);
  background: var(--rs-bg-elevated, var(--rs-bg));
  border-color: var(--rs-border-subtle);
}

.nm-mysql-browse__comment,
.nm-mysql-browse__status {
  margin: 0;
  padding: 0.25rem 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-fg-muted);
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-mysql-browse__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-mysql-browse__loading {
  flex: 1;
}
</style>
