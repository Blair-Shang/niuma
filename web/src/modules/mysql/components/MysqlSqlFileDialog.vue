<script setup lang="ts">
import { RsSelect, useRsToast, type RsSelectOptions } from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi, fsApi, mysqlApi } from '@/api'
import type { MysqlIoDumpMode, MysqlTableInfo } from '@/api/types/mysql'
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
const isDump = computed(() => task.value?.kind === 'dump_sql')
const isSingleObjectScope = computed(
  () =>
    !!ctx.value?.table ||
    ctx.value?.dumpScope === 'table' ||
    ctx.value?.dumpScope === 'procedure' ||
    ctx.value?.dumpScope === 'function',
)
const isCategoryScope = computed(
  () =>
    ctx.value?.dumpScope === 'tables' ||
    ctx.value?.dumpScope === 'views' ||
    ctx.value?.dumpScope === 'procedures' ||
    ctx.value?.dumpScope === 'functions',
)
const isDatabaseScope = computed(
  () => isDump.value && !isSingleObjectScope.value && !isCategoryScope.value,
)
const objectFiltersLocked = computed(() => isSingleObjectScope.value || isCategoryScope.value)

const filePath = ref('')
const mode = ref<MysqlIoDumpMode>('structure_and_data')
const includeTables = ref(true)
const includeViews = ref(true)
const includeProcedures = ref(true)
const includeFunctions = ref(true)
const includeTriggers = ref(true)
const includeEvents = ref(false)
const includeCreateDatabase = ref(false)
const dropIfExists = ref(true)
const truncateBeforeData = ref(false)
const continueOnError = ref(true)

const objectRows = ref<MysqlTableInfo[]>([])
const selectedTables = ref<string[]>([])
const objectsLoading = ref(false)
const objectsError = ref('')

const modeOptions = computed<RsSelectOptions>(() => [
  { value: 'structure_and_data', label: t('modules.mysql.io.dumpModeBoth') },
  { value: 'structure_only', label: t('modules.mysql.io.dumpModeStructure') },
  { value: 'data_only', label: t('modules.mysql.io.dumpModeData') },
])

const canPickObjects = computed(
  () => isDump.value && isDatabaseScope.value && (includeTables.value || includeViews.value),
)

const allObjectsSelected = computed(
  () =>
    objectRows.value.length > 0 &&
    objectRows.value.every((row) => selectedTables.value.includes(row.name)),
)

const canConfirm = computed(() => {
  if (!task.value || !ctx.value?.database || !filePath.value.trim() || busy.value) return false
  if (isDump.value && canPickObjects.value && objectRows.value.length > 0) {
    return selectedTables.value.length > 0
  }
  return true
})

const windowTitle = computed(() => task.value?.title ?? t('modules.mysql.io.dumpTitle'))

const scopeLabel = computed(() => {
  const scope = ctx.value
  if (!scope?.database) return '—'
  if (scope.table) return `${scope.database}.${scope.table}`
  if (scope.dumpScope === 'tables') {
    return t('modules.mysql.io.dumpScopeTables', { name: scope.database })
  }
  if (scope.dumpScope === 'views') {
    return t('modules.mysql.io.dumpScopeViews', { name: scope.database })
  }
  if (scope.dumpScope === 'procedures') {
    return t('modules.mysql.io.dumpScopeProcedures', { name: scope.database })
  }
  if (scope.dumpScope === 'functions') {
    return t('modules.mysql.io.dumpScopeFunctions', { name: scope.database })
  }
  return scope.database
})

const shellLabels = computed(
  (): DataTransferShellLabels => ({
    dockToBottom: t('modules.mysql.io.dockToBottom'),
    popOut: t('modules.mysql.io.popOut'),
    cancelTask: t('modules.mysql.io.cancelTask'),
    close: t('common.close'),
    confirm: isDump.value ? t('modules.mysql.io.dump') : t('modules.mysql.io.execSql'),
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

function applyDumpScopeDefaults(): void {
  const scope = ctx.value?.dumpScope
  if (scope === 'tables') {
    includeTables.value = true
    includeViews.value = false
    includeProcedures.value = false
    includeFunctions.value = false
    includeTriggers.value = true
    includeEvents.value = false
    includeCreateDatabase.value = false
    mode.value = 'structure_and_data'
    return
  }
  if (scope === 'views') {
    includeTables.value = false
    includeViews.value = true
    includeProcedures.value = false
    includeFunctions.value = false
    includeTriggers.value = false
    includeEvents.value = false
    includeCreateDatabase.value = false
    mode.value = 'structure_only'
    return
  }
  if (scope === 'procedures') {
    includeTables.value = false
    includeViews.value = false
    includeProcedures.value = true
    includeFunctions.value = false
    includeTriggers.value = false
    includeEvents.value = false
    includeCreateDatabase.value = false
    mode.value = 'structure_only'
    return
  }
  if (scope === 'functions') {
    includeTables.value = false
    includeViews.value = false
    includeProcedures.value = false
    includeFunctions.value = true
    includeTriggers.value = false
    includeEvents.value = false
    includeCreateDatabase.value = false
    mode.value = 'structure_only'
    return
  }
  if (scope === 'procedure' || scope === 'function') {
    includeTables.value = false
    includeViews.value = false
    includeProcedures.value = scope === 'procedure'
    includeFunctions.value = scope === 'function'
    includeTriggers.value = false
    includeEvents.value = false
    includeCreateDatabase.value = false
    mode.value = 'structure_only'
    return
  }
  if (scope === 'table' || ctx.value?.table) {
    includeTables.value = true
    includeViews.value = true
    includeProcedures.value = false
    includeFunctions.value = false
    includeTriggers.value = true
    includeEvents.value = false
    includeCreateDatabase.value = false
    return
  }
  // 整库：对齐 Navicat（表/视图/过程/函数/触发器；事件与建库默认关）
  includeTables.value = true
  includeViews.value = true
  includeProcedures.value = true
  includeFunctions.value = true
  includeTriggers.value = true
  includeEvents.value = false
  includeCreateDatabase.value = false
}

async function loadObjectRows(): Promise<void> {
  const scope = ctx.value
  if (!scope?.database || !canPickObjects.value) {
    objectRows.value = []
    selectedTables.value = []
    objectsError.value = ''
    return
  }
  objectsLoading.value = true
  objectsError.value = ''
  try {
    const types: Array<'table' | 'view'> = []
    if (includeTables.value) types.push('table')
    if (includeViews.value) types.push('view')
    const result = await mysqlApi.treeTables({
      profileId: scope.profileId,
      database: scope.database,
      types,
      limit: 2000,
    })
    objectRows.value = result.tables ?? []
    selectedTables.value = objectRows.value.map((row) => row.name)
  } catch (e) {
    objectsError.value = e instanceof Error ? e.message : t('modules.mysql.io.objectsLoadError')
    objectRows.value = []
    selectedTables.value = []
  } finally {
    objectsLoading.value = false
  }
}

function toggleSelectAll(checked: boolean): void {
  selectedTables.value = checked ? objectRows.value.map((row) => row.name) : []
}

function toggleObject(name: string, checked: boolean): void {
  if (checked) {
    if (!selectedTables.value.includes(name)) {
      selectedTables.value = [...selectedTables.value, name]
    }
    return
  }
  selectedTables.value = selectedTables.value.filter((n) => n !== name)
}

function reset(): void {
  filePath.value = ''
  mode.value = 'structure_and_data'
  includeTables.value = true
  includeViews.value = true
  includeProcedures.value = true
  includeFunctions.value = true
  includeTriggers.value = true
  includeEvents.value = false
  includeCreateDatabase.value = false
  dropIfExists.value = true
  truncateBeforeData.value = false
  continueOnError.value = true
  objectRows.value = []
  selectedTables.value = []
  objectsError.value = ''
  clearLines()
  applyDumpScopeDefaults()
}

watch(
  () => props.taskId,
  () => {
    reset()
    void loadObjectRows()
  },
  { immediate: true },
)

watch(
  () => ctx.value?.dumpScope,
  () => {
    applyDumpScopeDefaults()
    void loadObjectRows()
  },
)

watch([includeTables, includeViews, isDump], () => {
  if (isDump.value) void loadObjectRows()
})

function dumpDefaultFileName(): string {
  const scope = ctx.value
  if (!scope) return 'dump.sql'
  if (scope.table) return `${scope.database}.${scope.table}.sql`
  if (scope.dumpScope === 'tables') return `${scope.database}-tables.sql`
  if (scope.dumpScope === 'views') return `${scope.database}-views.sql`
  if (scope.dumpScope === 'procedures') return `${scope.database}-procedures.sql`
  if (scope.dumpScope === 'functions') return `${scope.database}-functions.sql`
  return `${scope.database ?? 'dump'}.sql`
}

async function pickPath(): Promise<void> {
  const current = task.value
  const scope = ctx.value
  if (!current || !scope) return
  try {
    if (isDump.value) {
      const result = await dialogApi.saveFile({
        title: t('modules.mysql.io.browseDumpTitle'),
        defaultPath: dumpDefaultFileName(),
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.mysql.io.browseExecTitle'),
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.io.browseError'))
  }
}

async function onConfirm(): Promise<void> {
  const scope = ctx.value
  if (!scope?.database || !canConfirm.value) return
  hub.setBusy(props.taskId, true)
  clearLines()
  track()
  try {
    const sessionId = scope.sessionId || undefined
    const selectedForDump =
      canPickObjects.value && selectedTables.value.length > 0
        ? selectedTables.value
        : undefined
    const tables = scope.table ? [scope.table] : selectedForDump
    const result = isDump.value
      ? await mysqlApi.ioDumpSql({
          profileId: scope.profileId,
          sessionId,
          dump: {
            database: scope.database,
            tables,
            mode: mode.value,
            outputPath: filePath.value,
            dropIfExists: dropIfExists.value,
            truncateBeforeData: truncateBeforeData.value,
            includeTables: includeTables.value,
            includeViews: includeViews.value,
            includeProcedures: includeProcedures.value,
            includeFunctions: includeFunctions.value,
            includeTriggers: includeTriggers.value,
            includeEvents: includeEvents.value,
            includeCreateDatabase: includeCreateDatabase.value,
          },
        })
      : await mysqlApi.ioExecSqlFile({
          profileId: scope.profileId,
          sessionId,
          database: scope.database,
          inputPath: filePath.value,
          execOptions: { continueOnError: continueOnError.value },
        })
    const done = await waitForTask(result.taskId)
    if (!done.ok) {
      toast.error(done.message || t('modules.mysql.io.failed'))
      return
    }
    toast.success(isDump.value ? t('modules.mysql.io.dumpDone') : t('modules.mysql.io.execDone'))
    if (done.outputPath && isDump.value) {
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
      <DataTransferSection :title="t('modules.mysql.io.sectionFile')">
        <DataTransferFileField
          v-model="filePath"
          :labels="fileLabels"
          :disabled="busy"
          required
          @browse="pickPath"
        />
      </DataTransferSection>

      <template v-if="isDump">
        <div class="nm-mysql-sf__row">
          <DataTransferSection :title="t('modules.mysql.io.sectionTarget')">
            <div class="nm-mysql-sf__scope" :title="scopeLabel">{{ scopeLabel }}</div>
          </DataTransferSection>
          <DataTransferSection :title="t('modules.mysql.io.dumpMode')">
            <RsSelect v-model="mode" :options="modeOptions" :disabled="busy" />
          </DataTransferSection>
        </div>

        <DataTransferSection
          v-if="!isSingleObjectScope"
          :title="t('modules.mysql.io.sectionObjects')"
        >
          <div class="nm-mysql-sf__chips">
            <DataTransferCheck
              v-model="includeTables"
              variant="chip"
              :label="t('modules.mysql.io.dumpIncludeTables')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-model="includeViews"
              variant="chip"
              :label="t('modules.mysql.io.dumpIncludeViews')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="isDatabaseScope || ctx?.dumpScope === 'procedures'"
              v-model="includeProcedures"
              variant="chip"
              :label="t('modules.mysql.io.dumpIncludeProcedures')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="isDatabaseScope || ctx?.dumpScope === 'functions'"
              v-model="includeFunctions"
              variant="chip"
              :label="t('modules.mysql.io.dumpIncludeFunctions')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="isDatabaseScope || ctx?.dumpScope === 'tables'"
              v-model="includeTriggers"
              variant="chip"
              :label="t('modules.mysql.io.dumpIncludeTriggers')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="isDatabaseScope"
              v-model="includeEvents"
              variant="chip"
              :label="t('modules.mysql.io.dumpIncludeEvents')"
              :disabled="busy"
            />
          </div>
        </DataTransferSection>

        <DataTransferSection :title="t('modules.mysql.io.sectionOptions')">
          <div class="nm-mysql-sf__options">
            <DataTransferCheck
              v-if="isDatabaseScope"
              v-model="includeCreateDatabase"
              :label="t('modules.mysql.io.dumpIncludeCreateDatabase')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="dropIfExists"
              :label="t('modules.mysql.io.dumpDropIfExists')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-if="mode !== 'structure_only'"
              v-model="truncateBeforeData"
              :label="t('modules.mysql.io.dumpTruncate')"
              :disabled="busy"
            />
          </div>
        </DataTransferSection>

        <DataTransferSection v-if="canPickObjects" :title="t('modules.mysql.io.dumpObjectList')">
          <template #head>
            <label class="nm-mysql-sf__select-all">
              <input
                type="checkbox"
                :checked="allObjectsSelected"
                :disabled="busy || objectsLoading || objectRows.length === 0"
                @change="toggleSelectAll(($event.target as HTMLInputElement).checked)"
              />
              {{ t('modules.mysql.io.selectAllObjects') }}
            </label>
          </template>
          <p v-if="objectsLoading" class="nm-mysql-sf__status">
            {{ t('modules.mysql.io.objectsLoading') }}
          </p>
          <p v-else-if="objectsError" class="nm-mysql-sf__status nm-mysql-sf__status--error">
            {{ objectsError }}
          </p>
          <ul v-else class="nm-mysql-sf__objects">
            <li v-for="row in objectRows" :key="row.name" class="nm-mysql-sf__object-item">
              <label class="nm-mysql-sf__object">
                <input
                  type="checkbox"
                  :checked="selectedTables.includes(row.name)"
                  :disabled="busy"
                  @change="
                    toggleObject(row.name, ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="nm-mysql-sf__object-name">{{ row.name }}</span>
                <span class="nm-mysql-sf__object-type">{{ row.type }}</span>
              </label>
            </li>
            <li v-if="objectRows.length === 0" class="nm-mysql-sf__object-item">
              <p class="nm-mysql-sf__status">{{ t('modules.mysql.io.objectsEmpty') }}</p>
            </li>
          </ul>
        </DataTransferSection>
      </template>

      <DataTransferSection v-else :title="t('modules.mysql.io.sectionOptions')">
        <div class="nm-mysql-sf__scope nm-mysql-sf__scope--mb">{{ scopeLabel }}</div>
        <DataTransferCheck
          v-model="continueOnError"
          :label="t('modules.mysql.io.execContinueOnError')"
          :hint="t('modules.mysql.io.execContinueOnErrorHint')"
          :disabled="busy"
        />
      </DataTransferSection>

      <template #note>
        {{ isDump ? t('modules.mysql.io.dumpHint') : t('modules.mysql.io.execHint') }}
      </template>
    </DataTransferPanel>
  </DataTransferShell>
</template>

<style scoped>
.nm-mysql-sf__row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 12px;
}

@media (max-width: 640px) {
  .nm-mysql-sf__row {
    grid-template-columns: 1fr;
  }
}

.nm-mysql-sf__scope {
  font-size: var(--rs-font-size-sm, 13px);
  line-height: 1.35;
  word-break: break-all;
}

.nm-mysql-sf__scope--mb {
  margin-bottom: 8px;
  color: var(--rs-muted);
}

.nm-mysql-sf__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.nm-mysql-sf__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 14px;
}

@media (max-width: 520px) {
  .nm-mysql-sf__options {
    grid-template-columns: 1fr;
  }
}

.nm-mysql-sf__select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-mysql-sf__status {
  margin: 0;
  font-size: 12px;
  color: var(--rs-muted);
}

.nm-mysql-sf__status--error {
  color: var(--rs-danger, #dc2626);
}

.nm-mysql-sf__objects {
  list-style: none;
  margin: 0;
  height: 148px;
  max-height: 148px;
  overflow: auto;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border-radius: var(--rs-radius-xs, 4px);
  border: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-elevated);
}

.nm-mysql-sf__object-item {
  margin: 0;
  padding: 0;
}

.nm-mysql-sf__object {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.nm-mysql-sf__object:hover {
  background: var(--rs-item-hover);
}

.nm-mysql-sf__object-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mysql-sf__object-type {
  flex: 0 0 auto;
  color: var(--rs-muted);
  font-size: 11px;
}
</style>
