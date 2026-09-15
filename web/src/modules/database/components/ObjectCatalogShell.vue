<script setup lang="ts">
/**
 * 库 / schema 对象一览外壳：分类 Tab + 操作条 · 网格槽 · 底栏。
 * 顶栏对齐 Monitor（左分类、右动作），不叠连接身份与功能徽章。
 * 方言注入 labels / 列 / 数据；禁止在此写引擎字段或 RPC。
 */
import {
  RsButton,
  RsEmpty,
  RsIcon,
  RsInput,
  RsLoading,
  RsPopover,
} from '@niuma/ui'
import type { ObjectCatalogCategoryTab, ObjectCatalogShellLabels } from '../types/object-catalog'

const props = withDefaults(
  defineProps<{
    labels: ObjectCatalogShellLabels
    brandIcon?: string
    sessionLabel?: string
    scopeLabel?: string
    loading?: boolean
    hasScope?: boolean
    hasResult?: boolean
    hasRows?: boolean
    canDdl?: boolean
    showCreate?: boolean
    categories?: ObjectCatalogCategoryTab[]
    statusMeta?: string
    statusHint?: string
  }>(),
  {
    brandIcon: 'database',
    sessionLabel: '',
    scopeLabel: '',
    loading: false,
    hasScope: false,
    hasResult: false,
    hasRows: false,
    canDdl: false,
    showCreate: true,
    categories: () => [],
    statusMeta: '',
    statusHint: '',
  },
)

const filterText = defineModel<string>('filterText', { default: '' })
const category = defineModel<string>('category', { default: '' })
const createOpen = defineModel<boolean>('createOpen', { default: false })

const emit = defineEmits<{
  query: []
  refresh: []
  ddl: []
}>()

const headerTitle = () => {
  const bits = [props.sessionLabel, props.scopeLabel, props.labels.featureLabel].filter(Boolean)
  return bits.join(' · ')
}
</script>

<template>
  <div class="nm-object-catalog">
    <header class="nm-object-catalog__header" :title="headerTitle()">
      <div
        v-if="categories.length"
        class="nm-object-catalog__tabs"
        role="tablist"
        :aria-label="labels.toolbarLabel"
      >
        <button
          v-for="tab in categories"
          :key="tab.id"
          type="button"
          class="nm-object-catalog__tab"
          :class="{ 'nm-object-catalog__tab--active': category === tab.id }"
          role="tab"
          :aria-selected="category === tab.id"
          @click="category = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
      <span v-else class="nm-object-catalog__title">{{ labels.featureLabel }}</span>

      <div class="nm-object-catalog__actions">
        <RsButton
          variant="ghost"
          size="sm"
          icon="code-2"
          :disabled="!hasScope"
          :tooltip="labels.queryTooltip"
          @click="emit('query')"
        >
          {{ labels.query }}
        </RsButton>
        <RsPopover
          v-if="showCreate"
          v-model:open="createOpen"
          side="bottom"
          align="end"
          :side-offset="4"
          width="auto"
        >
          <RsButton
            variant="ghost"
            size="sm"
            icon="plus"
            :disabled="!hasScope"
            :tooltip="labels.createTooltip"
          >
            {{ labels.create }}
          </RsButton>
          <template #content>
            <slot name="create-menu" />
          </template>
        </RsPopover>
        <RsButton
          variant="ghost"
          size="sm"
          icon="refresh-cw"
          :loading="loading"
          :disabled="!hasScope"
          :tooltip="labels.refresh"
          @click="emit('refresh')"
        >
          {{ labels.refresh }}
        </RsButton>
        <RsInput
          v-model="filterText"
          class="nm-object-catalog__filter"
          size="sm"
          clearable
          :placeholder="labels.filterPlaceholder"
          :disabled="!hasScope"
        >
          <template #prefix>
            <RsIcon name="search" :size="13" />
          </template>
        </RsInput>
        <RsButton
          variant="ghost"
          size="sm"
          icon="file-code"
          :disabled="!canDdl"
          :tooltip="labels.ddlTooltip"
          @click="emit('ddl')"
        >
          {{ labels.ddl }}
        </RsButton>
        <slot name="toolbar-end" />
      </div>
    </header>

    <div class="nm-object-catalog__body">
      <RsLoading v-if="loading && !hasResult" block class="nm-object-catalog__loading" />
      <RsEmpty
        v-else-if="!hasScope"
        fill
        icon="database"
        :description="labels.needDatabase"
      />
      <RsEmpty
        v-else-if="!hasRows"
        fill
        icon="table"
        :description="filterText.trim() ? labels.emptyFilter : labels.empty"
      />
      <div v-else class="nm-object-catalog__table-wrap">
        <slot />
      </div>
    </div>

    <footer class="nm-object-catalog__status">
      <span v-if="statusMeta" class="nm-object-catalog__status-meta">{{ statusMeta }}</span>
      <span v-if="statusHint" class="nm-object-catalog__status-hint">{{ statusHint }}</span>
    </footer>
  </div>
</template>

<style scoped>
.nm-object-catalog {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-object-catalog__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
  min-width: 0;
}

.nm-object-catalog__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--rs-fg);
  flex-shrink: 0;
}

.nm-object-catalog__tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  min-width: 0;
}

.nm-object-catalog__tab {
  padding: 3px 10px;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: var(--rs-radius-sm, 4px);
  cursor: pointer;
  background: transparent;
  color: var(--rs-fg-muted, #6b7280);
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.nm-object-catalog__tab:hover {
  background: var(--rs-bg-elevated, #f3f4f6);
  color: var(--rs-fg, #111827);
}

.nm-object-catalog__tab--active {
  background: var(--rs-accent-subtle, #eff6ff);
  color: var(--rs-accent, #2563eb);
  border-color: var(--rs-accent-border, #bfdbfe);
  font-weight: 500;
}

.nm-object-catalog__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 1;
  min-width: 0;
  margin-left: auto;
}

.nm-object-catalog__filter {
  width: 11.5rem;
  flex-shrink: 1;
  min-width: 8rem;
}

.nm-object-catalog__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-object-catalog__loading,
.nm-object-catalog__table-wrap {
  flex: 1;
  min-height: 0;
}

.nm-object-catalog__status {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
  padding: 0.25rem 0.75rem;
  border-top: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-fg-muted);
}

.nm-object-catalog__status-meta {
  flex-shrink: 0;
}

.nm-object-catalog__status-hint {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
