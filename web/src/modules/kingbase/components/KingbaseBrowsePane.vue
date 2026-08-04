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
import { BrowseDataGrid, BrowseDataShell } from '@/modules/database'
import { useKingbaseBrowsePane } from '@/modules/kingbase/composables/useKingbaseBrowsePane'

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
const pane = proxyRefs(useKingbaseBrowsePane(props))

const dialogLabels = computed(() => ({
  apply: pane.t('modules.kingbase.browse.cellApply'),
  cancel: pane.t('modules.kingbase.browse.cellCancel'),
  hint: pane.t('modules.kingbase.browse.cellApplyHint'),
  viewTitle: pane.t('modules.kingbase.browse.cellView'),
}))
</script>

<template>
  <BrowseDataShell
    v-model:page="pane.page"
    v-model:page-size="pane.pageSize"
    v-model:filter-open="pane.filterOpen"
    v-model:import-menu-open="pane.importMenuOpen"
    v-model:export-menu-open="pane.exportMenuOpen"
    class="nm-kingbase-browse"
    :labels="pane.shellLabels"
    brand-icon="database"
    :session-label="sessionLabel || 'Kingbase'"
    :scope-label="pane.scopeLabel"
    :loading="pane.loading"
    :saving="pane.saving"
    :show-mutate="!pane.isView"
    :can-insert="pane.canInsert"
    :can-delete="pane.canDelete"
    :show-import="pane.canInsert"
    :show-export="true"
    :export-disabled="!pane.lastResult"
    :has-active-filter="Boolean(pane.appliedWhereSql)"
    :has-scope="pane.scopeOk"
    :has-result="Boolean(pane.lastResult)"
    :page-size-options="pane.pageSizeOptions"
    :total-rows="pane.totalRows"
    :last-data-sql="pane.lastDataSql"
    :status-meta="pane.statusMeta"
    :status-hint="pane.statusHint"
    @refresh="pane.refresh"
    @insert="pane.openInsert"
    @delete="pane.deleteConfirm = true"
  >
    <template #export-menu>
      <button type="button" class="nm-kingbase-browse__menu-item" @click="pane.localExport('csv')">CSV</button>
      <button type="button" class="nm-kingbase-browse__menu-item" @click="pane.localExport('json')">JSON</button>
      <button type="button" class="nm-kingbase-browse__menu-item" @click="pane.localExport('tsv')">TSV</button>
      <button type="button" class="nm-kingbase-browse__menu-item" @click="pane.openFullCsv('export_csv')">
        {{ pane.t('modules.kingbase.browse.formatCsvFull') }}
      </button>
      <button type="button" class="nm-kingbase-browse__menu-item" @click="pane.copyTsv()">
        {{ pane.t('modules.kingbase.browse.copyTsv') }}
      </button>
    </template>
    <template #import-menu>
      <button type="button" class="nm-kingbase-browse__menu-item" @click="pane.localImport('csv')">CSV</button>
      <button type="button" class="nm-kingbase-browse__menu-item" @click="pane.localImport('json')">JSON</button>
      <button type="button" class="nm-kingbase-browse__menu-item" @click="pane.localImport('tsv')">TSV</button>
      <button type="button" class="nm-kingbase-browse__menu-item" @click="pane.openFullCsv('import_csv')">
        {{ pane.t('modules.kingbase.browse.importCsvFull') }}
      </button>
    </template>
    <template #toolbar-extra>
      <RsPopover v-model:open="pane.ddlMenuOpen" side="bottom" align="end" :side-offset="4" width="auto">
        <RsButton
          variant="ghost"
          size="sm"
          icon="file-code"
          :disabled="!table || !sessionId"
          :tooltip="pane.t('modules.kingbase.browse.ddlTooltip')"
        >
          {{ pane.t('modules.kingbase.browse.ddl') }}
        </RsButton>
        <template #content>
          <div class="nm-kingbase-browse__ddl-pop">
            <div class="nm-kingbase-browse__ddl-head">
              <div class="nm-kingbase-browse__ddl-title">
                <span>{{ pane.t('modules.kingbase.session.tabDdl') }}</span>
                <span v-if="pane.objectType" class="nm-kingbase-browse__ddl-type">{{ pane.objectType }}</span>
              </div>
              <div class="nm-kingbase-browse__ddl-actions">
                <RsButton
                  variant="ghost"
                  size="sm"
                  icon="copy"
                  :disabled="!pane.ddlText || pane.ddlLoading"
                  :tooltip="pane.t('modules.kingbase.ddl.copy')"
                  @click="pane.copyBrowseDdl"
                >
                  {{ pane.t('modules.kingbase.ddl.copy') }}
                </RsButton>
                <RsButton
                  v-if="pane.canOpenDesign"
                  variant="ghost"
                  size="sm"
                  icon="pencil"
                  :disabled="!table || !profileId"
                  :tooltip="pane.t('modules.kingbase.browse.openDesignTooltip')"
                  @click="pane.openDesignTable"
                >
                  {{ pane.t('modules.kingbase.browse.openDesign') }}
                </RsButton>
                <RsButton
                  variant="ghost"
                  size="sm"
                  icon="external-link"
                  :disabled="!table || !profileId"
                  :tooltip="pane.t('modules.kingbase.browse.openDdlTooltip')"
                  @click="pane.openDdlTab"
                >
                  {{ pane.t('modules.kingbase.browse.openDdl') }}
                </RsButton>
              </div>
            </div>
            <RsLoading v-if="pane.ddlLoading && !pane.ddlText" block class="nm-kingbase-browse__ddl-loading" />
            <RsEmpty
              v-else-if="!pane.ddlText"
              class="nm-kingbase-browse__ddl-empty"
              icon="file-code"
              :description="pane.t('modules.kingbase.ddl.empty')"
            />
            <RsCodeEditor
              v-else
              v-model="pane.ddlText"
              class="nm-kingbase-browse__ddl-editor"
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
      <div class="nm-kingbase-browse__filter" @keydown.capture="pane.onFilterKeydown">
        <RsCodeEditor
          v-model="pane.filterDraft"
          language="sql"
          embedded
          :rounded="false"
          :fold-gutter="false"
          :gutter-width="pane.browseGutterWidth"
          :show-toolbar="false"
          height="100%"
          :sql-config="pane.filterSqlConfig"
          :placeholder="pane.t('modules.kingbase.browse.filterEditorPlaceholder')"
        />
      </div>
    </template>
    <BrowseDataGrid
      v-model:selected-row-keys="pane.selectedRowKeys"
      :columns="pane.resultColumns"
      :data="pane.resultRows"
      :loading="pane.loading"
      :editable="pane.canEdit || pane.resultRows.some((row) => row.__isNew)"
      :allow-null="pane.canEdit"
      :row-pending="pane.isBrowseRowPending"
      :layout-active="active"
      :gutter-width="pane.browseGutterWidth"
      :dialog-labels="dialogLabels"
      :empty-text="pane.t('modules.kingbase.browse.empty')"
      @cell-edit-commit="pane.onCellEditCommit"
      @row-edit-commit="pane.onBrowseRowEditCommit"
      @row-edit-rollback="pane.onBrowseRowEditRollback"
    />

    <template #dialogs>
      <RsConfirmDialog
        v-model:open="pane.deleteConfirm"
        :title="pane.t('modules.kingbase.browse.deleteTitle')"
        :description="pane.t('modules.kingbase.browse.deleteDesc', { count: pane.selectedRowKeys.length })"
        tone="danger"
        confirm-variant="danger"
        @confirm="pane.deleteSelected"
      />
    </template>
  </BrowseDataShell>
</template>

<style scoped>
.nm-kingbase-browse__filter {
  display: block;
  width: 100%;
  height: 100%;
}
.nm-kingbase-browse__menu-item {
  display: block;
  width: 100%;
  padding: 0.4rem 0.75rem;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.nm-kingbase-browse__menu-item:hover {
  background: var(--rs-bg-muted);
}
.nm-kingbase-browse__ddl-pop {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(42rem, 80vw);
  height: min(26rem, 65vh);
  min-height: 16rem;
}
.nm-kingbase-browse__ddl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-shrink: 0;
  min-width: 0;
}
.nm-kingbase-browse__ddl-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}
.nm-kingbase-browse__ddl-type {
  font-weight: 500;
  color: var(--rs-muted);
  font-family: var(--rs-font-mono);
  font-size: 11px;
}
.nm-kingbase-browse__ddl-actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-shrink: 0;
}
.nm-kingbase-browse__ddl-loading,
.nm-kingbase-browse__ddl-empty,
.nm-kingbase-browse__ddl-editor {
  flex: 1;
  min-height: 0;
}
</style>
