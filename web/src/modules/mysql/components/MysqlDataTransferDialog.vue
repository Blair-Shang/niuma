<script setup lang="ts">
import { RsButton, RsInput, RsLabel, RsSelect, useRsToast, type RsSelectOptions } from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi, fsApi, mysqlApi } from '@/api'
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
import { useMysqlIoTasks } from '@/modules/mysql/composables/useMysqlIoTasks'
import { readMysqlIoContext } from '@/modules/mysql/data-tasks'
import {
  autoMatchColumns,
  parseCsvSourceColumns,
} from '@/modules/database/utils/csv-header'

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
const { track, waitForTask, lines, clearLines, activeTaskId } = useMysqlIoTasks()

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

const ctx = computed(() => (task.value ? readMysqlIoContext(task.value.context) : null))
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

const mappedCount = computed(() =>
  sourceColumns.value.filter((s) => !!columnTargets.value[s]?.trim()).length,
)

const canConfirm = computed(
  () =>
    !!task.value &&
    !!ctx.value?.database &&
    !!ctx.value?.table &&
    !!filePath.value.trim() &&
    !busy.value &&
    // 导入必须先解析列映射，避免未映射时用原始表头直插失败
    (isExport.value || (sourceColumns.value.length > 0 && mappedCount.value > 0)),
)

const windowTitle = computed(() => task.value?.title ?? t('modules.mysql.io.exportTitle'))
const scopeLabel = computed(() => {
  const scope = ctx.value
  if (!scope?.database || !scope.table) return '—'
  return `${scope.database}.${scope.table}`
})

const shellLabels = computed(
  (): DataTransferShellLabels => ({
    dockToBottom: t('modules.mysql.io.dockToBottom'),
    popOut: t('modules.mysql.io.popOut'),
    cancelTask: t('modules.mysql.io.cancelTask'),
    close: t('common.close'),
    confirm: isExport.value ? t('modules.mysql.io.export') : t('modules.mysql.io.import'),
  }),
)

const panelLabels = computed(
  (): DataTransferPanelLabels => ({
    progressLog: t('modules.mysql.io.progressLog'),
    progressEmpty: t('modules.mysql.io.progressEmpty'),
    running: t('modules.mysql.io.running'),
  }),
)

const fileLabels = computed(
  (): DataTransferFileFieldLabels => ({
    filePath: t('modules.mysql.io.filePath'),
    browse: t('modules.mysql.io.browse'),
  }),
)

const delimiterOptions = computed<RsSelectOptions>(() => [
  { value: ',', label: t('modules.mysql.io.delimiterComma') },
  { value: '\t', label: t('modules.mysql.io.delimiterTab') },
  { value: ';', label: t('modules.mysql.io.delimiterSemicolon') },
  { value: '|', label: t('modules.mysql.io.delimiterPipe') },
])

const targetOptions = computed<RsSelectOptions>(() => [
  { value: '', label: t('modules.mysql.io.columnMapSkip') },
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
  if (!scope?.database || !scope.table || isExport.value) {
    tableColumns.value = []
    return
  }
  try {
    const result = await mysqlApi.metaColumns({
      profileId: scope.profileId,
      sessionId: scope.sessionId || undefined,
      database: scope.database,
      table: scope.table,
    })
    tableColumns.value = result.columns.map((c) => c.name)
  } catch (e) {
    tableColumns.value = []
    toast.error(e instanceof Error ? e.message : t('modules.mysql.io.failed'))
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
    const result = await fsApi.readText({ path })
    // 仅用前缀解析表头，避免巨大文件卡 UI
    const prefix = result.content.slice(0, 64 * 1024)
    const sources = parseCsvSourceColumns(prefix, {
      header: header.value,
      delimiter: delimiter.value || ',',
    })
    if (sources.length === 0) {
      resetMap()
      toast.error(t('modules.mysql.io.columnMapEmpty'))
      return
    }
    applyAutoMap(sources)
  } catch (e) {
    resetMap()
    toast.error(e instanceof Error ? e.message : t('modules.mysql.io.browseError'))
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
        title: t('modules.mysql.io.browseExportTitle'),
        defaultPath: `${scope.table ?? 'export'}.csv`,
        accept: ['.csv'],
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.mysql.io.browseImportTitle'),
        accept: ['.csv'],
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
        await loadColumnMapFromFile()
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.io.browseError'))
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
    const csvOptions = {
      header: header.value,
      delimiter: delimiter.value || ',',
      nullString: nullString.value || undefined,
      truncate: !isExport.value && truncate.value,
      ...(columnMap ? { columnMap } : {}),
    }
    const sessionId = scope.sessionId || undefined
    const result = isExport.value
      ? await mysqlApi.ioExportCsv({
          profileId: scope.profileId,
          sessionId,
          database: scope.database,
          table: scope.table,
          outputPath: filePath.value,
          csvOptions,
        })
      : await mysqlApi.ioImportCsv({
          profileId: scope.profileId,
          sessionId,
          database: scope.database,
          table: scope.table,
          inputPath: filePath.value,
          csvOptions,
        })
    const done = await waitForTask(result.taskId)
    if (!done.ok) {
      toast.error(done.message || t('modules.mysql.io.failed'))
      return
    }
    toast.success(isExport.value ? t('modules.mysql.io.exportDone') : t('modules.mysql.io.importDone'))
    if (done.outputPath && isExport.value) {
      try {
        await fsApi.showInFolder({ path: done.outputPath })
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.io.failed'))
  } finally {
    hub.setBusy(props.taskId, false)
  }
}

async function onCancelTask(): Promise<void> {
  const backendTaskId = activeTaskId.value
  if (!backendTaskId) return
  try {
    await mysqlApi.ioCancel({ taskId: backendTaskId })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.io.failed'))
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
      <DataTransferSection :title="t('modules.mysql.io.sectionTarget')">
        <div class="nm-mysql-dt__scope" :title="scopeLabel">{{ scopeLabel }}</div>
      </DataTransferSection>

      <DataTransferSection :title="t('modules.mysql.io.sectionFile')">
        <DataTransferFileField
          v-model="filePath"
          :labels="fileLabels"
          :disabled="busy"
          required
          @browse="pickPath"
        />
      </DataTransferSection>

      <DataTransferSection :title="t('modules.mysql.io.sectionFormat')">
        <div class="nm-mysql-dt__grid">
          <div class="nm-mysql-dt__field">
            <RsLabel>{{ t('modules.mysql.io.delimiter') }}</RsLabel>
            <RsSelect v-model="delimiter" :options="delimiterOptions" :disabled="busy" />
          </div>
          <div class="nm-mysql-dt__field">
            <RsLabel>{{ t('modules.mysql.io.nullString') }}</RsLabel>
            <RsInput
              v-model="nullString"
              :disabled="busy"
              :placeholder="t('modules.mysql.io.nullStringPh')"
            />
          </div>
        </div>
        <div class="nm-mysql-dt__checks">
          <DataTransferCheck
            v-model="header"
            variant="chip"
            :label="t('modules.mysql.io.header')"
            :disabled="busy"
          />
          <DataTransferCheck
            v-if="!isExport"
            v-model="truncate"
            variant="chip"
            :label="t('modules.mysql.io.truncateFirst')"
            :disabled="busy"
          />
        </div>
      </DataTransferSection>

      <DataTransferSection
        v-if="!isExport"
        :title="t('modules.mysql.io.columnMapTitle')"
      >
        <template #head>
          <RsButton
            size="sm"
            variant="ghost"
            :disabled="busy || mapLoading || !filePath.trim()"
            @click="loadColumnMapFromFile"
          >
            {{ t('modules.mysql.io.columnMapLoad') }}
          </RsButton>
        </template>
        <p class="nm-mysql-dt__map-hint">{{ t('modules.mysql.io.columnMapHint') }}</p>
        <p v-if="sourceColumns.length" class="nm-mysql-dt__map-meta">
          {{ t('modules.mysql.io.columnMapMapped', { n: mappedCount, total: sourceColumns.length }) }}
        </p>
        <div v-if="sourceColumns.length" class="nm-mysql-dt__map">
          <div class="nm-mysql-dt__map-head">
            <span>{{ t('modules.mysql.io.columnMapSource') }}</span>
            <span>{{ t('modules.mysql.io.columnMapTarget') }}</span>
          </div>
          <div
            v-for="src in sourceColumns"
            :key="src"
            class="nm-mysql-dt__map-row"
          >
            <span class="nm-mysql-dt__map-src" :title="src">{{ src }}</span>
            <RsSelect
              :model-value="columnTargets[src] ?? ''"
              :options="targetOptions"
              :disabled="busy"
              @update:model-value="(v) => (columnTargets[src] = String(v ?? ''))"
            />
          </div>
        </div>
        <p v-else class="nm-mysql-dt__map-empty">{{ t('modules.mysql.io.columnMapNeedFile') }}</p>
      </DataTransferSection>

      <template #note>
        {{
          isExport ? t('modules.mysql.io.csvExportHint') : t('modules.mysql.io.csvImportHint')
        }}
      </template>
    </DataTransferPanel>
  </DataTransferShell>
</template>

<style scoped>
.nm-mysql-dt__scope {
  font-size: var(--rs-font-size-sm, 13px);
  line-height: 1.35;
  word-break: break-all;
}

.nm-mysql-dt__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 520px) {
  .nm-mysql-dt__grid {
    grid-template-columns: 1fr;
  }
}

.nm-mysql-dt__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nm-mysql-dt__checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.nm-mysql-dt__map-hint,
.nm-mysql-dt__map-meta,
.nm-mysql-dt__map-empty {
  margin: 0;
  font-size: var(--rs-font-size-xs, 12px);
  color: var(--rs-text-secondary, #64748b);
  line-height: 1.4;
}

.nm-mysql-dt__map-meta {
  margin-top: 4px;
}

.nm-mysql-dt__map {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  height: 180px;
  max-height: 180px;
  overflow: auto;
  flex: 0 0 auto;
}

.nm-mysql-dt__map-head,
.nm-mysql-dt__map-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 8px;
  align-items: center;
}

.nm-mysql-dt__map-head {
  font-size: var(--rs-font-size-xs, 12px);
  font-weight: 600;
  color: var(--rs-text-secondary, #64748b);
  position: sticky;
  top: 0;
  background: var(--rs-bg-elevated, #fff);
  z-index: 1;
  padding-bottom: 2px;
}

.nm-mysql-dt__map-src {
  font-size: var(--rs-font-size-sm, 13px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
