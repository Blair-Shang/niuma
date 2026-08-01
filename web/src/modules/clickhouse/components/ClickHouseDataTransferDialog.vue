<script setup lang="ts">
import { RsButton, RsInput, RsInputNumber, RsLabel, RsSelect, useRsToast, type RsSelectOptions } from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { clickhouseApi, dialogApi, fsApi } from '@/api'
import type { ClickHouseIoImportFormat } from '@/api/types/clickhouse'
import {
  DataTransferCheck,
  DataTransferFileField,
  DataTransferPanel,
  DataTransferSection,
  DataTransferShell,
  useDataTransferPresentation,
  type DataTransferFileFieldLabels,
  type DataTransferPanelLabels,
  type DataTransferShellLabels,
} from '@/modules/database'
import {
  autoMatchColumns,
  parseCsvPreview,
  parseTsvPreview,
} from '@/modules/database/utils/csv-header'
import { useClickHouseIoTasks } from '@/modules/clickhouse/composables/useClickHouseIoTasks'
import { withClickHouseSession } from '@/modules/clickhouse/composables/useClickHouseSessionSql'
import { openCreateTableDesign } from '@/modules/clickhouse/conn-tree-actions'
import { readClickHouseIoContext } from '@/modules/clickhouse/data-tasks'
import {
  setClickHouseDesignSeed,
  suggestTableNameFromPath,
} from '@/modules/clickhouse/utils/design-seed'

const props = withDefaults(defineProps<{
  taskId: string
  presentation?: 'float' | 'inline'
  activeInDock?: boolean
}>(), { presentation: 'float', activeInDock: false })

const { t } = useI18n()
const toast = useRsToast()
const { track, waitForTask, lines, clearLines, activeTaskId } = useClickHouseIoTasks()
const {
  hub, task, floatOpen, busy, dockReady, activeInDock, onFloatOpenUpdate, onClose, onDock, onPopOut,
} = useDataTransferPresentation({
  taskId: toRef(props, 'taskId'),
  presentation: toRef(props, 'presentation'),
  activeInDock: toRef(props, 'activeInDock'),
})

const ctx = computed(() => task.value ? readClickHouseIoContext(task.value.context) : null)
const isExport = computed(() => task.value?.kind === 'export_csv')
const filePath = ref('')
/** 导入/导出共用格式；导出不含 parquet */
const ioFormat = ref<string>('csv')
const header = ref(true)
const delimiter = ref(',')
const nullString = ref('')
const truncate = ref(false)
const encoding = ref('utf-8')
const skipRows = ref<number | null>(0)
const maxErrors = ref<number | null>(0)

const tableColumns = ref<string[]>([])
const sourceColumns = ref<string[]>([])
const columnTargets = ref<Record<string, string>>({})
const previewRows = ref<string[][]>([])
const mapLoading = ref(false)

const supportsColumnMap = computed(() =>
  !isExport.value && (ioFormat.value === 'csv' || ioFormat.value === 'tsv'),
)
const supportsPreview = computed(() => supportsColumnMap.value)
const mappedCount = computed(() =>
  sourceColumns.value.filter((s) => !!columnTargets.value[s]?.trim()).length,
)
const usesFormatFastPath = computed(() => {
  if (isExport.value || !supportsColumnMap.value) return !isExport.value
  if (sourceColumns.value.length === 0 || mappedCount.value === 0) return false
  return sourceColumns.value.every((src) => {
    const target = columnTargets.value[src]?.trim()
    return !!target && target.toLowerCase() === src.toLowerCase()
  })
})

const canConfirm = computed(() => {
  if (!task.value || !ctx.value?.database || !ctx.value?.table || !filePath.value.trim() || busy.value) {
    return false
  }
  if (isExport.value) return true
  if (!supportsColumnMap.value) return true
  return sourceColumns.value.length > 0 && mappedCount.value > 0
})

const scopeLabel = computed(() =>
  ctx.value?.database && ctx.value.table ? `${ctx.value.database}.${ctx.value.table}` : '—',
)
const windowTitle = computed(() => task.value?.title ?? t('modules.clickhouse.io.exportTitle'))
const formatOptions = computed<RsSelectOptions>(() => {
  const base: RsSelectOptions = [
    { value: 'csv', label: t('modules.clickhouse.io.formatCsv') },
    { value: 'tsv', label: t('modules.clickhouse.io.formatTsv') },
    { value: 'json_each_row', label: t('modules.clickhouse.io.formatJson') },
  ]
  if (!isExport.value) {
    return [
      ...base,
      { value: 'parquet', label: t('modules.clickhouse.io.formatParquet') },
    ]
  }
  return base
})
const exportExt = computed(() => {
  if (ioFormat.value === 'tsv') return 'tsv'
  if (ioFormat.value === 'json_each_row') return 'jsonl'
  return 'csv'
})
const encodingOptions = computed<RsSelectOptions>(() => [
  { value: 'utf-8', label: t('modules.clickhouse.io.encodingUtf8') },
  { value: 'gbk', label: t('modules.clickhouse.io.encodingGbk') },
])
const delimiterOptions = computed<RsSelectOptions>(() => [
  { value: ',', label: t('modules.clickhouse.io.delimiterComma') },
  { value: '\t', label: t('modules.clickhouse.io.delimiterTab') },
  { value: ';', label: t('modules.clickhouse.io.delimiterSemicolon') },
  { value: '|', label: t('modules.clickhouse.io.delimiterPipe') },
])
const targetOptions = computed<RsSelectOptions>(() => [
  { value: '', label: t('modules.clickhouse.io.columnMapSkip') },
  ...tableColumns.value.map((name) => ({ value: name, label: name })),
])
const shellLabels = computed((): DataTransferShellLabels => ({
  dockToBottom: t('modules.clickhouse.io.dockToBottom'),
  popOut: t('modules.clickhouse.io.popOut'),
  cancelTask: t('modules.clickhouse.io.cancelTask'),
  close: t('common.close'),
  confirm: isExport.value ? t('modules.clickhouse.io.export') : t('modules.clickhouse.io.import'),
}))
const panelLabels = computed((): DataTransferPanelLabels => ({
  progressLog: t('modules.clickhouse.io.progressLog'),
  progressEmpty: t('modules.clickhouse.io.progressEmpty'),
  running: t('modules.clickhouse.io.running'),
}))
const fileLabels = computed((): DataTransferFileFieldLabels => ({
  filePath: t('modules.clickhouse.io.filePath'),
  browse: t('modules.clickhouse.io.browse'),
}))
const fileAccept = computed(() => {
  if (isExport.value) {
    if (ioFormat.value === 'tsv') return ['.tsv', '.txt']
    if (ioFormat.value === 'json_each_row') return ['.json', '.jsonl', '.ndjson', '.txt']
    return ['.csv']
  }
  if (ioFormat.value === 'parquet') return ['.parquet']
  if (ioFormat.value === 'json_each_row') return ['.json', '.ndjson', '.jsonl', '.txt']
  if (ioFormat.value === 'tsv') return ['.tsv', '.txt', '.csv']
  return ['.csv', '.tsv', '.txt']
})

function resetMap(): void {
  sourceColumns.value = []
  columnTargets.value = {}
  previewRows.value = []
}

function applyAutoMap(sources: string[]): void {
  sourceColumns.value = sources
  const matched = autoMatchColumns(sources, tableColumns.value)
  const next: Record<string, string> = {}
  for (const src of sources) {
    next[src] = matched[src] ?? ''
  }
  columnTargets.value = next
}

/** 恒等全映射时不传 columnMap，以便走 FORMAT 快路径 */
function buildColumnMap(): Record<string, string> | undefined {
  if (isExport.value || !supportsColumnMap.value || sourceColumns.value.length === 0) return undefined
  const map: Record<string, string> = {}
  let allMapped = true
  let identity = true
  for (const src of sourceColumns.value) {
    const target = columnTargets.value[src]?.trim()
    if (!target) {
      allMapped = false
      continue
    }
    map[src] = target
    if (target.toLowerCase() !== src.toLowerCase()) identity = false
  }
  if (Object.keys(map).length === 0) return undefined
  if (allMapped && identity) return undefined
  return map
}

async function loadTableColumns(): Promise<void> {
  const scope = ctx.value
  if (!scope?.database || !scope.table || isExport.value || !supportsColumnMap.value) {
    tableColumns.value = []
    return
  }
  try {
    const fetchCols = async (sessionId: string) => {
      const result = await clickhouseApi.metaColumns({
        sessionId,
        database: scope.database!,
        table: scope.table!,
      })
      tableColumns.value = result.columns.map((c) => c.name)
    }
    if (scope.sessionId) await fetchCols(scope.sessionId)
    else await withClickHouseSession(scope.profileId, fetchCols)
  } catch (error) {
    tableColumns.value = []
    toast.error(error instanceof Error ? error.message : t('modules.clickhouse.io.failed'))
  }
}

async function loadColumnMapFromFile(): Promise<void> {
  const path = filePath.value.trim()
  if (!path || isExport.value || !supportsPreview.value) {
    resetMap()
    return
  }
  mapLoading.value = true
  try {
    if (tableColumns.value.length === 0) await loadTableColumns()
    const result = await fsApi.readText({ path })
    const prefix = result.content.slice(0, 64 * 1024)
    const preview = ioFormat.value === 'tsv'
      ? parseTsvPreview(prefix, { header: header.value, maxRows: 5 })
      : parseCsvPreview(prefix, {
          header: header.value,
          delimiter: delimiter.value || ',',
          maxRows: 5,
        })
    if (preview.columns.length === 0) {
      resetMap()
      toast.error(t('modules.clickhouse.io.columnMapEmpty'))
      return
    }
    applyAutoMap(preview.columns)
    previewRows.value = preview.rows
  } catch (error) {
    resetMap()
    toast.error(error instanceof Error ? error.message : t('modules.clickhouse.io.browseError'))
  } finally {
    mapLoading.value = false
  }
}

watch(() => props.taskId, () => {
  filePath.value = ''
  ioFormat.value = 'csv'
  header.value = true
  delimiter.value = ','
  nullString.value = ''
  truncate.value = false
  encoding.value = 'utf-8'
  skipRows.value = 0
  maxErrors.value = 0
  resetMap()
  clearLines()
  void loadTableColumns()
}, { immediate: true })

watch(ioFormat, (format) => {
  if (format === 'tsv' && delimiter.value === ',') delimiter.value = '\t'
  if (format === 'csv' && delimiter.value === '\t') delimiter.value = ','
  if (format === 'parquet' && isExport.value) ioFormat.value = 'csv'
  if (!supportsColumnMap.value) resetMap()
  else if (filePath.value.trim()) void loadColumnMapFromFile()
})

watch([header, delimiter], () => {
  if (supportsPreview.value && filePath.value.trim() && sourceColumns.value.length > 0) {
    void loadColumnMapFromFile()
  }
})

async function pickPath(): Promise<void> {
  const scope = ctx.value
  if (!scope) return
  try {
    if (isExport.value) {
      const result = await dialogApi.saveFile({
        title: t('modules.clickhouse.io.browseExportTitle'),
        defaultPath: `${scope.table ?? 'export'}.${exportExt.value}`,
        accept: fileAccept.value,
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.clickhouse.io.browseImportTitle'),
        accept: fileAccept.value,
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
        const lower = result.filePaths[0].toLowerCase()
        if (lower.endsWith('.parquet')) ioFormat.value = 'parquet'
        else if (lower.endsWith('.tsv')) ioFormat.value = 'tsv'
        else if (/\.(json|ndjson|jsonl)$/.test(lower)) ioFormat.value = 'json_each_row'
        await loadColumnMapFromFile()
      }
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('modules.clickhouse.io.browseError'))
  }
}

async function onConfirm(): Promise<void> {
  const scope = ctx.value
  if (!scope?.database || !scope.table || !canConfirm.value) return
  hub.setBusy(props.taskId, true)
  clearLines()
  track()
  try {
    const columnMap = buildColumnMap()
    const format = (ioFormat.value || 'csv') as ClickHouseIoImportFormat
    const csvOptions = {
      header: header.value,
      delimiter: delimiter.value || (format === 'tsv' ? '\t' : ','),
      nullString: nullString.value || undefined,
      truncate: !isExport.value && truncate.value,
      encoding: encoding.value || 'utf-8',
      format,
      skipRows: !isExport.value && (skipRows.value ?? 0) > 0 ? Math.floor(skipRows.value ?? 0) : undefined,
      maxErrors: !isExport.value && (maxErrors.value ?? 0) > 0 ? Math.floor(maxErrors.value ?? 0) : undefined,
      ...(columnMap ? { columnMap } : {}),
    }
    const sessionId = scope.sessionId || undefined
    const result = isExport.value
      ? await clickhouseApi.ioExportCsv({
          profileId: scope.profileId,
          sessionId,
          database: scope.database,
          table: scope.table,
          outputPath: filePath.value,
          csvOptions,
        })
      : await clickhouseApi.ioImportCsv({
          profileId: scope.profileId,
          sessionId,
          database: scope.database,
          table: scope.table,
          inputPath: filePath.value,
          csvOptions,
        })
    const done = await waitForTask(result.taskId)
    if (!done.ok) {
      toast.error(done.message || t('modules.clickhouse.io.failed'))
      return
    }
    toast.success(isExport.value ? t('modules.clickhouse.io.exportDone') : t('modules.clickhouse.io.importDone'))
    if (isExport.value && done.outputPath) await fsApi.showInFolder({ path: done.outputPath }).catch(() => undefined)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('modules.clickhouse.io.failed'))
  } finally {
    hub.setBusy(props.taskId, false)
  }
}

async function onCancelTask(): Promise<void> {
  if (!activeTaskId.value) return
  try {
    await clickhouseApi.ioCancel({
      taskId: activeTaskId.value,
      profileId: ctx.value?.profileId,
      sessionId: ctx.value?.sessionId || undefined,
    })
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('modules.clickhouse.io.failed'))
  }
}

function openCreateFromFile(): void {
  const scope = ctx.value
  if (!scope?.database || !scope.conn || !filePath.value.trim()) return
  const names = sourceColumns.value.length > 0
    ? sourceColumns.value
    : []
  if (names.length === 0) {
    toast.error(t('modules.clickhouse.io.createFromFileNeedPreview'))
    return
  }
  setClickHouseDesignSeed({
    database: scope.database,
    tableName: suggestTableNameFromPath(filePath.value),
    columns: names,
  })
  openCreateTableDesign(scope.conn, scope.database)
  toast.success(t('modules.clickhouse.io.createFromFileOpened'))
}

function previewCell(row: string[], index: number): string {
  const value = row[index] ?? ''
  return value.length > 40 ? `${value.slice(0, 37)}…` : value
}
</script>

<template>
  <DataTransferShell
    :labels="shellLabels" :title="windowTitle" :description="task?.description ?? ''"
    :busy="busy" :can-confirm="canConfirm" :presentation="presentation" :float-open="floatOpen"
    :active-in-dock="activeInDock" :dock-ready="dockReady"
    @update:float-open="onFloatOpenUpdate" @dock="onDock" @pop-out="onPopOut"
    @close="onClose" @cancel="onCancelTask" @confirm="onConfirm"
  >
    <DataTransferPanel :labels="panelLabels" :lines="lines" :busy="busy">
      <DataTransferSection :title="t('modules.clickhouse.io.sectionTarget')">
        <div class="nm-clickhouse-dt__scope" :title="scopeLabel">{{ scopeLabel }}</div>
      </DataTransferSection>
      <DataTransferSection :title="t('modules.clickhouse.io.sectionFormat')">
        <div class="nm-clickhouse-dt__field nm-clickhouse-dt__format">
          <RsLabel>{{ t('modules.clickhouse.io.format') }}</RsLabel>
          <RsSelect v-model="ioFormat" :options="formatOptions" :disabled="busy" />
          <p class="nm-clickhouse-dt__map-hint">
            {{
              isExport
                ? t('modules.clickhouse.io.formatExportHint')
                : t('modules.clickhouse.io.formatImportHint')
            }}
          </p>
        </div>
      </DataTransferSection>
      <DataTransferSection :title="t('modules.clickhouse.io.sectionFile')">
        <DataTransferFileField v-model="filePath" :labels="fileLabels" :disabled="busy" required @browse="pickPath" />
      </DataTransferSection>
      <DataTransferSection :title="t('modules.clickhouse.io.sectionOptions')">
        <div class="nm-clickhouse-dt__grid">
          <div class="nm-clickhouse-dt__field">
            <RsLabel>{{ t('modules.clickhouse.io.encoding') }}</RsLabel>
            <RsSelect v-model="encoding" :options="encodingOptions" :disabled="busy || ioFormat === 'parquet'" />
          </div>
          <div v-if="ioFormat === 'csv'" class="nm-clickhouse-dt__field">
            <RsLabel>{{ t('modules.clickhouse.io.delimiter') }}</RsLabel>
            <RsSelect v-model="delimiter" :options="delimiterOptions" :disabled="busy" />
          </div>
          <div class="nm-clickhouse-dt__field">
            <RsLabel>{{ t('modules.clickhouse.io.nullString') }}</RsLabel>
            <RsInput v-model="nullString" :disabled="busy || ioFormat === 'parquet'" :placeholder="t('modules.clickhouse.io.nullStringPh')" />
          </div>
          <div v-if="!isExport" class="nm-clickhouse-dt__field">
            <RsLabel>{{ t('modules.clickhouse.io.skipRows') }}</RsLabel>
            <RsInputNumber v-model="skipRows" :min="0" :step="1" :disabled="busy || ioFormat === 'parquet'" />
          </div>
          <div v-if="!isExport" class="nm-clickhouse-dt__field">
            <RsLabel>{{ t('modules.clickhouse.io.maxErrors') }}</RsLabel>
            <RsInputNumber v-model="maxErrors" :min="0" :step="1" :disabled="busy" />
          </div>
        </div>
        <div class="nm-clickhouse-dt__checks">
          <DataTransferCheck
            v-if="ioFormat === 'csv' || ioFormat === 'tsv'"
            v-model="header"
            variant="chip"
            :label="t('modules.clickhouse.io.header')"
            :disabled="busy"
          />
          <DataTransferCheck v-if="!isExport" v-model="truncate" variant="chip" :label="t('modules.clickhouse.io.truncateFirst')" :disabled="busy" />
        </div>
      </DataTransferSection>

      <DataTransferSection v-if="supportsColumnMap" :title="t('modules.clickhouse.io.columnMapTitle')">
        <template #head>
          <div class="nm-clickhouse-dt__map-actions">
            <RsButton
              size="sm"
              variant="ghost"
              :disabled="busy || mapLoading || !filePath.trim() || sourceColumns.length === 0"
              @click="openCreateFromFile"
            >
              {{ t('modules.clickhouse.io.createFromFile') }}
            </RsButton>
            <RsButton
              size="sm"
              variant="ghost"
              :disabled="busy || mapLoading || !filePath.trim()"
              @click="loadColumnMapFromFile"
            >
              {{ t('modules.clickhouse.io.columnMapLoad') }}
            </RsButton>
          </div>
        </template>
        <p class="nm-clickhouse-dt__map-hint">{{ t('modules.clickhouse.io.columnMapHint') }}</p>
        <p v-if="sourceColumns.length" class="nm-clickhouse-dt__map-meta">
          {{ t('modules.clickhouse.io.columnMapMapped', { n: mappedCount, total: sourceColumns.length }) }}
          <span v-if="usesFormatFastPath"> · {{ t('modules.clickhouse.io.formatFastPath') }}</span>
        </p>
        <div v-if="sourceColumns.length" class="nm-clickhouse-dt__map">
          <div class="nm-clickhouse-dt__map-head">
            <span>{{ t('modules.clickhouse.io.columnMapSource') }}</span>
            <span>{{ t('modules.clickhouse.io.columnMapTarget') }}</span>
          </div>
          <div v-for="src in sourceColumns" :key="src" class="nm-clickhouse-dt__map-row">
            <span class="nm-clickhouse-dt__map-src" :title="src">{{ src }}</span>
            <RsSelect
              :model-value="columnTargets[src] ?? ''"
              :options="targetOptions"
              :disabled="busy"
              @update:model-value="(v) => (columnTargets[src] = String(v ?? ''))"
            />
          </div>
        </div>
        <p v-else class="nm-clickhouse-dt__map-empty">{{ t('modules.clickhouse.io.columnMapNeedFile') }}</p>
      </DataTransferSection>

      <DataTransferSection
        v-if="supportsPreview && previewRows.length > 0"
        :title="t('modules.clickhouse.io.previewTitle')"
      >
        <p class="nm-clickhouse-dt__map-hint">{{ t('modules.clickhouse.io.previewHint') }}</p>
        <div class="nm-clickhouse-dt__preview">
          <table>
            <thead>
              <tr>
                <th v-for="src in sourceColumns" :key="src" :title="columnTargets[src] || src">
                  {{ columnTargets[src] || src }}
                  <span v-if="!columnTargets[src]" class="nm-clickhouse-dt__preview-skip">
                    {{ t('modules.clickhouse.io.columnMapSkip') }}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in previewRows" :key="ri">
                <td v-for="(src, ci) in sourceColumns" :key="`${ri}-${src}`" :title="row[ci] ?? ''">
                  {{ previewCell(row, ci) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </DataTransferSection>

      <template #note>
        {{
          isExport
            ? t('modules.clickhouse.io.csvExportHint')
            : ioFormat === 'parquet'
              ? t('modules.clickhouse.io.parquetImportHint')
              : ioFormat === 'json_each_row'
                ? t('modules.clickhouse.io.jsonImportHint')
                : t('modules.clickhouse.io.csvImportHint')
        }}
      </template>
    </DataTransferPanel>
  </DataTransferShell>
</template>

<style scoped>
.nm-clickhouse-dt__scope { font-size: var(--rs-font-size-sm, 13px); line-height: 1.35; word-break: break-all; }
.nm-clickhouse-dt__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.nm-clickhouse-dt__field { display: flex; flex-direction: column; gap: 4px; }
.nm-clickhouse-dt__format { gap: 6px; }
.nm-clickhouse-dt__checks { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.nm-clickhouse-dt__map-actions { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
.nm-clickhouse-dt__map-hint,
.nm-clickhouse-dt__map-meta,
.nm-clickhouse-dt__map-empty {
  margin: 0;
  font-size: var(--rs-font-size-xs, 12px);
  color: var(--rs-text-secondary, #64748b);
  line-height: 1.4;
}
.nm-clickhouse-dt__map-meta { margin-top: 4px; }
.nm-clickhouse-dt__map {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  height: 140px;
  max-height: 140px;
  overflow: auto;
  flex: 0 0 auto;
}
.nm-clickhouse-dt__map-head,
.nm-clickhouse-dt__map-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 8px;
  align-items: center;
}
.nm-clickhouse-dt__map-head {
  font-size: var(--rs-font-size-xs, 12px);
  font-weight: 600;
  color: var(--rs-text-secondary, #64748b);
  position: sticky;
  top: 0;
  background: var(--rs-bg-elevated, #fff);
  z-index: 1;
  padding-bottom: 2px;
}
.nm-clickhouse-dt__map-src {
  font-size: var(--rs-font-size-sm, 13px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nm-clickhouse-dt__preview {
  margin-top: 8px;
  max-height: 120px;
  overflow: auto;
  border: 1px solid var(--rs-border-subtle, #e2e8f0);
  border-radius: 6px;
}
.nm-clickhouse-dt__preview table {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  font-size: var(--rs-font-size-xs, 12px);
}
.nm-clickhouse-dt__preview th,
.nm-clickhouse-dt__preview td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--rs-border-subtle, #e2e8f0);
  border-right: 1px solid var(--rs-border-subtle, #e2e8f0);
  text-align: left;
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nm-clickhouse-dt__preview th {
  position: sticky;
  top: 0;
  background: var(--rs-bg-muted, #f8fafc);
  font-weight: 600;
  color: var(--rs-text-secondary, #64748b);
}
.nm-clickhouse-dt__preview-skip {
  display: block;
  font-weight: 400;
  opacity: 0.7;
}
@media (max-width: 520px) { .nm-clickhouse-dt__grid { grid-template-columns: 1fr; } }
</style>
