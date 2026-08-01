<script setup lang="ts">
/**
 * 例程调试外壳：探测空态 / 工具栏控制 / 参数网格 / 源码+巡视分栏 / 状态条。
 * 方言侧负责 RPC 与 #source / #inspect 内容；布局与控件态由本组件统一。
 */
import { RsButton, RsEmpty, RsIcon, RsLoading, RsSplitPane, RsToolbar, RsTooltip } from '@niuma/ui'
import type { RsSplitPaneItem } from '@niuma/ui'
import { computed } from 'vue'
import DebugParamsGrid from './DebugParamsGrid.vue'
import type {
  DebugShellLabels,
  DebugShellParamRow,
  DebugShellStateTone,
} from '../types/debug-shell'

const props = withDefaults(
  defineProps<{
    labels: DebugShellLabels
    /** 目标例程展示名 */
    targetLabel?: string
    stateLabel?: string
    stateTone?: DebugShellStateTone
    probing?: boolean
    available?: boolean
    unavailableReason?: string
    busy?: boolean
    sessionActive?: boolean
    /** 步进类控件可用（通常 paused && !busy） */
    controlsEnabled?: boolean
    /** 是否可点开始（有目标且未在会话中） */
    canStart?: boolean
    /**
     * 是否展示步进/中止控件。
     * MySQL 等「调用+观测」辅助模式可关，仅保留开始（生成调用）与自定义工具栏。
     */
    showStepControls?: boolean
    params?: DebugShellParamRow[]
    paramsPreview?: string
    paramsDisabled?: boolean
    statusText?: string
    statusMeta?: string
    sourceRatio?: number
    inspectRatio?: number
  }>(),
  {
    targetLabel: '',
    stateLabel: '',
    stateTone: 'idle',
    probing: false,
    available: true,
    unavailableReason: '',
    busy: false,
    sessionActive: false,
    controlsEnabled: false,
    canStart: false,
    showStepControls: true,
    params: () => [],
    paramsPreview: '',
    paramsDisabled: false,
    statusText: '',
    statusMeta: '',
    sourceRatio: 0.68,
    inspectRatio: 0.32,
  },
)

const emit = defineEmits<{
  start: []
  continue: []
  next: []
  step: []
  finish: []
  abort: []
  'update:param-null': [index: number, isNull: boolean]
  'update:param-value': [index: number, value: string]
}>()

const mainSplitPanes = computed<RsSplitPaneItem[]>(() => {
  const sourcePct = Math.round(props.sourceRatio * 100)
  const inspectPct = Math.max(1, 100 - sourcePct)
  return [
    { key: 'source', size: sourcePct, min: 36, resizerHandle: true },
    { key: 'inspect', size: inspectPct, min: 20 },
  ]
})
</script>

<template>
  <div class="nm-debug-shell">
    <RsLoading v-if="probing" class="nm-debug-shell__loading" />
    <div v-else-if="!available" class="nm-debug-shell__unavailable">
      <RsEmpty fill icon="bug" :description="unavailableReason || labels.unavailable" />
      <div v-if="$slots['unavailable-extra']" class="nm-debug-shell__unavailable-extra">
        <slot name="unavailable-extra" />
      </div>
    </div>
    <template v-else>
      <RsToolbar
        size="md"
        elevated
        compact
        class="nm-debug-shell__toolbar"
        :label="labels.toolbarLabel"
      >
        <template #left>
          <div class="nm-debug-shell__identity" :title="targetLabel">
            <RsIcon name="bug" :size="14" class="nm-debug-shell__brand" />
            <span class="nm-debug-shell__target">{{ targetLabel || labels.noTarget }}</span>
            <span
              v-if="stateLabel"
              class="nm-debug-shell__badge"
              :class="`nm-debug-shell__badge--${stateTone}`"
            >
              {{ stateLabel }}
            </span>
          </div>
          <slot name="toolbar-left-extra" />
        </template>
        <template #right>
          <slot name="toolbar-start" />
          <RsTooltip :content="labels.start" side="bottom" nowrap>
            <RsButton
              variant="primary"
              size="sm"
              :loading="busy && !sessionActive"
              :disabled="!canStart"
              @click="emit('start')"
            >
              <RsIcon name="play" :size="13" />
              {{ labels.start }}
            </RsButton>
          </RsTooltip>
          <template v-if="showStepControls">
            <RsTooltip :content="labels.continue" side="bottom" nowrap>
              <RsButton
                variant="ghost"
                size="sm"
                :disabled="!controlsEnabled"
                @click="emit('continue')"
              >
                <RsIcon name="chevrons-right" :size="13" />
              </RsButton>
            </RsTooltip>
            <RsTooltip :content="labels.next" side="bottom" nowrap>
              <RsButton
                variant="ghost"
                size="sm"
                :disabled="!controlsEnabled"
                @click="emit('next')"
              >
                <RsIcon name="arrow-right-to-line" :size="13" />
              </RsButton>
            </RsTooltip>
            <RsTooltip :content="labels.step" side="bottom" nowrap>
              <RsButton
                variant="ghost"
                size="sm"
                :disabled="!controlsEnabled"
                @click="emit('step')"
              >
                <RsIcon name="arrow-down-to-line" :size="13" />
              </RsButton>
            </RsTooltip>
            <RsTooltip :content="labels.finish" side="bottom" nowrap>
              <RsButton
                variant="ghost"
                size="sm"
                :disabled="!controlsEnabled"
                @click="emit('finish')"
              >
                <RsIcon name="corner-down-right" :size="13" />
              </RsButton>
            </RsTooltip>
            <RsTooltip :content="labels.abort" side="bottom" nowrap>
              <RsButton
                variant="danger"
                size="sm"
                :disabled="!sessionActive || busy"
                @click="emit('abort')"
              >
                <RsIcon name="square" :size="12" />
              </RsButton>
            </RsTooltip>
          </template>
          <slot name="toolbar-end" />
        </template>
      </RsToolbar>

      <DebugParamsGrid
        :labels="labels"
        :params="params"
        :preview="paramsPreview"
        :disabled="paramsDisabled"
        @update:param-null="(i, v) => emit('update:param-null', i, v)"
        @update:param-value="(i, v) => emit('update:param-value', i, v)"
      />

      <RsSplitPane
        :panes="mainSplitPanes"
        orientation="horizontal"
        with-handle
        class="nm-debug-shell__split"
      >
        <template #source>
          <div class="nm-debug-shell__source-pane">
            <div class="nm-debug-shell__pane-header">
              <RsIcon name="file-code" :size="12" />
              <span>{{ labels.sourceTitle }}</span>
              <span class="nm-debug-shell__pane-hint">{{ labels.bpHint }}</span>
              <slot name="source-header-extra" />
            </div>
            <div class="nm-debug-shell__source-body">
              <slot name="source" />
            </div>
          </div>
        </template>
        <template #inspect>
          <div class="nm-debug-shell__inspect">
            <slot name="inspect" />
          </div>
        </template>
      </RsSplitPane>

      <footer v-if="statusText || statusMeta || $slots.status" class="nm-debug-shell__status">
        <slot name="status">
          <span class="nm-debug-shell__status-text" :title="statusText">{{ statusText }}</span>
          <span v-if="statusMeta" class="nm-debug-shell__status-meta">{{ statusMeta }}</span>
        </slot>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.nm-debug-shell {
  --nm-debug-pane-header-h: 2rem;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  align-self: stretch;
  background: var(--rs-bg);
  overflow: hidden;
}

.nm-debug-shell__loading,
.nm-debug-shell__unavailable {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.nm-debug-shell__unavailable-extra {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  gap: var(--rs-space-sm);
  padding: 0 0 var(--rs-space-lg);
}

.nm-debug-shell__toolbar {
  flex-shrink: 0;
}

.nm-debug-shell__identity {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  min-width: 0;
}

.nm-debug-shell__brand {
  flex-shrink: 0;
  color: var(--rs-muted);
}

.nm-debug-shell__target {
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 28rem;
}

.nm-debug-shell__badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  padding: 0.1rem 0.4rem;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border-subtle);
  color: var(--rs-muted);
  background: var(--rs-surface);
}

.nm-debug-shell__badge--paused {
  color: var(--rs-warning, #b45309);
  border-color: color-mix(in srgb, var(--rs-warning, #b45309) 35%, transparent);
  background: color-mix(in srgb, var(--rs-warning, #b45309) 12%, transparent);
}

.nm-debug-shell__badge--running {
  color: var(--rs-success, #15803d);
  border-color: color-mix(in srgb, var(--rs-success, #15803d) 35%, transparent);
  background: color-mix(in srgb, var(--rs-success, #15803d) 12%, transparent);
}

.nm-debug-shell__badge--ended {
  color: var(--rs-danger, #b91c1c);
  border-color: color-mix(in srgb, var(--rs-danger, #b91c1c) 30%, transparent);
  background: color-mix(in srgb, var(--rs-danger, #b91c1c) 10%, transparent);
}

.nm-debug-shell__split {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  width: 100%;
  height: 100%;
}

.nm-debug-shell__source-pane,
.nm-debug-shell__inspect {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.nm-debug-shell__pane-header {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
  box-sizing: border-box;
  height: var(--nm-debug-pane-header-h, 2rem);
  padding: 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
}

.nm-debug-shell__pane-hint {
  margin-left: auto;
  font-weight: 400;
  opacity: 0.85;
}

.nm-debug-shell__source-body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--rs-bg-elevated, var(--rs-bg));
}

.nm-debug-shell__status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
  padding: 0.2rem var(--rs-space-sm);
  border-top: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  min-height: 1.5rem;
}

.nm-debug-shell__status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
}

.nm-debug-shell__status-meta {
  flex-shrink: 0;
  font-weight: 600;
}
</style>
