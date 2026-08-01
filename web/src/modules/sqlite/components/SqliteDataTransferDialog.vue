<script setup lang="ts">
import { RsButton, RsInput, RsLabel, RsSelect, useRsToast, type RsSelectOptions } from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi, fsApi, sqliteApi } from '@/api'
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
import { useSqliteIoTasks } from '@/modules/sqlite/composables/useSqliteIoTasks'
import { withSqliteSession } from '@/modules/sqlite/composables/useSqliteSessionSql'
import { readSqliteIoContext } from '@/modules/sqlite/data-tasks'
import {
  autoMatchColumns,
  parseCsvSourceColumns,
} from '@/modules/sqlite/utils/csv-header'

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
const { track, waitForTask, lines, clearLines, activeTaskId } = useSqliteIoTasks()

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

const ctx = computed(() => (task.value ? readSqliteIoContext(task.value.context) : null))
const isExport = computed(() => task.value?.kind === 'export_csv')
const schemaName = computed(() => ctx.value?.schema?.trim() || 'main')

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
    !!ctx.value?.table &&
    !!filePath.value.trim() &&
    !busy.value &&
    // 导入必须先解析列映射，避免未映射时用原始表头直插失败
    (isExport.value || (sourceColumns.value.length > 0 && mappedCount.value > 0)),
)

const windowTitle = computed(() => task.value?.title ?? t('modules.sqlite.io.exportTitle'))
const scopeLabel = computed(() => {
  const scope = ctx.value
  if (!scope?.table) return '—'
  return `${schemaName.value}.${scope.table}`
})

const shellLabels = computed(
  (): DataTransferShellLabels => ({
    dockToBottom: t('modules.sqlite.io.dockToBottom'),
    popOut: t('modules.sqlite.io.popOut'),
    cancelTask: t('modules.sqlite.io.cancelTask'),
    close: t('common.close'),
    confirm: isExport.value ? t('modules.sqlite.io.export') : t('modules.sqlite.io.import'),
  }),
)

const panelLabels = computed(
  (): DataTransferPanelLabels => ({
    progressLog: t('modules.sqlite.io.progressLog'),
    progressEmpty: t('modules.sqlite.io.progressEmpty'),
    running: t('modules.sqlite.io.running'),
  }),
)

const fileLabels = computed(
  (): DataTransferFileFieldLabels => ({
    filePath: t('modules.sqlite.io.filePath'),
    browse: t('modules.sqlite.io.browse'),
  }),
)

const delimiterOptions = computed<RsSelectOptions>(() => [
  { value: ',', label: t('modules.sqlite.io.delimiterComma') },
  { value: '\t', label: t('modules.sqlite.io.delimiterTab') },
  { value: ';', label: t('modules.sqlite.io.delimiterSemicolon') },
  { value: '|', label: t('modules.sqlite.io.delimiterPipe') },
])

const targetOptions = computed<RsSelectOptions>(() => [
  { value: '', label: t('modules.sqlite.io.columnMapSkip') },
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
  if (!scope?.table || isExport.value) {
    tableColumns.value = []
    return
  }
  try {
    const load = async (sessionId: string) => {
      const result = await sqliteApi.metaColumns({
        sessionId,
        schema: schemaName.value,
        table: scope.table,
      })
      tableColumns.value = result.columns.map((c) => c.name)
    }
    if (scope.sessionId) {
      await load(scope.sessionId)
    } else {
      await withSqliteSession(scope.profileId, load)
    }
  } catch (e) {
    tableColumns.value = []
    toast.error(e instanceof Error ? e.message : t('modules.sqlite.io.failed'))
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
    const prefix = result.content.slice(0, 64 * 1024)
    const sources = parseCsvSourceColumns(prefix, {
      header: header.value,
      delimiter: delimiter.value || ',',
    })
    if (sources.length === 0) {
      resetMap()
      toast.error(t('modules.sqlite.io.columnMapEmpty'))
      return
    }
    applyAutoMap(sources)
  } catch (e) {
    resetMap()
    toast.error(e instanceof Error ? e.message : t('modules.sqlite.io.browseError'))
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
        title: t('modules.sqlite.io.browseExportTitle'),
        defaultPath: `${scope.table ?? 'export'}.csv`,
        accept: ['.csv'],
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.sqlite.io.browseImportTitle'),
        accept: ['.csv'],
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
        await loadColumnMapFromFile()
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.sqlite.io.browseError'))
  }
}

async function onConfirm(): Promise<void> {
  const scope = ctx.value
  if (!scope?.table || !canConfirm.value) return
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
      ? await sqliteApi.ioExportCsv({
          profileId: scope.profileId,
          sessionId,
          schema: schemaName.value,
          table: scope.table,
          outputPath: filePath.value,
          csvOptions,
        })
      : await sqliteApi.ioImportCsv({
          profileId: scope.profileId,
          sessionId,
          schema: schemaName.value,
          table: scope.table,
          inputPath: filePath.value,
          csvOptions,
        })
    const done = await waitForTask(result.taskId)
    if (!done.ok) {
      toast.error(done.message || t('modules.sqlite.io.failed'))
      return
    }
    toast.success(
      isExport.value ? t('modules.sqlite.io.exportDone') : t('modules.sqlite.io.importDone'),
    )
    if (done.outputPath && isExport.value) {
      try {
        await fsApi.showInFolder({ path: done.outputPath })
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.sqlite.io.failed'))
  } finally {
    hub.setBusy(props.taskId, false)
  }
}

async function onCancelTask(): Promise<void> {
  const backendTaskId = activeTaskId.value
  if (!backendTaskId) return
  try {
    await sqliteApi.ioCancel({ taskId: backendTaskId })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.sqlite.io.failed'))
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
      <DataTransferSection :title="t('modules.sqlite.io.sectionTarget')">
        <div class="nm-sqlite-dt__scope" :title="scopeLabel">{{ scopeLabel }}</div>
      </DataTransferSection>

      <DataTransferSection :title="t('modules.sqlite.io.sectionFile')">
        <DataTransferFileField
          v-model="filePath"
          :labels="fileLabels"
          :disabled="busy"
          required
          @browse="pickPath"
        />
      </DataTransferSection>

      <DataTransferSection :title="t('modules.sqlite.io.sectionFormat')">
        <div class="nm-sqlite-dt__grid">
          <div class="nm-sqlite-dt__field">
            <RsLabel>{{ t('modules.sqlite.io.delimiter') }}</RsLabel>
            <RsSelect v-model="delimiter" :options="delimiterOptions" :disabled="busy" />
          </div>
          <div class="nm-sqlite-dt__field">
            <RsLabel>{{ t('modules.sqlite.io.nullString') }}</RsLabel>
            <RsInput
              v-model="nullString"
              :disabled="busy"
              :placeholder="t('modules.sqlite.io.nullStringPh')"
            />
          </div>
        </div>
        <div class="nm-sqlite-dt__checks">
          <DataTransferCheck
            v-model="header"
            variant="chip"
            :label="t('modules.sqlite.io.header')"
            :disabled="busy"
          />
          <DataTransferCheck
            v-if="!isExport"
            v-model="truncate"
            variant="chip"
            :label="t('modules.sqlite.io.truncateFirst')"
            :disabled="busy"
          />
        </div>
      </DataTransferSection>

      <DataTransferSection
        v-if="!isExport"
        :title="t('modules.sqlite.io.columnMapTitle')"
      >
        <template #head>
          <RsButton
            size="sm"
            variant="ghost"
            :disabled="busy || mapLoading || !filePath.trim()"
            @click="loadColumnMapFromFile"
          >
            {{ t('modules.sqlite.io.columnMapLoad') }}
          </RsButton>
        </template>
        <p class="nm-sqlite-dt__map-hint">{{ t('modules.sqlite.io.columnMapHint') }}</p>
        <p v-if="sourceColumns.length" class="nm-sqlite-dt__map-meta">
          {{
            t('modules.sqlite.io.columnMapMapped', {
              n: mappedCount,
              total: sourceColumns.length,
            })
          }}
        </p>
        <div v-if="sourceColumns.length" class="nm-sqlite-dt__map">
          <div class="nm-sqlite-dt__map-head">
            <span>{{ t('modules.sqlite.io.columnMapSource') }}</span>
            <span>{{ t('modules.sqlite.io.columnMapTarget') }}</span>
          </div>
          <div
            v-for="src in sourceColumns"
            :key="src"
            class="nm-sqlite-dt__map-row"
          >
            <span class="nm-sqlite-dt__map-src" :title="src">{{ src }}</span>
            <RsSelect
              :model-value="columnTargets[src] ?? ''"
              :options="targetOptions"
              :disabled="busy"
              @update:model-value="(v) => (columnTargets[src] = String(v ?? ''))"
            />
          </div>
        </div>
        <p v-else class="nm-sqlite-dt__map-empty">{{ t('modules.sqlite.io.columnMapNeedFile') }}</p>
      </DataTransferSection>

      <template #note>
        {{
          isExport ? t('modules.sqlite.io.csvExportHint') : t('modules.sqlite.io.csvImportHint')
        }}
      </template>
    </DataTransferPanel>
  </DataTransferShell>
</template>

<style scoped>
.nm-sqlite-dt__scope {
  font-size: var(--rs-font-size-sm, 13px);
  line-height: 1.35;
  word-break: break-all;
}

.nm-sqlite-dt__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 520px) {
  .nm-sqlite-dt__grid {
    grid-template-columns: 1fr;
  }
}

.nm-sqlite-dt__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nm-sqlite-dt__checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.nm-sqlite-dt__map-hint,
.nm-sqlite-dt__map-meta,
.nm-sqlite-dt__map-empty {
  margin: 0;
  font-size: var(--rs-font-size-xs, 12px);
  color: var(--rs-text-secondary, #64748b);
  line-height: 1.4;
}

.nm-sqlite-dt__map-meta {
  margin-top: 4px;
}

.nm-sqlite-dt__map {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  height: 180px;
  max-height: 180px;
  overflow: auto;
  flex: 0 0 auto;
}

.nm-sqlite-dt__map-head,
.nm-sqlite-dt__map-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 8px;
  align-items: center;
}

.nm-sqlite-dt__map-head {
  font-size: var(--rs-font-size-xs, 12px);
  font-weight: 600;
  color: var(--rs-text-secondary, #64748b);
  position: sticky;
  top: 0;
  background: var(--rs-bg-elevated, #fff);
  z-index: 1;
  padding-bottom: 2px;
}

.nm-sqlite-dt__map-src {
  font-size: var(--rs-font-size-sm, 13px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
