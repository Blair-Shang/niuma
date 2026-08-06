<script setup lang="ts">
import { RsButton, RsInput, RsLabel, RsSelect, useRsToast, type RsSelectOptions } from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi, fsApi } from '@/api'
import { oracleApi } from '@/api/oracle'
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
import { useOracleIoTasks } from '@/modules/oracle/composables/useOracleIoTasks'
import { readOracleIoContext } from '@/modules/oracle/data-tasks'
import {
  autoMatchColumns,
  parseCsvSourceColumns,
} from '@/modules/oracle/utils/csv-header'

const props = withDefaults(
  defineProps<{
    taskId: string
    presentation?: 'float' | 'inline'
    activeInDock?: boolean
  }>(),
  { presentation: 'float', activeInDock: false },
)

const { t } = useI18n()
const toast = useRsToast()
const { track, waitForTask, lines, clearLines, activeTaskId } = useOracleIoTasks()

const {
  hub,
  task,
  floatOpen,
  busy,
  dockReady,
  activeInDock,
  onFloatOpenUpdate,
  onClose,
  onDock,
  onPopOut,
} = useDataTransferPresentation({
  taskId: toRef(props, 'taskId'),
  presentation: toRef(props, 'presentation'),
  activeInDock: toRef(props, 'activeInDock'),
})

const ctx = computed(() => (task.value ? readOracleIoContext(task.value.context) : null))
const isExport = computed(() => task.value?.kind === 'export_csv')

const filePath = ref('')
const header = ref(true)
const delimiter = ref(',')
const nullString = ref('')
const truncate = ref(false)

const tableColumns = ref<string[]>([])
const sourceColumns = ref<string[]>([])
/** 源列 → 表列；空字符串表示跳过 */
const columnTargets = ref<Record<string, string>>({})
const mapLoading = ref(false)
const CSV_HEADER_PREFIX_BYTES = 64 * 1024

const mappedCount = computed(() =>
  sourceColumns.value.filter((s) => !!columnTargets.value[s]?.trim()).length,
)

const canConfirm = computed(
  () =>
    !!task.value &&
    !!ctx.value?.schema &&
    !!ctx.value?.table &&
    !!filePath.value.trim() &&
    !busy.value &&
    // 导入必须先解析列映射，避免未映射时用原始表头直插失败
    (isExport.value || (sourceColumns.value.length > 0 && mappedCount.value > 0)),
)

const windowTitle = computed(() => task.value?.title ?? t('modules.oracle.io.exportTitle'))
const scopeLabel = computed(() => {
  const scope = ctx.value
  if (!scope?.schema || !scope.table) return '—'
  return `${scope.schema}.${scope.table}`
})

const shellLabels = computed(
  (): DataTransferShellLabels => ({
    dockToBottom: t('modules.oracle.io.dockToBottom'),
    popOut: t('modules.oracle.io.popOut'),
    cancelTask: t('modules.oracle.io.cancelTask'),
    close: t('common.close'),
    confirm: isExport.value ? t('modules.oracle.io.export') : t('modules.oracle.io.import'),
  }),
)

const panelLabels = computed(
  (): DataTransferPanelLabels => ({
    progressLog: t('modules.oracle.io.progressLog'),
    progressEmpty: t('modules.oracle.io.progressEmpty'),
    running: t('modules.oracle.io.running'),
  }),
)

const fileLabels = computed(
  (): DataTransferFileFieldLabels => ({
    filePath: t('modules.oracle.io.filePath'),
    browse: t('modules.oracle.io.browse'),
  }),
)

const delimiterOptions = computed<RsSelectOptions>(() => [
  { value: ',', label: t('modules.oracle.io.delimiterComma') },
  { value: '\t', label: t('modules.oracle.io.delimiterTab') },
  { value: ';', label: t('modules.oracle.io.delimiterSemicolon') },
  { value: '|', label: t('modules.oracle.io.delimiterPipe') },
])

const targetOptions = computed<RsSelectOptions>(() => [
  { value: '', label: t('modules.oracle.io.columnMapSkip') },
  ...tableColumns.value.map((name) => ({ value: name, label: name })),
])

function resetMap(): void {
  sourceColumns.value = []
  columnTargets.value = {}
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

function buildColumnMap(): Record<string, string> | undefined {
  if (isExport.value || sourceColumns.value.length === 0) return undefined
  const map: Record<string, string> = {}
  for (const src of sourceColumns.value) {
    const target = columnTargets.value[src]?.trim()
    if (target) map[src] = target
  }
  return Object.keys(map).length > 0 ? map : undefined
}

async function loadTableColumns(): Promise<void> {
  const scope = ctx.value
  if (!scope?.schema || !scope.table || isExport.value) {
    tableColumns.value = []
    return
  }
  try {
    const result = await oracleApi.metaColumns({
      profileId: scope.profileId,
      sessionId: scope.sessionId || undefined,
      schema: scope.schema,
      table: scope.table,
    })
    tableColumns.value = result.columns.map((c) => c.name)
  } catch (e) {
    tableColumns.value = []
    toast.error(e instanceof Error ? e.message : t('modules.oracle.io.failed'))
  }
}

async function loadColumnMapFromFile(): Promise<void> {
  const path = filePath.value.trim()
  if (!path || isExport.value) {
    resetMap()
    return
  }
  mapLoading.value = true
  try {
    if (tableColumns.value.length === 0) await loadTableColumns()
    const result = await fsApi.readTextPrefix({ path, maxBytes: CSV_HEADER_PREFIX_BYTES })
    const sources = parseCsvSourceColumns(result.content, {
      header: header.value,
      delimiter: delimiter.value || ',',
    })
    if (sources.length === 0) {
      resetMap()
      toast.error(t('modules.oracle.io.columnMapEmpty'))
      return
    }
    applyAutoMap(sources)
  } catch (e) {
    resetMap()
    toast.error(e instanceof Error ? e.message : t('modules.oracle.io.browseError'))
  } finally {
    mapLoading.value = false
  }
}

watch(
  () => props.taskId,
  () => {
    filePath.value = ''
    header.value = true
    delimiter.value = ','
    nullString.value = ''
    truncate.value = false
    resetMap()
    clearLines()
    void loadTableColumns()
  },
  { immediate: true },
)

watch([header, delimiter], () => {
  if (!isExport.value && filePath.value.trim() && sourceColumns.value.length > 0) {
    void loadColumnMapFromFile()
  }
})

async function pickPath(): Promise<void> {
  const current = task.value
  const scope = ctx.value
  if (!current || !scope) return
  try {
    if (current.kind === 'export_csv') {
      const result = await dialogApi.saveFile({
        title: t('modules.oracle.io.browseExportTitle'),
        defaultPath: `${scope.table ?? 'export'}.csv`,
        accept: ['.csv'],
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.oracle.io.browseImportTitle'),
        accept: ['.csv'],
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
        await loadColumnMapFromFile()
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.oracle.io.browseError'))
  }
}

async function onConfirm(): Promise<void> {
  const scope = ctx.value
  if (!scope?.schema || !scope.table || !canConfirm.value) return
  hub.setBusy(props.taskId, true)
  clearLines()
  track()
  try {
    const columnMap = buildColumnMap()
    const csvOptions = {
      header: header.value,
      delimiter: delimiter.value || ',',
      nullString: nullString.value || undefined,
      truncate: !isExport.value && truncate.value,
      ...(columnMap ? { columnMap } : {}),
    }
    const sessionId = scope.sessionId || undefined
    const result = isExport.value
      ? await oracleApi.ioExportCsv({
          profileId: scope.profileId,
          sessionId,
          schema: scope.schema,
          table: scope.table,
          outputPath: filePath.value,
          csvOptions,
        })
      : await oracleApi.ioImportCsv({
          profileId: scope.profileId,
          sessionId,
          schema: scope.schema,
          table: scope.table,
          inputPath: filePath.value,
          csvOptions,
        })
    const done = await waitForTask(result.taskId)
    if (!done.ok) {
      toast.error(done.message || t('modules.oracle.io.failed'))
      return
    }
    toast.success(isExport.value ? t('modules.oracle.io.exportDone') : t('modules.oracle.io.importDone'))
    if (done.outputPath && isExport.value) {
      try {
        await fsApi.showInFolder({ path: done.outputPath })
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.oracle.io.failed'))
  } finally {
    hub.setBusy(props.taskId, false)
  }
}

async function onCancelTask(): Promise<void> {
  const backendTaskId = activeTaskId.value
  const scope = ctx.value
  if (!backendTaskId) return
  try {
    await oracleApi.ioCancel({
      profileId: scope?.profileId,
      sessionId: scope?.sessionId || undefined,
      taskId: backendTaskId,
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.oracle.io.failed'))
  }
}
</script>

<template>
  <DataTransferShell
    :labels="shellLabels"
    :title="windowTitle"
    :description="task?.description ?? ''"
    :busy="busy"
    :can-confirm="canConfirm"
    :presentation="presentation"
    :float-open="floatOpen"
    :active-in-dock="activeInDock"
    :dock-ready="dockReady"
    @update:float-open="onFloatOpenUpdate"
    @dock="onDock"
    @pop-out="onPopOut"
    @close="onClose"
    @cancel="onCancelTask"
    @confirm="onConfirm"
  >
    <DataTransferPanel :labels="panelLabels" :lines="lines" :busy="busy">
      <DataTransferSection :title="t('modules.oracle.io.sectionTarget')">
        <div class="nm-oracle-dt__scope" :title="scopeLabel">{{ scopeLabel }}</div>
      </DataTransferSection>

      <DataTransferSection :title="t('modules.oracle.io.sectionFile')">
        <DataTransferFileField
          v-model="filePath"
          :labels="fileLabels"
          :disabled="busy"
          required
          @browse="pickPath"
        />
      </DataTransferSection>

      <DataTransferSection :title="t('modules.oracle.io.sectionFormat')">
        <div class="nm-oracle-dt__grid">
          <div class="nm-oracle-dt__field">
            <RsLabel>{{ t('modules.oracle.io.delimiter') }}</RsLabel>
            <RsSelect v-model="delimiter" :options="delimiterOptions" :disabled="busy" />
          </div>
          <div class="nm-oracle-dt__field">
            <RsLabel>{{ t('modules.oracle.io.nullString') }}</RsLabel>
            <RsInput
              v-model="nullString"
              :disabled="busy"
              :placeholder="t('modules.oracle.io.nullStringPh')"
            />
          </div>
        </div>
        <div class="nm-oracle-dt__checks">
          <DataTransferCheck
            v-model="header"
            variant="chip"
            :label="t('modules.oracle.io.header')"
            :disabled="busy"
          />
          <DataTransferCheck
            v-if="!isExport"
            v-model="truncate"
            variant="chip"
            :label="t('modules.oracle.io.truncateFirst')"
            :disabled="busy"
          />
        </div>
      </DataTransferSection>

      <DataTransferSection
        v-if="!isExport"
        :title="t('modules.oracle.io.columnMapTitle')"
      >
        <template #head>
          <RsButton
            size="sm"
            variant="ghost"
            :disabled="busy || mapLoading || !filePath.trim()"
            @click="loadColumnMapFromFile"
          >
            {{ t('modules.oracle.io.columnMapLoad') }}
          </RsButton>
        </template>
        <p class="nm-oracle-dt__map-hint">{{ t('modules.oracle.io.columnMapHint') }}</p>
        <p v-if="sourceColumns.length" class="nm-oracle-dt__map-meta">
          {{ t('modules.oracle.io.columnMapMapped', { n: mappedCount, total: sourceColumns.length }) }}
        </p>
        <div v-if="sourceColumns.length" class="nm-oracle-dt__map">
          <div class="nm-oracle-dt__map-head">
            <span>{{ t('modules.oracle.io.columnMapSource') }}</span>
            <span>{{ t('modules.oracle.io.columnMapTarget') }}</span>
          </div>
          <div
            v-for="src in sourceColumns"
            :key="src"
            class="nm-oracle-dt__map-row"
          >
            <span class="nm-oracle-dt__map-src" :title="src">{{ src }}</span>
            <RsSelect
              :model-value="columnTargets[src] ?? ''"
              :options="targetOptions"
              :disabled="busy"
              @update:model-value="(v) => (columnTargets[src] = String(v ?? ''))"
            />
          </div>
        </div>
        <p v-else class="nm-oracle-dt__map-empty">{{ t('modules.oracle.io.columnMapNeedFile') }}</p>
      </DataTransferSection>

      <template #note>
        {{
          isExport ? t('modules.oracle.io.csvExportHint') : t('modules.oracle.io.csvImportHint')
        }}
      </template>
    </DataTransferPanel>
  </DataTransferShell>
</template>

<style scoped>
.nm-oracle-dt__scope {
  font-size: var(--rs-font-size-sm, 13px);
  line-height: 1.35;
  word-break: break-all;
}

.nm-oracle-dt__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 520px) {
  .nm-oracle-dt__grid {
    grid-template-columns: 1fr;
  }
}

.nm-oracle-dt__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nm-oracle-dt__checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.nm-oracle-dt__map-hint,
.nm-oracle-dt__map-meta,
.nm-oracle-dt__map-empty {
  margin: 0;
  font-size: var(--rs-font-size-xs, 12px);
  color: var(--rs-text-secondary, #64748b);
  line-height: 1.4;
}

.nm-oracle-dt__map-meta {
  margin-top: 4px;
}

.nm-oracle-dt__map {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  height: 180px;
  max-height: 180px;
  overflow: auto;
  flex: 0 0 auto;
}

.nm-oracle-dt__map-head,
.nm-oracle-dt__map-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 8px;
  align-items: center;
}

.nm-oracle-dt__map-head {
  font-size: var(--rs-font-size-xs, 12px);
  font-weight: 600;
  color: var(--rs-text-secondary, #64748b);
  position: sticky;
  top: 0;
  background: var(--rs-bg-elevated, #fff);
  z-index: 1;
  padding-bottom: 2px;
}

.nm-oracle-dt__map-src {
  font-size: var(--rs-font-size-sm, 13px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
