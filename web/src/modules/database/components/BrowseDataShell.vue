<script setup lang="ts">
/**
 * 表 / 视图数据浏览外壳：工具栏 · 过滤条 · 网格区 · 底部分页与状态。
 * 方言注入 labels / 数据网格 / 导入导出菜单；表与视图共用同一壳。
 */
import {
  RsButton,
  RsEmpty,
  RsIcon,
  RsLoading,
  RsPagination,
  RsPopover,
  RsToolbar,
} from '@niuma/ui'
import type { BrowseDataShellLabels } from '../types/browse-data'

const props = withDefaults(
  defineProps<{
    labels: BrowseDataShellLabels
    /** 品牌 / 方言图标 */
    brandIcon?: string
    sessionLabel?: string
    scopeLabel?: string
    loading?: boolean
    saving?: boolean
    /** 是否展示插入 / 删除（视图可关） */
    showMutate?: boolean
    canInsert?: boolean
    canDelete?: boolean
    showImport?: boolean
    showExport?: boolean
    importDisabled?: boolean
    exportDisabled?: boolean
    showFilter?: boolean
    hasActiveFilter?: boolean
    /** 作用域是否就绪（库.表） */
    hasScope?: boolean
    /** 是否已有结果集（含空表） */
    hasResult?: boolean
    pageSizeOptions?: readonly number[]
    totalRows?: number
    lastDataSql?: string
    statusMeta?: string
    statusHint?: string
    statusWarn?: boolean
  }>(),
  {
    brandIcon: 'table',
    sessionLabel: '',
    scopeLabel: '',
    loading: false,
    saving: false,
    showMutate: true,
    canInsert: false,
    canDelete: false,
    showImport: true,
    showExport: true,
    importDisabled: false,
    exportDisabled: false,
    showFilter: true,
    hasActiveFilter: false,
    hasScope: false,
    hasResult: false,
    pageSizeOptions: () => [50, 100, 200, 500, 1000],
    totalRows: 0,
    lastDataSql: '',
    statusMeta: '',
    statusHint: '',
    statusWarn: false,
  },
)

const page = defineModel<number>('page', { default: 1 })
const pageSize = defineModel<number>('pageSize', { default: 100 })
const filterOpen = defineModel<boolean>('filterOpen', { default: false })
const importMenuOpen = defineModel<boolean>('importMenuOpen', { default: false })
const exportMenuOpen = defineModel<boolean>('exportMenuOpen', { default: false })

const emit = defineEmits<{
  insert: []
  delete: []
  refresh: []
  keydown: [ev: KeyboardEvent]
}>()

const identityTitle = () => {
  const bits = [props.sessionLabel, props.scopeLabel].filter(Boolean)
  return bits.join(' · ')
}
</script>

<template>
  <div class="nm-browse-data" tabindex="-1" @keydown="emit('keydown', $event)">
    <RsToolbar
      class="nm-browse-data__toolbar"
      size="md"
      elevated
      :label="labels.toolbarLabel"
    >
      <template #left>
        <div class="nm-browse-data__identity" :title="identityTitle()">
          <RsIcon :name="brandIcon" :size="15" class="nm-browse-data__brand" />
          <span v-if="sessionLabel" class="nm-browse-data__session">{{ sessionLabel }}</span>
          <span v-if="scopeLabel" class="nm-browse-data__scope">{{ scopeLabel }}</span>
          <span class="nm-browse-data__feature">
            <RsIcon name="table" :size="12" />
            {{ labels.featureLabel }}
          </span>
        </div>
      </template>
      <template #right>
        <slot name="toolbar-start" />
        <RsButton
          v-if="showMutate"
          variant="ghost"
          size="sm"
          icon="plus"
          :disabled="!canInsert || saving"
          :tooltip="labels.insertTooltip"
          @click="emit('insert')"
        >
          {{ labels.insert }}
        </RsButton>
        <RsButton
          v-if="showMutate"
          variant="ghost"
          size="sm"
          icon="trash-2"
          :disabled="!canDelete || saving"
          :tooltip="labels.deleteTooltip"
          @click="emit('delete')"
        >
          {{ labels.delete }}
        </RsButton>
        <RsPopover
          v-if="showImport"
          v-model:open="importMenuOpen"
          side="bottom"
          align="end"
          :side-offset="4"
          width="auto"
        >
          <RsButton
            variant="ghost"
            size="sm"
            icon="upload"
            :disabled="importDisabled || saving"
            :tooltip="labels.importTooltip"
          >
            {{ labels.import }}
          </RsButton>
          <template #content>
            <slot name="import-menu" />
          </template>
        </RsPopover>
        <RsPopover
          v-if="showExport"
          v-model:open="exportMenuOpen"
          side="bottom"
          align="end"
          :side-offset="4"
          width="auto"
        >
          <RsButton
            variant="ghost"
            size="sm"
            icon="download"
            :disabled="exportDisabled"
            :tooltip="labels.exportTooltip"
          >
            {{ labels.export }}
          </RsButton>
          <template #content>
            <slot name="export-menu" />
          </template>
        </RsPopover>
        <slot name="toolbar-extra" />
        <RsButton
          v-if="showFilter"
          variant="ghost"
          size="sm"
          icon="funnel"
          :tooltip="labels.filterToggle"
          :class="{ 'nm-browse-data__filter-toggle--on': filterOpen }"
          @click="filterOpen = !filterOpen"
        >
          {{ labels.filter }}
          <span v-if="hasActiveFilter" class="nm-browse-data__filter-badge">•</span>
        </RsButton>
        <RsButton
          variant="primary"
          size="sm"
          icon="refresh-cw"
          :loading="loading || saving"
          @click="emit('refresh')"
        >
          {{ labels.refresh }}
        </RsButton>
        <slot name="toolbar-end" />
      </template>
    </RsToolbar>

    <div v-if="filterOpen && showFilter" class="nm-browse-data__filter-bar">
      <slot name="filter" />
    </div>

    <div class="nm-browse-data__body">
      <RsLoading v-if="loading && !hasResult" block class="nm-browse-data__loading" />
      <RsEmpty
        v-else-if="!hasScope"
        fill
        icon="table"
        :description="labels.needTable"
      />
      <RsEmpty
        v-else-if="!hasResult"
        fill
        icon="table"
        :description="labels.empty"
      />
      <div v-else class="nm-browse-data__table-wrap">
        <slot />
      </div>
    </div>

    <footer class="nm-browse-data__status">
      <RsPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        class="nm-browse-data__pager"
        size="sm"
        :total="totalRows"
        show-summary
        show-page-size
        :page-size-options="[...pageSizeOptions]"
        :disabled="loading"
      />
      <div
        v-if="lastDataSql"
        class="nm-browse-data__status-sql"
        :title="lastDataSql"
      >
        <span class="nm-browse-data__status-sql-label">SQL</span>
        <code class="nm-browse-data__status-sql-text">{{ lastDataSql }}</code>
      </div>
      <span
        v-if="statusMeta || statusHint"
        class="nm-browse-data__status-meta"
        :class="{ 'nm-browse-data__status-meta--warn': statusWarn }"
      >
        <template v-if="statusMeta">{{ statusMeta }}<template v-if="statusHint"> · </template></template>
        {{ statusHint }}
      </span>
    </footer>

    <slot name="dialogs" />
  </div>
</template>

<style scoped>
.nm-browse-data {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-browse-data__toolbar {
  flex-shrink: 0;
}

.nm-browse-data__identity {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs, 0.35rem);
  min-width: 0;
  overflow: hidden;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-browse-data__brand {
  flex-shrink: 0;
  color: var(--rs-accent, #3b82f6);
}

.nm-browse-data__session {
  flex-shrink: 0;
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-browse-data__scope {
  color: var(--rs-muted, var(--rs-fg-muted));
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.nm-browse-data__feature {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  margin-left: 2px;
  padding: 0.1rem 0.45rem;
  border-radius: var(--rs-radius-sm);
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.12));
  color: var(--rs-muted, var(--rs-fg-muted));
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
}

.nm-browse-data__filter-toggle--on {
  color: var(--rs-accent, #3b82f6);
}

.nm-browse-data__filter-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.3rem;
  margin-left: 0.15rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--rs-accent, #3b82f6) 18%, transparent);
  font-size: 10px;
  font-family: var(--rs-font-mono);
  line-height: 1;
}

.nm-browse-data__filter-bar {
  position: relative;
  display: block;
  width: 100%;
  flex-shrink: 0;
  height: 5.5rem;
  min-height: 5.5rem;
  padding: 0;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
  overflow: hidden;
}

.nm-browse-data__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.nm-browse-data__loading {
  flex: 1;
}

.nm-browse-data__table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.nm-browse-data__status {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--rs-space-sm, 0.5rem);
  flex-shrink: 0;
  min-height: 2rem;
  height: 2rem;
  padding: 0 var(--rs-space-sm, 0.5rem);
  border-top: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-subtle, var(--rs-surface));
  overflow: hidden;
}

.nm-browse-data__pager {
  flex: 0 0 auto;
  min-width: 0;
}

.nm-browse-data__pager :deep(.rs-pagination) {
  flex-wrap: nowrap;
  white-space: nowrap;
  margin: 0;
}

.nm-browse-data__status-sql {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs, 0.35rem);
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  line-height: 1.2;
  overflow: hidden;
}

.nm-browse-data__status-sql-label {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--rs-muted, var(--rs-fg-muted));
  font-family: var(--rs-font-mono);
}

.nm-browse-data__status-sql-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--rs-font-mono);
  color: var(--rs-text);
  user-select: text;
  font-style: normal;
}

.nm-browse-data__status-meta {
  flex: 0 1 auto;
  max-width: 22%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--rs-muted, var(--rs-fg-muted));
}

.nm-browse-data__status-meta--warn {
  color: var(--rs-warning, #d97706);
}
</style>
