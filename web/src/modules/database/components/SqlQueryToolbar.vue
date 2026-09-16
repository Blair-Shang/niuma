<script setup lang="ts">
import { computed } from 'vue'
import {
  RsButton,
  RsCheckbox,
  RsDropdown,
  RsIcon,
  RsPopover,
  type RsDropdownItems,
} from '@niuma/ui'
import { sqlIdeToolbarIconButton } from '../types/sql-ide-toolbar'
import type { SqlQueryHistoryEntry, SqlQueryToolbarLabels } from '../types/sql-query-shell'

const props = withDefaults(
  defineProps<{
    labels: SqlQueryToolbarLabels
    running?: boolean
    cancelling?: boolean
    hasSelection?: boolean
    /** 是否允许执行（如 session 未就绪） */
    canRun?: boolean
    historyEnabled?: boolean
    historyOpen?: boolean
    historyEntries?: SqlQueryHistoryEntry[]
    showExplain?: boolean
    showExplainAnalyze?: boolean
    /** 显示 Auto-commit / Commit / Rollback */
    showTransaction?: boolean
    autoCommit?: boolean
    inTransaction?: boolean
    txBusy?: boolean
  }>(),
  {
    running: false,
    cancelling: false,
    hasSelection: false,
    canRun: true,
    historyEnabled: true,
    historyOpen: false,
    historyEntries: () => [],
    showExplain: true,
    showExplainAnalyze: true,
    showTransaction: false,
    autoCommit: true,
    inTransaction: false,
    txBusy: false,
  },
)

const historyOpenModel = defineModel<boolean>('historyOpen', { default: false })

const emit = defineEmits<{
  format: []
  explain: []
  explainAnalyze: []
  run: []
  cancel: []
  historyPick: [id: string]
  'update:autoCommit': [value: boolean]
  commit: []
  rollback: []
}>()

const sessionLocked = computed(() => props.running || props.txBusy || !props.canRun)

const runTooltip = computed(() => {
  if (props.hasSelection) return `${props.labels.runSelection} · ${props.labels.runTooltip}`
  return props.labels.runTooltip
})

const showTx = computed(() => Boolean(props.showTransaction && props.labels.autoCommit))
const showExplainMenu = computed(
  () =>
    (props.showExplain ? 1 : 0) + (props.showExplainAnalyze ? 1 : 0) > 1,
)

const explainMenuItems = computed<RsDropdownItems>(() => [
  ...(props.showExplain
    ? [{
        value: 'explain',
        label: props.labels.explain,
        icon: 'list-tree',
        hint: props.labels.explainTooltip,
      }]
    : []),
  ...(props.showExplainAnalyze
    ? [{
        value: 'analyze',
        label: props.labels.explainAnalyze,
        icon: 'gauge',
        hint: props.labels.explainAnalyzeTooltip,
      }]
    : []),
])

function historyPreview(sql: string): string {
  const preview = sql.replace(/\s+/g, ' ').slice(0, 72)
  return sql.length > 72 ? `${preview}…` : preview
}

function onExplainMenu(value: string): void {
  if (value === 'analyze') emit('explainAnalyze')
  else emit('explain')
}

function onExplainMain(): void {
  if (props.showExplain) emit('explain')
  else emit('explainAnalyze')
}
</script>

<template>
  <header class="nm-sql-tb" role="toolbar" :aria-label="labels.toolbarAria">
    <div class="nm-sql-tb__lead">
      <div class="nm-sql-tb__scope">
        <slot name="identity" />
      </div>

      <span class="nm-sql-tb__sep" aria-hidden="true" />

      <slot name="toolbar-start" />

      <RsButton
        v-bind="sqlIdeToolbarIconButton"
        icon="play"
        tone="success"
        :disabled="running || !canRun"
        :tooltip="runTooltip"
        @click="emit('run')"
      />
      <RsButton
        v-bind="sqlIdeToolbarIconButton"
        icon="square"
        tone="danger"
        :disabled="!running"
        :tooltip="labels.cancelTooltip"
        @click="emit('cancel')"
      />

      <span class="nm-sql-tb__sep" aria-hidden="true" />

      <RsDropdown
        v-if="showExplainMenu"
        :items="explainMenuItems"
        :disabled="running || !canRun"
        :show-selected="false"
        size="ssm"
        content-width="fit"
        @select="onExplainMenu"
      >
        <template #trigger>
          <RsButton
            type="button"
            variant="text"
            size="sm"
            radius="sm"
            icon="list-tree"
            :disabled="running || !canRun"
            :tooltip="labels.explainTooltip"
            :aria-label="labels.explain"
          >
            <RsIcon name="chevron-down" :size="12" />
          </RsButton>
        </template>
      </RsDropdown>
      <RsButton
        v-else-if="showExplain || showExplainAnalyze"
        v-bind="sqlIdeToolbarIconButton"
        icon="list-tree"
        :disabled="running || !canRun"
        :tooltip="showExplain ? labels.explainTooltip : labels.explainAnalyzeTooltip"
        @click="onExplainMain"
      />

      <RsButton
        v-bind="sqlIdeToolbarIconButton"
        icon="align-left"
        :disabled="running"
        :tooltip="labels.formatTooltip"
        @click="emit('format')"
      />

      <template v-if="showTx">
        <span class="nm-sql-tb__sep" aria-hidden="true" />
        <div
          class="nm-sql-tb__autocommit"
          :title="labels.autoCommitTooltip || labels.autoCommit"
        >
          <RsCheckbox
            size="ssm"
            :model-value="autoCommit"
            :disabled="sessionLocked"
            :aria-label="labels.autoCommit"
            @update:model-value="emit('update:autoCommit', $event)"
          >
            {{ labels.autoCommit }}
          </RsCheckbox>
        </div>
        <template v-if="!autoCommit">
          <RsButton
            type="button"
            variant="text"
            size="sm"
            radius="sm"
            :disabled="sessionLocked || !inTransaction"
            :tooltip="labels.commitTooltip || labels.commit"
            @click="emit('commit')"
          >
            {{ labels.commit }}
          </RsButton>
          <RsButton
            type="button"
            variant="text"
            size="sm"
            radius="sm"
            tone="danger"
            :disabled="sessionLocked || !inTransaction"
            :tooltip="labels.rollbackTooltip || labels.rollback"
            @click="emit('rollback')"
          >
            {{ labels.rollback }}
          </RsButton>
          <span
            v-if="inTransaction"
            class="nm-sql-tb__in-tx"
          >{{ labels.inTransaction }}</span>
        </template>
      </template>
    </div>

    <div class="nm-sql-tb__trail">
      <RsPopover
        v-if="historyEnabled"
        v-model:open="historyOpenModel"
        side="bottom"
        align="end"
        width="lg"
      >
        <RsButton
          v-bind="sqlIdeToolbarIconButton"
          icon="history"
          :tooltip="labels.history"
        />
        <template #content>
          <div class="nm-sql-tb__history">
            <p class="nm-sql-tb__history-title">{{ labels.history }}</p>
            <p
              v-if="historyEntries.length === 0"
              class="nm-sql-tb__history-empty"
            >
              {{ labels.historyEmpty }}
            </p>
            <ul v-else class="nm-sql-tb__history-list">
              <li v-for="entry in historyEntries" :key="entry.id">
                <button
                  type="button"
                  class="nm-sql-tb__history-item"
                  :title="entry.sql"
                  @click="emit('historyPick', entry.id)"
                >
                  {{ historyPreview(entry.sql) }}
                </button>
              </li>
            </ul>
            <button
              v-if="historyEntries.length > 0"
              type="button"
              class="nm-sql-tb__history-clear"
              @click="emit('historyPick', '__clear')"
            >
              {{ labels.historyClear }}
            </button>
          </div>
        </template>
      </RsPopover>
      <slot name="toolbar-end" />
    </div>
  </header>
</template>

<style scoped src="./sql-ide-toolbar.css"></style>
<style scoped>
.nm-sql-tb__autocommit {
  display: inline-flex;
  align-items: center;
  padding: 0 6px 0 4px;
}

.nm-sql-tb__in-tx {
  padding: 0 6px;
  font-size: 11px;
  color: var(--rs-warning);
  white-space: nowrap;
}

.nm-sql-tb__history {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 18rem;
  min-width: 0;
}

.nm-sql-tb__history-title {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
}

.nm-sql-tb__history-empty {
  margin: 0;
  padding: 0.5rem 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-sql-tb__history-list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nm-sql-tb__history-item,
.nm-sql-tb__history-clear {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  border-radius: var(--rs-radius-sm);
  font-size: var(--rs-font-size-xs);
  font-family: var(--rs-font-mono);
  color: var(--rs-text);
  padding: 0.35rem 0.45rem;
}

.nm-sql-tb__history-item:hover,
.nm-sql-tb__history-clear:hover {
  background: var(--rs-item-hover, rgba(127, 127, 127, 0.12));
}

.nm-sql-tb__history-item {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-sql-tb__history-clear {
  margin-top: 0.15rem;
  border-top: 1px solid var(--rs-border-subtle);
  border-radius: 0 0 var(--rs-radius-sm) var(--rs-radius-sm);
  color: var(--rs-muted);
  font-family: inherit;
}
</style>
