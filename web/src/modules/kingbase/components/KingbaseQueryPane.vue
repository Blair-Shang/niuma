<script setup lang="ts">
import { RsIcon, RsLoading, RsMonacoEditor, type RsSplitPaneItem } from '@niuma/ui'
import { QueryResultPanel, SqlQueryShell } from '@/modules/database'
import { useKingbaseQueryPane } from '@/modules/kingbase/composables/useKingbaseQueryPane'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  initialSql?: string
  draftSql?: string
  tabId?: string
  autoRunInitialSql?: boolean
  queryExecMode?: 'paged' | 'batch'
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
  runSql,
  runExplain,
  cancelRun,
  fetchMore,
  fetchAll,
  exportCsv,
  onHistoryPick,
  onContextMenuSelect,
  autoCommit,
  inTransaction,
  txBusy,
  setAutoCommit,
  commitTx,
  rollbackTx,
} = useKingbaseQueryPane(props)
</script>

<template>
  <SqlQueryShell
    v-model:history-open="historyOpen"
    class="nm-kingbase-query"
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
      <div class="nm-kingbase-query__identity" :title="identityTitle">
        <RsIcon name="kingbase" :size="15" class="nm-kingbase-query__brand" />
        <span v-if="database" class="nm-kingbase-query__db">{{ database }}</span>
        <span v-if="database && schema" class="nm-kingbase-query__schema">{{ schema }}</span>
        <span v-else-if="!database" class="nm-kingbase-query__scope-fallback">{{ t('modules.kingbase.query.noDatabase') }}</span>
      </div>
    </template>

    <template #editor>
      <RsMonacoEditor
        v-if="languageReady"
        ref="editorRef"
        v-model="sqlText"
        :language="monacoLanguage"
        height="100%"
        class="nm-kingbase-query__editor"
        :options="{
          automaticLayout: active !== false,
          minimap: { enabled: false },
          wordBasedSuggestions: 'off',
          suggest: {
            filterGraceful: false,
            matchOnWordStartOnly: true,
            snippetsPreventQuickSuggestions: false,
          },
        }"
      />
      <div v-else class="nm-kingbase-query__editor-boot">
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
        :labels="resultPanelLabels"
        @select-tab="selectResultTab"
        @close-tab="closeResultGridTab"
        @fetch-more="fetchMore"
        @fetch-all="fetchAll"
        @export-csv="exportCsv"
      />
    </template>
  </SqlQueryShell>
</template>

<style scoped>
.nm-kingbase-query__identity {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-kingbase-query__brand {
  flex-shrink: 0;
}

.nm-kingbase-query__db {
  color: var(--rs-foreground);
  font-weight: 600;
  flex-shrink: 0;
  white-space: nowrap;
}

.nm-kingbase-query__schema {
  color: var(--rs-muted);
  font-weight: 500;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-kingbase-query__schema::before {
  content: '·';
  margin-right: 6px;
  color: var(--rs-muted);
}

.nm-kingbase-query__scope-fallback {
  color: var(--rs-muted);
  font-weight: 500;
  flex-shrink: 0;
  white-space: nowrap;
}

.nm-kingbase-query__editor {
  flex: 1;
  min-height: 0;
  border-radius: 0;
  border: none;
}

.nm-kingbase-query__editor-boot {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
}
</style>
