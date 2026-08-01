<script setup lang="ts">
/**
 * 表设计器外壳：header / meta / section tabs / list+editor。
 * SQL 预览由方言侧通过 #preview 槽挂 RsPopover（CodeMirror），不在壳内嵌 pre。
 */
import { RsButton, RsIcon, RsLoading } from '@niuma/ui'
import type {
  TableDesignMode,
  TableDesignSection,
  TableDesignSectionItem,
  TableDesignShellLabels,
} from '../types/table-design'

withDefaults(
  defineProps<{
    labels: TableDesignShellLabels
    title: string
    mode: TableDesignMode
    scopeLabel?: string
    loading?: boolean
    saving?: boolean
    canPreview?: boolean
    canApply?: boolean
    showReload?: boolean
    sections: TableDesignSectionItem[]
    activeSection: TableDesignSection
    showEditor?: boolean
  }>(),
  {
    scopeLabel: '',
    loading: false,
    saving: false,
    canPreview: true,
    canApply: true,
    showReload: true,
    showEditor: true,
  },
)

const emit = defineEmits<{
  reload: []
  preview: []
  apply: []
  'update:activeSection': [id: TableDesignSection]
}>()
</script>

<template>
  <div class="nm-table-design">
    <header class="nm-table-design__header">
      <div class="nm-table-design__header-left">
        <RsIcon name="layout-list" :size="15" />
        <span class="nm-table-design__title">{{ title }}</span>
        <span v-if="scopeLabel" class="nm-table-design__label">{{ scopeLabel }}</span>
      </div>
      <div class="nm-table-design__header-right">
        <slot name="toolbar-extra" />
        <RsButton
          v-if="showReload"
          size="sm"
          variant="ghost"
          :loading="loading"
          icon="refresh-cw"
          @click="emit('reload')"
        >
          {{ labels.reload }}
        </RsButton>
        <slot name="preview">
          <RsButton
            size="sm"
            variant="ghost"
            :disabled="!canPreview || loading"
            @click="emit('preview')"
          >
            {{ labels.preview }}
          </RsButton>
        </slot>
        <RsButton
          size="sm"
          variant="primary"
          :loading="saving"
          :disabled="!canApply || loading"
          @click="emit('apply')"
        >
          {{ mode === 'create' ? labels.create : labels.apply }}
        </RsButton>
      </div>
    </header>

    <RsLoading v-if="loading" class="nm-table-design__loading" />

    <div v-else class="nm-table-design__content">
      <div v-if="$slots.meta" class="nm-table-design__meta">
        <slot name="meta" />
      </div>

      <div class="nm-table-design__tabs" role="tablist">
        <button
          v-for="sec in sections"
          :key="sec.id"
          type="button"
          role="tab"
          class="nm-table-design__tab"
          :class="{ 'nm-table-design__tab--active': activeSection === sec.id }"
          :aria-selected="activeSection === sec.id"
          @click="emit('update:activeSection', sec.id)"
        >
          {{ sec.label }}
          <span v-if="sec.count != null" class="nm-table-design__tab-count">{{ sec.count }}</span>
        </button>
      </div>

      <div class="nm-table-design__main">
        <div class="nm-table-design__list">
          <slot name="list" />
        </div>
        <aside v-if="showEditor" class="nm-table-design__editor">
          <slot name="editor" />
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nm-table-design {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.nm-table-design__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
}
.nm-table-design__header-left {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.nm-table-design__title {
  font-weight: 600;
  font-size: 13px;
}
.nm-table-design__label {
  font-size: 12px;
  color: var(--rs-fg-muted);
}
.nm-table-design__header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.nm-table-design__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nm-table-design__content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.nm-table-design__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
}
.nm-table-design__tabs {
  display: flex;
  gap: 0;
  padding: 0 12px;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
}
.nm-table-design__tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  font-size: 12px;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  background: transparent;
  color: var(--rs-fg-muted, #6b7280);
}
.nm-table-design__tab--active {
  color: var(--rs-accent, #2563eb);
  border-bottom-color: var(--rs-accent, #2563eb);
  font-weight: 500;
}
.nm-table-design__tab-count {
  background: var(--rs-bg-elevated, #f3f4f6);
  color: var(--rs-fg-muted);
  border-radius: 10px;
  padding: 0 6px;
  font-size: 11px;
}
.nm-table-design__main {
  flex: 1;
  min-height: 0;
  display: flex;
}
.nm-table-design__list {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.nm-table-design__editor {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 10px;
  gap: 4px;
  border-left: 1px solid var(--rs-border-subtle, #e5e7eb);
}
</style>
