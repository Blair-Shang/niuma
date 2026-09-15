<script setup lang="ts">
import { RsLoading, RsMonacoEditor, type RsSplitPaneItem } from '@niuma/ui'
import { QueryResultPanel, SqlQueryIdentity, SqlQueryShell } from '@/modules/database'
import { useSqliteQueryPane } from '@/modules/sqlite/composables/useSqliteQueryPane'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  schema?: string
  initialSql?: string
  /** 随 workspace.tabs 持久化的查询正文草稿 */
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
  onContextMenuSelect,
  setAutoCommit,
  commitTx,
  rollbackTx,
} = useSqliteQueryPane(props)
</script>

<template>
  <SqlQueryShell
    v-model:history-open="historyOpen"
    class="nm-sqlite-query"
    :toolbar-labels="toolbarLabels"
    :context-menu-items="contextMenuItems"
    :running="running"
    :cancelling="cancelling"
    :has-selection="hasSelection"
    :can-run="Boolean(sessionId)"
    :history-enabled="Boolean(profileId)"
    :history-entries="historyEntries"
    :split-panes="splitPanes"
    show-transaction
    :show-explain-analyze="false"
    :auto-commit="autoCommit"
    :in-transaction="inTransaction"
    :tx-busy="txBusy"
    @format="formatEditor"
    @explain="runExplain"
    @run="runSql"
    @cancel="cancelRun"
    @history-pick="onHistoryPick"
    @context-select="onContextMenuSelect"
    @update:auto-commit="setAutoCommit"
    @commit="commitTx"
    @rollback="rollbackTx"
  >
    <template #identity>
      <SqlQueryIdentity icon="sqlite" :title="identityTitle">
        <span v-if="schema">{{ schema }}</span>
        <span v-else>{{ t('modules.sqlite.query.noSchema') }}</span>
      </SqlQueryIdentity>
    </template>

    <template #editor>
      <RsMonacoEditor
        v-if="languageReady"
        ref="editorRef"
        v-model="sqlText"
        :language="monacoLanguage"
        height="100%"
        class="nm-sqlite-query__editor"
        :options="{ automaticLayout: active !== false, minimap: { enabled: false } }"
      />
      <div v-else class="nm-sqlite-query__editor-boot">
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
.nm-sqlite-query__editor {
  flex: 1;
  min-height: 0;
  border-radius: 0;
  border: none;
}

.nm-sqlite-query__editor-boot {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
}
</style>
