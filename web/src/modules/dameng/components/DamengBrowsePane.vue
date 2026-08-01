<script setup lang="ts">
/**
 * 达梦表 / 视图数据浏览：挂载公共 BrowseDataShell。
 * 「浏览数据」共用本面板（表/视图；视图只读）。
 */
import {
  RsButton,
  RsCodeEditor,
  RsConfirmDialog,
  RsEmpty,
  RsLoading,
  RsPopover,
  RsTable,
} from '@niuma/ui'
import { computed } from 'vue'
import { BrowseDataShell, BrowseIoMenu } from '@/modules/database'
import { useDamengBrowsePane } from '@/modules/dameng/composables/useDamengBrowsePane'

/** 过滤 SQL 行号与表格提交/行号列对齐 */
const BROWSE_GUTTER_WIDTH = 40

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  schema?: string
  table?: string
  isView?: boolean
  sessionLabel?: string
  active: boolean
}>()

const {
  t,
  page,
  pageSize,
  pageSizeOptions,
  totalRows,
  filterOpen,
  filterDraft,
  appliedWhereSql,
  lastDataSql,
  loading,
  saving,
  lastResult,
  selectedRowKeys,
  resultRows,
  resultColumns,
  deleteConfirm,
  importMenuOpen,
  exportMenuOpen,
  importMenuItems,
  exportMenuItems,
  shellLabels,
  scopeLabel,
  scopeOk,
  canInsert,
  canEdit,
  canDeleteSelection,
  tableEditable,
  statusMeta,
  statusHint,
  isView,
  filterSqlConfig,
  refresh,
  onFilterKeydown,
  openInsert,
  requestDelete,
  confirmDelete,
  onBrowseKeydown,
  onCellEditCommit,
  isBrowseRowPending,
  onBrowseRowEditCommit,
  onBrowseRowEditRollback,
  contextMenuItems,
  onContextMenuSelect,
  onImportMenuSelect,
  onExportMenuSelect,
  openBrowseIo,
  ddlMenuOpen,
  ddlLoading,
  ddlText,
  objectType,
  canOpenDesign,
  copyBrowseDdl,
  openDesignTable,
  openDdlTab,
} = useDamengBrowsePane(props)

const showMutate = computed(() => !isView.value)
const importDisabled = computed(() => !canInsert.value || saving.value)
const exportDisabled = computed(
  () => !props.profileId && (!lastResult.value || resultRows.value.length === 0),
)
const statusWarn = computed(
  () => Boolean(lastResult.value) && !isView.value && !canEdit.value && !resultRows.value.some((r) => r.__isNew),
)
const deleteCount = computed(
  () => selectedRowKeys.value.filter((k) => !String(k).startsWith('new-')).length || 1,
)
</script>

<template>
  <BrowseDataShell
    v-model:page="page"
    v-model:page-size="pageSize"
    v-model:filter-open="filterOpen"
    v-model:import-menu-open="importMenuOpen"
    v-model:export-menu-open="exportMenuOpen"
    class="nm-dameng-browse"
    :labels="shellLabels"
    brand-icon="dameng"
    :session-label="sessionLabel || 'Dameng'"
    :scope-label="scopeLabel"
    :loading="loading"
    :saving="saving"
    :show-mutate="showMutate"
    :can-insert="canInsert"
    :can-delete="canDeleteSelection"
    :show-import="showMutate"
    :import-disabled="importDisabled"
    :export-disabled="exportDisabled"
    :has-active-filter="Boolean(appliedWhereSql)"
    :has-scope="scopeOk"
    :has-result="Boolean(lastResult)"
    :page-size-options="pageSizeOptions"
    :total-rows="totalRows"
    :last-data-sql="lastDataSql"
    :status-meta="statusMeta"
    :status-hint="statusHint"
    :status-warn="statusWarn"
    @insert="openInsert"
    @delete="requestDelete"
    @refresh="refresh"
    @keydown="onBrowseKeydown"
  >
    <template #import-menu>
      <BrowseIoMenu :items="importMenuItems" @select="onImportMenuSelect">
        <button
          type="button"
          class="nm-dameng-browse__io-extra"
          :disabled="!profileId || saving"
          @pointerdown.stop.prevent="openBrowseIo('import_csv')"
        >
          {{ t('modules.dameng.tree.importCsv') }}
        </button>
      </BrowseIoMenu>
    </template>
    <template #export-menu>
      <BrowseIoMenu :items="exportMenuItems" @select="onExportMenuSelect" />
    </template>

    <template #toolbar-extra>
      <RsPopover
        v-model:open="ddlMenuOpen"
        side="bottom"
        align="end"
        :side-offset="4"
        width="auto"
      >
        <RsButton
          variant="ghost"
          size="sm"
          icon="file-code"
          :disabled="!schema || !table || !sessionId"
          :tooltip="t('modules.dameng.browse.ddlTooltip')"
        >
          {{ t('modules.dameng.browse.ddl') }}
        </RsButton>
        <template #content>
          <div class="nm-dameng-browse__ddl-pop">
            <div class="nm-dameng-browse__ddl-head">
              <div class="nm-dameng-browse__ddl-title">
                <span>{{ t('modules.dameng.session.tabDdl') }}</span>
                <span v-if="objectType" class="nm-dameng-browse__ddl-type">{{ objectType }}</span>
              </div>
              <div class="nm-dameng-browse__ddl-actions">
                <RsButton
                  variant="ghost"
                  size="sm"
                  icon="copy"
                  :disabled="!ddlText || ddlLoading"
                  :tooltip="t('modules.dameng.ddl.copy')"
                  @click="copyBrowseDdl"
                >
                  {{ t('modules.dameng.ddl.copy') }}
                </RsButton>
                <RsButton
                  v-if="canOpenDesign"
                  variant="ghost"
                  size="sm"
                  icon="pencil"
                  :disabled="!schema || !table || !profileId"
                  :tooltip="t('modules.dameng.browse.openDesignTooltip')"
                  @click="openDesignTable"
                >
                  {{ t('modules.dameng.browse.openDesign') }}
                </RsButton>
                <RsButton
                  variant="ghost"
                  size="sm"
                  icon="external-link"
                  :disabled="!schema || !table || !profileId"
                  :tooltip="t('modules.dameng.browse.openDdlTooltip')"
                  @click="openDdlTab"
                >
                  {{ t('modules.dameng.browse.openDdl') }}
                </RsButton>
              </div>
            </div>
            <RsLoading v-if="ddlLoading && !ddlText" block class="nm-dameng-browse__ddl-loading" />
            <RsEmpty
              v-else-if="!ddlText"
              class="nm-dameng-browse__ddl-empty"
              icon="file-code"
              :description="t('modules.dameng.ddl.empty')"
            />
            <RsCodeEditor
              v-else
              v-model="ddlText"
              class="nm-dameng-browse__ddl-editor"
              language="sql"
              readonly
              embedded
              :rounded="false"
              :show-toolbar="false"
              height="100%"
            />
          </div>
        </template>
      </RsPopover>
    </template>

    <template #filter>
      <div class="nm-dameng-browse__filter" @keydown.capture="onFilterKeydown">
        <RsCodeEditor
          v-model="filterDraft"
          language="sql"
          embedded
          :rounded="false"
          :fold-gutter="false"
          :gutter-width="BROWSE_GUTTER_WIDTH"
          :show-toolbar="false"
          height="100%"
          :sql-config="filterSqlConfig"
          :placeholder="t('modules.dameng.browse.filterEditorPlaceholder')"
        />
      </div>
    </template>

    <RsTable
      v-model:selected-row-keys="selectedRowKeys"
      :columns="resultColumns"
      :data="resultRows"
      row-key="__rowKey"
      size="sm"
      striped
      fill
      bordered
      column-bordered
      :rounded="false"
      show-index
      :index-width="BROWSE_GUTTER_WIDTH"
      :edit-gutter-width="BROWSE_GUTTER_WIDTH"
      resizable
      column-layout="fixed"
      cell-tooltip
      highlight-row
      selectable
      selection-type="row"
      :editable="tableEditable"
      :allow-null="tableEditable"
      edit-trigger="dblclick"
      :row-pending="isBrowseRowPending"
      :context-menu-items="contextMenuItems"
      :loading="loading"
      :virtual="true"
      :virtual-auto-threshold="40"
      :virtual-columns-auto-threshold="40"
      :layout-active="active"
      @cell-edit-commit="onCellEditCommit"
      @row-edit-commit="onBrowseRowEditCommit"
      @row-edit-rollback="onBrowseRowEditRollback"
      @context-menu-select="onContextMenuSelect"
    >
      <template #empty>
        {{ t('modules.dameng.browse.empty') }}
      </template>
    </RsTable>

    <template #dialogs>
      <RsConfirmDialog
        v-model:open="deleteConfirm"
        :title="t('modules.dameng.browse.deleteTitle')"
        :description="t('modules.dameng.browse.deleteDesc', { count: deleteCount })"
        tone="danger"
        confirm-variant="danger"
        @confirm="confirmDelete"
      />
    </template>
  </BrowseDataShell>
</template>

<style scoped>
.nm-dameng-browse__filter {
  display: block;
  width: 100%;
  height: 100%;
}

.nm-dameng-browse__ddl-pop {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(42rem, 80vw);
  height: min(26rem, 65vh);
  min-height: 16rem;
}

.nm-dameng-browse__ddl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-shrink: 0;
  min-width: 0;
}

.nm-dameng-browse__ddl-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}

.nm-dameng-browse__ddl-type {
  font-weight: 500;
  color: var(--rs-muted);
  font-family: var(--rs-font-mono);
  font-size: 11px;
}

.nm-dameng-browse__ddl-actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-shrink: 0;
}

.nm-dameng-browse__ddl-loading,
.nm-dameng-browse__ddl-empty,
.nm-dameng-browse__ddl-editor {
  flex: 1;
  min-height: 0;
}

.nm-dameng-browse__io-extra {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.55rem;
  border: 0;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.nm-dameng-browse__io-extra:hover:not(:disabled) {
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.12));
}

.nm-dameng-browse__io-extra:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
