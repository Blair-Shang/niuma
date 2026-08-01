<script setup lang="ts">
/**
 * 调试辅助结果区：多结果 Tab + 元信息条 + 结果表。
 * 单行（常见 OUT 回显）转置为「出参标题 | 出参值」；多行仍用宽表。
 */
import { RsEmpty, RsIcon, RsTable, RsTabs, type RsTabItem, type RsTableColumn } from '@niuma/ui'
import { computed } from 'vue'
import type { DebugResultGrid, DebugResultPanelLabels } from '../types/debug-result'

type KvRow = { __rowKey: string; name: string; value: string }

const props = withDefaults(
  defineProps<{
    grids: DebugResultGrid[]
    labels: DebugResultPanelLabels
    running?: boolean
  }>(),
  {
    running: false,
  },
)

const activeGridId = defineModel<string>('activeGridId', { default: '' })

const activeGrid = computed(
  () =>
    props.grids.find((g) => g.id === activeGridId.value) ?? props.grids[0] ?? null,
)

const tabItems = computed((): RsTabItem[] =>
  props.grids.map((g) => ({
    value: g.id,
    label: g.title,
  })),
)

const rowCountText = computed(() => {
  const g = activeGrid.value
  if (!g || g.rowCount == null) return ''
  return props.labels.rows(g.rowCount)
})

const durationText = computed(() => {
  const g = activeGrid.value
  if (!g || g.durationMs == null) return ''
  return props.labels.duration(g.durationMs)
})

/** 单行结果 → 出参名/值两列，便于阅读 OUT 回显 */
const useKvLayout = computed(() => {
  const g = activeGrid.value
  return Boolean(g && g.rows.length === 1 && g.columns.length > 0)
})

const kvColumns = computed((): RsTableColumn<KvRow>[] => [
  {
    key: 'name',
    title: props.labels.outName,
    dataIndex: 'name',
    width: 160,
    ellipsis: true,
  },
  {
    key: 'value',
    title: props.labels.outValue,
    dataIndex: 'value',
    ellipsis: true,
  },
])

const kvRows = computed((): KvRow[] => {
  const g = activeGrid.value
  if (!g || g.rows.length !== 1) return []
  const row = g.rows[0]!
  return g.columns.map((col, i) => {
    const key = String(col.dataIndex ?? col.key ?? `c${i}`)
    const raw = row[key]
    return {
      __rowKey: `${g.id}-kv-${key}`,
      name: String(col.title ?? col.key ?? key),
      value: raw == null ? 'NULL' : String(raw),
    }
  })
})
</script>

<template>
  <div class="nm-debug-result">
    <RsEmpty
      v-if="grids.length === 0"
      fill
      class="nm-debug-result__empty"
      :description="labels.empty"
    >
      <template #icon>
        <RsIcon name="table" :size="22" />
      </template>
    </RsEmpty>

    <template v-else>
      <div v-if="grids.length > 1" class="nm-debug-result__tabs-bar">
        <RsTabs
          v-model="activeGridId"
          class="nm-debug-result__tabs"
          :items="tabItems"
          size="sm"
          variant="line"
          panelless
        />
      </div>

      <div v-if="activeGrid" class="nm-debug-result__meta" :title="activeGrid.sqlPreview">
        <span v-if="activeGrid.sqlPreview" class="nm-debug-result__sql">
          {{ activeGrid.sqlPreview }}
        </span>
        <span class="nm-debug-result__meta-spacer" />
        <span v-if="rowCountText" class="nm-debug-result__chip nm-debug-result__chip--rows">
          {{ rowCountText }}
        </span>
        <span v-if="durationText" class="nm-debug-result__chip nm-debug-result__chip--time">
          {{ durationText }}
        </span>
      </div>

      <div v-if="activeGrid" class="nm-debug-result__table-wrap">
        <RsTable
          v-if="useKvLayout"
          :view-key="`${activeGrid.id}-kv`"
          class="nm-debug-result__kv"
          :columns="kvColumns"
          :data="kvRows"
          row-key="__rowKey"
          size="sm"
          striped
          fill
          bordered
          column-bordered
          column-layout="fixed"
          cell-tooltip
          highlight-row
          :loading="running"
        >
          <template #empty>
            {{ labels.emptyTable || labels.empty }}
          </template>
          <template #cell-name="{ row }">
            <span class="nm-debug-result__kv-name">{{ (row as KvRow).name }}</span>
          </template>
          <template #cell-value="{ row }">
            <span
              class="nm-debug-result__kv-value"
              :class="{ 'nm-debug-result__kv-value--null': (row as KvRow).value === 'NULL' }"
            >{{ (row as KvRow).value }}</span>
          </template>
        </RsTable>
        <RsTable
          v-else
          :view-key="activeGrid.id"
          :columns="activeGrid.columns"
          :data="activeGrid.rows"
          row-key="__rowKey"
          size="sm"
          striped
          fill
          bordered
          column-bordered
          show-index
          resizable
          column-layout="fixed"
          cell-tooltip
          highlight-row
          :loading="running"
          :virtual="activeGrid.rows.length > 80"
          :virtual-columns-auto-threshold="40"
        >
          <template #empty>
            {{ labels.emptyTable || labels.empty }}
          </template>
        </RsTable>
      </div>
    </template>
  </div>
</template>

<style scoped>
.nm-debug-result {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--rs-surface);
}

.nm-debug-result__empty {
  flex: 1;
  min-height: 0;
}

.nm-debug-result__tabs-bar {
  flex-shrink: 0;
  padding: 0 var(--rs-space-sm, 8px);
  border-bottom: 1px solid var(--rs-border-subtle, rgba(0, 0, 0, 0.08));
  background: var(--rs-surface-subtle, var(--rs-surface));
}

.nm-debug-result__tabs {
  width: 100%;
  min-width: 0;
}

.nm-debug-result__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  min-height: 28px;
  padding: 0.3rem var(--rs-space-sm, 8px);
  border-bottom: 1px solid var(--rs-border-subtle, rgba(0, 0, 0, 0.08));
  background: var(--rs-surface-subtle, color-mix(in srgb, var(--rs-surface) 92%, var(--rs-fg-muted) 8%));
}

.nm-debug-result__sql {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--rs-foreground);
  user-select: text;
}

.nm-debug-result__meta-spacer {
  flex: 1 1 auto;
  min-width: 4px;
}

.nm-debug-result__chip {
  flex-shrink: 0;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  padding: 0 7px;
  border-radius: 999px;
  white-space: nowrap;
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.12));
  color: var(--rs-muted, var(--rs-fg-muted));
}

.nm-debug-result__chip--rows {
  color: var(--rs-accent, #3b82f6);
  background: color-mix(in srgb, var(--rs-accent, #3b82f6) 12%, var(--rs-surface));
}

.nm-debug-result__chip--time {
  color: var(--rs-fg-secondary, #666);
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.1));
}

.nm-debug-result__table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.nm-debug-result__kv-name {
  font-weight: 600;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: 12px;
  color: var(--rs-fg-secondary, #555);
}

.nm-debug-result__kv-value {
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: 12px;
  color: var(--rs-foreground);
  user-select: text;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.nm-debug-result__kv-value--null {
  color: var(--rs-muted, var(--rs-fg-muted));
  font-style: italic;
}
</style>
