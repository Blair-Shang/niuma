<script setup lang="ts">
import { RsLoading, RsMonacoEditor, type RsSplitPaneItem } from '@niuma/ui'
import { QueryResultPanel, SqlQueryIdentity, SqlQueryShell } from '@/modules/database'
import { useVastQueryPane } from '@/modules/vastbase/composables/useVastQueryPane'
import type { VastSessionTab } from '@/modules/vastbase/sql-seed'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  table?: string
  routine?: string
  routineKind?: 'function' | 'procedure'
  args?: string
  oid?: number
  feature: VastSessionTab
  initialSql?: string
  draftSql?: string
  tabId?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
  active: boolean
}>()

const splitPanes: RsSplitPaneItem[] = [
  { key: 'editor', size: 32, min: 16, resizerHandle: true },
  { key: 'result', size: 68, min: 28 },
]

const {
  t,
  sqlText,
  running,
  cancelling,
  lastError,
  historyOpen,
  activePaneTab,
  gridTabs,
  batchItems,
  batchActive,
  filterText,
  scopeLabel,
  identityTitle,
  messageItems,
  hasMessages,
  resultSummaryText,
  resultPanelLabels,
  historyEntries,
  contextMenuItems,
  toolbarLabels,
  resultColumns,
  resultRows,
  filterKeys,
  editorRef,
  hasSelection,
  languageReady,
  sqlLanguage,
  formatSql,
  onHistoryPick,
  onContextMenuSelect,
  selectResultTab,
  closeResultGridTab,
  openBatchGrid,
  runQuery,
  runExplain,
  cancelQuery,
  fetchMore,
  fetchAll,
  exportCsv,
  hasMore,
  loadingMore,
} = useVastQueryPane(props)
</script>

<template>
  <SqlQueryShell
    v-model:history-open="historyOpen"
    class="nm-vast-query"
    :toolbar-labels="toolbarLabels"
    :context-menu-items="contextMenuItems"
    :running="running"
    :cancelling="cancelling"
    :has-selection="hasSelection"
    :can-run="Boolean(sessionId)"
    :history-enabled="Boolean(profileId)"
    :history-entries="historyEntries"
    :split-panes="splitPanes"
    @format="formatSql"
    @explain="runExplain(false)"
    @explain-analyze="runExplain(true)"
    @run="runQuery"
    @cancel="cancelQuery"
    @history-pick="onHistoryPick"
    @context-select="onContextMenuSelect"
  >
    <template #identity>
      <SqlQueryIdentity
        icon="vastbase"
        :title="`${identityTitle}\n${t('modules.vastbase.session.dialectHint')}`"
      >
        <span>{{ scopeLabel }}</span>
      </SqlQueryIdentity>
    </template>

    <template #editor>
      <RsMonacoEditor
        v-if="languageReady"
        ref="editorRef"
        v-model="sqlText"
        :language="sqlLanguage"
        height="100%"
        class="nm-vast-query__editor"
      />
      <div v-else class="nm-vast-query__editor-boot">
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
        :layout-active="active"
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
.nm-vast-query__editor {
  flex: 1;
  min-height: 0;
  border-radius: 0;
  border: none;
}

.nm-vast-query__editor-boot {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 0;
}
</style>
