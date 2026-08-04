<script setup lang="ts">
import {
  RsButton,
  RsCodeEditor,
  RsConfirmDialog,
  RsEmpty,
  RsLoading,
  RsPopover,
} from '@niuma/ui'
import { computed, proxyRefs } from 'vue'
import {
  BrowseDataGrid,
  BrowseDataShell,
  BrowseIoMenu,
} from '@/modules/database'
import { useOracleBrowsePane } from '@/modules/oracle/composables/useOracleBrowsePane'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  schema?: string
  table?: string
  isView?: boolean
  sessionLabel?: string
  active: boolean
}>()

const pane = proxyRefs(useOracleBrowsePane(props))
const dialogLabels = computed(() => ({
  apply: pane.t('modules.oracle.browse.cellApply'),
  cancel: pane.t('modules.oracle.browse.cellCancel'),
  hint: pane.t('modules.oracle.browse.cellApplyHint'),
  viewTitle: pane.t('modules.oracle.browse.cellView'),
}))
const showMutate = computed(() => !pane.isView)
const importDisabled = computed(() => !pane.canInsert || pane.saving)
const exportDisabled = computed(
  () => !props.profileId && (!pane.lastResult || pane.resultRows.length === 0),
)
const statusWarn = computed(
  () =>
    Boolean(pane.lastResult) &&
    !pane.isView &&
    !pane.canEdit &&
    !pane.resultRows.some((r) => r.__isNew),
)
const deleteCount = computed(
  () => pane.selectedRowKeys.filter((key) => !key.startsWith('new-')).length || 1,
)
</script>

<template>
  <BrowseDataShell
    v-model:page="pane.page"
    v-model:page-size="pane.pageSize"
    v-model:filter-open="pane.filterOpen"
    v-model:import-menu-open="pane.importMenuOpen"
    v-model:export-menu-open="pane.exportMenuOpen"
    class="nm-oracle-browse"
    :labels="pane.shellLabels"
    brand-icon="database"
    :session-label="sessionLabel || 'Oracle'"
    :scope-label="pane.scopeLabel"
    :loading="pane.loading"
    :saving="pane.saving"
    :show-mutate="showMutate"
    :can-insert="pane.canInsert"
    :can-delete="pane.canDeleteSelection"
    :show-import="showMutate"
    :import-disabled="importDisabled"
    :export-disabled="exportDisabled"
    :show-filter="true"
    :has-active-filter="Boolean(pane.appliedWhereSql)"
    :has-scope="pane.scopeOk"
    :has-result="Boolean(pane.lastResult)"
    :page-size-options="pane.pageSizeOptions"
    :total-rows="pane.totalRows"
    :last-data-sql="pane.lastDataSql"
    :status-meta="pane.statusMeta"
    :status-hint="pane.statusHint"
    :status-warn="statusWarn"
    @insert="pane.openInsert"
    @delete="pane.requestDelete"
    @refresh="() => pane.loadData()"
    @keydown="pane.onBrowseKeydown"
  >
    <template #import-menu>
      <BrowseIoMenu :items="pane.importMenuItems" @select="pane.onImportMenuSelect">
        <button
          type="button"
          class="nm-oracle-browse__io-extra"
          :disabled="!profileId || pane.saving"
          @pointerdown.stop.prevent="pane.openBrowseIo('import_csv')"
        >
          {{ pane.t('modules.oracle.tree.importCsv') }}
        </button>
      </BrowseIoMenu>
    </template>
    <template #export-menu>
      <BrowseIoMenu :items="pane.exportMenuItems" @select="pane.onExportMenuSelect" />
    </template>

    <template #toolbar-extra>
      <RsPopover
        v-model:open="pane.ddlMenuOpen"
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
          :tooltip="pane.t('modules.oracle.browse.ddlTooltip')"
        >
          {{ pane.t('modules.oracle.browse.ddl') }}
        </RsButton>
        <template #content>
          <div class="nm-oracle-browse__ddl-pop">
            <div class="nm-oracle-browse__ddl-head">
              <div class="nm-oracle-browse__ddl-title">
                <span>{{ pane.t('modules.oracle.session.tabDdl') }}</span>
                <span v-if="pane.objectType" class="nm-oracle-browse__ddl-type">{{ pane.objectType }}</span>
              </div>
              <div class="nm-oracle-browse__ddl-actions">
                <RsButton
                  variant="ghost"
                  size="sm"
                  icon="copy"
                  :disabled="!pane.ddlText || pane.ddlLoading"
                  :tooltip="pane.t('modules.oracle.ddl.copy')"
                  @click="pane.copyBrowseDdl"
                >
                  {{ pane.t('modules.oracle.ddl.copy') }}
                </RsButton>
                <RsButton
                  v-if="pane.canOpenDesign"
                  variant="ghost"
                  size="sm"
                  icon="pencil"
                  :disabled="!table || !profileId"
                  :tooltip="pane.t('modules.oracle.browse.openDesignTooltip')"
                  @click="pane.openDesignTable"
                >
                  {{ pane.t('modules.oracle.browse.openDesign') }}
                </RsButton>
                <RsButton
                  variant="ghost"
                  size="sm"
                  icon="external-link"
                  :disabled="!table || !profileId"
                  :tooltip="pane.t('modules.oracle.browse.openDdlTooltip')"
                  @click="pane.openDdlTab"
                >
                  {{ pane.t('modules.oracle.browse.openDdl') }}
                </RsButton>
              </div>
            </div>
            <RsLoading
              v-if="pane.ddlLoading && !pane.ddlText"
              block
              class="nm-oracle-browse__ddl-loading"
            />
            <RsEmpty
              v-else-if="!pane.ddlText"
              class="nm-oracle-browse__ddl-empty"
              icon="file-code"
              :description="pane.t('modules.oracle.ddl.empty')"
            />
            <RsCodeEditor
              v-else
              v-model="pane.ddlText"
              class="nm-oracle-browse__ddl-editor"
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
      <div class="nm-oracle-browse__filter" @keydown.capture="pane.onFilterKeydown">
        <RsCodeEditor
          v-model="pane.filterDraft"
          language="sql"
          embedded
          :rounded="false"
          :fold-gutter="false"
          :gutter-width="pane.BROWSE_GUTTER_WIDTH"
          :show-toolbar="false"
          height="100%"
          :sql-config="pane.filterSqlConfig"
          :placeholder="pane.t('modules.oracle.browse.filterEditorPlaceholder')"
        />
      </div>
    </template>

    <BrowseDataGrid
      v-model:selected-row-keys="pane.selectedRowKeys"
      :columns="pane.resultColumns"
      :data="pane.resultRows"
      :loading="pane.loading"
      :editable="pane.tableEditable"
      :allow-null="pane.tableEditable"
      :row-pending="pane.isBrowseRowPending"
      :context-menu-items="pane.contextMenuItems"
      :layout-active="active"
      :gutter-width="pane.BROWSE_GUTTER_WIDTH"
      :dialog-labels="dialogLabels"
      :empty-text="pane.t('modules.oracle.browse.empty')"
      @cell-edit-commit="pane.onCellEditCommit"
      @row-edit-commit="pane.onBrowseRowEditCommit"
      @row-edit-rollback="pane.onBrowseRowEditRollback"
      @context-menu-select="pane.onContextMenuSelect"
    />

    <template #dialogs>
      <RsConfirmDialog
        v-model:open="pane.deleteConfirm"
        :title="pane.t('modules.oracle.browse.deleteTitle')"
        :description="pane.t('modules.oracle.browse.deleteDesc', { count: deleteCount })"
        tone="danger"
        confirm-variant="danger"
        @confirm="pane.confirmDelete"
      />
    </template>
  </BrowseDataShell>
</template>

<style scoped>
.nm-oracle-browse__filter {
  width: 100%;
  height: 100%;
}

.nm-oracle-browse__ddl-pop {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(42rem, 80vw);
  height: min(26rem, 65vh);
  min-height: 16rem;
}

.nm-oracle-browse__ddl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-shrink: 0;
  min-width: 0;
}

.nm-oracle-browse__ddl-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}

.nm-oracle-browse__ddl-type {
  font-weight: 500;
  color: var(--rs-muted);
  font-family: var(--rs-font-mono);
  font-size: 11px;
}

.nm-oracle-browse__ddl-actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-shrink: 0;
}

.nm-oracle-browse__ddl-loading,
.nm-oracle-browse__ddl-empty,
.nm-oracle-browse__ddl-editor {
  flex: 1;
  min-height: 0;
}

.nm-oracle-browse__io-extra {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0.35rem 0.6rem;
  border: none;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  text-align: left;
  cursor: pointer;
}

.nm-oracle-browse__io-extra:hover:not(:disabled) {
  background: var(--rs-bg-elevated, var(--rs-bg));
}

.nm-oracle-browse__io-extra:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
