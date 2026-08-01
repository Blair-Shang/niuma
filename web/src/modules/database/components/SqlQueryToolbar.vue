<script setup lang="ts">
import {
  RsButton,
  RsCheckbox,
  RsIcon,
  RsPopover,
  RsToolbar,
  RsTooltip,
} from '@niuma/ui'
import type { SqlQueryHistoryEntry, SqlQueryToolbarLabels } from '../types/sql-query-shell'

withDefaults(
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

function historyPreview(sql: string): string {
  const preview = sql.replace(/\s+/g, ' ').slice(0, 72)
  return sql.length > 72 ? `${preview}…` : preview
}
</script>

<template>
  <RsToolbar
    class="nm-sql-query-toolbar"
    size="md"
    elevated
    :label="labels.toolbarAria"
  >
    <template #left>
      <slot name="identity" />
    </template>
    <template #right>
      <slot name="toolbar-start" />

      <div
        v-if="showTransaction && labels.autoCommit"
        class="nm-sql-query-toolbar__group nm-sql-query-toolbar__tx"
        role="group"
      >
        <RsTooltip
          :content="labels.autoCommitTooltip || labels.autoCommit"
          side="bottom"
          nowrap
        >
          <label class="nm-sql-query-toolbar__autocommit">
            <RsCheckbox
              size="sm"
              :model-value="autoCommit"
              :disabled="running || txBusy || !canRun"
              :aria-label="labels.autoCommit"
              @update:model-value="emit('update:autoCommit', $event)"
            />
            <span>{{ labels.autoCommit }}</span>
          </label>
        </RsTooltip>
        <template v-if="!autoCommit">
          <span
            v-if="inTransaction"
            class="nm-sql-query-toolbar__in-tx"
          >{{ labels.inTransaction }}</span>
          <RsTooltip :content="labels.commitTooltip || labels.commit" side="bottom" nowrap>
            <RsButton
              variant="default"
              size="sm"
              :disabled="running || txBusy || !canRun || !inTransaction"
              @click="emit('commit')"
            >
              {{ labels.commit }}
            </RsButton>
          </RsTooltip>
          <RsTooltip :content="labels.rollbackTooltip || labels.rollback" side="bottom" nowrap>
            <RsButton
              variant="ghost"
              size="sm"
              :disabled="running || txBusy || !canRun || !inTransaction"
              @click="emit('rollback')"
            >
              {{ labels.rollback }}
            </RsButton>
          </RsTooltip>
        </template>
      </div>

      <span
        v-if="showTransaction && labels.autoCommit"
        class="nm-sql-query-toolbar__sep"
        aria-hidden="true"
      />

      <div class="nm-sql-query-toolbar__group" role="group" :aria-label="labels.format">
        <RsButton
          variant="ghost"
          size="sm"
          :disabled="running"
          :tooltip="labels.formatTooltip"
          @click="emit('format')"
        >
          <RsIcon name="braces" :size="13" />
          {{ labels.format }}
        </RsButton>
      </div>

      <span
        v-if="showExplain || showExplainAnalyze"
        class="nm-sql-query-toolbar__sep"
        aria-hidden="true"
      />

      <div
        v-if="showExplain || showExplainAnalyze"
        class="nm-sql-query-toolbar__group"
        role="group"
      >
        <RsTooltip v-if="showExplain" :content="labels.explainTooltip" side="bottom" nowrap>
          <RsButton
            variant="default"
            size="sm"
            :disabled="running || !canRun"
            @click="emit('explain')"
          >
            <RsIcon name="git-compare" :size="13" />
            {{ labels.explain }}
          </RsButton>
        </RsTooltip>
        <RsTooltip
          v-if="showExplainAnalyze"
          :content="labels.explainAnalyzeTooltip"
          side="bottom"
          nowrap
        >
          <RsButton
            variant="default"
            size="sm"
            class="nm-sql-query-toolbar__btn-analyze"
            :disabled="running || !canRun"
            @click="emit('explainAnalyze')"
          >
            <RsIcon name="activity" :size="13" />
            {{ labels.explainAnalyze }}
          </RsButton>
        </RsTooltip>
      </div>

      <span class="nm-sql-query-toolbar__sep" aria-hidden="true" />

      <div class="nm-sql-query-toolbar__group" role="group">
        <RsTooltip
          v-if="!running"
          :content="labels.runTooltip"
          side="bottom"
          nowrap
        >
          <RsButton
            variant="primary"
            size="sm"
            :disabled="!canRun"
            @click="emit('run')"
          >
            <RsIcon name="play" :size="13" />
            {{ hasSelection ? labels.runSelection : labels.run }}
          </RsButton>
        </RsTooltip>
        <RsTooltip
          v-else
          :content="labels.cancelTooltip"
          side="bottom"
          nowrap
        >
          <RsButton
            variant="danger"
            size="sm"
            :loading="cancelling"
            @click="emit('cancel')"
          >
            <RsIcon name="square" :size="13" />
            {{ labels.cancel }}
          </RsButton>
        </RsTooltip>

        <RsPopover
          v-if="historyEnabled"
          v-model:open="historyOpenModel"
          side="bottom"
          align="end"
          width="lg"
        >
          <RsButton
            variant="ghost"
            size="sm"
            :disabled="!historyEnabled"
            :tooltip="labels.history"
          >
            <RsIcon name="history" :size="13" />
            {{ labels.history }}
          </RsButton>
          <template #content>
            <div class="nm-sql-query-toolbar__history">
              <p class="nm-sql-query-toolbar__history-title">{{ labels.history }}</p>
              <p
                v-if="historyEntries.length === 0"
                class="nm-sql-query-toolbar__history-empty"
              >
                {{ labels.historyEmpty }}
              </p>
              <ul v-else class="nm-sql-query-toolbar__history-list">
                <li v-for="entry in historyEntries" :key="entry.id">
                  <button
                    type="button"
                    class="nm-sql-query-toolbar__history-item"
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
                class="nm-sql-query-toolbar__history-clear"
                @click="emit('historyPick', '__clear')"
              >
                {{ labels.historyClear }}
              </button>
            </div>
          </template>
        </RsPopover>
      </div>

      <slot name="toolbar-end" />
    </template>
  </RsToolbar>
</template>

<style scoped>
.nm-sql-query-toolbar__group {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs, 0.25rem);
}

.nm-sql-query-toolbar__autocommit {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-foreground);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.nm-sql-query-toolbar__in-tx {
  padding: 0.05rem 0.4rem;
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, var(--rs-warning) 18%, var(--rs-surface));
  color: var(--rs-warning);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  white-space: nowrap;
}

.nm-sql-query-toolbar__sep {
  display: inline-block;
  width: 1px;
  height: 1rem;
  margin-inline: 0.15rem;
  background: var(--rs-border-subtle);
  flex-shrink: 0;
}

:deep(.nm-sql-query-toolbar__btn-analyze) {
  border-color: color-mix(in srgb, var(--rs-warning) 45%, var(--rs-border));
  color: var(--rs-warning);
  background: color-mix(in srgb, var(--rs-warning) 10%, var(--rs-surface));
}

:deep(.nm-sql-query-toolbar__btn-analyze:hover:not(:disabled)) {
  border-color: var(--rs-warning);
  color: var(--rs-warning);
  background: color-mix(in srgb, var(--rs-warning) 16%, var(--rs-surface));
}

.nm-sql-query-toolbar__history {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 18rem;
  min-width: 0;
}

.nm-sql-query-toolbar__history-title {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
}

.nm-sql-query-toolbar__history-empty {
  margin: 0;
  padding: 0.5rem 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-sql-query-toolbar__history-list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nm-sql-query-toolbar__history-item,
.nm-sql-query-toolbar__history-clear {
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

.nm-sql-query-toolbar__history-item:hover,
.nm-sql-query-toolbar__history-clear:hover {
  background: var(--rs-item-hover, rgba(127, 127, 127, 0.12));
}

.nm-sql-query-toolbar__history-item {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-sql-query-toolbar__history-clear {
  margin-top: 0.15rem;
  border-top: 1px solid var(--rs-border-subtle);
  border-radius: 0 0 var(--rs-radius-sm) var(--rs-radius-sm);
  color: var(--rs-muted);
  font-family: inherit;
}
</style>
