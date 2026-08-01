<script setup lang="ts">
import { RsIcon, RsLoading, RsMonacoEditor, type RsSplitPaneItem } from '@niuma/ui'
import { QueryResultPanel, SqlQueryShell } from '@/modules/database'
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
  featureIcon,
  featureLabelKey,
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
      <div
        class="nm-vast-query__identity"
        :title="`${identityTitle}\n${t('modules.vastbase.session.dialectHint')}`"
      >
        <RsIcon name="vastbase" :size="15" class="nm-vast-query__brand" />
        <span v-if="sessionLabel" class="nm-vast-query__session">{{ sessionLabel }}</span>
        <span class="nm-vast-query__scope">{{ scopeLabel }}</span>
        <span class="nm-vast-query__feature">
          <RsIcon :name="featureIcon" :size="12" />
          {{ t(featureLabelKey) }}
        </span>
      </div>
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
.nm-vast-query__identity {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-vast-query__brand {
  flex-shrink: 0;
}

.nm-vast-query__session {
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-vast-query__scope {
  color: var(--rs-foreground);
  font-weight: 500;
  flex-shrink: 0;
  white-space: nowrap;
}

.nm-vast-query__feature {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.05rem 0.4rem;
  border-radius: var(--rs-radius-sm);
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.12));
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  flex-shrink: 0;
}

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
