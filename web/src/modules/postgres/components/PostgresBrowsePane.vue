<script setup lang="ts">
/**
 * PostgreSQL 表 / 视图数据浏览：挂载公共 BrowseDataShell。
 * 对齐 MySQL：网格右键复制 INSERT/UPDATE/DELETE、粘贴、行提交；视图只读。
 */
import {
  RsButton,
  RsCodeEditor,
  RsConfirmDialog,
  RsEmpty,
  RsLoading,
  RsPopover,
} from '@niuma/ui'
import { computed } from 'vue'
import {
  BrowseDataGrid,
  BrowseDataShell,
  BrowseIoMenu,
} from '@/modules/database'
import { usePostgresBrowsePane } from '@/modules/postgres/composables/usePostgresBrowsePane'

const BROWSE_GUTTER_WIDTH = 40

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
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
} = usePostgresBrowsePane(props)

const dialogLabels = computed(() => ({
  apply: t('modules.postgres.browse.cellApply'),
  cancel: t('modules.postgres.browse.cellCancel'),
  hint: t('modules.postgres.browse.cellApplyHint'),
  viewTitle: t('modules.postgres.browse.cellView'),
}))

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
    class="nm-postgres-browse"
    :labels="shellLabels"
    brand-icon="database"
    :session-label="sessionLabel || 'Postgres'"
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
          class="nm-postgres-browse__io-extra"
          :disabled="!profileId || saving"
          @pointerdown.stop.prevent="openBrowseIo('import_csv')"
        >
          {{ t('modules.postgres.tree.importCsv') }}
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
          :disabled="!database || !table || !sessionId"
          :tooltip="t('modules.postgres.browse.ddlTooltip')"
        >
          {{ t('modules.postgres.browse.ddl') }}
        </RsButton>
        <template #content>
          <div class="nm-postgres-browse__ddl-pop">
            <div class="nm-postgres-browse__ddl-head">
              <div class="nm-postgres-browse__ddl-title">
                <span>{{ t('modules.postgres.session.tabDdl') }}</span>
                <span v-if="objectType" class="nm-postgres-browse__ddl-type">{{ objectType }}</span>
              </div>
              <div class="nm-postgres-browse__ddl-actions">
                <RsButton
                  variant="ghost"
                  size="sm"
                  icon="copy"
                  :disabled="!ddlText || ddlLoading"
                  :tooltip="t('modules.postgres.ddl.copy')"
                  @click="copyBrowseDdl"
                >
                  {{ t('modules.postgres.ddl.copy') }}
                </RsButton>
                <RsButton
                  v-if="canOpenDesign"
                  variant="ghost"
                  size="sm"
                  icon="pencil"
                  :disabled="!database || !table || !profileId"
                  :tooltip="t('modules.postgres.browse.openDesignTooltip')"
                  @click="openDesignTable"
                >
                  {{ t('modules.postgres.browse.openDesign') }}
                </RsButton>
                <RsButton
                  variant="ghost"
                  size="sm"
                  icon="external-link"
                  :disabled="!database || !table || !profileId"
                  :tooltip="t('modules.postgres.browse.openDdlTooltip')"
                  @click="openDdlTab"
                >
                  {{ t('modules.postgres.browse.openDdl') }}
                </RsButton>
              </div>
            </div>
            <RsLoading v-if="ddlLoading && !ddlText" block class="nm-postgres-browse__ddl-loading" />
            <RsEmpty
              v-else-if="!ddlText"
              class="nm-postgres-browse__ddl-empty"
              icon="file-code"
              :description="t('modules.postgres.ddl.empty')"
            />
            <RsCodeEditor
              v-else
              v-model="ddlText"
              class="nm-postgres-browse__ddl-editor"
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
      <div class="nm-postgres-browse__filter" @keydown.capture="onFilterKeydown">
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
          :placeholder="t('modules.postgres.browse.filterEditorPlaceholder')"
        />
      </div>
    </template>

    <BrowseDataGrid
      v-model:selected-row-keys="selectedRowKeys"
      :columns="resultColumns"
      :data="resultRows"
      :loading="loading"
      :editable="tableEditable"
      :allow-null="tableEditable"
      :row-pending="isBrowseRowPending"
      :context-menu-items="contextMenuItems"
      :layout-active="active"
      :gutter-width="BROWSE_GUTTER_WIDTH"
      :dialog-labels="dialogLabels"
      :empty-text="t('modules.postgres.browse.empty')"
      @cell-edit-commit="onCellEditCommit"
      @row-edit-commit="onBrowseRowEditCommit"
      @row-edit-rollback="onBrowseRowEditRollback"
      @context-menu-select="onContextMenuSelect"
    />

    <template #dialogs>
      <RsConfirmDialog
        v-model:open="deleteConfirm"
        :title="t('modules.postgres.browse.deleteTitle')"
        :description="t('modules.postgres.browse.deleteDesc', { count: deleteCount })"
        tone="danger"
        confirm-variant="danger"
        @confirm="confirmDelete"
      />
    </template>
  </BrowseDataShell>
</template>

<style scoped>
.nm-postgres-browse__filter {
  display: block;
  width: 100%;
  height: 100%;
}

.nm-postgres-browse__ddl-pop {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(42rem, 80vw);
  height: min(26rem, 65vh);
  min-height: 16rem;
}

.nm-postgres-browse__ddl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-shrink: 0;
  min-width: 0;
}

.nm-postgres-browse__ddl-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}

.nm-postgres-browse__ddl-type {
  font-weight: 500;
  color: var(--rs-muted);
  font-family: var(--rs-font-mono);
  font-size: 11px;
}

.nm-postgres-browse__ddl-actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-shrink: 0;
}

.nm-postgres-browse__ddl-loading,
.nm-postgres-browse__ddl-empty,
.nm-postgres-browse__ddl-editor {
  flex: 1;
  min-height: 0;
}

.nm-postgres-browse__io-extra {
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

.nm-postgres-browse__io-extra:hover:not(:disabled) {
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.12));
}

.nm-postgres-browse__io-extra:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
