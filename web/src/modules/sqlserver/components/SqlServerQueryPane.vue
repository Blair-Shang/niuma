<script setup lang="ts">
import { RsLoading, RsMonacoEditor, type RsSplitPaneItem } from '@niuma/ui'
import { QueryResultPanel, SqlQueryIdentity, SqlQueryShell } from '@/modules/database'
import { useSqlServerQueryPane } from '@/modules/sqlserver/composables/useSqlServerQueryPane'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  initialSql?: string
  draftSql?: string
  tabId?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
  active?: boolean
}>()

const splitPanes: RsSplitPaneItem[] = [
  { key: 'editor', size: 40, min: 18, resizerHandle: true },
  { key: 'result', size: 60, min: 24 },
]

const {
  t,
  sqlText,
  running,
  cancelling,
  loadingMore,
  filterText,
  activePaneTab,
  lastError,
  gridTabs,
  batchItems,
  batchActive,
  identityTitle,
  resultColumns,
  resultRows,
  filterKeys,
  hasMore,
  resultSummaryText,
  messageItems,
  hasMessages,
  resultPanelLabels,
  monacoLanguage,
  languageReady,
  editorRef,
  hasSelection,
  historyOpen,
  historyEntries,
  toolbarLabels,
  contextMenuItems,
  formatEditor,
  selectResultTab,
  closeResultGridTab,
  openBatchGrid,
  runSql,
  runExplain,
  cancelRun,
  fetchMore,
  fetchAll,
  exportCsv,
  onHistoryPick,
  onContextMenuSelect,
} = useSqlServerQueryPane(props)
</script>

<template>
  <SqlQueryShell
    v-model:history-open="historyOpen"
    class="nm-sqlserver-query"
    :toolbar-labels="toolbarLabels"
    :context-menu-items="contextMenuItems"
    :running="running"
    :cancelling="cancelling"
    :has-selection="hasSelection"
    :can-run="Boolean(sessionId)"
    :history-enabled="Boolean(profileId)"
    :history-entries="historyEntries"
    :split-panes="splitPanes"
    :show-explain="true"
    :show-explain-analyze="true"
    @format="formatEditor"
    @explain="runExplain(false)"
    @explain-analyze="runExplain(true)"
    @run="runSql"
    @cancel="cancelRun"
    @history-pick="onHistoryPick"
    @context-select="onContextMenuSelect"
  >
    <template #identity>
      <SqlQueryIdentity icon="sqlserver" :title="identityTitle">
        <span v-if="database">{{ database }}</span>
        <span v-else>{{ t('modules.sqlserver.query.noDatabase') }}</span>
      </SqlQueryIdentity>
    </template>

    <template #editor>
      <RsMonacoEditor
        v-if="languageReady"
        ref="editorRef"
        v-model="sqlText"
        :language="monacoLanguage"
        height="100%"
        class="nm-sqlserver-query__editor"
        :options="{ automaticLayout: active !== false, minimap: { enabled: false } }"
      />
      <div v-else class="nm-sqlserver-query__editor-boot">
        <RsLoading size="sm" />
      </div>
    </template>

    <template #result>
      <QueryResultPanel
        v-model:filter-text="filterText"
        :grid-tabs="gridTabs"
        :active-pane-tab="activePaneTab"
        :result-summary-text="resultSummaryText"
        :has-more="hasMore"
        :loading-more="loadingMore"
        :running="running"
        :layout-active="active !== false"
        :result-rows="resultRows"
        :result-columns="resultColumns"
        :filter-keys="filterKeys"
        :last-error="lastError"
        :has-messages="hasMessages"
        :message-items="messageItems"
        :batch-items="batchItems"
        :batch-active="batchActive"
        :labels="resultPanelLabels"
        @select-tab="selectResultTab"
        @close-tab="closeResultGridTab"
        @fetch-more="fetchMore"
        @fetch-all="fetchAll"
        @export-csv="exportCsv"
        @open-batch="openBatchGrid"
      />
    </template>
  </SqlQueryShell>
</template>

<style scoped>
.nm-sqlserver-query__editor {
  flex: 1;
  min-height: 0;
  border-radius: 0;
  border: none;
}

.nm-sqlserver-query__editor-boot {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
}
</style>
