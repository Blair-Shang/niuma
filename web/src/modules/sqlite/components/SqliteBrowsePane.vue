<script setup lang="ts">
/**
 * SQLite 表/视图数据浏览：挂载公共 BrowseDataShell。
 * 布局与 MySQL Browse 对齐；基表支持单元格编辑 / 插入 / 删除（走 sqlite.query.exec）。
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
import { useSqliteBrowsePane } from '@/modules/sqlite/composables/useSqliteBrowsePane'

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
  BROWSE_GUTTER_WIDTH,
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
  shellLabels,
  scopeLabel,
  scopeOk,
  statusMeta,
  statusHint,
  isView,
  filterSqlConfig,
  canInsert,
  canDeleteSelection,
  tableEditable,
  loadData,
  onFilterKeydown,
  importMenuItems,
  exportMenuItems,
  onImportMenuSelect,
  onExportMenuSelect,
  openInsert,
  requestDelete,
  confirmDelete,
  onCellEditCommit,
  isBrowseRowPending,
  onBrowseRowEditCommit,
  onBrowseRowEditRollback,
  onBrowseKeydown,
  contextMenuItems,
  onContextMenuSelect,
  ddlMenuOpen,
  ddlLoading,
  ddlText,
  objectType,
  canOpenDesign,
  copyBrowseDdl,
  openDesignTable,
  openDdlTab,
} = useSqliteBrowsePane(props)

const showMutate = computed(() => !isView.value)
const importDisabled = computed(() => !canInsert.value || saving.value)
const exportDisabled = computed(
  () => !props.profileId && (!lastResult.value || resultRows.value.length === 0),
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
    class="nm-sqlite-browse"
    :labels="shellLabels"
    brand-icon="sqlite"
    :session-label="sessionLabel || 'SQLite'"
    :scope-label="scopeLabel"
    :loading="loading"
    :saving="saving"
    :show-mutate="showMutate"
    :can-insert="canInsert"
    :can-delete="canDeleteSelection"
    :show-import="showMutate"
    :import-disabled="importDisabled"
    :export-disabled="exportDisabled"
    :show-filter="true"
    :has-active-filter="Boolean(appliedWhereSql)"
    :has-scope="scopeOk"
    :has-result="Boolean(lastResult)"
    :page-size-options="pageSizeOptions"
    :total-rows="totalRows"
    :last-data-sql="lastDataSql"
    :status-meta="statusMeta"
    :status-hint="statusHint"
    @insert="openInsert"
    @delete="requestDelete"
    @refresh="() => loadData()"
    @keydown="onBrowseKeydown"
  >
    <template #import-menu>
      <BrowseIoMenu :items="importMenuItems" @select="onImportMenuSelect" />
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
          :disabled="!table || !sessionId"
          :tooltip="t('modules.sqlite.browse.ddlTooltip')"
        >
          {{ t('modules.sqlite.browse.ddl') }}
        </RsButton>
        <template #content>
          <div class="nm-sqlite-browse__ddl-pop">
            <div class="nm-sqlite-browse__ddl-head">
              <div class="nm-sqlite-browse__ddl-title">
                <span>{{ t('modules.sqlite.session.tabDdl') }}</span>
                <span v-if="objectType" class="nm-sqlite-browse__ddl-type">{{ objectType }}</span>
              </div>
              <div class="nm-sqlite-browse__ddl-actions">
                <RsButton
                  variant="ghost"
                  size="sm"
                  icon="copy"
                  :disabled="!ddlText || ddlLoading"
                  :tooltip="t('modules.sqlite.ddl.copy')"
                  @click="copyBrowseDdl"
                >
                  {{ t('modules.sqlite.ddl.copy') }}
                </RsButton>
                <RsButton
                  v-if="canOpenDesign"
                  variant="ghost"
                  size="sm"
                  icon="pencil"
                  :disabled="!table || !profileId"
                  :tooltip="t('modules.sqlite.browse.openDesignTooltip')"
                  @click="openDesignTable"
                >
                  {{ t('modules.sqlite.browse.openDesign') }}
                </RsButton>
                <RsButton
                  variant="ghost"
                  size="sm"
                  icon="external-link"
                  :disabled="!table || !profileId"
                  :tooltip="t('modules.sqlite.browse.openDdlTooltip')"
                  @click="openDdlTab"
                >
                  {{ t('modules.sqlite.browse.openDdl') }}
                </RsButton>
              </div>
            </div>
            <RsLoading v-if="ddlLoading && !ddlText" block class="nm-sqlite-browse__ddl-loading" />
            <RsEmpty
              v-else-if="!ddlText"
              class="nm-sqlite-browse__ddl-empty"
              icon="file-code"
              :description="t('modules.sqlite.ddl.empty')"
            />
            <RsCodeEditor
              v-else
              v-model="ddlText"
              class="nm-sqlite-browse__ddl-editor"
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
      <div class="nm-sqlite-browse__filter" @keydown.capture="onFilterKeydown">
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
          :placeholder="t('modules.sqlite.browse.filterEditorPlaceholder')"
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
        {{ t('modules.sqlite.browse.empty') }}
      </template>
    </RsTable>

    <template #dialogs>
      <RsConfirmDialog
        v-model:open="deleteConfirm"
        :title="t('modules.sqlite.browse.deleteTitle')"
        :description="t('modules.sqlite.browse.deleteDesc', { count: deleteCount })"
        tone="danger"
        confirm-variant="danger"
        @confirm="confirmDelete"
      />
    </template>
  </BrowseDataShell>
</template>

<style scoped>
.nm-sqlite-browse__filter {
  display: block;
  width: 100%;
  height: 100%;
}

.nm-sqlite-browse__ddl-pop {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(42rem, 80vw);
  height: min(26rem, 65vh);
  min-height: 16rem;
}

.nm-sqlite-browse__ddl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-shrink: 0;
  min-width: 0;
}

.nm-sqlite-browse__ddl-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}

.nm-sqlite-browse__ddl-type {
  font-weight: 500;
  color: var(--rs-muted);
  font-family: var(--rs-font-mono);
  font-size: 11px;
}

.nm-sqlite-browse__ddl-actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-shrink: 0;
}

.nm-sqlite-browse__ddl-loading,
.nm-sqlite-browse__ddl-empty,
.nm-sqlite-browse__ddl-editor {
  flex: 1;
  min-height: 0;
}
</style>
