<script setup lang="ts">
import { RsEmpty, RsIcon, RsTable, useRsToast } from '@niuma/ui'
import type { RsContextMenuItem, RsTableColumn } from '@niuma/ui'
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import type { MongoCollectionInfo } from '@/api/types/mongodb'
import SqlIdeToolbar from '@/modules/database/components/SqlIdeToolbar.vue'
import type { SqlIdeToolbarItem } from '@/modules/database/types/sql-ide-toolbar'

const props = defineProps<{
  sessionId: string | null
  database: string
  active: boolean
}>()

const emit = defineEmits<{
  'open-collection': [collection: string, feature: string]
  'open-feature': [feature: string]
}>()

interface CollRow extends Record<string, unknown> {
  name: string
  type: string
  typeLabel: string
  count: string
  countValue?: number
  storageSize: string
  storageValue?: number
  avgObjSize: string
  avgValue?: number
  indexCount: string
  indexCountValue?: number
  indexSize: string
  indexSizeValue?: number
}

const { t } = useI18n()
const toast = useRsToast()

const collections = shallowRef<MongoCollectionInfo[]>([])
const loading = ref(false)
const filterText = ref('')

/** 缺省排在升序末尾，避免视图/无统计项把有数值的行顶走。 */
function compareOptionalNumber(left?: number, right?: number): number {
  const leftOk = left !== undefined && left >= 0
  const rightOk = right !== undefined && right >= 0
  if (leftOk && rightOk) return left - right
  if (leftOk) return -1
  if (rightOk) return 1
  return 0
}

const columns = computed((): RsTableColumn<CollRow>[] => [
  { key: 'name', title: t('modules.mongodb.database.colName'), minWidth: 180, ellipsis: true, sortable: true },
  { key: 'typeLabel', title: t('modules.mongodb.database.colType'), minWidth: 72, sortable: true },
  {
    key: 'count',
    title: t('modules.mongodb.database.colCount'),
    minWidth: 88,
    align: 'right',
    sortable: true,
    sorter: (a, b) => compareOptionalNumber(a.countValue, b.countValue),
  },
  {
    key: 'storageSize',
    title: t('modules.mongodb.database.colStorage'),
    minWidth: 88,
    align: 'right',
    sortable: true,
    sorter: (a, b) => compareOptionalNumber(a.storageValue, b.storageValue),
  },
  {
    key: 'avgObjSize',
    title: t('modules.mongodb.database.colAvgSize'),
    minWidth: 96,
    align: 'right',
    sortable: true,
    sorter: (a, b) => compareOptionalNumber(a.avgValue, b.avgValue),
  },
  {
    key: 'indexCount',
    title: t('modules.mongodb.database.colIndexCount'),
    minWidth: 80,
    align: 'right',
    sortable: true,
    sorter: (a, b) => compareOptionalNumber(a.indexCountValue, b.indexCountValue),
  },
  {
    key: 'indexSize',
    title: t('modules.mongodb.database.colIndexSize'),
    minWidth: 96,
    align: 'right',
    sortable: true,
    sorter: (a, b) => compareOptionalNumber(a.indexSizeValue, b.indexSizeValue),
  },
])

/** 字节数格式化为人类可读单位；缺省或负值显示占位符 */
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exp
  return `${value.toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`
}

function mapCollectionsToRows(items: readonly MongoCollectionInfo[]): CollRow[] {
  return items.map((c) => ({
    name: c.name,
    type: c.type,
    typeLabel:
      c.type === 'view'
        ? t('modules.mongodb.database.typeView')
        : t('modules.mongodb.database.typeCollection'),
    count: c.count !== undefined ? c.count.toLocaleString() : '—',
    countValue: c.count,
    storageSize: c.type === 'view' ? '—' : formatBytes(c.storageSize),
    storageValue: c.type === 'view' ? undefined : c.storageSize,
    avgObjSize: c.type === 'view' ? '—' : formatBytes(c.avgObjSize),
    avgValue: c.type === 'view' ? undefined : c.avgObjSize,
    indexCount: c.indexCount !== undefined ? c.indexCount.toLocaleString() : '—',
    indexCountValue: c.indexCount,
    indexSize: c.type === 'view' ? '—' : formatBytes(c.indexSize),
    indexSizeValue: c.type === 'view' ? undefined : c.indexSize,
  }))
}

const allRows = computed(() => mapCollectionsToRows(collections.value))

const filterQuery = computed(() => filterText.value.trim().toLowerCase())

const visibleRows = computed(() => {
  const q = filterQuery.value
  if (!q) return allRows.value
  return allRows.value.filter(
    (row) => row.name.toLowerCase().includes(q) || row.typeLabel.toLowerCase().includes(q),
  )
})

const summaryText = computed(() => {
  const total = collections.value.length
  const shown = visibleRows.value.length
  if (filterQuery.value && shown !== total) {
    return t('modules.mongodb.database.summaryFiltered', { shown, total })
  }
  return t('modules.mongodb.database.summaryCount', { count: total })
})

async function loadCollections(): Promise<void> {
  if (!props.sessionId || !props.database) return
  loading.value = true
  try {
    const result = await mongodbApi.treeCollections({
      sessionId: props.sessionId,
      database: props.database,
    })
    collections.value = result.collections
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.database.loadError'))
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.sessionId, props.database, props.active] as const,
  ([sid, db, active]) => {
    if (sid && db && active) void loadCollections()
  },
  { immediate: true },
)

function buildContextMenuItems(row: CollRow | null): RsContextMenuItem[] {
  if (!row) return []
  const items: RsContextMenuItem[] = [
    { key: 'browse', label: t('modules.mongodb.tree.collOpen'), icon: 'rows-3' },
  ]
  if (row.type !== 'view') {
    items.push({ key: 'query', label: t('modules.mongodb.tree.collQuery'), icon: 'code-2' })
  }
  return items
}

function onContextMenuSelect(key: string, row: CollRow | null): void {
  if (!row) return
  if (key === 'browse') emit('open-collection', row.name, 'collections')
  else if (key === 'query') emit('open-collection', row.name, 'query')
}

const toolbarReady = computed(() => Boolean(props.sessionId))

const toolbarItems = computed((): SqlIdeToolbarItem[] => [
  {
    key: 'query',
    icon: 'code-2',
    title: t('modules.mongodb.tree.collQuery'),
    disabled: !toolbarReady.value,
  },
  {
    key: 'monitor',
    icon: 'activity',
    title: t('modules.mongodb.tree.dbMonitor'),
    disabled: !toolbarReady.value,
  },
  {
    key: 'filter',
    kind: 'filter',
    align: 'trail',
    value: filterText.value,
    placeholder: t('modules.mongodb.database.filterPlaceholder'),
    disabled: !toolbarReady.value || loading.value,
  },
  {
    key: 'refresh',
    icon: 'refresh-cw',
    title: t('modules.mongodb.database.refresh'),
    disabled: !toolbarReady.value || loading.value,
    align: 'trail',
  },
])

function onToolbarAction(key: string): void {
  if (key === 'query') emit('open-feature', 'query')
  else if (key === 'monitor') emit('open-feature', 'monitor')
  else if (key === 'refresh') void loadCollections()
}

function onToolbarFilter(_itemKey: string, value: string): void {
  filterText.value = value
}
</script>

<template>
  <div class="nm-dbpane">
    <SqlIdeToolbar
      :label="t('modules.mongodb.database.toolbarAria')"
      identity-icon="database"
      :identity="database"
      :items="toolbarItems"
      @action="onToolbarAction"
      @filter="onToolbarFilter"
    />

    <RsEmpty
      v-if="!loading && collections.length === 0"
      fill
      class="nm-dbpane__empty"
      icon="table-2"
      :description="t('modules.mongodb.database.noCollections')"
    />

    <RsEmpty
      v-else-if="!loading && visibleRows.length === 0"
      fill
      class="nm-dbpane__empty"
      icon="table-2"
      :description="t('modules.mongodb.database.emptyFilter')"
    />

    <div v-else class="nm-dbpane__table-wrap">
      <RsTable
        :columns="columns"
        :data="visibleRows"
        row-key="name"
        :loading="loading"
        :default-sort="{ key: 'name', order: 'asc' }"
        size="sm"
        striped
        resizable
        column-layout="auto"
        column-bordered
        fill
        :virtual-auto-threshold="30"
        :context-menu-items="buildContextMenuItems"
        @context-menu-select="onContextMenuSelect"
      >
        <template #name="{ row }">
          <button
            type="button"
            class="nm-dbpane__name-btn"
            :title="row.name"
            @click="emit('open-collection', row.name, 'collections')"
          >
            <RsIcon
              :name="row.type === 'view' ? 'eye' : 'table-2'"
              :size="13"
              class="nm-dbpane__name-icon"
            />
            <span class="nm-dbpane__name-text">{{ row.name }}</span>
          </button>
        </template>

        <template #typeLabel="{ row }">
          <span
            class="nm-dbpane__type-badge"
            :class="{ 'nm-dbpane__type-badge--view': row.type === 'view' }"
            :title="row.type === 'view'
              ? t('modules.mongodb.database.tooltipView')
              : t('modules.mongodb.database.tooltipCollection')"
          >
            {{ row.typeLabel }}
          </span>
        </template>

        <template #summary>
          <div class="nm-dbpane__summary">
            <span class="nm-dbpane__summary-count">
              <RsIcon name="layers" :size="12" />
              {{ summaryText }}
            </span>
          </div>
        </template>
      </RsTable>
    </div>
  </div>
</template>

<style scoped>
.nm-dbpane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--rs-surface);
}

/* ── 空状态 ── */
.nm-dbpane__empty {
  flex: 1;
}

/* ── 表格区域：flex 容器，滚动由 RsTable fill 模式内置处理 ── */
.nm-dbpane__table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}


/* ── 集合名按钮：限制在列宽内，文本溢出省略 ── */
.nm-dbpane__name-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
  border: none;
  background: none;
  padding: 0;
  font-size: var(--rs-font-size-sm);
  font-family: var(--rs-font-mono);
  font-weight: 500;
  color: var(--rs-accent);
  cursor: pointer;
  text-align: left;
}

.nm-dbpane__name-btn:hover .nm-dbpane__name-text {
  text-decoration: underline;
}

.nm-dbpane__name-icon {
  flex-shrink: 0;
  color: var(--rs-muted);
}

.nm-dbpane__name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* ── 类型徽标 ── */
.nm-dbpane__type-badge {
  display: inline-block;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  background: var(--rs-surface-subtle);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-xs);
  padding: 1px 6px;
  cursor: default;
}

.nm-dbpane__type-badge--view {
  color: var(--rs-warning);
  background: color-mix(in srgb, var(--rs-warning) 10%, transparent);
  border-color: color-mix(in srgb, var(--rs-warning) 30%, transparent);
}

/* ── 数值列：等宽数字对齐 + 次要色（仅正文右对齐单元格，不影响表头） ── */
:deep(.rs-table__td.rs-table__cell--right) {
  font-family: var(--rs-font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--rs-muted);
}


/* ── 汇总行（#summary slot） ── */
.nm-dbpane__summary {
  display: flex;
  align-items: center;
}

.nm-dbpane__summary-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

</style>
