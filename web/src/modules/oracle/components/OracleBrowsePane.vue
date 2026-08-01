<script setup lang="ts">
import {
  RsButton, RsCodeEditor, RsConfirmDialog, RsEmpty, RsLoading, RsPopover, RsTable,
} from '@niuma/ui'
import { computed, proxyRefs } from 'vue'
import { BrowseDataShell, BrowseIoMenu } from '@/modules/database'
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
const showMutate = computed(() => !pane.isView)
const deleteCount = computed(() => pane.selectedRowKeys.filter((key) => !key.startsWith('new-')).length || 1)
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
    :import-disabled="!pane.canInsert || pane.saving"
    :export-disabled="!pane.lastResult || !pane.resultRows.length"
    :show-filter="true"
    :has-active-filter="Boolean(pane.appliedWhereSql)"
    :has-scope="pane.scopeOk"
    :has-result="Boolean(pane.lastResult)"
    :page-size-options="pane.pageSizeOptions"
    :total-rows="pane.totalRows"
    :last-data-sql="pane.lastDataSql"
    :status-meta="pane.statusMeta"
    :status-hint="pane.statusHint"
    @insert="pane.openInsert"
    @delete="pane.requestDelete"
    @refresh="() => pane.loadData()"
    @keydown="pane.onBrowseKeydown"
  >
    <template #import-menu><BrowseIoMenu :items="pane.importMenuItems" @select="pane.onImportMenuSelect" /></template>
    <template #export-menu><BrowseIoMenu :items="pane.exportMenuItems" @select="pane.onExportMenuSelect" /></template>
    <template #toolbar-extra>
      <RsPopover v-model:open="pane.ddlMenuOpen" side="bottom" align="end" :side-offset="4" width="auto">
        <RsButton variant="ghost" size="sm" icon="file-code" :disabled="!table || !sessionId" :tooltip="pane.t('modules.oracle.browse.ddlTooltip')">
          {{ pane.t('modules.oracle.browse.ddl') }}
        </RsButton>
        <template #content>
          <div class="nm-oracle-browse__ddl-pop">
            <div class="nm-oracle-browse__ddl-head">
              <strong>{{ pane.t('modules.oracle.session.tabDdl') }}</strong>
              <span v-if="pane.objectType" class="nm-oracle-browse__ddl-type">{{ pane.objectType }}</span>
              <RsButton variant="ghost" size="sm" icon="copy" :disabled="!pane.ddlText || pane.ddlLoading" @click="pane.copyBrowseDdl">
                {{ pane.t('modules.oracle.ddl.copy') }}
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
            <RsLoading v-if="pane.ddlLoading && !pane.ddlText" block />
            <RsEmpty v-else-if="!pane.ddlText" icon="file-code" :description="pane.t('modules.oracle.ddl.empty')" />
            <RsCodeEditor v-else v-model="pane.ddlText" language="sql" readonly embedded :rounded="false" :show-toolbar="false" height="100%" />
          </div>
        </template>
      </RsPopover>
    </template>
    <template #filter>
      <div class="nm-oracle-browse__filter" @keydown.capture="pane.onFilterKeydown">
        <RsCodeEditor v-model="pane.filterDraft" language="sql" embedded :rounded="false" :fold-gutter="false" :gutter-width="pane.BROWSE_GUTTER_WIDTH" :show-toolbar="false" height="100%" :sql-config="pane.filterSqlConfig" :placeholder="pane.t('modules.oracle.browse.filterEditorPlaceholder')" />
      </div>
    </template>
    <RsTable
      v-model:selected-row-keys="pane.selectedRowKeys"
      :columns="pane.resultColumns"
      :data="pane.resultRows"
      row-key="__rowKey"
      size="sm"
      striped
      fill
      bordered
      column-bordered
      :rounded="false"
      show-index
      :index-width="pane.BROWSE_GUTTER_WIDTH"
      :edit-gutter-width="pane.BROWSE_GUTTER_WIDTH"
      resizable
      column-layout="fixed"
      cell-tooltip
      highlight-row
      selectable
      selection-type="row"
      :editable="pane.tableEditable"
      :allow-null="pane.tableEditable"
      edit-trigger="dblclick"
      :row-pending="pane.isBrowseRowPending"
      :context-menu-items="pane.contextMenuItems"
      :loading="pane.loading"
      :virtual="true"
      :virtual-auto-threshold="40"
      :virtual-columns-auto-threshold="40"
      :layout-active="active"
      @cell-edit-commit="pane.onCellEditCommit"
      @row-edit-commit="pane.onBrowseRowEditCommit"
      @row-edit-rollback="pane.onBrowseRowEditRollback"
      @context-menu-select="pane.onContextMenuSelect"
    ><template #empty>{{ pane.t('modules.oracle.browse.empty') }}</template></RsTable>
    <template #dialogs>
      <RsConfirmDialog v-model:open="pane.deleteConfirm" :title="pane.t('modules.oracle.browse.deleteTitle')" :description="pane.t('modules.oracle.browse.deleteDesc', { count: deleteCount })" tone="danger" confirm-variant="danger" @confirm="pane.confirmDelete" />
    </template>
  </BrowseDataShell>
</template>

<style scoped>
.nm-oracle-browse__filter { width: 100%; height: 100%; }
.nm-oracle-browse__ddl-pop { display: flex; flex-direction: column; gap: .5rem; width: min(42rem, 80vw); height: min(26rem, 65vh); min-height: 16rem; }
.nm-oracle-browse__ddl-head { display: flex; align-items: center; gap: .5rem; }
.nm-oracle-browse__ddl-type { color: var(--rs-muted); font-family: var(--rs-font-mono); }
</style>
