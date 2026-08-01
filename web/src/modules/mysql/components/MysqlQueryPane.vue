<script setup lang="ts">
import { RsIcon, RsLoading, RsMonacoEditor, type RsSplitPaneItem } from '@niuma/ui'
import { QueryResultPanel, SqlQueryShell } from '@/modules/database'
import { useMysqlQueryPane } from '@/modules/mysql/composables/useMysqlQueryPane'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  initialSql?: string
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
} = useMysqlQueryPane(props)
</script>

<template>
  <SqlQueryShell
    v-model:history-open="historyOpen"
    class="nm-mysql-query"
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
    :auto-commit="autoCommit"
    :in-transaction="inTransaction"
    :tx-busy="txBusy"
    @format="formatEditor"
    @explain="runExplain(false)"
    @explain-analyze="runExplain(true)"
    @run="runSql"
    @cancel="cancelRun"
    @history-pick="onHistoryPick"
    @context-select="onContextMenuSelect"
    @update:auto-commit="setAutoCommit"
    @commit="commitTx"
    @rollback="rollbackTx"
  >
    <template #identity>
      <div
        class="nm-mysql-query__identity"
        :title="identityTitle"
      >
        <RsIcon name="database" :size="15" class="nm-mysql-query__brand" />
        <!-- Shell tab 已含连接名/查询序号；此处只展示当前库上下文，避免重复 -->
        <span v-if="database" class="nm-mysql-query__db">{{ database }}</span>
        <span v-else class="nm-mysql-query__scope-fallback">{{ t('modules.mysql.query.noDatabase') }}</span>
      </div>
    </template>

    <template #editor>
      <RsMonacoEditor
        v-if="languageReady"
        ref="editorRef"
        v-model="sqlText"
        :language="monacoLanguage"
        height="100%"
        class="nm-mysql-query__editor"
        :options="{ automaticLayout: active !== false, minimap: { enabled: false } }"
      />
      <div v-else class="nm-mysql-query__editor-boot">
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
.nm-mysql-query__identity {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-mysql-query__brand {
  flex-shrink: 0;
}

.nm-mysql-query__db {
  color: var(--rs-foreground);
  font-weight: 600;
  flex-shrink: 0;
  white-space: nowrap;
}

.nm-mysql-query__scope-fallback {
  color: var(--rs-muted);
  font-weight: 500;
  flex-shrink: 0;
  white-space: nowrap;
}

.nm-mysql-query__editor {
  flex: 1;
  min-height: 0;
  border-radius: 0;
  border: none;
}

.nm-mysql-query__editor-boot {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 0;
}
</style>
