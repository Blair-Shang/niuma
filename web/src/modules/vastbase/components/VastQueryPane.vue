<script setup lang="ts">
import {
  RsButton,
  RsContextMenu,
  RsEmpty,
  RsIcon,
  RsInput,
  RsLoading,
  RsMonacoEditor,
  RsPopover,
  RsSplitPane,
  RsTable,
  RsToolbar,
  RsTooltip,
  RsVirtualList,
} from '@niuma/ui'
import type { RsSplitPaneItem } from '@niuma/ui'
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
  lastResult,
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
  historyEntries,
  contextMenuItems,
  resultColumns,
  resultRows,
  filterKeys,
  editorRef,
  hasSelection,
  languageReady,
  sqlLanguage,
  formatSql,
  historyPreview,
  onHistoryPick,
  onContextMenuSelect,
  selectResultTab,
  closeResultGridTab,
  openBatchGrid,
  batchItemOpenable,
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
  <div class="nm-vast-query">
    <RsContextMenu :items="contextMenuItems" @select="onContextMenuSelect">
      <div class="nm-vast-query__surface">
      <RsToolbar
        class="nm-vast-query__toolbar"
        size="md"
        elevated
        :label="t('modules.vastbase.session.sqlEditor')"
      >
        <template #left>
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
        <template #right>
          <RsButton
            variant="ghost"
            size="sm"
            :disabled="running"
            :tooltip="t('modules.vastbase.session.formatTooltip')"
            @click="formatSql"
          >
            <RsIcon name="braces" :size="13" />
            {{ t('modules.vastbase.session.format') }}
          </RsButton>
          <RsTooltip
            :content="t('modules.vastbase.session.explainTooltip')"
            side="bottom"
            nowrap
          >
            <RsButton
              variant="default"
              size="sm"
              :disabled="running"
              @click="runExplain(false)"
            >
              {{ t('modules.vastbase.session.explain') }}
            </RsButton>
          </RsTooltip>
          <RsTooltip
            :content="t('modules.vastbase.session.explainAnalyzeTooltip')"
            side="bottom"
            nowrap
          >
            <RsButton
              variant="default"
              size="sm"
              class="nm-vast-query__btn-analyze"
              :disabled="running"
              @click="runExplain(true)"
            >
              {{ t('modules.vastbase.session.explainAnalyze') }}
            </RsButton>
          </RsTooltip>
          <RsTooltip
            v-if="!running"
            :content="t('modules.vastbase.session.runTooltip')"
            side="bottom"
            nowrap
          >
            <RsButton variant="primary" size="sm" @click="runQuery">
              <RsIcon name="play" :size="13" />
              {{
                hasSelection
                  ? t('modules.vastbase.session.runSelection')
                  : t('modules.vastbase.session.run')
              }}
            </RsButton>
          </RsTooltip>
          <RsTooltip
            v-else
            :content="t('modules.vastbase.session.cancelTooltip')"
            side="bottom"
            nowrap
          >
            <RsButton
              variant="danger"
              size="sm"
              :loading="cancelling"
              @click="cancelQuery"
            >
              <RsIcon name="square" :size="13" />
              {{ t('modules.vastbase.session.cancel') }}
            </RsButton>
          </RsTooltip>
          <RsPopover
            v-model:open="historyOpen"
            side="bottom"
            align="end"
            width="lg"
          >
            <RsButton
              variant="ghost"
              size="sm"
              :disabled="!profileId"
              :tooltip="t('modules.vastbase.session.history')"
            >
              <RsIcon name="history" :size="13" />
              {{ t('modules.vastbase.session.history') }}
            </RsButton>
            <template #content>
              <div class="nm-vast-query__history">
                <p class="nm-vast-query__history-title">
                  {{ t('modules.vastbase.session.history') }}
                </p>
                <p v-if="historyEntries.length === 0" class="nm-vast-query__history-empty">
                  {{ t('modules.vastbase.session.historyEmpty') }}
                </p>
                <ul v-else class="nm-vast-query__history-list">
                  <li v-for="entry in historyEntries" :key="entry.id">
                    <button
                      type="button"
                      class="nm-vast-query__history-item"
                      :title="entry.sql"
                      @click="onHistoryPick(entry.id)"
                    >
                      {{ historyPreview(entry.sql) }}
                    </button>
                  </li>
                </ul>
                <button
                  v-if="historyEntries.length > 0"
                  type="button"
                  class="nm-vast-query__history-clear"
                  @click="onHistoryPick('__clear')"
                >
                  {{ t('modules.vastbase.session.historyClear') }}
                </button>
              </div>
            </template>
          </RsPopover>
        </template>
      </RsToolbar>

      <RsSplitPane :panes="splitPanes" orientation="vertical" class="nm-vast-query__split" with-handle>
        <template #editor>
          <div class="nm-vast-query__pane-shell">
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
          </div>
        </template>

        <template #result>
          <div class="nm-vast-query__pane-shell">
            <div class="nm-vast-query__result-bar">
              <div class="nm-vast-query__result-tabs" role="tablist">
                <div
                  v-for="(tab, tabIdx) in gridTabs"
                  :key="tab.id"
                  class="nm-vast-query__tab-wrap"
                  :class="{ 'nm-vast-query__tab-wrap--active': activePaneTab === tab.id }"
                >
                  <button
                    type="button"
                    class="nm-vast-query__tab"
                    :class="{ 'nm-vast-query__tab--active': activePaneTab === tab.id }"
                    role="tab"
                    :aria-selected="activePaneTab === tab.id"
                    :title="tab.sqlPreview"
                    @click="selectResultTab(tab.id)"
                  >
                    {{ t('modules.vastbase.session.batchResultTab', { n: tabIdx + 1 }) }}
                    <span class="nm-vast-query__tab-meta">
                      {{ tab.fetchedCount }}{{ tab.hasMore ? '+' : '' }}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="nm-vast-query__tab-close"
                    :title="t('modules.vastbase.session.closeResultTab')"
                    :aria-label="t('modules.vastbase.session.closeResultTab')"
                    @click.stop="closeResultGridTab(tab.id)"
                  >
                    <RsIcon name="x" :size="11" />
                  </button>
                </div>
                <button
                  type="button"
                  class="nm-vast-query__tab"
                  :class="{
                    'nm-vast-query__tab--active': activePaneTab === 'messages',
                    'nm-vast-query__tab--alert': Boolean(lastError),
                  }"
                  role="tab"
                  :aria-selected="activePaneTab === 'messages'"
                  @click="selectResultTab('messages')"
                >
                  {{ t('modules.vastbase.session.messages') }}
                  <span v-if="hasMessages || batchActive" class="nm-vast-query__tab-meta">
                    {{ batchActive ? batchItems.length : messageItems.length }}
                  </span>
                </button>
              </div>

              <span
                v-if="resultSummaryText"
                class="nm-vast-query__result-summary"
                :title="resultSummaryText"
              >
                {{ resultSummaryText }}
              </span>

              <div class="nm-vast-query__result-actions">
                <RsInput
                  v-if="activePaneTab !== 'messages' && lastResult"
                  v-model="filterText"
                  size="sm"
                  clearable
                  class="nm-vast-query__filter"
                  :placeholder="t('modules.vastbase.session.filterPlaceholder')"
                >
                  <template #prefix>
                    <RsIcon name="search" :size="12" />
                  </template>
                </RsInput>
                <RsButton
                  v-if="hasMore"
                  variant="default"
                  size="sm"
                  class="nm-vast-query__btn-fetch-more"
                  :loading="loadingMore"
                  :disabled="running"
                  @click="fetchMore"
                >
                  <RsIcon name="arrow-down" :size="13" />
                  {{ t('modules.vastbase.session.fetchMore') }}
                </RsButton>
                <RsButton
                  v-if="hasMore"
                  variant="default"
                  size="sm"
                  class="nm-vast-query__btn-fetch-all"
                  :disabled="running || loadingMore"
                  @click="fetchAll"
                >
                  {{ t('modules.vastbase.session.fetchAll') }}
                </RsButton>
                <RsButton
                  variant="ghost"
                  size="sm"
                  class="nm-vast-query__btn-export"
                  :disabled="resultRows.length === 0 || activePaneTab === 'messages'"
                  @click="exportCsv"
                >
                  <RsIcon name="download" :size="13" />
                  {{ t('modules.vastbase.session.exportCsv') }}
                </RsButton>
              </div>
            </div>

            <div class="nm-vast-query__result-body">
              <RsLoading
                v-if="running && gridTabs.length === 0 && !lastError && !batchActive"
                block
                class="nm-vast-query__loading"
              />

              <template v-else-if="activePaneTab === 'messages'">
                <RsEmpty
                  v-if="!hasMessages && !batchActive"
                  fill
                  class="nm-vast-query__empty"
                  icon="message-square"
                  :description="t('modules.vastbase.session.messagesEmpty')"
                />
                <div v-else-if="batchActive" class="nm-vast-query__messages-host">
                  <div
                    v-if="messageItems[0]"
                    class="nm-vast-query__msg nm-vast-query__msg--summary"
                    :class="messageItems[0].tone ? `nm-vast-query__msg--${messageItems[0].tone}` : undefined"
                  >
                    <span class="nm-vast-query__msg-label">{{ messageItems[0].label }}</span>
                    <span class="nm-vast-query__msg-value">{{ messageItems[0].value }}</span>
                  </div>
                  <RsVirtualList
                    class="nm-vast-query__messages-virtual"
                    radius="none"
                    :items="batchItems"
                    height="100%"
                    :item-size="56"
                    :overscan="8"
                    :layout-active="active && activePaneTab === 'messages'"
                  >
                    <template #default="{ item }">
                      <button
                        type="button"
                        class="nm-vast-query__msg nm-vast-query__msg--batch"
                        :class="{
                          [`nm-vast-query__msg--${item.status === 'error' ? 'error' : item.status === 'ok' ? 'success' : item.status === 'running' ? 'default' : 'warning'}`]: true,
                          'nm-vast-query__msg--clickable': batchItemOpenable(item),
                        }"
                        :disabled="!batchItemOpenable(item)"
                        :title="[item.error, item.sqlPreview].filter(Boolean).join('\n')"
                        @click="openBatchGrid(item)"
                      >
                        <span class="nm-vast-query__msg-label">
                          {{ t('modules.vastbase.session.batchStmtLabel', { n: item.index + 1 }) }}
                        </span>
                        <span class="nm-vast-query__batch-body">
                          <span class="nm-vast-query__batch-meta">
                            <span
                              class="nm-vast-query__batch-status"
                              :data-status="item.status"
                            >
                              <template v-if="item.status === 'ok'">
                                {{ t('modules.vastbase.session.msgStatusOk') }}
                              </template>
                              <template v-else-if="item.status === 'error'">
                                {{ t('modules.vastbase.session.msgStatusError') }}
                              </template>
                              <template v-else-if="item.status === 'running'">
                                {{ t('modules.vastbase.session.batchStmtRunning') }}
                              </template>
                              <template v-else-if="item.status === 'skipped'">
                                {{ t('modules.vastbase.session.batchStmtSkipped') }}
                              </template>
                              <template v-else-if="item.status === 'cancelled'">
                                {{ t('modules.vastbase.session.msgStatusCancelled') }}
                              </template>
                              <template v-else>
                                {{ t('modules.vastbase.session.batchStmtPending') }}
                              </template>
                            </span>
                            <span v-if="item.status === 'ok'" class="nm-vast-query__batch-stats">
                              {{ item.rowCount ?? '—' }} · {{ item.durationMs ?? 0 }}ms
                              <template v-if="batchItemOpenable(item)">
                                · {{ t('modules.vastbase.session.batchOpenResult') }}
                              </template>
                            </span>
                          </span>
                          <span class="nm-vast-query__batch-preview">{{ item.sqlPreview }}</span>
                          <span
                            v-if="item.status === 'error' && item.error"
                            class="nm-vast-query__batch-error"
                          >{{ item.error }}</span>
                        </span>
                      </button>
                    </template>
                  </RsVirtualList>
                </div>
                <RsVirtualList
                  v-else
                  class="nm-vast-query__messages-virtual"
                  radius="none"
                  :items="messageItems"
                  height="100%"
                  :item-size="34"
                  :overscan="6"
                  :layout-active="active && activePaneTab === 'messages'"
                >
                  <template #default="{ item }">
                    <div
                      class="nm-vast-query__msg nm-vast-query__msg--row"
                      :class="item.tone ? `nm-vast-query__msg--${item.tone}` : undefined"
                    >
                      <span class="nm-vast-query__msg-label">{{ item.label }}</span>
                      <span class="nm-vast-query__msg-value">{{ item.value }}</span>
                    </div>
                  </template>
                </RsVirtualList>
              </template>

              <template v-else>
                <RsEmpty
                  v-if="!lastResult"
                  fill
                  class="nm-vast-query__empty"
                  icon="play-circle"
                  :description="t('modules.vastbase.session.noResult')"
                />
                <div v-else class="nm-vast-query__table-wrap">
                  <RsTable
                    :view-key="activePaneTab"
                    :layout-active="active && activePaneTab !== 'messages'"
                    :columns="resultColumns"
                    :data="resultRows"
                    row-key="__rowKey"
                    size="sm"
                    striped
                    fill
                    bordered
                    column-bordered
                    show-index
                    resizable
                    column-layout="fixed"
                    cell-tooltip
                    highlight-row
                    infinite
                    :has-more="hasMore"
                    :loading="running"
                    :loading-more="loadingMore"
                    :filter-text="filterText"
                    :filter-keys="filterKeys"
                    :virtual="true"
                    :virtual-columns-auto-threshold="40"
                    @load-more="fetchMore"
                  >
                    <template #empty>
                      {{ t('modules.vastbase.session.resultEmpty') }}
                    </template>
                  </RsTable>
                </div>
              </template>
            </div>
          </div>
        </template>
      </RsSplitPane>
      </div>
    </RsContextMenu>
  </div>
</template>

<style scoped>
.nm-vast-query {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-vast-query__surface {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

:deep(.nm-vast-query__btn-analyze),
:deep(.nm-vast-query__btn-fetch-all) {
  border-color: color-mix(in srgb, var(--rs-warning) 45%, var(--rs-border));
  color: var(--rs-warning);
  background: color-mix(in srgb, var(--rs-warning) 10%, var(--rs-surface));
}

:deep(.nm-vast-query__btn-analyze:hover:not(:disabled)),
:deep(.nm-vast-query__btn-fetch-all:hover:not(:disabled)) {
  border-color: var(--rs-warning);
  color: var(--rs-warning);
  background: color-mix(in srgb, var(--rs-warning) 16%, var(--rs-surface));
}

:deep(.nm-vast-query__btn-fetch-more) {
  border-color: color-mix(in srgb, var(--rs-accent, #3b82f6) 40%, var(--rs-border));
  color: var(--rs-accent, #3b82f6);
  background: color-mix(in srgb, var(--rs-accent, #3b82f6) 10%, var(--rs-surface));
}

:deep(.nm-vast-query__btn-fetch-more:hover:not(:disabled)) {
  border-color: var(--rs-accent, #3b82f6);
  color: var(--rs-accent, #3b82f6);
  background: color-mix(in srgb, var(--rs-accent, #3b82f6) 16%, var(--rs-surface));
}

:deep(.nm-vast-query__btn-export) {
  color: var(--rs-muted);
}

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

.nm-vast-query__history {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 18rem;
  min-width: 0;
}

.nm-vast-query__history-title {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
}

.nm-vast-query__history-empty {
  margin: 0;
  padding: 0.5rem 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-vast-query__history-list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nm-vast-query__history-item,
.nm-vast-query__history-clear {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  border-radius: var(--rs-radius-sm);
  font-size: var(--rs-font-size-xs);
  font-family: var(--rs-font-mono);
  color: var(--rs-foreground);
  padding: 0.35rem 0.45rem;
}

.nm-vast-query__history-item:hover,
.nm-vast-query__history-clear:hover {
  background: var(--rs-item-hover, rgba(127, 127, 127, 0.12));
}

.nm-vast-query__history-item {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-vast-query__history-clear {
  margin-top: 0.15rem;
  border-top: 1px solid var(--rs-border-subtle);
  border-radius: 0 0 var(--rs-radius-sm) var(--rs-radius-sm);
  color: var(--rs-muted);
  font-family: inherit;
}

.nm-vast-query__split {
  flex: 1;
  min-height: 0;
}

.nm-vast-query__split :deep(.rs-split__pane) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.nm-vast-query__pane-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-vast-query__editor {
  flex: 1;
  min-height: 0;
  border-radius: 0;
  border: none;
}

.nm-vast-query__editor-boot {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--rs-surface);
}

.nm-vast-query__result-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
  padding: 0 var(--rs-space-sm);
  height: 32px;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-subtle);
}

.nm-vast-query__result-tabs {
  display: inline-flex;
  align-items: stretch;
  height: 100%;
  gap: 2px;
  min-width: 0;
  max-width: min(70%, 42rem);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.nm-vast-query__tab-wrap {
  display: inline-flex;
  align-items: stretch;
  flex-shrink: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.nm-vast-query__tab-wrap--active {
  border-bottom-color: var(--rs-accent, #3b82f6);
}

.nm-vast-query__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  padding: 0 4px 0 10px;
  cursor: pointer;
  white-space: nowrap;
}

.nm-vast-query__tab:hover {
  color: var(--rs-foreground);
}

.nm-vast-query__tab--active {
  color: var(--rs-foreground);
}

.nm-vast-query__tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  margin-right: 4px;
  border: none;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  opacity: 0.55;
}

.nm-vast-query__tab-wrap:hover .nm-vast-query__tab-close,
.nm-vast-query__tab-wrap--active .nm-vast-query__tab-close {
  opacity: 1;
}

.nm-vast-query__tab-close:hover {
  color: var(--rs-foreground);
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.16));
}

.nm-vast-query__tab--alert {
  color: var(--rs-danger, #dc2626);
}

.nm-vast-query__tab-meta {
  font-family: var(--rs-font-mono);
  font-size: 10px;
  color: var(--rs-muted);
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.12));
  border-radius: 999px;
  padding: 0 6px;
  line-height: 16px;
}

.nm-vast-query__result-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  font-family: var(--rs-font-mono);
  font-size: 11px;
  color: var(--rs-muted);
  padding: 0 var(--rs-space-xs);
  user-select: text;
}

.nm-vast-query__result-actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
  min-width: 0;
}

.nm-vast-query__filter {
  width: 10.5rem;
  flex-shrink: 1;
  min-width: 6rem;
}

.nm-vast-query__export {
  flex-shrink: 0;
}

.nm-vast-query__result-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 仅作 fill 宿主：不在此滚动，交给 RsTable（.rs-table--fill）公共样式 */
.nm-vast-query__table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.nm-vast-query__messages-host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--rs-surface);
}

.nm-vast-query__messages-virtual {
  flex: 1;
  min-height: 0;
  padding: 0 var(--rs-space-md) var(--rs-space-sm);
  background: var(--rs-surface);
}

.nm-vast-query__msg {
  display: grid;
  grid-template-columns: 5.5rem minmax(0, 1fr);
  gap: var(--rs-space-sm);
  align-items: center;
  padding: 0 0.55rem;
  border-radius: 0;
  font-size: var(--rs-font-size-xs);
  line-height: 1.35;
  height: 100%;
  box-sizing: border-box;
}

.nm-vast-query__msg--summary {
  flex-shrink: 0;
  margin: var(--rs-space-sm) var(--rs-space-md) 2px;
  height: auto;
  min-height: 34px;
  padding: 0.4rem 0.55rem;
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.08));
}

.nm-vast-query__msg--row,
.nm-vast-query__msg--batch {
  width: 100%;
  margin: 0;
  border: none;
  background: transparent;
  text-align: left;
  color: inherit;
  font: inherit;
}

.nm-vast-query__msg--batch {
  align-items: start;
  padding: 0.35rem 0.55rem;
  border-bottom: 1px solid var(--rs-border-subtle, rgba(127, 127, 127, 0.12));
  overflow: hidden;
}

.nm-vast-query__msg--clickable {
  cursor: pointer;
}

.nm-vast-query__msg--clickable:hover {
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.1));
}

.nm-vast-query__msg--row:disabled,
.nm-vast-query__msg--batch:disabled {
  cursor: default;
  opacity: 1;
}

.nm-vast-query__msg-label {
  color: var(--rs-muted);
  font-weight: 500;
  white-space: nowrap;
  padding-top: 0.1rem;
}

.nm-vast-query__msg-value {
  color: var(--rs-foreground);
  font-family: var(--rs-font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-vast-query__batch-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.nm-vast-query__batch-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.65rem;
  min-width: 0;
}

.nm-vast-query__batch-status {
  display: inline-flex;
  align-items: center;
  height: 1.25rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.12));
  color: var(--rs-muted);
}

.nm-vast-query__batch-status[data-status='ok'] {
  background: color-mix(in srgb, var(--rs-success, #16a34a) 16%, transparent);
  color: var(--rs-success, #16a34a);
}

.nm-vast-query__batch-status[data-status='error'] {
  background: color-mix(in srgb, var(--rs-danger, #dc2626) 16%, transparent);
  color: var(--rs-danger, #dc2626);
}

.nm-vast-query__batch-status[data-status='skipped'],
.nm-vast-query__batch-status[data-status='cancelled'] {
  background: color-mix(in srgb, var(--rs-warning, #d97706) 16%, transparent);
  color: var(--rs-warning, #d97706);
}

.nm-vast-query__batch-status[data-status='running'] {
  background: color-mix(in srgb, var(--rs-primary, #2563eb) 14%, transparent);
  color: var(--rs-primary, #2563eb);
}

.nm-vast-query__batch-stats {
  color: var(--rs-muted);
  font-size: 0.7rem;
}

.nm-vast-query__batch-preview {
  color: var(--rs-foreground);
  font-family: var(--rs-font-mono);
  font-size: 0.72rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}

.nm-vast-query__batch-error {
  color: var(--rs-danger, #dc2626);
  font-size: 0.72rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-vast-query__msg--success .nm-vast-query__msg-value {
  color: var(--rs-success, #16a34a);
  font-weight: 600;
  font-family: inherit;
}

.nm-vast-query__msg--warning .nm-vast-query__msg-value {
  color: var(--rs-warning, #d97706);
}

.nm-vast-query__msg--error .nm-vast-query__msg-value {
  color: var(--rs-danger, #dc2626);
}

.nm-vast-query__msg--error .nm-vast-query__msg-label {
  color: var(--rs-danger, #dc2626);
}

.nm-vast-query__loading,
.nm-vast-query__empty {
  flex: 1;
  min-height: 0;
}

.nm-vast-query__loading {
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

/* 单元格字号/字重走 RsTable 公共样式，此处只区分语义色 */
:deep(.nm-vast-query__null) {
  color: var(--rs-muted);
  font-style: italic;
}
</style>
