<script setup lang="ts">
import {
  RsButton,
  RsCodeEditor,
  RsConfirmDialog,
  RsEmpty,
  RsLoading,
  RsPopover,
  RsTable,
} from '@niuma/ui'
import { proxyRefs } from 'vue'
import { BrowseDataShell, BrowseIoMenu } from '@/modules/database'
import { useClickHouseBrowsePane } from '@/modules/clickhouse/composables/useClickHouseBrowsePane'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  table?: string
  isView?: boolean
  sessionLabel?: string
  active: boolean
}>()
const pane = proxyRefs(useClickHouseBrowsePane(props))
</script>

<template>
  <BrowseDataShell
    v-model:page="pane.page"
    v-model:page-size="pane.pageSize"
    v-model:filter-open="pane.filterOpen"
    v-model:import-menu-open="pane.importMenuOpen"
    v-model:export-menu-open="pane.exportMenuOpen"
    class="nm-clickhouse-browse"
    :labels="pane.shellLabels"
    brand-icon="clickhouse"
    :session-label="sessionLabel || 'ClickHouse'"
    :scope-label="pane.scopeLabel"
    :loading="pane.loading"
    :saving="pane.saving"
    :show-mutate="!pane.isView"
    :can-insert="pane.canInsert"
    :can-delete="pane.canDelete"
    :show-import="true"
    :show-export="true"
    :export-disabled="!pane.scopeOk"
    :show-filter="true"
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
    @delete="pane.requestDelete"
    @keydown="pane.onBrowseKeydown"
  >
    <template #import-menu>
      <BrowseIoMenu :items="pane.importMenuItems" @select="pane.onImportMenuSelect" />
    </template>
    <template #export-menu>
      <BrowseIoMenu :items="pane.exportMenuItems" @select="pane.onExportMenuSelect" />
    </template>
    <template #toolbar-extra>
      <RsPopover v-model:open="pane.ddlMenuOpen" side="bottom" align="end" :side-offset="4" width="auto">
        <RsButton
          variant="ghost"
          size="sm"
          icon="file-code"
          :disabled="!table || !sessionId"
          :tooltip="pane.t('modules.clickhouse.browse.ddlTooltip')"
        >
          {{ pane.t('modules.clickhouse.browse.ddl') }}
        </RsButton>
        <template #content>
          <div class="nm-clickhouse-browse__ddl-pop">
            <div class="nm-clickhouse-browse__ddl-head">
              <div class="nm-clickhouse-browse__ddl-title">
                <span>{{ pane.t('modules.clickhouse.session.tabDdl') }}</span>
                <span v-if="pane.objectType" class="nm-clickhouse-browse__ddl-type">{{ pane.objectType }}</span>
              </div>
              <div class="nm-clickhouse-browse__ddl-actions">
                <RsButton
                  variant="ghost"
                  size="sm"
                  icon="copy"
                  :disabled="!pane.ddlText || pane.ddlLoading"
                  :tooltip="pane.t('modules.clickhouse.ddl.copy')"
                  @click="pane.copyBrowseDdl"
                >
                  {{ pane.t('modules.clickhouse.ddl.copy') }}
                </RsButton>
                <RsButton
                  variant="ghost"
                  size="sm"
                  icon="external-link"
                  :disabled="!table || !profileId"
                  :tooltip="pane.t('modules.clickhouse.browse.openDdlTooltip')"
                  @click="pane.openDdlTab"
                >
                  {{ pane.t('modules.clickhouse.browse.openDdl') }}
                </RsButton>
              </div>
            </div>
            <RsLoading v-if="pane.ddlLoading && !pane.ddlText" block class="nm-clickhouse-browse__ddl-loading" />
            <RsEmpty
              v-else-if="!pane.ddlText"
              class="nm-clickhouse-browse__ddl-empty"
              icon="file-code"
              :description="pane.t('modules.clickhouse.ddl.empty')"
            />
            <RsCodeEditor
              v-else
              v-model="pane.ddlText"
              class="nm-clickhouse-browse__ddl-editor"
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
      <div class="nm-clickhouse-browse__filter" @keydown.capture="pane.onFilterKeydown">
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
          :placeholder="pane.t('modules.clickhouse.browse.filterEditorPlaceholder')"
        />
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
      :index-width="pane.browseGutterWidth"
      :edit-gutter-width="pane.browseGutterWidth"
      resizable
      column-layout="fixed"
      cell-tooltip
      highlight-row
      selectable
      selection-type="row"
      :editable="pane.canEdit || pane.resultRows.some((row) => row.__isNew)"
      :allow-null="pane.canEdit"
      edit-trigger="dblclick"
      :loading="pane.loading"
      :virtual="true"
      :virtual-auto-threshold="40"
      :virtual-columns-auto-threshold="40"
      :layout-active="active"
      :context-menu-items="pane.contextMenuItems"
      @cell-edit-commit="pane.onCellEditCommit"
      @row-edit-commit="pane.flushNewRow"
      @context-menu-select="pane.onContextMenuSelect"
    >
      <template #empty>{{ pane.t('modules.clickhouse.browse.empty') }}</template>
    </RsTable>

    <template #dialogs>
      <RsConfirmDialog
        v-model:open="pane.deleteConfirm"
        :title="pane.t('modules.clickhouse.browse.deleteTitle')"
        :description="pane.t('modules.clickhouse.browse.deleteDesc', { count: pane.selectedRowKeys.length })"
        tone="danger"
        confirm-variant="danger"
        @confirm="pane.deleteSelected"
      />
    </template>
  </BrowseDataShell>
</template>

<style scoped>
.nm-clickhouse-browse__filter {
  display: block;
  width: 100%;
  height: 100%;
}

.nm-clickhouse-browse__ddl-pop {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(42rem, 80vw);
  height: min(26rem, 65vh);
  min-height: 16rem;
}

.nm-clickhouse-browse__ddl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-shrink: 0;
  min-width: 0;
}

.nm-clickhouse-browse__ddl-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}

.nm-clickhouse-browse__ddl-type {
  font-weight: 500;
  color: var(--rs-muted);
  font-family: var(--rs-font-mono);
  font-size: 11px;
}

.nm-clickhouse-browse__ddl-actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-shrink: 0;
}

.nm-clickhouse-browse__ddl-loading,
.nm-clickhouse-browse__ddl-empty,
.nm-clickhouse-browse__ddl-editor {
  flex: 1;
  min-height: 0;
}
</style>
