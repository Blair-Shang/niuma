<script setup lang="ts">
import {
  RsContextMenu,
  RsSplitPane,
  type RsContextMenuItem,
  type RsSplitPaneItem,
} from '@niuma/ui'
import SqlQueryToolbar from './SqlQueryToolbar.vue'
import type { SqlQueryHistoryEntry, SqlQueryToolbarLabels } from '../types/sql-query-shell'

withDefaults(
  defineProps<{
    toolbarLabels: SqlQueryToolbarLabels
    contextMenuItems?: RsContextMenuItem[]
    running?: boolean
    cancelling?: boolean
    hasSelection?: boolean
    canRun?: boolean
    historyEnabled?: boolean
    historyEntries?: SqlQueryHistoryEntry[]
    showExplain?: boolean
    showExplainAnalyze?: boolean
    showTransaction?: boolean
    autoCommit?: boolean
    inTransaction?: boolean
    txBusy?: boolean
    splitPanes?: RsSplitPaneItem[]
  }>(),
  {
    contextMenuItems: () => [],
    running: false,
    cancelling: false,
    hasSelection: false,
    canRun: true,
    historyEnabled: true,
    historyEntries: () => [],
    showExplain: true,
    showExplainAnalyze: true,
    showTransaction: false,
    autoCommit: true,
    inTransaction: false,
    txBusy: false,
    splitPanes: () => [
      { key: 'editor', size: 40, min: 18, resizerHandle: true },
      { key: 'result', size: 60, min: 24 },
    ],
  },
)

const historyOpen = defineModel<boolean>('historyOpen', { default: false })

const emit = defineEmits<{
  format: []
  explain: []
  explainAnalyze: []
  run: []
  cancel: []
  historyPick: [id: string]
  contextSelect: [key: string]
  'update:autoCommit': [value: boolean]
  commit: []
  rollback: []
}>()
</script>

<template>
  <div class="nm-sql-query">
    <RsContextMenu
      :items="contextMenuItems"
      @select="emit('contextSelect', $event)"
    >
      <div class="nm-sql-query__surface">
        <SqlQueryToolbar
          v-model:history-open="historyOpen"
          :labels="toolbarLabels"
          :running="running"
          :cancelling="cancelling"
          :has-selection="hasSelection"
          :can-run="canRun"
          :history-enabled="historyEnabled"
          :history-entries="historyEntries"
          :show-explain="showExplain"
          :show-explain-analyze="showExplainAnalyze"
          :show-transaction="showTransaction"
          :auto-commit="autoCommit"
          :in-transaction="inTransaction"
          :tx-busy="txBusy"
          @format="emit('format')"
          @explain="emit('explain')"
          @explain-analyze="emit('explainAnalyze')"
          @run="emit('run')"
          @cancel="emit('cancel')"
          @history-pick="emit('historyPick', $event)"
          @update:auto-commit="emit('update:autoCommit', $event)"
          @commit="emit('commit')"
          @rollback="emit('rollback')"
        >
          <template #identity>
            <slot name="identity" />
          </template>
          <template #toolbar-start>
            <slot name="toolbar-start" />
          </template>
          <template #toolbar-end>
            <slot name="toolbar-end" />
          </template>
        </SqlQueryToolbar>

        <RsSplitPane
          :panes="splitPanes"
          orientation="vertical"
          class="nm-sql-query__split"
          with-handle
        >
          <template #editor>
            <div class="nm-sql-query__pane-shell">
              <slot name="editor" />
            </div>
          </template>
          <template #result>
            <slot name="result" />
          </template>
        </RsSplitPane>
      </div>
    </RsContextMenu>
  </div>
</template>

<style scoped>
.nm-sql-query {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-sql-query__surface {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-sql-query__split {
  flex: 1;
  min-height: 0;
}

.nm-sql-query__split :deep(.rs-split__pane) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.nm-sql-query__pane-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
</style>
