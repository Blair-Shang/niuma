<script setup lang="ts">
import {
  RsButton,
  RsIcon,
  RsTable,
  copyTextToClipboard,
  type RsContextMenuItem,
  type RsTableColumn,
} from '@niuma/ui'
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

interface TransferQueueRow extends Record<string, unknown> {
  taskId: string
  direction: 'upload' | 'download'
  source: string
  name: string
  remotePath: string
  localPath: string
  progress: number
  progressLabel: string
  sizeLabel: string
  speedLabel: string
  state: string
  stateLabel: string
  error?: string
  canPause: boolean
  canResume: boolean
  canCancel: boolean
  /** 操作列占位，复制行时为空 */
  actions: string
}

function taskSortOrder(state: string): number {
  if (state === 'running') return 0
  if (state === 'queued') return 1
  if (state === 'paused') return 2
  if (state === 'failed') return 3
  return 4
}

const activeCount = computed(() =>
  props.tasks.filter((task) => task.state === 'queued' || task.state === 'running' || task.state === 'paused')
    .length,
)

const hasActiveTransfers = computed(() => activeCount.value > 0)

/** 是否显示来源列（有 sessions 且多于 0 个） */
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

function formatSize(task: FtpTransferTask): string {
  return `${formatFileSize(task.transferred)} / ${formatFileSize(task.total)}`
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

function displayName(task: FtpTransferTask): string {
  return fileName(task.direction === 'upload' ? task.localPath : task.remotePath)
}

const tableRows = computed((): TransferQueueRow[] =>
  [...props.tasks]
    .sort((a, b) => taskSortOrder(a.state) - taskSortOrder(b.state))
    .map((task) => {
      const progress = progressPercent(task)
      return {
        taskId: task.taskId,
        direction: task.direction,
        source: sessionLabel(task.sessionId),
        name: displayName(task),
        remotePath: task.remotePath || '',
        localPath: task.localPath || '',
        progress,
        progressLabel: `${progress}%`,
        sizeLabel: formatSize(task),
        speedLabel: formatSpeed(task.speedBps),
        state: task.state,
        stateLabel: stateLabel(task.state),
        error: task.error,
        canPause: task.state === 'running',
        canResume: task.state === 'paused',
        canCancel: task.state === 'queued' || task.state === 'running' || task.state === 'paused',
        actions: '',
      }
    }),
)

const columns = computed((): RsTableColumn<TransferQueueRow>[] => {
  const cols: RsTableColumn<TransferQueueRow>[] = [
    {
      key: 'direction',
      title: '',
      width: 40,
      align: 'center',
    },
  ]
  if (showSource.value) {
    cols.push({
      key: 'source',
      title: t('modules.ftp.transfer.colSource'),
      width: 110,
      ellipsis: true,
    })
  }
  cols.push(
    {
      key: 'name',
      title: t('modules.ftp.transfer.colName'),
      minWidth: 120,
      ellipsis: true,
      tooltip: (row) => (row.error ? `${row.name}\n${row.error}` : undefined),
    },
    {
      key: 'remotePath',
      title: t('modules.ftp.transfer.colRemotePath'),
      minWidth: 160,
      ellipsis: true,
    },
    {
      key: 'progressLabel',
      title: t('modules.ftp.transfer.colProgress'),
      width: 120,
      dataIndex: 'progressLabel',
    },
    {
      key: 'sizeLabel',
      title: t('modules.ftp.transfer.colSize'),
      width: 168,
      align: 'right',
      ellipsis: true,
    },
    {
      key: 'speedLabel',
      title: t('modules.ftp.transfer.colSpeed'),
      width: 88,
      align: 'right',
    },
    {
      key: 'stateLabel',
      title: t('modules.ftp.transfer.colState'),
      width: 80,
    },
    {
      key: 'actions',
      title: '',
      width: 88,
      align: 'right',
    },
  )
  return cols
})

function buildCtxItems(row: TransferQueueRow | null): RsContextMenuItem[] {
  if (!row) return []
  const items: RsContextMenuItem[] = []
  if (row.remotePath) {
    items.push({
      key: 'copyRemotePath',
      label: t('modules.ftp.transfer.copyRemotePath'),
      icon: 'copy',
    })
  }
  if (row.localPath) {
    items.push({
      key: 'copyLocalPath',
      label: t('modules.ftp.transfer.copyLocalPath'),
      icon: 'copy',
    })
  }
  return items
}

async function onContextMenuSelect(key: string, row: TransferQueueRow | null): Promise<void> {
  if (!row) return
  if (key === 'copyRemotePath' && row.remotePath) {
    await copyTextToClipboard(row.remotePath)
    return
  }
  if (key === 'copyLocalPath' && row.localPath) {
    await copyTextToClipboard(row.localPath)
  }
}

/** RsTable 动态列 slot 的 row 推断为 object，这里收窄回本表面类型。 */
function asQueueRow(row: object): TransferQueueRow {
  return row as TransferQueueRow
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
        {{ hasActiveTransfers ? activeCount : tableRows.length }}
      </span>
    </header>

    <div v-show="hideHeader || !collapsed" class="nm-transfer-queue__body">
      <RsTable
        class="nm-transfer-queue__table"
        :columns="columns"
        :data="tableRows"
        row-key="taskId"
        size="sm"
        fill
        :bordered="false"
        :context-menu-items="buildCtxItems"
        cell-tooltip
        @context-menu-select="(key, row) => void onContextMenuSelect(key, row)"
      >
        <template #direction="{ row }">
          <span
            class="tq-dir"
            :class="asQueueRow(row).direction === 'upload' ? 'tq-dir--up' : 'tq-dir--down'"
          >
            <RsIcon
              :name="asQueueRow(row).direction === 'upload' ? 'upload' : 'download'"
              :size="12"
            />
          </span>
        </template>

        <template #name="{ row }">
          <template v-if="asQueueRow(row).error">
            <span class="tq-name">{{ asQueueRow(row).name }}</span>
            <span class="tq-error">{{ asQueueRow(row).error }}</span>
          </template>
          <template v-else>{{ asQueueRow(row).name }}</template>
        </template>

        <template #remotePath="{ row }">
          <span class="tq-remote">{{ asQueueRow(row).remotePath || '—' }}</span>
        </template>

        <template #progressLabel="{ row }">
          <div class="tq-progress">
            <div class="tq-bar">
              <div
                class="tq-bar-fill"
                :class="{
                  'tq-bar-fill--done': asQueueRow(row).state === 'done',
                  'tq-bar-fill--failed': asQueueRow(row).state === 'failed',
                }"
                :style="{ width: `${asQueueRow(row).progress}%` }"
              />
            </div>
            <span class="tq-pct">{{ asQueueRow(row).progressLabel }}</span>
          </div>
        </template>

        <template #sizeLabel="{ row }">
          <span class="tq-meta">{{ asQueueRow(row).sizeLabel }}</span>
        </template>

        <template #speedLabel="{ row }">
          <span class="tq-meta">{{ asQueueRow(row).speedLabel }}</span>
        </template>

        <template #stateLabel="{ row }">
          <span class="tq-state" :class="stateClass(asQueueRow(row).state)">{{
            asQueueRow(row).stateLabel
          }}</span>
        </template>

        <template #actions="{ row }">
          <div class="tq-actions">
            <RsButton
              v-if="asQueueRow(row).canPause"
              size="sm"
              variant="ghost"
              icon="pause"
              icon-only
              :tooltip="t('modules.ftp.transfer.pause')"
              @click="emit('pause', asQueueRow(row).taskId)"
            />
            <RsButton
              v-if="asQueueRow(row).canResume"
              size="sm"
              variant="ghost"
              icon="play"
              icon-only
              :tooltip="t('modules.ftp.transfer.resume')"
              @click="emit('resume', asQueueRow(row).taskId)"
            />
            <RsButton
              v-if="asQueueRow(row).canCancel"
              size="sm"
              variant="ghost"
              icon="x"
              icon-only
              :tooltip="t('modules.ftp.transfer.cancel')"
              @click="emit('cancel', asQueueRow(row).taskId)"
            />
          </div>
        </template>
      </RsTable>
    </div>
  </section>
</template>

<style scoped>
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

.nm-transfer-queue__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.nm-transfer-queue__table {
  height: 100%;
}

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

.tq-name {
  display: block;
  color: var(--rs-text);
}

.tq-error {
  display: block;
  font-size: 0.65rem;
  color: var(--rs-danger);
}

.tq-remote {
  color: var(--rs-muted);
}

.tq-meta {
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tq-progress {
  min-width: 0;
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

.tq-bar-fill--done {
  background: var(--rs-success);
}

.tq-bar-fill--failed {
  background: var(--rs-danger);
}

.tq-pct {
  font-size: 0.65rem;
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
}

.tq-state {
  color: var(--rs-muted);
  white-space: nowrap;
}

.tq-state--running {
  color: var(--rs-primary);
}

.tq-state--failed {
  color: var(--rs-danger);
}

.tq-state--done {
  color: var(--rs-success);
}

.tq-actions {
  display: inline-flex;
  justify-content: flex-end;
  gap: 1px;
}
</style>
