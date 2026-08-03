<script setup lang="ts">
import { RsIcon, RsLoading, RsMonacoEditor, type RsSplitPaneItem } from '@niuma/ui'
import { QueryResultPanel, SqlQueryShell } from '@/modules/database'
import { useOracleQueryPane } from '@/modules/oracle/composables/useOracleQueryPane'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  schema?: string
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
  autoCommit,
  inTransaction,
  txBusy,
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
  setAutoCommit,
  commitTx,
  rollbackTx,
  onContextMenuSelect,
} = useOracleQueryPane(props)
</script>

<template>
  <SqlQueryShell
    v-model:history-open="historyOpen"
    class="nm-oracle-query"
    :toolbar-labels="toolbarLabels"
    :context-menu-items="contextMenuItems"
    :running="running"
    :cancelling="cancelling"
    :has-selection="hasSelection"
    :can-run="Boolean(sessionId)"
    :history-enabled="Boolean(profileId)"
    :history-entries="historyEntries"
    :split-panes="splitPanes"
    :show-transaction="true"
    :show-explain="true"
    :show-explain-analyze="false"
    :auto-commit="autoCommit"
    :in-transaction="inTransaction"
    :tx-busy="txBusy"
    @format="formatEditor"
    @run="runSql"
    @explain="runExplain"
    @cancel="cancelRun"
    @history-pick="onHistoryPick"
    @update:auto-commit="setAutoCommit"
    @commit="commitTx"
    @rollback="rollbackTx"
    @context-select="onContextMenuSelect"
  >
    <template #identity>
      <div class="nm-oracle-query__identity" :title="identityTitle">
        <RsIcon name="database" :size="15" />
        <span>{{ schema || t('modules.oracle.query.noSchema') }}</span>
      </div>
    </template>
    <template #editor>
      <RsMonacoEditor
        v-if="languageReady"
        ref="editorRef"
        v-model="sqlText"
        :language="monacoLanguage"
        height="100%"
        :options="{ automaticLayout: active !== false, minimap: { enabled: false } }"
      />
      <div v-else class="nm-oracle-query__boot">
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
.nm-oracle-query__identity {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}
.nm-oracle-query__boot {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
}
</style>
