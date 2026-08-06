<script setup lang="ts">
import { RsSelect, useRsToast, type RsSelectOptions } from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi, fsApi } from '@/api'
import { oracleApi } from '@/api/oracle'
import type { OracleIoDumpMode, OracleObjectInfo } from '@/api/types/oracle'
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
const isDump = computed(() => task.value?.kind === 'dump_sql')
const schemaName = computed(() => ctx.value?.schema?.trim() || 'main')

const SINGLE_OBJECT_SCOPES = new Set([
  'table',
  'view',
  'procedure',
  'function',
  'package',
  'sequence',
])
const CATEGORY_SCOPES = new Set([
  'tables',
  'views',
  'functions',
  'procedures',
  'packages',
  'sequences',
])

const isSingleObjectScope = computed(
  () =>
    !!ctx.value?.table ||
    (ctx.value?.dumpScope != null && SINGLE_OBJECT_SCOPES.has(ctx.value.dumpScope)),
)
const isCategoryScope = computed(
  () => ctx.value?.dumpScope != null && CATEGORY_SCOPES.has(ctx.value.dumpScope),
)
const isSchemaScope = computed(
  () => isDump.value && !isSingleObjectScope.value && !isCategoryScope.value,
)
const objectFiltersLocked = computed(() => isSingleObjectScope.value || isCategoryScope.value)

const filePath = ref('')
const mode = ref<OracleIoDumpMode>('structure_and_data')
const includeTables = ref(true)
const includeViews = ref(true)
const includeProcedures = ref(true)
const includeFunctions = ref(true)
const includePackages = ref(true)
const includeSequences = ref(true)
const dropIfExists = ref(true)
const truncateBeforeData = ref(false)
const continueOnError = ref(true)

const objectRows = ref<OracleObjectInfo[]>([])
const selectedTables = ref<string[]>([])
const objectsLoading = ref(false)
const objectsError = ref('')
const objectsTruncated = ref(false)

const modeOptions = computed<RsSelectOptions>(() => [
  { value: 'structure_and_data', label: t('modules.oracle.io.dumpModeBoth') },
  { value: 'structure_only', label: t('modules.oracle.io.dumpModeStructure') },
  { value: 'data_only', label: t('modules.oracle.io.dumpModeData') },
])

const canPickObjects = computed(
  () => isDump.value && isSchemaScope.value && (includeTables.value || includeViews.value),
)

const allObjectsSelected = computed(
  () =>
    objectRows.value.length > 0 &&
    objectRows.value.every((row) => selectedTables.value.includes(row.name)),
)

const canConfirm = computed(() => {
  if (!task.value || !filePath.value.trim() || busy.value) return false
  if (isDump.value && canPickObjects.value && objectsTruncated.value) return false
  if (isDump.value && canPickObjects.value && objectRows.value.length > 0) {
    return selectedTables.value.length > 0
  }
  return true
})

const windowTitle = computed(() => task.value?.title ?? t('modules.oracle.io.dumpTitle'))

const scopeLabel = computed(() => {
  const scope = ctx.value
  const schema = schemaName.value
  if (scope?.table) return `${schema}.${scope.table}`
  const keyByScope: Record<string, string> = {
    tables: 'modules.oracle.io.dumpScopeTables',
    views: 'modules.oracle.io.dumpScopeViews',
    functions: 'modules.oracle.io.dumpScopeFunctions',
    procedures: 'modules.oracle.io.dumpScopeProcedures',
    packages: 'modules.oracle.io.dumpScopePackages',
    sequences: 'modules.oracle.io.dumpScopeSequences',
  }
  const key = scope?.dumpScope ? keyByScope[scope.dumpScope] : undefined
  if (key) return t(key, { name: schema })
  return schema
})

const shellLabels = computed(
  (): DataTransferShellLabels => ({
    dockToBottom: t('modules.oracle.io.dockToBottom'),
    popOut: t('modules.oracle.io.popOut'),
    cancelTask: t('modules.oracle.io.cancelTask'),
    close: t('common.close'),
    confirm: isDump.value ? t('modules.oracle.io.dump') : t('modules.oracle.io.execSql'),
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

function resetIncludes(opts: {
  tables?: boolean
  views?: boolean
  procedures?: boolean
  functions?: boolean
  packages?: boolean
  sequences?: boolean
}): void {
  includeTables.value = !!opts.tables
  includeViews.value = !!opts.views
  includeProcedures.value = !!opts.procedures
  includeFunctions.value = !!opts.functions
  includePackages.value = !!opts.packages
  includeSequences.value = !!opts.sequences
}

function applyDumpScopeDefaults(): void {
  const scope = ctx.value?.dumpScope
  if (scope === 'tables') {
    resetIncludes({ tables: true })
    mode.value = 'structure_and_data'
    return
  }
  if (scope === 'views' || scope === 'view') {
    resetIncludes({ views: true })
    mode.value = 'structure_only'
    return
  }
  if (scope === 'functions' || scope === 'function') {
    resetIncludes({ functions: true })
    mode.value = 'structure_only'
    return
  }
  if (scope === 'procedures' || scope === 'procedure') {
    resetIncludes({ procedures: true })
    mode.value = 'structure_only'
    return
  }
  if (scope === 'packages' || scope === 'package') {
    resetIncludes({ packages: true })
    mode.value = 'structure_only'
    return
  }
  if (scope === 'sequences' || scope === 'sequence') {
    resetIncludes({ sequences: true })
    mode.value = 'structure_only'
    return
  }
  if (scope === 'table') {
    resetIncludes({ tables: true })
    return
  }
  if (ctx.value?.table) {
    resetIncludes({ tables: true, views: true })
    return
  }
  resetIncludes({
    tables: true,
    views: true,
    procedures: true,
    functions: true,
    packages: true,
    sequences: true,
  })
}

async function loadObjectRows(): Promise<void> {
  const scope = ctx.value
  if (!canPickObjects.value) {
    objectRows.value = []
    selectedTables.value = []
    objectsError.value = ''
    objectsTruncated.value = false
    return
  }
  objectsLoading.value = true
  objectsError.value = ''
  try {
    const types: string[] = []
    if (includeTables.value) types.push('table')
    if (includeViews.value) types.push('view')
    const result = await oracleApi.treeTables({
      sessionId: scope?.sessionId || undefined,
      profileId: scope?.profileId,
      schema: schemaName.value,
      types,
      limit: 2000,
    })
    objectRows.value = result.objects ?? result.tables ?? []
    selectedTables.value = objectRows.value.map((row) => row.name)
    objectsTruncated.value = !!result.truncated
  } catch (e) {
    objectsError.value = e instanceof Error ? e.message : t('modules.oracle.io.objectsLoadError')
    objectRows.value = []
    selectedTables.value = []
    objectsTruncated.value = false
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
  includePackages.value = true
  includeSequences.value = true
  dropIfExists.value = true
  truncateBeforeData.value = false
  continueOnError.value = true
  objectRows.value = []
  selectedTables.value = []
  objectsError.value = ''
  objectsTruncated.value = false
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
  const schema = schemaName.value
  if (!scope) return 'dump.sql'
  if (scope.table) return `${schema}.${scope.table}.sql`
  const suffixByScope: Record<string, string> = {
    tables: 'tables',
    views: 'views',
    functions: 'functions',
    procedures: 'procedures',
    packages: 'packages',
    sequences: 'sequences',
  }
  const suffix = scope.dumpScope ? suffixByScope[scope.dumpScope] : undefined
  if (suffix) return `${schema}-${suffix}.sql`
  return `${schema}.sql`
}

async function pickPath(): Promise<void> {
  const current = task.value
  const scope = ctx.value
  if (!current || !scope) return
  try {
    if (isDump.value) {
      const result = await dialogApi.saveFile({
        title: t('modules.oracle.io.browseDumpTitle'),
        defaultPath: dumpDefaultFileName(),
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.oracle.io.browseExecTitle'),
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.oracle.io.browseError'))
  }
}

async function onConfirm(): Promise<void> {
  const scope = ctx.value
  if (!scope || !canConfirm.value) return
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
      ? await oracleApi.ioDumpSql({
          profileId: scope.profileId,
          sessionId,
          dump: {
            schema: schemaName.value,
            tables,
            mode: mode.value,
            outputPath: filePath.value,
            dropIfExists: dropIfExists.value,
            truncateBeforeData: truncateBeforeData.value,
            includeTables: includeTables.value,
            includeViews: includeViews.value,
            includeProcedures: includeProcedures.value,
            includeFunctions: includeFunctions.value,
            includePackages: includePackages.value,
            includeSequences: includeSequences.value,
          },
        })
      : await oracleApi.ioExecSqlFile({
          profileId: scope.profileId,
          sessionId,
          schema: schemaName.value,
          inputPath: filePath.value,
          execOptions: { continueOnError: continueOnError.value },
        })
    const done = await waitForTask(result.taskId)
    if (!done.ok) {
      toast.error(done.message || t('modules.oracle.io.failed'))
      return
    }
    toast.success(isDump.value ? t('modules.oracle.io.dumpDone') : t('modules.oracle.io.execDone'))
    if (done.outputPath && isDump.value) {
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
      <DataTransferSection :title="t('modules.oracle.io.sectionFile')">
        <DataTransferFileField
          v-model="filePath"
          :labels="fileLabels"
          :disabled="busy"
          required
          @browse="pickPath"
        />
      </DataTransferSection>

      <template v-if="isDump">
        <div class="nm-oracle-sf__row">
          <DataTransferSection :title="t('modules.oracle.io.sectionTarget')">
            <div class="nm-oracle-sf__scope" :title="scopeLabel">{{ scopeLabel }}</div>
          </DataTransferSection>
          <DataTransferSection :title="t('modules.oracle.io.dumpMode')">
            <RsSelect v-model="mode" :options="modeOptions" :disabled="busy" />
          </DataTransferSection>
        </div>

        <DataTransferSection
          v-if="!isSingleObjectScope"
          :title="t('modules.oracle.io.sectionObjects')"
        >
          <div class="nm-oracle-sf__chips">
            <DataTransferCheck
              v-model="includeTables"
              variant="chip"
              :label="t('modules.oracle.io.dumpIncludeTables')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-model="includeViews"
              variant="chip"
              :label="t('modules.oracle.io.dumpIncludeViews')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="isSchemaScope || ctx?.dumpScope === 'procedures' || ctx?.dumpScope === 'tables'"
              v-model="includeProcedures"
              variant="chip"
              :label="t('modules.oracle.io.dumpIncludeProcedures')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="isSchemaScope || ctx?.dumpScope === 'functions'"
              v-model="includeFunctions"
              variant="chip"
              :label="t('modules.oracle.io.dumpIncludeFunctions')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="isSchemaScope || ctx?.dumpScope === 'packages'"
              v-model="includePackages"
              variant="chip"
              :label="t('modules.oracle.io.dumpIncludePackages')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="isSchemaScope || ctx?.dumpScope === 'sequences'"
              v-model="includeSequences"
              variant="chip"
              :label="t('modules.oracle.io.dumpIncludeSequences')"
              :disabled="busy || objectFiltersLocked"
            />
          </div>
        </DataTransferSection>

        <DataTransferSection :title="t('modules.oracle.io.sectionOptions')">
          <div class="nm-oracle-sf__options">
            <DataTransferCheck
              v-model="dropIfExists"
              :label="t('modules.oracle.io.dumpDropIfExists')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-if="mode !== 'structure_only'"
              v-model="truncateBeforeData"
              :label="t('modules.oracle.io.dumpTruncate')"
              :disabled="busy"
            />
          </div>
        </DataTransferSection>

        <DataTransferSection v-if="canPickObjects" :title="t('modules.oracle.io.dumpObjectList')">
          <template #head>
            <label class="nm-oracle-sf__select-all">
              <input
                type="checkbox"
                :checked="allObjectsSelected"
                :disabled="busy || objectsLoading || objectRows.length === 0"
                @change="toggleSelectAll(($event.target as HTMLInputElement).checked)"
              />
              {{ t('modules.oracle.io.selectAllObjects') }}
            </label>
          </template>
          <p v-if="objectsLoading" class="nm-oracle-sf__status">
            {{ t('modules.oracle.io.objectsLoading') }}
          </p>
          <p v-else-if="objectsError" class="nm-oracle-sf__status nm-oracle-sf__status--error">
            {{ objectsError }}
          </p>
          <p
            v-else-if="objectsTruncated"
            class="nm-oracle-sf__status nm-oracle-sf__status--error"
          >
            {{ t('modules.oracle.io.objectsTruncated') }}
          </p>
          <ul v-else class="nm-oracle-sf__objects">
            <li v-for="row in objectRows" :key="row.name" class="nm-oracle-sf__object-item">
              <label class="nm-oracle-sf__object">
                <input
                  type="checkbox"
                  :checked="selectedTables.includes(row.name)"
                  :disabled="busy"
                  @change="
                    toggleObject(row.name, ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="nm-oracle-sf__object-name">{{ row.name }}</span>
                <span class="nm-oracle-sf__object-type">{{ row.type }}</span>
              </label>
            </li>
            <li v-if="objectRows.length === 0" class="nm-oracle-sf__object-item">
              <p class="nm-oracle-sf__status">{{ t('modules.oracle.io.objectsEmpty') }}</p>
            </li>
          </ul>
        </DataTransferSection>
      </template>

      <DataTransferSection v-else :title="t('modules.oracle.io.sectionOptions')">
        <div class="nm-oracle-sf__scope nm-oracle-sf__scope--mb">{{ scopeLabel }}</div>
        <DataTransferCheck
          v-model="continueOnError"
          :label="t('modules.oracle.io.execContinueOnError')"
          :hint="t('modules.oracle.io.execContinueOnErrorHint')"
          :disabled="busy"
        />
      </DataTransferSection>

      <template #note>
        {{ isDump ? t('modules.oracle.io.dumpHint') : t('modules.oracle.io.execHint') }}
      </template>
    </DataTransferPanel>
  </DataTransferShell>
</template>

<style scoped>
.nm-oracle-sf__row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 12px;
}

@media (max-width: 640px) {
  .nm-oracle-sf__row {
    grid-template-columns: 1fr;
  }
}

.nm-oracle-sf__scope {
  font-size: var(--rs-font-size-sm, 13px);
  line-height: 1.35;
  word-break: break-all;
}

.nm-oracle-sf__scope--mb {
  margin-bottom: 8px;
  color: var(--rs-muted);
}

.nm-oracle-sf__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.nm-oracle-sf__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 14px;
}

@media (max-width: 520px) {
  .nm-oracle-sf__options {
    grid-template-columns: 1fr;
  }
}

.nm-oracle-sf__select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-oracle-sf__status {
  margin: 0;
  font-size: 12px;
  color: var(--rs-muted);
}

.nm-oracle-sf__status--error {
  color: var(--rs-danger, #dc2626);
}

.nm-oracle-sf__objects {
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

.nm-oracle-sf__object-item {
  margin: 0;
  padding: 0;
}

.nm-oracle-sf__object {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.nm-oracle-sf__object:hover {
  background: var(--rs-item-hover);
}

.nm-oracle-sf__object-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-oracle-sf__object-type {
  flex: 0 0 auto;
  color: var(--rs-muted);
  font-size: 11px;
}
</style>
