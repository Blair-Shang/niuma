<script setup lang="ts">
import { RsButton, RsEmpty, RsIcon, RsTable, RsTooltip, useRsToast } from '@niuma/ui'
import type { RsContextMenuItem, RsTableColumn } from '@niuma/ui'
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import type { MongoCollectionInfo } from '@/api/types/mongodb'

const props = defineProps<{
  sessionId: string | null
  database: string
  active: boolean
}>()

const emit = defineEmits<{
  'open-collection': [collection: string, feature: string]
}>()

interface CollRow extends Record<string, unknown> {
  name: string
  type: string
  typeLabel: string
  count: string
  storageSize: string
  avgObjSize: string
  indexCount: string
  indexSize: string
}

const { t, locale } = useI18n()
const toast = useRsToast()

const collections = shallowRef<MongoCollectionInfo[]>([])
const loading = ref(false)
const rows = shallowRef<CollRow[]>([])

const columns = computed((): RsTableColumn<CollRow>[] => [
  { key: 'name', title: t('modules.mongodb.database.colName'), minWidth: 180, ellipsis: true },
  { key: 'typeLabel', title: t('modules.mongodb.database.colType'), minWidth: 72 },
  { key: 'count', title: t('modules.mongodb.database.colCount'), minWidth: 88, align: 'right' },
  { key: 'storageSize', title: t('modules.mongodb.database.colStorage'), minWidth: 88, align: 'right' },
  { key: 'avgObjSize', title: t('modules.mongodb.database.colAvgSize'), minWidth: 96, align: 'right' },
  { key: 'indexCount', title: t('modules.mongodb.database.colIndexCount'), minWidth: 80, align: 'right' },
  { key: 'indexSize', title: t('modules.mongodb.database.colIndexSize'), minWidth: 96, align: 'right' },
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
    storageSize: c.type === 'view' ? '—' : formatBytes(c.storageSize),
    avgObjSize: c.type === 'view' ? '—' : formatBytes(c.avgObjSize),
    indexCount: c.indexCount !== undefined ? c.indexCount.toLocaleString() : '—',
    indexSize: c.type === 'view' ? '—' : formatBytes(c.indexSize),
  }))
}

function syncRows(): void {
  rows.value = mapCollectionsToRows(collections.value)
}

watch(locale, syncRows)

async function loadCollections(): Promise<void> {
  if (!props.sessionId || !props.database) return
  loading.value = true
  try {
    const result = await mongodbApi.treeCollections({
      sessionId: props.sessionId,
      database: props.database,
    })
    collections.value = result.collections
    syncRows()
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
</script>

<template>
  <div class="nm-dbpane">
    <!-- 空状态 -->
    <RsEmpty
      v-if="!loading && collections.length === 0"
      fill
      class="nm-dbpane__empty"
      icon="table-2"
      :description="t('modules.mongodb.database.noCollections')"
    />

    <!-- 集合列表（直接铺满，无独立 toolbar） -->
    <div v-else class="nm-dbpane__table-wrap">
      <RsTable
        :columns="columns"
        :data="rows"
        row-key="name"
        :loading="loading"
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
        <!-- 集合名：列宽不足时省略，原生 title 展示全名（避免每行挂载 Tooltip 组件） -->
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

        <!-- 类型徽标 -->
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

        <!-- 汇总行：数量 + 刷新（sticky 固定在底部） -->
        <template #summary>
          <div class="nm-dbpane__summary">
            <span class="nm-dbpane__summary-count">
              <RsIcon name="layers" :size="12" />
              {{ t('modules.mongodb.database.summaryCount', { count: collections.length }) }}
            </span>
            <RsTooltip :content="t('modules.mongodb.database.refresh')" side="top">
              <RsButton size="sm" variant="ghost" :loading="loading" @click="loadCollections">
                <RsIcon name="refresh-cw" :size="12" />
              </RsButton>
            </RsTooltip>
          </div>
        </template>
      </RsTable>
    </div>
  </div>
</template>

<style scoped>
/* ── 容器：不用 height:100%，依赖父级 flex:1 + min-height:0 ── */
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
  justify-content: space-between;
  gap: var(--rs-space-sm);
}

.nm-dbpane__summary-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

</style>
