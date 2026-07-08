<script setup lang="ts">
import { RsButton, RsIcon } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FtpTransferTask } from '@/api/types/ftp'
import type { TransferSessionMeta } from '@/stores/transfer-hub'
import { formatFileSize } from '@/modules/ftp/utils/ftpFormat'

const props = withDefaults(
  defineProps<{
    tasks: FtpTransferTask[]
    collapsed?: boolean
    /** 嵌入全局底栏时隐藏组件自带标题栏 */
    hideHeader?: boolean
    /** 会话映射（sessionId → meta），有值时显示「来源」列 */
    sessions?: Map<string, TransferSessionMeta>
  }>(),
  {
    collapsed: false,
    hideHeader: false,
    sessions: undefined,
  },
)

const emit = defineEmits<{
  cancel: [taskId: string]
  pause: [taskId: string]
  resume: [taskId: string]
  toggleCollapse: []
}>()

const { t } = useI18n()

function taskSortOrder(state: string): number {
  if (state === 'running') return 0
  if (state === 'queued') return 1
  if (state === 'paused') return 2
  if (state === 'failed') return 3
  return 4
}

const activeCount = computed(() =>
  props.tasks.filter((t) => t.state === 'queued' || t.state === 'running' || t.state === 'paused').length,
)

const hasActiveTransfers = computed(() => activeCount.value > 0)

const activeTasks = computed(() =>
  [...props.tasks].sort((a, b) => taskSortOrder(a.state) - taskSortOrder(b.state)),
)

/** 是否显示来源列（有 sessions 且多于 1 个，或调用方明确传入） */
const showSource = computed(() => !!props.sessions && props.sessions.size > 0)

function sessionLabel(sessionId: string): string {
  return props.sessions?.get(sessionId)?.label ?? sessionId.slice(0, 8)
}

function progressPercent(task: FtpTransferTask): number {
  if (task.total <= 0) return task.state === 'done' ? 100 : 0
  return Math.min(100, Math.round((task.transferred / task.total) * 100))
}

function formatSpeed(bps: number): string {
  return bps > 0 ? `${formatFileSize(bps)}/s` : '—'
}

function stateLabel(state: string): string {
  return t(`modules.ftp.transfer.state.${state}` as Parameters<typeof t>[0])
}

function stateClass(state: string): string {
  if (state === 'running') return 'tq-state--running'
  if (state === 'failed') return 'tq-state--failed'
  if (state === 'done') return 'tq-state--done'
  return ''
}

function fileName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

function canPause(task: FtpTransferTask): boolean { return task.state === 'running' }
function canResume(task: FtpTransferTask): boolean { return task.state === 'paused' }
function canCancel(task: FtpTransferTask): boolean {
  return task.state === 'queued' || task.state === 'running' || task.state === 'paused'
}
</script>

<template>
  <section
    class="nm-transfer-queue"
    :class="{
      'nm-transfer-queue--collapsed': collapsed,
      'nm-transfer-queue--active': hasActiveTransfers,
    }"
  >
    <header
      v-if="!hideHeader"
      class="nm-transfer-queue__header"
      :class="{ 'nm-transfer-queue__header--active': hasActiveTransfers }"
    >
      <button
        type="button"
        class="nm-transfer-queue__toggle"
        :aria-label="collapsed ? t('modules.ftp.transfer.expand') : t('modules.ftp.transfer.collapse')"
        @click="emit('toggleCollapse')"
      >
        <RsIcon :name="collapsed ? 'chevron-up' : 'chevron-down'" :size="14" />
      </button>
      <span class="nm-transfer-queue__icon" aria-hidden="true">
        <RsIcon name="arrow-down-up" :size="14" />
      </span>
      <span class="nm-transfer-queue__title">{{ t('modules.ftp.transfer.title') }}</span>
      <span
        class="nm-transfer-queue__count"
        :class="{ 'nm-transfer-queue__count--active': hasActiveTransfers }"
      >
        {{ hasActiveTransfers ? activeCount : activeTasks.length }}
      </span>
    </header>

    <div v-show="hideHeader || !collapsed" class="nm-transfer-queue__body">
      <div class="nm-transfer-queue__scroll">
        <table class="tq-table">
          <colgroup>
            <col class="tq-col-dir">
            <col v-if="showSource" class="tq-col-src">
            <col class="tq-col-name">
            <col class="tq-col-progress">
            <col class="tq-col-size">
            <col class="tq-col-speed">
            <col class="tq-col-state">
            <col class="tq-col-actions">
          </colgroup>
          <thead>
            <tr>
              <th />
              <th v-if="showSource">{{ t('modules.ftp.transfer.colSource') }}</th>
              <th>{{ t('modules.ftp.transfer.colName') }}</th>
              <th>{{ t('modules.ftp.transfer.colProgress') }}</th>
              <th class="tq-right">{{ t('modules.ftp.transfer.colSize') }}</th>
              <th class="tq-right">{{ t('modules.ftp.transfer.colSpeed') }}</th>
              <th>{{ t('modules.ftp.transfer.colState') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <template v-if="activeTasks.length">
              <tr v-for="task in activeTasks" :key="task.taskId">
                <!-- 方向图标 -->
                <td class="tq-center">
                  <span
                    class="tq-dir"
                    :class="task.direction === 'upload' ? 'tq-dir--up' : 'tq-dir--down'"
                  >
                    <RsIcon
                      :name="task.direction === 'upload' ? 'upload' : 'download'"
                      :size="12"
                    />
                  </span>
                </td>
                <!-- 来源（会话名） -->
                <td v-if="showSource" class="tq-src" :title="sessionLabel(task.sessionId)">
                  {{ sessionLabel(task.sessionId) }}
                </td>
                <!-- 文件名 -->
                <td class="tq-name-cell">
                  <span
                    class="tq-name"
                    :title="fileName(task.direction === 'upload' ? task.localPath : task.remotePath)"
                  >
                    {{ fileName(task.direction === 'upload' ? task.localPath : task.remotePath) }}
                  </span>
                  <span v-if="task.error" class="tq-error" :title="task.error">{{ task.error }}</span>
                </td>
                <!-- 进度 -->
                <td class="tq-progress-cell">
                  <div class="tq-bar">
                    <div
                      class="tq-bar-fill"
                      :class="{
                        'tq-bar-fill--done': task.state === 'done',
                        'tq-bar-fill--failed': task.state === 'failed',
                      }"
                      :style="{ width: `${progressPercent(task)}%` }"
                    />
                  </div>
                  <span class="tq-pct">{{ progressPercent(task) }}%</span>
                </td>
                <!-- 大小 -->
                <td class="tq-right tq-meta">
                  {{ formatFileSize(task.transferred) }} / {{ formatFileSize(task.total) }}
                </td>
                <!-- 速度 -->
                <td class="tq-right tq-meta">{{ formatSpeed(task.speedBps) }}</td>
                <!-- 状态 -->
                <td>
                  <span class="tq-state" :class="stateClass(task.state)">
                    {{ stateLabel(task.state) }}
                  </span>
                </td>
                <!-- 操作 -->
                <td class="tq-actions-cell">
                  <div class="tq-actions">
                    <RsButton
                      v-if="canPause(task)"
                      size="sm"
                      variant="ghost"
                      icon="pause"
                      icon-only
                      :tooltip="t('modules.ftp.transfer.pause')"
                      @click="emit('pause', task.taskId)"
                    />
                    <RsButton
                      v-if="canResume(task)"
                      size="sm"
                      variant="ghost"
                      icon="play"
                      icon-only
                      :tooltip="t('modules.ftp.transfer.resume')"
                      @click="emit('resume', task.taskId)"
                    />
                    <RsButton
                      v-if="canCancel(task)"
                      size="sm"
                      variant="ghost"
                      icon="x"
                      icon-only
                      :tooltip="t('modules.ftp.transfer.cancel')"
                      @click="emit('cancel', task.taskId)"
                    />
                  </div>
                </td>
              </tr>
            </template>
            <tr v-else>
              <td :colspan="showSource ? 8 : 7" class="tq-empty">
                {{ t('modules.ftp.transfer.empty') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ── 容器 ───────────────────────────────────────────────────────── */
.nm-transfer-queue {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--nm-editor-bg, var(--rs-surface));
}

.nm-transfer-queue--collapsed {
  height: auto;
  flex: 0 0 auto;
  align-self: flex-start;
  width: 100%;
}

/* ── 标题栏（会话内使用时） ─────────────────────────────────────── */
.nm-transfer-queue__header {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  min-height: 2.125rem;
  padding: 0 var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--nm-frame-bg, var(--rs-surface-elevated));
  color: var(--rs-text);
  flex-shrink: 0;
  user-select: none;
  transition:
    background var(--rs-transition-fast),
    border-color var(--rs-transition-fast);
}

.nm-transfer-queue__header--active {
  background: color-mix(in srgb, var(--rs-primary) 10%, var(--nm-frame-bg, var(--rs-surface-elevated)));
  border-bottom-color: color-mix(in srgb, var(--rs-primary) 28%, var(--rs-border-subtle));
}

.nm-transfer-queue__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.375rem;
  height: 1.375rem;
  padding: 0;
  border: none;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.nm-transfer-queue__toggle:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-transfer-queue__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.375rem;
  height: 1.375rem;
  border-radius: var(--rs-radius-xs);
  color: var(--rs-primary);
  background: var(--rs-primary-container);
  flex-shrink: 0;
}

.nm-transfer-queue__title {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: inherit;
  white-space: nowrap;
}

.nm-transfer-queue--active .nm-transfer-queue__title {
  color: var(--rs-text);
}

.nm-transfer-queue__count {
  margin-left: auto;
  min-width: 1.375rem;
  height: 1.25rem;
  padding: 0 0.4rem;
  border-radius: var(--rs-radius-full);
  border: 1px solid var(--rs-border-subtle);
  color: var(--rs-muted);
  background: var(--nm-editor-bg, var(--rs-surface));
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.125rem;
  text-align: center;
}

.nm-transfer-queue__count--active {
  color: var(--rs-primary-foreground);
  border-color: transparent;
  background: var(--rs-primary);
}

/* ── 滚动容器 ───────────────────────────────────────────────────── */
.nm-transfer-queue__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.nm-transfer-queue__scroll {
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  overflow-y: auto;
}

/* ── 原生表格 ───────────────────────────────────────────────────── */
.tq-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--rs-font-size-xs);
  table-layout: fixed;
}

/* 列宽 */
.tq-col-dir     { width: 2.25rem; }
.tq-col-src     { width: 110px; }
.tq-col-name    { width: auto; min-width: 120px; }
.tq-col-progress{ width: 148px; }
.tq-col-size    { width: 116px; }
.tq-col-speed   { width: 84px; }
.tq-col-state   { width: 68px; }
.tq-col-actions { width: 72px; }

/* 表头 */
thead tr {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--nm-frame-bg, var(--rs-surface-elevated));
}

thead th {
  padding: 0 0.5rem;
  height: 1.75rem;
  font-weight: 600;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--rs-border-subtle);
  letter-spacing: 0.03em;
}

/* 表体行 */
tbody tr {
  border-bottom: 1px solid var(--rs-border-subtle);
  transition: background var(--rs-transition-fast);
}

tbody tr:last-child {
  border-bottom: none;
}

tbody tr:hover {
  background: var(--rs-item-hover);
}

tbody td {
  padding: 0.25rem 0.5rem;
  height: 2.25rem;
  vertical-align: middle;
  overflow: hidden;
}

/* 对齐辅助 */
.tq-center { text-align: center; }
.tq-right  { text-align: right; }

/* 方向图标 */
.tq-dir {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.375rem;
  height: 1.375rem;
  border-radius: var(--rs-radius-full);
}

.tq-dir--up {
  color: var(--rs-primary);
  background: var(--rs-primary-container);
}

.tq-dir--down {
  color: var(--rs-success);
  background: var(--rs-success-container);
}

/* 来源列 */
.tq-src {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

/* 文件名列 */
.tq-name-cell { max-width: 0; }

.tq-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rs-text);
}

.tq-error {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.65rem;
  color: var(--rs-danger);
}

/* 进度列 */
.tq-progress-cell {
  padding-right: 0.75rem;
}

.tq-bar {
  height: 3px;
  margin-bottom: 2px;
  border-radius: var(--rs-radius-full);
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
  overflow: hidden;
}

.tq-bar-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--rs-primary);
  transition: width 0.3s ease;
}

.tq-bar-fill--done  { background: var(--rs-success); }
.tq-bar-fill--failed{ background: var(--rs-danger); }

.tq-pct {
  font-size: 0.65rem;
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
}

/* 元信息（大小/速度） */
.tq-meta {
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 状态 */
.tq-state {
  color: var(--rs-muted);
  white-space: nowrap;
}

.tq-state--running { color: var(--rs-primary); }
.tq-state--failed  { color: var(--rs-danger); }
.tq-state--done    { color: var(--rs-success); }

/* 操作按钮 */
.tq-actions-cell { padding: 0 0.25rem; }

.tq-actions {
  display: inline-flex;
  justify-content: flex-end;
  gap: 1px;
}

/* 空状态 */
.tq-empty {
  height: 3rem;
  text-align: center;
  color: var(--rs-muted);
  vertical-align: middle;
}
</style>
