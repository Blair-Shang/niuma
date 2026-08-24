<script setup lang="ts">
import { RsSelect, useRsToast, type RsSelectOptions } from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi, fsApi } from '@/api'
import { sqlserverApi } from '@/api/sqlserver'
import type { SqlServerIoDumpMode, SqlServerTableInfo } from '@/api/types/sqlserver'
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
import { excludeSystemSchemasEnabled } from '@/modules/sqlserver/conn-tree-shared'
import { useSqlServerIoTasks } from '@/modules/sqlserver/composables/useSqlServerIoTasks'
import { readSqlServerIoContext } from '@/modules/sqlserver/data-tasks'

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
const { track, waitForTask, lines, clearLines, activeTaskId } = useSqlServerIoTasks()

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

const ctx = computed(() => (task.value ? readSqlServerIoContext(task.value.context) : null))
const isDump = computed(() => task.value?.kind === 'dump_sql')
const schemaName = computed(() => ctx.value?.schema?.trim() || 'dbo')
const databaseName = computed(() => ctx.value?.database?.trim() || '')
const includeStructure = computed(
  () => mode.value === 'structure_and_data' || mode.value === 'structure_only',
)
const includeData = computed(
  () => mode.value === 'structure_and_data' || mode.value === 'data_only',
)

const SINGLE_OBJECT_SCOPES = new Set([
  'table',
  'view',
  'procedure',
  'function',
  'synonym',
  'sequence',
])
const CATEGORY_SCOPES = new Set([
  'tables',
  'views',
  'functions',
  'procedures',
  'synonyms',
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
const isDatabaseScope = computed(() => ctx.value?.dumpScope === 'database')
const isSchemaScope = computed(
  () =>
    isDump.value &&
    !isSingleObjectScope.value &&
    !isCategoryScope.value &&
    !isDatabaseScope.value,
)
const objectFiltersLocked = computed(() => isSingleObjectScope.value || isCategoryScope.value)
const showAllTypeChips = computed(() => isSchemaScope.value || isDatabaseScope.value)

const filePath = ref('')
const mode = ref<SqlServerIoDumpMode>('structure_and_data')
const includeTables = ref(true)
const includeViews = ref(true)
const includeProcedures = ref(true)
const includeFunctions = ref(true)
const includeSynonyms = ref(true)
const includeSequences = ref(true)
const dropIfExists = ref(true)
const truncateBeforeData = ref(false)
const createSchema = ref(true)
const excludeSystem = ref(true)
const continueOnError = ref(true)

const objectRows = ref<SqlServerTableInfo[]>([])
const selectedTables = ref<string[]>([])
const objectsLoading = ref(false)
const objectsError = ref('')

const modeOptions = computed<RsSelectOptions>(() => [
  { value: 'structure_and_data', label: t('modules.sqlserver.io.dumpModeBoth') },
  { value: 'structure_only', label: t('modules.sqlserver.io.dumpModeStructure') },
  { value: 'data_only', label: t('modules.sqlserver.io.dumpModeData') },
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
  if (!task.value || !filePath.value.trim() || busy.value || !databaseName.value) return false
  if (
    isDump.value &&
    !isSingleObjectScope.value &&
    !includeTables.value &&
    !includeViews.value &&
    !includeProcedures.value &&
    !includeFunctions.value &&
    !includeSynonyms.value &&
    !includeSequences.value
  ) {
    return false
  }
  if (isDump.value && canPickObjects.value && objectRows.value.length > 0) {
    return selectedTables.value.length > 0
  }
  return true
})

const windowTitle = computed(() => task.value?.title ?? t('modules.sqlserver.io.dumpTitle'))

const scopeLabel = computed(() => {
  const scope = ctx.value
  const schema = schemaName.value
  if (scope?.dumpScope === 'database') {
    return t('modules.sqlserver.io.dumpScopeDatabase', { name: databaseName.value })
  }
  if (scope?.table) return [databaseName.value, schema, scope.table].filter(Boolean).join('.')
  const keyByScope: Record<string, string> = {
    tables: 'modules.sqlserver.io.dumpScopeTables',
    views: 'modules.sqlserver.io.dumpScopeViews',
    functions: 'modules.sqlserver.io.dumpScopeFunctions',
    procedures: 'modules.sqlserver.io.dumpScopeProcedures',
    synonyms: 'modules.sqlserver.io.dumpScopeSynonyms',
    sequences: 'modules.sqlserver.io.dumpScopeSequences',
  }
  const key = scope?.dumpScope ? keyByScope[scope.dumpScope] : undefined
  if (key) return t(key, { name: schema })
  return schema
})

const dumpHintText = computed(() =>
  isDatabaseScope.value ? t('modules.sqlserver.io.dumpHintDatabase') : t('modules.sqlserver.io.dumpHint'),
)

const shellLabels = computed(
  (): DataTransferShellLabels => ({
    dockToBottom: t('modules.sqlserver.io.dockToBottom'),
    popOut: t('modules.sqlserver.io.popOut'),
    cancelTask: t('modules.sqlserver.io.cancelTask'),
    close: t('common.close'),
    confirm: isDump.value ? t('modules.sqlserver.io.dump') : t('modules.sqlserver.io.execSql'),
  }),
)

const panelLabels = computed(
  (): DataTransferPanelLabels => ({
    progressLog: t('modules.sqlserver.io.progressLog'),
    progressEmpty: t('modules.sqlserver.io.progressEmpty'),
    running: t('modules.sqlserver.io.running'),
  }),
)

const fileLabels = computed(
  (): DataTransferFileFieldLabels => ({
    filePath: t('modules.sqlserver.io.filePath'),
    browse: t('modules.sqlserver.io.browse'),
  }),
)

function resetIncludes(opts: {
  tables?: boolean
  views?: boolean
  procedures?: boolean
  functions?: boolean
  synonyms?: boolean
  sequences?: boolean
}): void {
  includeTables.value = !!opts.tables
  includeViews.value = !!opts.views
  includeProcedures.value = !!opts.procedures
  includeFunctions.value = !!opts.functions
  includeSynonyms.value = !!opts.synonyms
  includeSequences.value = !!opts.sequences
}

function applyDumpScopeDefaults(): void {
  const scope = ctx.value?.dumpScope
  if (scope === 'tables') {
    resetIncludes({ tables: true })
    mode.value = 'structure_and_data'
    return
  }
  if (scope === 'views') {
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
  if (scope === 'synonyms' || scope === 'synonym') {
    resetIncludes({ synonyms: true })
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
  if (scope === 'view' || ctx.value?.table) {
    // 兼容旧上下文：有 table 但无明确 scope 时，表+视图均可匹配
    if (scope === 'view') {
      resetIncludes({ views: true })
      mode.value = 'structure_only'
      return
    }
    resetIncludes({ tables: true, views: true })
    return
  }
  resetIncludes({
    tables: true,
    views: true,
    procedures: true,
    functions: true,
    synonyms: true,
    sequences: true,
  })
}

async function loadObjectRows(): Promise<void> {
  const scope = ctx.value
  if (!canPickObjects.value) {
    objectRows.value = []
    selectedTables.value = []
    objectsError.value = ''
    return
  }
  objectsLoading.value = true
  objectsError.value = ''
  try {
    const types: string[] = []
    if (includeTables.value) types.push('table')
    if (includeViews.value) types.push('view')
    const result = await sqlserverApi.treeTables({
      sessionId: scope?.sessionId || undefined,
      profileId: scope?.profileId,
      database: databaseName.value,
      schema: schemaName.value,
      types,
      limit: 2000,
    })
    objectRows.value = result.tables ?? []
    selectedTables.value = objectRows.value.map((row) => row.name)
  } catch (e) {
    objectsError.value = e instanceof Error ? e.message : t('modules.sqlserver.io.objectsLoadError')
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
  dropIfExists.value = true
  truncateBeforeData.value = false
  createSchema.value = true
  excludeSystem.value = ctx.value?.conn ? excludeSystemSchemasEnabled(ctx.value.conn) : true
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
  const schema = schemaName.value
  if (!scope) return 'dump.sql'
  if (scope.dumpScope === 'database') return `${databaseName.value || 'database'}.sql`
  if (scope.table) return `${schema}.${scope.table}.sql`
  const suffixByScope: Record<string, string> = {
    tables: 'tables',
    views: 'views',
    functions: 'functions',
    procedures: 'procedures',
    synonyms: 'synonyms',
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
        title: t('modules.sqlserver.io.browseDumpTitle'),
        defaultPath: dumpDefaultFileName(),
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.sqlserver.io.browseExecTitle'),
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.sqlserver.io.browseError'))
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
      ? await sqlserverApi.ioDumpSql({
          profileId: scope.profileId,
          sessionId,
          dump: {
            database: databaseName.value,
            schema: isDatabaseScope.value ? '' : schemaName.value,
            tables,
            mode: mode.value,
            outputPath: filePath.value,
            dropIfExists: dropIfExists.value,
            truncateBeforeData: truncateBeforeData.value,
            includeTables: includeTables.value,
            includeViews: includeViews.value,
            includeProcedures: includeProcedures.value,
            includeFunctions: includeFunctions.value,
            includeSynonyms: includeSynonyms.value,
            includeSequences: includeSequences.value,
            createSchema: createSchema.value,
            excludeSystem: excludeSystem.value,
          },
        })
      : await sqlserverApi.ioExecSqlFile({
          profileId: scope.profileId,
          sessionId,
          database: databaseName.value,
          inputPath: filePath.value,
          execOptions: { continueOnError: continueOnError.value },
        })
    const done = await waitForTask(result.taskId)
    if (!done.ok) {
      toast.error(done.message || t('modules.sqlserver.io.failed'))
      return
    }
    toast.success(isDump.value ? t('modules.sqlserver.io.dumpDone') : t('modules.sqlserver.io.execDone'))
    if (isDump.value) {
      const revealPath = (filePath.value || done.outputPath || '').trim()
      if (revealPath) {
        try {
          await fsApi.showInFolder({ path: revealPath })
        } catch {
          /* ignore */
        }
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.sqlserver.io.failed'))
  } finally {
    hub.setBusy(props.taskId, false)
  }
}

async function onCancelTask(): Promise<void> {
  const backendTaskId = activeTaskId.value
  const scope = ctx.value
  if (!backendTaskId || !scope) return
  try {
    await sqlserverApi.ioCancel({
      profileId: scope.profileId,
      sessionId: scope.sessionId || undefined,
      taskId: backendTaskId,
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.sqlserver.io.failed'))
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
      <DataTransferSection :title="t('modules.sqlserver.io.sectionFile')">
        <DataTransferFileField
          v-model="filePath"
          :labels="fileLabels"
          :disabled="busy"
          required
          @browse="pickPath"
        />
      </DataTransferSection>

      <template v-if="isDump">
        <div class="nm-sqlserver-sf__row">
          <DataTransferSection :title="t('modules.sqlserver.io.sectionTarget')">
            <div class="nm-sqlserver-sf__scope" :title="scopeLabel">{{ scopeLabel }}</div>
          </DataTransferSection>
          <DataTransferSection :title="t('modules.sqlserver.io.dumpMode')">
            <RsSelect v-model="mode" :options="modeOptions" :disabled="busy" />
          </DataTransferSection>
        </div>

        <DataTransferSection
          v-if="!isSingleObjectScope"
          :title="t('modules.sqlserver.io.sectionObjects')"
        >
          <div class="nm-sqlserver-sf__chips">
            <DataTransferCheck
              v-model="includeTables"
              variant="chip"
              :label="t('modules.sqlserver.io.dumpIncludeTables')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-model="includeViews"
              variant="chip"
              :label="t('modules.sqlserver.io.dumpIncludeViews')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="showAllTypeChips || ctx?.dumpScope === 'procedures'"
              v-model="includeProcedures"
              variant="chip"
              :label="t('modules.sqlserver.io.dumpIncludeProcedures')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="showAllTypeChips || ctx?.dumpScope === 'functions'"
              v-model="includeFunctions"
              variant="chip"
              :label="t('modules.sqlserver.io.dumpIncludeFunctions')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="showAllTypeChips || ctx?.dumpScope === 'synonyms'"
              v-model="includeSynonyms"
              variant="chip"
              :label="t('modules.sqlserver.io.dumpIncludeSynonyms')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="showAllTypeChips || ctx?.dumpScope === 'sequences'"
              v-model="includeSequences"
              variant="chip"
              :label="t('modules.sqlserver.io.dumpIncludeSequences')"
              :disabled="busy || objectFiltersLocked"
            />
          </div>
        </DataTransferSection>

        <DataTransferSection :title="t('modules.sqlserver.io.sectionOptions')">
          <div class="nm-sqlserver-sf__options">
            <DataTransferCheck
              v-if="includeStructure"
              v-model="createSchema"
              :label="t('modules.sqlserver.io.dumpCreateSchema')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="dropIfExists"
              :label="t('modules.sqlserver.io.dumpDropIfExists')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-if="includeData"
              v-model="truncateBeforeData"
              :label="t('modules.sqlserver.io.dumpTruncate')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-if="isDatabaseScope"
              v-model="excludeSystem"
              :label="t('modules.sqlserver.io.dumpExcludeSystem')"
              :disabled="busy"
            />
          </div>
        </DataTransferSection>

        <DataTransferSection v-if="canPickObjects" :title="t('modules.sqlserver.io.dumpObjectList')">
          <template #head>
            <label class="nm-sqlserver-sf__select-all">
              <input
                type="checkbox"
                :checked="allObjectsSelected"
                :disabled="busy || objectsLoading || objectRows.length === 0"
                @change="toggleSelectAll(($event.target as HTMLInputElement).checked)"
              />
              {{ t('modules.sqlserver.io.selectAllObjects') }}
            </label>
          </template>
          <p v-if="objectsLoading" class="nm-sqlserver-sf__status">
            {{ t('modules.sqlserver.io.objectsLoading') }}
          </p>
          <p v-else-if="objectsError" class="nm-sqlserver-sf__status nm-sqlserver-sf__status--error">
            {{ objectsError }}
          </p>
          <ul v-else class="nm-sqlserver-sf__objects">
            <li v-for="row in objectRows" :key="row.name" class="nm-sqlserver-sf__object-item">
              <label class="nm-sqlserver-sf__object">
                <input
                  type="checkbox"
                  :checked="selectedTables.includes(row.name)"
                  :disabled="busy"
                  @change="
                    toggleObject(row.name, ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="nm-sqlserver-sf__object-name">{{ row.name }}</span>
                <span class="nm-sqlserver-sf__object-type">{{ row.type }}</span>
              </label>
            </li>
            <li v-if="objectRows.length === 0" class="nm-sqlserver-sf__object-item">
              <p class="nm-sqlserver-sf__status">{{ t('modules.sqlserver.io.objectsEmpty') }}</p>
            </li>
          </ul>
        </DataTransferSection>
      </template>

      <DataTransferSection v-else :title="t('modules.sqlserver.io.sectionOptions')">
        <div class="nm-sqlserver-sf__scope nm-sqlserver-sf__scope--mb">{{ scopeLabel }}</div>
        <DataTransferCheck
          v-model="continueOnError"
          :label="t('modules.sqlserver.io.execContinueOnError')"
          :hint="t('modules.sqlserver.io.execContinueOnErrorHint')"
          :disabled="busy"
        />
      </DataTransferSection>

      <template #note>
        {{ isDump ? dumpHintText : t('modules.sqlserver.io.execHint') }}
      </template>
    </DataTransferPanel>
  </DataTransferShell>
</template>

<style scoped>
.nm-sqlserver-sf__row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 12px;
}

@media (max-width: 640px) {
  .nm-sqlserver-sf__row {
    grid-template-columns: 1fr;
  }
}

.nm-sqlserver-sf__scope {
  font-size: var(--rs-font-size-sm, 13px);
  line-height: 1.35;
  word-break: break-all;
}

.nm-sqlserver-sf__scope--mb {
  margin-bottom: 8px;
  color: var(--rs-muted);
}

.nm-sqlserver-sf__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.nm-sqlserver-sf__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 14px;
}

@media (max-width: 520px) {
  .nm-sqlserver-sf__options {
    grid-template-columns: 1fr;
  }
}

.nm-sqlserver-sf__select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-sqlserver-sf__status {
  margin: 0;
  font-size: 12px;
  color: var(--rs-muted);
}

.nm-sqlserver-sf__status--error {
  color: var(--rs-danger, #dc2626);
}

.nm-sqlserver-sf__objects {
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

.nm-sqlserver-sf__object-item {
  margin: 0;
  padding: 0;
}

.nm-sqlserver-sf__object {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.nm-sqlserver-sf__object:hover {
  background: var(--rs-item-hover);
}

.nm-sqlserver-sf__object-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-sqlserver-sf__object-type {
  flex: 0 0 auto;
  color: var(--rs-muted);
  font-size: 11px;
}
</style>
