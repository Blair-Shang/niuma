<script setup lang="ts">
import {
  RsButton,
  RsEmpty,
  RsIcon,
  RsInput,
  RsLoading,
  RsTable,
  RsVirtualList,
  copyTextToClipboard,
  type RsTableColumn,
} from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import BrowseCellEditorDialog from './BrowseCellEditorDialog.vue'
import {
  useCellViewDialog,
  type CellViewResolveFullValue,
} from '../composables/useCellViewDialog'
import type {
  QueryBatchStatementItem,
  QueryResultGridTabSummary,
  QueryResultMessageItem,
  QueryResultPanelLabels,
} from '../types/query-result'

const props = withDefaults(
  defineProps<{
    gridTabs: QueryResultGridTabSummary[]
    activePaneTab: string
    resultSummaryText?: string
    hasMore?: boolean
    loadingMore?: boolean
    running?: boolean
    layoutActive?: boolean
    resultRows: Record<string, unknown>[]
    // 方言侧可能是 RsTableColumn<QueryResultRow> 等更窄泛型，面板只消费展示字段
    resultColumns: RsTableColumn<any>[]
  filterKeys?: string[]
  lastError?: string | null
  hasMessages?: boolean
  messageItems?: QueryResultMessageItem[]
  batchItems?: QueryBatchStatementItem[]
  batchActive?: boolean
  labels: QueryResultPanelLabels
  showFilter?: boolean
  /** 方言异步加载截断 LOB 全量（如 Oracle query.loadLob） */
  resolveFullCellValue?: CellViewResolveFullValue
}>(),
{
  resultSummaryText: '',
  hasMore: false,
  loadingMore: false,
  running: false,
  layoutActive: true,
  filterKeys: () => [],
  lastError: null,
  hasMessages: false,
  messageItems: () => [],
  batchItems: () => [],
  batchActive: false,
  showFilter: true,
},
)

const filterText = defineModel<string>('filterText', { default: '' })

const emit = defineEmits<{
  selectTab: [id: string]
  closeTab: [id: string]
  fetchMore: []
  fetchAll: []
  exportCsv: []
  openBatch: [item: QueryBatchStatementItem]
}>()

const {
  open: cellViewOpen,
  draft: cellViewDraft,
  title: cellViewTitle,
  labels: cellViewLabels,
  openCell: openCellView,
  copyFull: copyCellFull,
} = useCellViewDialog(
  () => {
    // 仅透传方言已配置的文案；缺省由 useCellViewDialog 走 modules.database 多语言
    const next: Partial<{
      viewTitle: string
      close: string
      copyFull: string
      copied: string
    }> = {}
    if (props.labels.cellViewTitle) next.viewTitle = props.labels.cellViewTitle
    if (props.labels.cellViewClose) next.close = props.labels.cellViewClose
    if (props.labels.cellViewCopyFull) next.copyFull = props.labels.cellViewCopyFull
    if (props.labels.cellViewCopied) next.copied = props.labels.cellViewCopied
    return next
  },
  props.resolveFullCellValue,
)

function onCellView(
  row: Record<string, unknown>,
  column: RsTableColumn<Record<string, unknown>>,
): void {
  openCellView(row, column)
}

async function onCellViewCopyFull(): Promise<void> {
  await copyCellFull()
}

const messagesLayoutActive = computed(
  () => props.layoutActive && props.activePaneTab === 'messages',
)

const gridLayoutActive = computed(
  () => props.layoutActive && props.activePaneTab !== 'messages',
)

const showResultFilter = computed(
  () => props.showFilter && props.activePaneTab !== 'messages' && Boolean(props.activePaneTab),
)

const showGridEmpty = computed(
  () => !props.activePaneTab || props.resultColumns.length === 0,
)

/** 批跑消息区：摘要条（成功概览）与错误详情分开，避免长错误被单行截断 */
const batchSummaryItem = computed(() =>
  props.messageItems.find((item) => item.key === 'batch-summary') ?? props.messageItems[0] ?? null,
)

const selectedBatchErrorIndex = ref<number | null>(null)
const copiedKey = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const detailErrorText = computed(() => {
  if (!props.batchActive) return ''
  const idx = selectedBatchErrorIndex.value
  if (idx != null) {
    const hit = props.batchItems.find((item) => item.index === idx)
    if (hit?.error) return hit.error
  }
  if (props.lastError) return props.lastError
  const firstErr = props.batchItems.find((item) => item.status === 'error' && item.error)
  return firstErr?.error ?? ''
})

const detailErrorStmt = computed(() => {
  const idx = selectedBatchErrorIndex.value
  if (idx != null) {
    const hit = props.batchItems.find((item) => item.index === idx)
    if (hit) return hit
  }
  return props.batchItems.find((item) => item.status === 'error' && item.error) ?? null
})

watch(
  () => [props.batchActive, props.lastError, props.batchItems.map((item) => `${item.index}:${item.status}:${item.error ?? ''}`).join('|')] as const,
  () => {
    if (!props.batchActive) {
      selectedBatchErrorIndex.value = null
      return
    }
    const current = selectedBatchErrorIndex.value
    if (
      current != null
      && props.batchItems.some((item) => item.index === current && item.status === 'error' && item.error)
    ) {
      return
    }
    const firstErr = props.batchItems.find((item) => item.status === 'error' && item.error)
    selectedBatchErrorIndex.value = firstErr?.index ?? null
  },
  { immediate: true },
)

const copyLabel = computed(() => props.labels.copyMessage?.trim() || '复制')
const copiedLabel = computed(() => props.labels.copiedHint?.trim() || '已复制')

async function copyText(text: string, key: string): Promise<void> {
  const ok = await copyTextToClipboard(text)
  if (!ok) return
  copiedKey.value = key
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    if (copiedKey.value === key) copiedKey.value = null
  }, 1600)
}

function batchItemOpenable(item: QueryBatchStatementItem): boolean {
  return Boolean(
    item.hasGrid && item.gridTabId && props.gridTabs.some((g) => g.id === item.gridTabId),
  )
}

function onBatchItemClick(item: QueryBatchStatementItem): void {
  if (item.status === 'error' && item.error) {
    selectedBatchErrorIndex.value = item.index
  }
  if (batchItemOpenable(item)) {
    emit('openBatch', item)
  }
}

function statusLabel(item: QueryBatchStatementItem): string {
  switch (item.status) {
    case 'ok':
      return props.labels.msgOk
    case 'error':
      return props.labels.msgError
    case 'running':
      return props.labels.batchStmtRunning
    case 'skipped':
      return props.labels.batchStmtSkipped
    case 'cancelled':
      return props.labels.cancelled
    default:
      return props.labels.batchStmtPending
  }
}

function statusIcon(status: QueryBatchStatementItem['status']): string {
  switch (status) {
    case 'ok':
      return 'check'
    case 'error':
      return 'x'
    case 'running':
      return 'loader'
    case 'cancelled':
    case 'skipped':
      return 'minus'
    default:
      return 'circle'
  }
}

function plainToneIcon(tone?: QueryResultMessageItem['tone']): string {
  if (tone === 'error') return 'x'
  if (tone === 'warning') return 'triangle-alert'
  if (tone === 'success') return 'check'
  return 'info'
}
</script>

<template>
  <div class="nm-query-result">
    <div class="nm-query-result__bar">
      <div class="nm-query-result__tabs" role="tablist">
        <div
          v-for="(tab, tabIdx) in gridTabs"
          :key="tab.id"
          class="nm-query-result__tab-wrap"
          :class="{ 'nm-query-result__tab-wrap--active': activePaneTab === tab.id }"
        >
          <button
            type="button"
            class="nm-query-result__tab"
            :class="{ 'nm-query-result__tab--active': activePaneTab === tab.id }"
            role="tab"
            :aria-selected="activePaneTab === tab.id"
            :title="tab.sqlPreview"
            @click="emit('selectTab', tab.id)"
          >
            {{ labels.batchResultTab(tabIdx + 1) }}
            <span class="nm-query-result__tab-meta" :title="labels.tabRowCount(tab.fetchedCount, tab.hasMore)">
              {{ labels.tabRowCount(tab.fetchedCount, tab.hasMore) }}
            </span>
          </button>
          <button
            type="button"
            class="nm-query-result__tab-close"
            :title="labels.closeResultTab"
            :aria-label="labels.closeResultTab"
            @click.stop="emit('closeTab', tab.id)"
          >
            <RsIcon name="x" :size="11" />
          </button>
        </div>
        <button
          type="button"
          class="nm-query-result__tab"
          :class="{
            'nm-query-result__tab--active': activePaneTab === 'messages',
            'nm-query-result__tab--alert': Boolean(lastError),
          }"
          role="tab"
          :aria-selected="activePaneTab === 'messages'"
          @click="emit('selectTab', 'messages')"
        >
          <RsIcon name="message-square" :size="12" />
          {{ labels.messages }}
          <span v-if="hasMessages || batchActive" class="nm-query-result__tab-meta">
            {{ batchActive ? batchItems.length : messageItems.length }}
          </span>
        </button>
      </div>

      <span
        v-if="resultSummaryText"
        class="nm-query-result__summary"
        :title="resultSummaryText"
      >
        {{ resultSummaryText }}
      </span>

      <div class="nm-query-result__actions">
        <RsInput
          v-if="showResultFilter"
          v-model="filterText"
          size="sm"
          clearable
          class="nm-query-result__filter"
          :placeholder="labels.filterPlaceholder"
        >
          <template #prefix>
            <RsIcon name="search" :size="12" />
          </template>
        </RsInput>
        <RsButton
          v-if="hasMore"
          variant="default"
          size="sm"
          class="nm-query-result__btn-fetch-more"
          :loading="loadingMore"
          :disabled="running"
          @click="emit('fetchMore')"
        >
          <RsIcon name="arrow-down" :size="13" />
          {{ labels.loadMore }}
        </RsButton>
        <RsButton
          v-if="hasMore"
          variant="default"
          size="sm"
          class="nm-query-result__btn-fetch-all"
          :disabled="running || loadingMore"
          @click="emit('fetchAll')"
        >
          {{ labels.fetchAll }}
        </RsButton>
        <RsButton
          variant="ghost"
          size="sm"
          class="nm-query-result__btn-export"
          :disabled="resultRows.length === 0 || activePaneTab === 'messages'"
          @click="emit('exportCsv')"
        >
          <RsIcon name="download" :size="13" />
          {{ labels.exportCsv }}
        </RsButton>
        <slot name="actions-extra" />
      </div>
    </div>

    <div class="nm-query-result__body">
      <RsLoading
        v-if="running && gridTabs.length === 0 && !lastError && !batchActive"
        block
        class="nm-query-result__loading"
      />

      <template v-else-if="activePaneTab === 'messages'">
        <RsEmpty
          v-if="!hasMessages && !batchActive"
          fill
          class="nm-query-result__empty"
          :description="labels.messagesEmpty"
        >
          <template #icon>
            <RsIcon name="message-square" :size="22" />
          </template>
        </RsEmpty>
        <div v-else-if="batchActive" class="nm-query-result__messages-host">
          <div
            v-if="batchSummaryItem"
            class="nm-query-result__log-summary"
            :class="batchSummaryItem.tone ? `nm-query-result__log-summary--${batchSummaryItem.tone}` : undefined"
          >
            <RsIcon
              :name="batchSummaryItem.tone === 'error' || batchSummaryItem.tone === 'warning' ? 'triangle-alert' : 'check'"
              :size="13"
            />
            <span class="nm-query-result__log-summary-text">{{ batchSummaryItem.value }}</span>
          </div>
          <div
            v-if="detailErrorText"
            class="nm-query-result__error-detail"
            role="alert"
          >
            <div class="nm-query-result__error-detail-bar">
              <span class="nm-query-result__error-detail-title">
                <RsIcon name="x" :size="12" />
                {{
                  detailErrorStmt
                    ? labels.batchStmtLabel(detailErrorStmt.index + 1)
                    : labels.msgError
                }}
              </span>
              <RsButton
                size="ssm"
                variant="ghost"
                :icon="copiedKey === 'batch-error' ? 'check' : 'copy'"
                :tooltip="copiedKey === 'batch-error' ? copiedLabel : copyLabel"
                @click="copyText(detailErrorText, 'batch-error')"
              >
                {{ copiedKey === 'batch-error' ? copiedLabel : copyLabel }}
              </RsButton>
            </div>
            <pre class="nm-query-result__error-detail-body">{{ detailErrorText }}</pre>
          </div>
          <div class="nm-query-result__log-head" aria-hidden="true">
            <span class="nm-query-result__log-col nm-query-result__log-col--idx">#</span>
            <span class="nm-query-result__log-col nm-query-result__log-col--status">{{ labels.logColStatus }}</span>
            <span class="nm-query-result__log-col nm-query-result__log-col--time">{{ labels.logColTime }}</span>
            <span class="nm-query-result__log-col nm-query-result__log-col--rows">{{ labels.logColRows }}</span>
            <span class="nm-query-result__log-col nm-query-result__log-col--sql">SQL</span>
          </div>
          <RsVirtualList
            class="nm-query-result__messages-virtual"
            radius="none"
            :items="batchItems"
            height="100%"
            :item-size="30"
            :overscan="10"
            :layout-active="messagesLayoutActive"
          >
            <template #default="{ item }">
              <button
                type="button"
                class="nm-query-result__log-line"
                :class="{
                  'nm-query-result__log-line--clickable': batchItemOpenable(item) || Boolean(item.error),
                  'nm-query-result__log-line--selected':
                    item.status === 'error' && selectedBatchErrorIndex === item.index,
                  [`nm-query-result__log-line--${item.status}`]: true,
                }"
                :disabled="!batchItemOpenable(item) && !item.error"
                :title="item.sqlPreview"
                @click="onBatchItemClick(item)"
              >
                <span class="nm-query-result__log-col nm-query-result__log-col--idx">
                  {{ item.index + 1 }}
                </span>
                <span class="nm-query-result__log-col nm-query-result__log-col--status" :data-status="item.status">
                  <RsIcon :name="statusIcon(item.status)" :size="12" />
                  {{ statusLabel(item) }}
                </span>
                <span class="nm-query-result__log-col nm-query-result__log-col--time">
                  <template v-if="item.durationMs != null">{{ item.durationMs }}</template>
                  <template v-else>—</template>
                </span>
                <span class="nm-query-result__log-col nm-query-result__log-col--rows">
                  <template v-if="item.rowCount != null">{{ item.rowCount }}</template>
                  <template v-else>—</template>
                </span>
                <span class="nm-query-result__log-col nm-query-result__log-col--sql">
                  <span class="nm-query-result__log-sql">{{ item.sqlPreview }}</span>
                  <span
                    v-if="item.status === 'error' && item.error"
                    class="nm-query-result__log-err"
                  >{{ item.error }}</span>
                </span>
                <span
                  v-if="batchItemOpenable(item)"
                  class="nm-query-result__log-col nm-query-result__log-col--action"
                >
                  {{ labels.batchOpenResult }}
                </span>
              </button>
            </template>
          </RsVirtualList>
        </div>
        <div v-else class="nm-query-result__messages-scroll">
          <div
            v-for="item in messageItems"
            :key="item.key"
            class="nm-query-result__log-plain"
            :class="item.tone ? `nm-query-result__log-plain--${item.tone}` : undefined"
          >
            <RsIcon :name="plainToneIcon(item.tone)" :size="12" class="nm-query-result__log-plain-icon" />
            <span class="nm-query-result__log-plain-label">{{ item.label }}</span>
            <div class="nm-query-result__log-plain-body">
              <RsButton
                v-if="item.value"
                class="nm-query-result__log-plain-copy"
                size="ssm"
                variant="ghost"
                :icon="copiedKey === item.key ? 'check' : 'copy'"
                :tooltip="copiedKey === item.key ? copiedLabel : copyLabel"
                @click="copyText(item.value, item.key)"
              >
                {{ copiedKey === item.key ? copiedLabel : copyLabel }}
              </RsButton>
              <pre class="nm-query-result__log-plain-value">{{ item.value }}</pre>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <RsEmpty
          v-if="showGridEmpty"
          fill
          class="nm-query-result__empty"
          :description="labels.emptyResult"
        >
          <template #icon>
            <RsIcon name="play" :size="22" />
          </template>
        </RsEmpty>
        <div v-else class="nm-query-result__table-wrap">
          <slot
            name="table"
            :columns="resultColumns"
            :rows="resultRows"
            :view-key="activePaneTab"
            :layout-active="gridLayoutActive"
            :has-more="hasMore"
            :loading="running"
            :loading-more="loadingMore"
            :filter-text="filterText"
            :filter-keys="filterKeys"
          >
            <RsTable
              :view-key="activePaneTab"
              :layout-active="gridLayoutActive"
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
              @load-more="emit('fetchMore')"
              @cell-view="onCellView"
            >
              <template #empty>
                {{ labels.resultEmpty }}
              </template>
            </RsTable>
          </slot>
        </div>
      </template>
    </div>

    <BrowseCellEditorDialog
      v-model:open="cellViewOpen"
      v-model:draft="cellViewDraft"
      :title="cellViewTitle"
      readonly
      :cancel-label="cellViewLabels().close"
      :show-copy-full="true"
      :copy-full-label="cellViewLabels().copyFull"
      :copied-label="cellViewLabels().copied"
      @copy-full="onCellViewCopyFull"
    />
  </div>
</template>

<style scoped>
.nm-query-result {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-query-result__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
  padding: 0 var(--rs-space-sm);
  height: 32px;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-subtle, var(--rs-surface));
}

.nm-query-result__tabs {
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

.nm-query-result__tab-wrap {
  display: inline-flex;
  align-items: stretch;
  flex-shrink: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.nm-query-result__tab-wrap--active {
  border-bottom-color: var(--rs-accent, #3b82f6);
}

.nm-query-result__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--rs-muted, var(--rs-fg-muted));
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  padding: 0 4px 0 10px;
  cursor: pointer;
  white-space: nowrap;
  height: 100%;
}

.nm-query-result__tab:hover {
  color: var(--rs-foreground);
}

.nm-query-result__tab--active {
  color: var(--rs-foreground);
}

.nm-query-result__tab--alert:not(.nm-query-result__tab--active) {
  color: var(--rs-danger, #dc2626);
}

.nm-query-result__tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  margin-right: 4px;
  border: none;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-muted, var(--rs-fg-muted));
  cursor: pointer;
  opacity: 0.55;
  padding: 0;
}

.nm-query-result__tab-wrap:hover .nm-query-result__tab-close,
.nm-query-result__tab-wrap--active .nm-query-result__tab-close {
  opacity: 1;
}

.nm-query-result__tab-close:hover {
  color: var(--rs-foreground);
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.16));
}

.nm-query-result__tab-meta {
  font-family: var(--rs-font-mono);
  font-size: 10px;
  color: var(--rs-muted, var(--rs-fg-muted));
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.12));
  border-radius: 999px;
  padding: 0 6px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.nm-query-result__summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  font-family: var(--rs-font-mono);
  font-size: 11px;
  color: var(--rs-muted, var(--rs-fg-muted));
  padding: 0 var(--rs-space-xs);
  user-select: text;
}

.nm-query-result__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
  min-width: 0;
}

.nm-query-result__filter {
  width: 10.5rem;
  flex-shrink: 1;
  min-width: 6rem;
}

:deep(.nm-query-result__btn-fetch-all) {
  border-color: color-mix(in srgb, var(--rs-warning) 45%, var(--rs-border));
  color: var(--rs-warning);
  background: color-mix(in srgb, var(--rs-warning) 10%, var(--rs-surface));
}

:deep(.nm-query-result__btn-fetch-all:hover:not(:disabled)) {
  border-color: var(--rs-warning);
  color: var(--rs-warning);
  background: color-mix(in srgb, var(--rs-warning) 16%, var(--rs-surface));
}

:deep(.nm-query-result__btn-fetch-more) {
  border-color: color-mix(in srgb, var(--rs-accent, #3b82f6) 40%, var(--rs-border));
  color: var(--rs-accent, #3b82f6);
  background: color-mix(in srgb, var(--rs-accent, #3b82f6) 10%, var(--rs-surface));
}

:deep(.nm-query-result__btn-fetch-more:hover:not(:disabled)) {
  border-color: var(--rs-accent, #3b82f6);
  color: var(--rs-accent, #3b82f6);
  background: color-mix(in srgb, var(--rs-accent, #3b82f6) 16%, var(--rs-surface));
}

:deep(.nm-query-result__btn-export) {
  color: var(--rs-muted);
}

.nm-query-result__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.nm-query-result__loading,
.nm-query-result__empty {
  flex: 1;
  min-height: 0;
}

.nm-query-result__table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.nm-query-result__messages-host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--rs-surface);
}

.nm-query-result__log-summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
  margin: 0;
  padding: 0.35rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-success, #16a34a) 8%, var(--rs-surface));
  color: var(--rs-success, #16a34a);
  font-size: var(--rs-font-size-xs);
  font-family: var(--rs-font-mono);
}

.nm-query-result__log-summary--error {
  background: color-mix(in srgb, var(--rs-danger, #dc2626) 8%, var(--rs-surface));
  color: var(--rs-danger, #dc2626);
}

.nm-query-result__log-summary--warning {
  background: color-mix(in srgb, var(--rs-warning, #d97706) 8%, var(--rs-surface));
  color: var(--rs-warning, #d97706);
}

.nm-query-result__log-summary-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}

.nm-query-result__error-detail {
  flex: 0 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: min(42vh, 280px);
  border-bottom: 1px solid color-mix(in srgb, var(--rs-danger, #dc2626) 28%, var(--rs-border-subtle));
  background: color-mix(in srgb, var(--rs-danger, #dc2626) 6%, var(--rs-surface));
}

.nm-query-result__error-detail-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-shrink: 0;
  padding: 0.25rem 0.5rem 0.25rem 0.75rem;
}

.nm-query-result__error-detail-title {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
  color: var(--rs-danger, #dc2626);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
}

.nm-query-result__error-detail-body {
  margin: 0;
  padding: 0 0.75rem 0.55rem;
  min-height: 0;
  overflow: auto;
  font-family: var(--rs-font-mono);
  font-size: 11px;
  line-height: 1.45;
  color: var(--rs-danger, #dc2626);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
  cursor: text;
}

.nm-query-result__log-head,
.nm-query-result__log-line {
  display: grid;
  grid-template-columns: 2.25rem 5.5rem 3.5rem 3.25rem minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 0 0.75rem;
  font-size: 11px;
  font-family: var(--rs-font-mono);
  line-height: 1.25;
}

.nm-query-result__log-head {
  flex-shrink: 0;
  height: 24px;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-subtle, var(--rs-surface));
  color: var(--rs-muted, var(--rs-fg-muted));
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 10px;
  font-family: inherit;
}

.nm-query-result__messages-virtual {
  flex: 1;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-query-result__messages-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.35rem 0;
  background: var(--rs-surface);
}

.nm-query-result__log-line {
  height: 100%;
  margin: 0;
  border: none;
  border-bottom: 1px solid var(--rs-border-subtle, rgba(127, 127, 127, 0.1));
  background: transparent;
  color: var(--rs-foreground);
  text-align: left;
  cursor: default;
}

.nm-query-result__log-line--clickable {
  cursor: pointer;
}

.nm-query-result__log-line--clickable:hover {
  background: var(--rs-item-hover, rgba(127, 127, 127, 0.08));
}

.nm-query-result__log-line:disabled {
  opacity: 1;
}

.nm-query-result__log-line--error {
  background: color-mix(in srgb, var(--rs-danger, #dc2626) 5%, transparent);
}

.nm-query-result__log-line--selected {
  outline: 1px solid color-mix(in srgb, var(--rs-danger, #dc2626) 45%, transparent);
  outline-offset: -1px;
  background: color-mix(in srgb, var(--rs-danger, #dc2626) 10%, transparent);
}

.nm-query-result__log-line--running {
  background: color-mix(in srgb, var(--rs-primary, #2563eb) 5%, transparent);
}

.nm-query-result__log-col--idx {
  color: var(--rs-muted, var(--rs-fg-muted));
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.nm-query-result__log-col--status {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
}

.nm-query-result__log-col--status[data-status='ok'] {
  color: var(--rs-success, #16a34a);
}

.nm-query-result__log-col--status[data-status='error'] {
  color: var(--rs-danger, #dc2626);
}

.nm-query-result__log-col--status[data-status='running'] {
  color: var(--rs-primary, #2563eb);
}

.nm-query-result__log-col--status[data-status='skipped'],
.nm-query-result__log-col--status[data-status='cancelled'] {
  color: var(--rs-warning, #d97706);
}

.nm-query-result__log-col--time,
.nm-query-result__log-col--rows {
  font-variant-numeric: tabular-nums;
  color: var(--rs-muted, var(--rs-fg-muted));
  text-align: right;
  white-space: nowrap;
}

.nm-query-result__log-col--sql {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow: hidden;
}

.nm-query-result__log-sql {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rs-foreground);
}

.nm-query-result__log-err {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rs-danger, #dc2626);
  font-size: 10px;
}

.nm-query-result__log-col--action {
  color: var(--rs-accent, #3b82f6);
  white-space: nowrap;
  font-size: 10px;
  font-family: inherit;
}

.nm-query-result__log-plain {
  display: grid;
  grid-template-columns: 1rem 4.5rem minmax(0, 1fr);
  gap: 0.5rem;
  align-items: start;
  padding: 0.45rem 0.75rem;
  box-sizing: border-box;
  font-size: 11px;
  border-bottom: 1px solid var(--rs-border-subtle, rgba(127, 127, 127, 0.08));
}

.nm-query-result__log-plain-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.2rem;
}

.nm-query-result__log-plain-copy {
  align-self: flex-end;
}

.nm-query-result__log-plain-icon {
  color: var(--rs-muted, var(--rs-fg-muted));
  flex-shrink: 0;
  margin-top: 1px;
}

.nm-query-result__log-plain--success .nm-query-result__log-plain-icon {
  color: var(--rs-success, #16a34a);
}

.nm-query-result__log-plain--error .nm-query-result__log-plain-icon {
  color: var(--rs-danger, #dc2626);
}

.nm-query-result__log-plain--warning .nm-query-result__log-plain-icon {
  color: var(--rs-warning, #d97706);
}

.nm-query-result__log-plain-label {
  color: var(--rs-muted, var(--rs-fg-muted));
  font-weight: 600;
  white-space: nowrap;
  padding-top: 1px;
}

.nm-query-result__log-plain-value {
  margin: 0;
  min-width: 0;
  max-height: min(50vh, 360px);
  overflow: auto;
  font-family: var(--rs-font-mono);
  font-size: 11px;
  line-height: 1.45;
  color: var(--rs-foreground);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
  cursor: text;
}

.nm-query-result__log-plain--success .nm-query-result__log-plain-value {
  color: var(--rs-success, #16a34a);
}

.nm-query-result__log-plain--error .nm-query-result__log-plain-value {
  color: var(--rs-danger, #dc2626);
}

.nm-query-result__log-plain--warning .nm-query-result__log-plain-value {
  color: var(--rs-warning, #d97706);
}
</style>
