<script setup lang="ts">
import {
  RsButton,
  RsEmpty,
  RsIcon,
  RsInput,
  RsLoading,
  RsTable,
  type RsTableColumn,
  type RsTableRowDropPosition,
  type RsTableSortState,
} from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildFtpContextMenuItems } from '@/modules/ftp/composables/useFtpContextMenu'
import type { FtpPaneEntry, FtpPaneSide } from '@/modules/ftp/composables/useFtpPaneList'
import { readFtpDragSideFromTypes } from '@/modules/ftp/utils/ftpDrag'
import { formatFileSize, formatModifiedAt } from '@/modules/ftp/utils/ftpFormat'
import { resolveEntryIcon } from '@/utils/fileIcon'

const PARENT_ROW_ID = '__parent__'

export type FtpPaneMoveTarget =
  | { kind: 'parent' }
  | { kind: 'dir'; entry: FtpPaneEntry }

interface FtpTableRow extends Record<string, unknown> {
  id: string
  name: string
  kind: 'file' | 'dir' | 'link' | 'parent'
  size: number
  modifiedAt: string
  sizeLabel: string
  modifiedLabel: string
}

const props = withDefaults(
  defineProps<{
    side: FtpPaneSide
    label: string
    path: string
    entries: FtpPaneEntry[]
    loading?: boolean
    dragOver?: boolean
    canGoUp?: boolean
    showModified?: boolean
    browseFolder?: boolean
    draggableFiles?: boolean
    /** 远程面板无本地栏时显示上传（如 SSH SFTP） */
    remoteUpload?: boolean
  }>(),
  {
    loading: false,
    dragOver: false,
    canGoUp: true,
    showModified: false,
    browseFolder: false,
    draggableFiles: true,
    remoteUpload: false,
  },
)

const emit = defineEmits<{
  'update:path': [path: string]
  refresh: []
  'go-up': []
  'browse-folder': []
  mkdir: []
  'upload-pane': []
  'upload-folder-pane': []
  open: [entry: FtpPaneEntry]
  upload: [entry: FtpPaneEntry]
  download: [entry: FtpPaneEntry]
  delete: [entries: FtpPaneEntry[]]
  rename: [entry: FtpPaneEntry]
  'show-in-folder': [entry: FtpPaneEntry]
  'copy-path': [path: string]
  'open-in-editor': [entry: FtpPaneEntry]
  'upload-selected': [entries: FtpPaneEntry[]]
  'download-selected': [entries: FtpPaneEntry[]]
  'delete-selected': [entries: FtpPaneEntry[]]
  move: [sources: FtpPaneEntry[], target: FtpPaneMoveTarget]
  dragstart: [event: DragEvent, entries: FtpPaneEntry[]]
  dragover: [event: DragEvent]
  dragleave: []
  drop: [event: DragEvent]
}>()

const { t } = useI18n()

const filterQuery = ref('')
const tableSort = ref<RsTableSortState | null>({ key: 'name', order: 'asc' })
const selectedRowKeys = ref<string[]>([])

watch(
  toRef(props, 'entries'),
  () => {
    selectedRowKeys.value = selectedRowKeys.value.filter((id) =>
      props.entries.some((e) => e.name === id),
    )
  },
)

const columns = computed((): RsTableColumn<FtpTableRow>[] => {
  const cols: RsTableColumn<FtpTableRow>[] = [
    {
      key: 'name',
      title: t('modules.ftp.session.colName'),
      sortable: true,
      ellipsis: true,
      minWidth: 180,
    },
    {
      key: 'sizeLabel',
      title: t('modules.ftp.session.colSize'),
      sortable: true,
      align: 'right',
      width: 96,
      ellipsis: true,
    },
  ]
  if (props.showModified) {
    cols.push({
      key: 'modifiedLabel',
      title: t('modules.ftp.session.colModified'),
      sortable: true,
      align: 'right',
      width: 152,
      ellipsis: true,
    })
  }
  return cols
})

function toTableRow(entry: FtpPaneEntry): FtpTableRow {
  return {
    id: entry.name,
    name: entry.name,
    kind: entry.kind,
    size: entry.size,
    modifiedAt: entry.modifiedAt ?? '',
    sizeLabel: entry.kind === 'dir' ? '—' : formatFileSize(entry.size),
    modifiedLabel: formatModifiedAt(entry.modifiedAt),
  }
}

function toPaneEntry(row: FtpTableRow): FtpPaneEntry {
  return {
    name: row.name,
    kind: row.kind === 'parent' ? 'dir' : row.kind,
    size: row.size,
    modifiedAt: row.modifiedAt || undefined,
  }
}

const tableRows = computed((): FtpTableRow[] => {
  let list = [...props.entries]
  const q = filterQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter((e) => e.name.toLowerCase().includes(q))
  }

  const sort = tableSort.value
  list.sort((a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') {
      return -1
    }
    if (a.kind !== 'dir' && b.kind === 'dir') {
      return 1
    }
    if (!sort) {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    }
    const dir = sort.order === 'asc' ? 1 : -1
    switch (sort.key) {
      case 'sizeLabel':
      case 'size':
        return (a.size - b.size) * dir
      case 'modifiedLabel':
      case 'modifiedAt': {
        const ta = a.modifiedAt ? Date.parse(a.modifiedAt) : 0
        const tb = b.modifiedAt ? Date.parse(b.modifiedAt) : 0
        return (ta - tb) * dir
      }
      default:
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    }
  })

  const rows = list.map(toTableRow)
  if (props.canGoUp) {
    rows.unshift({
      id: PARENT_ROW_ID,
      name: '..',
      kind: 'parent',
      size: 0,
      modifiedAt: '',
      sizeLabel: '—',
      modifiedLabel: '—',
    })
  }
  return rows
})

const rowById = computed(() => new Map(tableRows.value.map((row) => [row.id, row])))

const selectedEntries = computed((): FtpPaneEntry[] =>
  tableRows.value
    .filter((row) => selectedRowKeys.value.includes(row.id) && row.kind !== 'parent')
    .map(toPaneEntry),
)

const selectionCount = computed(() => selectedEntries.value.length)

const ctxMenuOptions = computed(() =>
  props.side === 'remote' && props.remoteUpload ? { remoteUpload: true } : undefined,
)

function buildCtxItems(row: FtpTableRow | null, selectedRows: FtpTableRow[]) {
  const selCount = selectedRows.filter((r) => r.kind !== 'parent').length
  if (row && row.kind !== 'parent') {
    return buildFtpContextMenuItems(
      { kind: 'entry', side: props.side, entry: toPaneEntry(row), selectionCount: selCount },
      t,
      ctxMenuOptions.value,
    )
  }
  return buildFtpContextMenuItems(
    { kind: 'pane', side: props.side, selectionCount: selCount },
    t,
    ctxMenuOptions.value,
  )
}

function resolveCtxAction(key: string, entry?: FtpPaneEntry): void {
  const selected = selectedEntries.value
  const transferSelected = selected.filter((e) => e.kind === 'file' || e.kind === 'dir')

  const actions: Record<string, () => void> = {
    open: () => entry && emit('open', entry),
    upload: () => entry && emit('upload', entry),
    download: () => entry && emit('download', entry),
    'upload-selected': () => emit('upload-selected', transferSelected),
    'download-selected': () => emit('download-selected', transferSelected),
    delete: () => entry && emit('delete', [entry]),
    'delete-selected': () => emit('delete-selected', selected),
    rename: () => entry && emit('rename', entry),
    'show-in-folder': () => entry && emit('show-in-folder', entry),
    'copy-path': () => entry && emit('copy-path', entry.name),
    'open-in-editor': () => entry && emit('open-in-editor', entry),
    refresh: () => emit('refresh'),
    mkdir: () => emit('mkdir'),
    'upload-pane': () => emit('upload-pane'),
    'upload-folder-pane': () => emit('upload-folder-pane'),
  }
  actions[key]?.()
}

function onContextMenuSelect(key: string, row: FtpTableRow | null): void {
  const entry = row && row.kind !== 'parent' ? toPaneEntry(row) : undefined
  resolveCtxAction(key, entry)
}

function onRowDblclick(row: FtpTableRow): void {
  if (row.kind === 'parent') {
    emit('go-up')
    return
  }
  emit('open', toPaneEntry(row))
}

function onRowClick(row: FtpTableRow): void {
  if (row.kind === 'parent') {
    return
  }
}

function onPathSubmit(): void {
  emit('refresh')
}

function onPaneKeydown(event: KeyboardEvent): void {
  if (event.key === 'F5') {
    event.preventDefault()
    emit('refresh')
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const row = tableRows.value.find((item) => item.id === selectedRowKeys.value[0])
    if (row?.kind === 'parent') {
      emit('go-up')
    } else if (row) {
      emit('open', toPaneEntry(row))
    }
    return
  }
  if (event.key === 'Delete' && selectedEntries.value.length) {
    event.preventDefault()
    emit('delete-selected', selectedEntries.value)
  }
}

function entryIconForRow(row: FtpTableRow) {
  return resolveEntryIcon(row.kind, row.name)
}

/** RsTable 动态列 slot 的 row 推断为 object，这里收窄回本表面类型。 */
function asFtpRow(row: object): FtpTableRow {
  return row as FtpTableRow
}

const statusText = computed(() => {
  const total = props.entries.length
  const dirs = props.entries.filter((e) => e.kind === 'dir').length
  const files = total - dirs
  const base = t('modules.ftp.session.statusSummary', { files, dirs })
  if (selectionCount.value > 0) {
    return `${base} · ${t('modules.ftp.session.statusSelected', { count: selectionCount.value })}`
  }
  return base
})

function canRowDrag(row: FtpTableRow): boolean {
  return props.draggableFiles && row.kind !== 'parent'
}

function canRowDropTarget(row: FtpTableRow): boolean {
  return row.kind === 'parent' || row.kind === 'dir'
}

function canRowDrop(dragKeys: string[], dropKey: string): boolean {
  const dropRow = rowById.value.get(dropKey)
  if (!dropRow || !canRowDropTarget(dropRow)) {
    return false
  }
  return !dragKeys.includes(dropKey)
}

function entriesFromKeys(keys: string[]): FtpPaneEntry[] {
  return keys
    .map((key) => rowById.value.get(key))
    .filter((row): row is FtpTableRow => Boolean(row && row.kind !== 'parent'))
    .map(toPaneEntry)
}

function onRowDragStart(dragKeys: string[], event: DragEvent): void {
  const entries = entriesFromKeys(dragKeys)
  if (!entries.length) {
    return
  }
  emit('dragstart', event, entries)
}

function onRowDrop(
  dragKeys: string[],
  dropKey: string,
  position: RsTableRowDropPosition,
): void {
  if (position !== 'into') {
    return
  }
  const sources = entriesFromKeys(dragKeys)
  const dropRow = rowById.value.get(dropKey)
  if (!sources.length || !dropRow || !canRowDropTarget(dropRow)) {
    return
  }
  const target: FtpPaneMoveTarget =
    dropRow.kind === 'parent'
      ? { kind: 'parent' }
      : { kind: 'dir', entry: toPaneEntry(dropRow) }
  emit('move', sources, target)
}

function onPaneDragOver(event: DragEvent): void {
  if (readFtpDragSideFromTypes(event) === props.side) {
    return
  }
  emit('dragover', event)
}

function onPaneDrop(event: DragEvent): void {
  if (readFtpDragSideFromTypes(event) === props.side) {
    return
  }
  emit('drop', event)
}

function resetOnNavigate(): void {
  filterQuery.value = ''
  selectedRowKeys.value = []
}

function clearSelection(): void {
  selectedRowKeys.value = []
}

defineExpose({ resetOnNavigate, clearSelection })
</script>

<template>
  <section
    role="grid"
    class="nm-ftp-pane"
    :class="{ 'nm-ftp-pane--drag-over': dragOver }"
    tabindex="0"
    @keydown="onPaneKeydown"
    @dragover="onPaneDragOver"
    @dragleave="emit('dragleave')"
    @drop="onPaneDrop"
  >
    <header class="nm-ftp-pane__toolbar">
      <span class="nm-ftp-pane__label">{{ label }}</span>
      <RsInput
        :model-value="path"
        size="sm"
        class="nm-ftp-pane__path"
        @update:model-value="emit('update:path', $event)"
        @press-enter="onPathSubmit"
      />
      <RsInput
        v-model="filterQuery"
        size="sm"
        class="nm-ftp-pane__filter"
        :placeholder="t('modules.ftp.session.filter')"
        clearable
      >
        <template #prefix>
          <RsIcon name="search" :size="13" />
        </template>
      </RsInput>
      <div class="nm-ftp-pane__actions">
        <RsButton
          v-if="browseFolder"
          size="sm"
          variant="ghost"
          icon="hard-drive"
          icon-only
          :disabled="loading"
          :tooltip="t('modules.ftp.session.browseLocalFolder')"
          @click="emit('browse-folder')"
        />
        <RsButton
          v-if="remoteUpload"
          size="sm"
          variant="ghost"
          icon="upload"
          icon-only
          :disabled="loading"
          :tooltip="t('modules.ftp.session.upload')"
          @click="emit('upload-pane')"
        />
        <RsButton
          v-if="remoteUpload"
          size="sm"
          variant="ghost"
          icon="folder-up"
          icon-only
          :disabled="loading"
          :tooltip="t('modules.ftp.session.uploadFolder')"
          @click="emit('upload-folder-pane')"
        />
        <RsButton
          size="sm"
          variant="ghost"
          icon="chevron-left"
          icon-only
          :disabled="!canGoUp"
          :tooltip="t('modules.ftp.session.up')"
          @click="emit('go-up')"
        />
        <RsButton
          size="sm"
          variant="ghost"
          icon="folder-plus"
          icon-only
          :disabled="loading"
          :tooltip="t('modules.ftp.session.mkdir')"
          @click="emit('mkdir')"
        />
        <RsButton
          size="sm"
          variant="ghost"
          icon="rotate-cw"
          icon-only
          :disabled="loading"
          :tooltip="t('modules.ftp.session.refresh')"
          @click="emit('refresh')"
        />
      </div>
    </header>

    <div class="nm-ftp-pane__body">
      <RsLoading v-if="loading" class="nm-ftp-pane__loading" />

      <div v-else class="nm-ftp-pane__table-wrap">
        <RsTable
          :columns="columns"
          :data="tableRows"
          row-key="id"
          size="sm"
          striped
          fill
          :bordered="false"
          selectable
          :selected-row-keys="selectedRowKeys"
          :row-selectable="(row) => row.kind !== 'parent'"
          :sort="tableSort"
          remote-sort
          row-draggable
          row-drag-trigger="row"
          row-drop-mode="into"
          :row-draggable-when="canRowDrag"
          :row-drop-target-when="canRowDropTarget"
          :can-row-drop="canRowDrop"
          :context-menu-items="buildCtxItems"
          :virtual="true"
          @update:sort="tableSort = $event"
          @update:selected-row-keys="selectedRowKeys = $event"
          @row-click="onRowClick"
          @row-dblclick="onRowDblclick"
          @context-menu-select="onContextMenuSelect"
          @row-drag-start="onRowDragStart"
          @row-drop="onRowDrop"
        >
          <template #empty>
            <RsEmpty :description="t('modules.ftp.session.emptyDir')" />
          </template>
          <template #name="{ row }">
            <span
              class="nm-ftp-pane__file-name"
              :class="{ 'nm-ftp-pane__file-name--parent': asFtpRow(row).kind === 'parent' }"
            >
              <RsIcon
                :name="entryIconForRow(asFtpRow(row)).icon"
                :size="16"
                class="nm-ftp-pane__file-icon"
                :class="`nm-ftp-pane__file-icon--${entryIconForRow(asFtpRow(row)).tone}`"
              />
              {{ asFtpRow(row).name }}
            </span>
          </template>
          <template #sizeLabel="{ row }">
            <span class="nm-ftp-pane__meta">{{ asFtpRow(row).sizeLabel }}</span>
          </template>
          <template #modifiedLabel="{ row }">
            <span class="nm-ftp-pane__meta">{{ asFtpRow(row).modifiedLabel }}</span>
          </template>
        </RsTable>
      </div>
    </div>

    <footer class="nm-ftp-pane__status">{{ statusText }}</footer>
  </section>
</template>

<style scoped>
.nm-ftp-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--nm-editor-bg, var(--rs-surface));
  outline: none;
}

.nm-ftp-pane--drag-over {
  background: color-mix(in srgb, var(--rs-primary) 8%, var(--nm-editor-bg, var(--rs-surface)));
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--rs-primary) 45%, transparent);
}

.nm-ftp-pane__toolbar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  min-height: 2.125rem;
  padding: 0 var(--rs-space-xs) 0 var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-ftp-pane__label {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rs-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.nm-ftp-pane__actions {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}

.nm-ftp-pane__path {
  flex: 1;
  min-width: 0;
}

.nm-ftp-pane__filter {
  width: 8rem;
  flex-shrink: 0;
}

.nm-ftp-pane__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-ftp-pane__table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-ftp-pane__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-ftp-pane__file-name {
  display: contents;
}

.nm-ftp-pane__file-name--parent {
  color: var(--rs-primary);
  font-weight: 500;
}

.nm-ftp-pane__file-icon {
  display: inline-block;
  vertical-align: -3px;
  margin-right: var(--rs-space-sm);
}

.nm-ftp-pane__file-icon--dir {
  color: var(--rs-primary);
}

.nm-ftp-pane__file-icon--parent {
  color: var(--rs-muted);
}

.nm-ftp-pane__file-icon--link {
  color: var(--rs-warning, #f5a623);
}

.nm-ftp-pane__file-icon--file,
.nm-ftp-pane__file-icon--document {
  color: var(--rs-muted);
}

.nm-ftp-pane__file-icon--image {
  color: #a855f7;
}

.nm-ftp-pane__file-icon--video {
  color: #6366f1;
}

.nm-ftp-pane__file-icon--audio {
  color: #ec4899;
}

.nm-ftp-pane__file-icon--archive {
  color: #d97706;
}

.nm-ftp-pane__file-icon--code {
  color: #0ea5e9;
}

.nm-ftp-pane__file-icon--config {
  color: #ca8a04;
}

.nm-ftp-pane__file-icon--spreadsheet {
  color: var(--rs-success, #22c55e);
}

.nm-ftp-pane__file-icon--presentation {
  color: #f97316;
}

.nm-ftp-pane__file-icon--pdf {
  color: var(--rs-danger, #ef4444);
}

.nm-ftp-pane__file-icon--database {
  color: #3b82f6;
}

.nm-ftp-pane__file-icon--executable {
  color: #b45309;
}

.nm-ftp-pane__file-icon--font {
  color: #8b5cf6;
}

.nm-ftp-pane__meta {
  display: inline-block;
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  width: max-content;
  min-width: max-content;
  max-width: none;
}

.nm-ftp-pane__status {
  flex-shrink: 0;
  padding: 0.3rem var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  border-top: 1px solid var(--rs-border-subtle);
  font-variant-numeric: tabular-nums;
}
</style>
