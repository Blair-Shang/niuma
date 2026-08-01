<script setup lang="ts">
import { RsSelect, useRsToast, type RsSelectOptions } from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi, fsApi, sqliteApi } from '@/api'
import type { SqliteIoDumpMode, SqliteObjectInfo } from '@/api/types/sqlite'
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
const isDump = computed(() => task.value?.kind === 'dump_sql')
const schemaName = computed(() => ctx.value?.schema?.trim() || 'main')

const isSingleObjectScope = computed(
  () => !!ctx.value?.table || ctx.value?.dumpScope === 'table',
)
const isCategoryScope = computed(
  () =>
    ctx.value?.dumpScope === 'tables' ||
    ctx.value?.dumpScope === 'views' ||
    ctx.value?.dumpScope === 'indexes' ||
    ctx.value?.dumpScope === 'triggers',
)
const isSchemaScope = computed(
  () => isDump.value && !isSingleObjectScope.value && !isCategoryScope.value,
)
const objectFiltersLocked = computed(() => isSingleObjectScope.value || isCategoryScope.value)

const filePath = ref('')
const mode = ref<SqliteIoDumpMode>('structure_and_data')
const includeTables = ref(true)
const includeViews = ref(true)
const includeTriggers = ref(true)
const includeIndexes = ref(true)
const dropIfExists = ref(true)
const truncateBeforeData = ref(false)
const continueOnError = ref(true)

const objectRows = ref<SqliteObjectInfo[]>([])
const selectedTables = ref<string[]>([])
const objectsLoading = ref(false)
const objectsError = ref('')

const modeOptions = computed<RsSelectOptions>(() => [
  { value: 'structure_and_data', label: t('modules.sqlite.io.dumpModeBoth') },
  { value: 'structure_only', label: t('modules.sqlite.io.dumpModeStructure') },
  { value: 'data_only', label: t('modules.sqlite.io.dumpModeData') },
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
  if (isDump.value && canPickObjects.value && objectRows.value.length > 0) {
    return selectedTables.value.length > 0
  }
  return true
})

const windowTitle = computed(() => task.value?.title ?? t('modules.sqlite.io.dumpTitle'))

const scopeLabel = computed(() => {
  const scope = ctx.value
  const schema = schemaName.value
  if (scope?.table) return `${schema}.${scope.table}`
  if (scope?.dumpScope === 'tables') {
    return t('modules.sqlite.io.dumpScopeTables', { name: schema })
  }
  if (scope?.dumpScope === 'views') {
    return t('modules.sqlite.io.dumpScopeViews', { name: schema })
  }
  if (scope?.dumpScope === 'indexes') {
    return t('modules.sqlite.io.dumpScopeIndexes', { name: schema })
  }
  if (scope?.dumpScope === 'triggers') {
    return t('modules.sqlite.io.dumpScopeTriggers', { name: schema })
  }
  return schema
})

const shellLabels = computed(
  (): DataTransferShellLabels => ({
    dockToBottom: t('modules.sqlite.io.dockToBottom'),
    popOut: t('modules.sqlite.io.popOut'),
    cancelTask: t('modules.sqlite.io.cancelTask'),
    close: t('common.close'),
    confirm: isDump.value ? t('modules.sqlite.io.dump') : t('modules.sqlite.io.execSql'),
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

function applyDumpScopeDefaults(): void {
  const scope = ctx.value?.dumpScope
  if (scope === 'tables') {
    includeTables.value = true
    includeViews.value = false
    includeTriggers.value = true
    includeIndexes.value = false
    mode.value = 'structure_and_data'
    return
  }
  if (scope === 'views') {
    includeTables.value = false
    includeViews.value = true
    includeTriggers.value = false
    includeIndexes.value = false
    mode.value = 'structure_only'
    return
  }
  if (scope === 'indexes') {
    includeTables.value = false
    includeViews.value = false
    includeTriggers.value = false
    includeIndexes.value = true
    mode.value = 'structure_only'
    return
  }
  if (scope === 'triggers') {
    includeTables.value = false
    includeViews.value = false
    includeTriggers.value = true
    includeIndexes.value = false
    mode.value = 'structure_only'
    return
  }
  if (scope === 'table' || ctx.value?.table) {
    includeTables.value = true
    includeViews.value = true
    includeTriggers.value = true
    includeIndexes.value = false
    return
  }
  includeTables.value = true
  includeViews.value = true
  includeTriggers.value = true
  includeIndexes.value = true
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
    const load = async (sessionId: string) => {
      const result = await sqliteApi.treeTables({
        sessionId,
        schema: schemaName.value,
        types,
        limit: 2000,
      })
      objectRows.value = result.objects ?? result.tables ?? []
      selectedTables.value = objectRows.value.map((row) => row.name)
    }
    if (scope?.sessionId) {
      await load(scope.sessionId)
    } else if (scope?.profileId) {
      await withSqliteSession(scope.profileId, load)
    } else {
      throw new Error(t('modules.sqlite.io.objectsLoadError'))
    }
  } catch (e) {
    objectsError.value = e instanceof Error ? e.message : t('modules.sqlite.io.objectsLoadError')
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
  includeTriggers.value = true
  includeIndexes.value = true
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
  const schema = schemaName.value
  if (!scope) return 'dump.sql'
  if (scope.table) return `${schema}.${scope.table}.sql`
  if (scope.dumpScope === 'tables') return `${schema}-tables.sql`
  if (scope.dumpScope === 'views') return `${schema}-views.sql`
  if (scope.dumpScope === 'indexes') return `${schema}-indexes.sql`
  if (scope.dumpScope === 'triggers') return `${schema}-triggers.sql`
  return `${schema}.sql`
}

async function pickPath(): Promise<void> {
  const current = task.value
  const scope = ctx.value
  if (!current || !scope) return
  try {
    if (isDump.value) {
      const result = await dialogApi.saveFile({
        title: t('modules.sqlite.io.browseDumpTitle'),
        defaultPath: dumpDefaultFileName(),
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.sqlite.io.browseExecTitle'),
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.sqlite.io.browseError'))
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
      ? await sqliteApi.ioDumpSql({
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
            includeTriggers: includeTriggers.value,
            includeIndexes: includeIndexes.value,
          },
        })
      : await sqliteApi.ioExecSqlFile({
          profileId: scope.profileId,
          sessionId,
          schema: schemaName.value,
          inputPath: filePath.value,
          execOptions: { continueOnError: continueOnError.value },
        })
    const done = await waitForTask(result.taskId)
    if (!done.ok) {
      toast.error(done.message || t('modules.sqlite.io.failed'))
      return
    }
    toast.success(isDump.value ? t('modules.sqlite.io.dumpDone') : t('modules.sqlite.io.execDone'))
    if (done.outputPath && isDump.value) {
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
      <DataTransferSection :title="t('modules.sqlite.io.sectionFile')">
        <DataTransferFileField
          v-model="filePath"
          :labels="fileLabels"
          :disabled="busy"
          required
          @browse="pickPath"
        />
      </DataTransferSection>

      <template v-if="isDump">
        <div class="nm-sqlite-sf__row">
          <DataTransferSection :title="t('modules.sqlite.io.sectionTarget')">
            <div class="nm-sqlite-sf__scope" :title="scopeLabel">{{ scopeLabel }}</div>
          </DataTransferSection>
          <DataTransferSection :title="t('modules.sqlite.io.dumpMode')">
            <RsSelect v-model="mode" :options="modeOptions" :disabled="busy" />
          </DataTransferSection>
        </div>

        <DataTransferSection
          v-if="!isSingleObjectScope"
          :title="t('modules.sqlite.io.sectionObjects')"
        >
          <div class="nm-sqlite-sf__chips">
            <DataTransferCheck
              v-model="includeTables"
              variant="chip"
              :label="t('modules.sqlite.io.dumpIncludeTables')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-model="includeViews"
              variant="chip"
              :label="t('modules.sqlite.io.dumpIncludeViews')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="isSchemaScope || ctx?.dumpScope === 'triggers' || ctx?.dumpScope === 'tables'"
              v-model="includeTriggers"
              variant="chip"
              :label="t('modules.sqlite.io.dumpIncludeTriggers')"
              :disabled="busy || objectFiltersLocked"
            />
            <DataTransferCheck
              v-if="isSchemaScope || ctx?.dumpScope === 'indexes'"
              v-model="includeIndexes"
              variant="chip"
              :label="t('modules.sqlite.io.dumpIncludeIndexes')"
              :disabled="busy || objectFiltersLocked"
            />
          </div>
        </DataTransferSection>

        <DataTransferSection :title="t('modules.sqlite.io.sectionOptions')">
          <div class="nm-sqlite-sf__options">
            <DataTransferCheck
              v-model="dropIfExists"
              :label="t('modules.sqlite.io.dumpDropIfExists')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-if="mode !== 'structure_only'"
              v-model="truncateBeforeData"
              :label="t('modules.sqlite.io.dumpTruncate')"
              :disabled="busy"
            />
          </div>
        </DataTransferSection>

        <DataTransferSection v-if="canPickObjects" :title="t('modules.sqlite.io.dumpObjectList')">
          <template #head>
            <label class="nm-sqlite-sf__select-all">
              <input
                type="checkbox"
                :checked="allObjectsSelected"
                :disabled="busy || objectsLoading || objectRows.length === 0"
                @change="toggleSelectAll(($event.target as HTMLInputElement).checked)"
              />
              {{ t('modules.sqlite.io.selectAllObjects') }}
            </label>
          </template>
          <p v-if="objectsLoading" class="nm-sqlite-sf__status">
            {{ t('modules.sqlite.io.objectsLoading') }}
          </p>
          <p v-else-if="objectsError" class="nm-sqlite-sf__status nm-sqlite-sf__status--error">
            {{ objectsError }}
          </p>
          <ul v-else class="nm-sqlite-sf__objects">
            <li v-for="row in objectRows" :key="row.name" class="nm-sqlite-sf__object-item">
              <label class="nm-sqlite-sf__object">
                <input
                  type="checkbox"
                  :checked="selectedTables.includes(row.name)"
                  :disabled="busy"
                  @change="
                    toggleObject(row.name, ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="nm-sqlite-sf__object-name">{{ row.name }}</span>
                <span class="nm-sqlite-sf__object-type">{{ row.type }}</span>
              </label>
            </li>
            <li v-if="objectRows.length === 0" class="nm-sqlite-sf__object-item">
              <p class="nm-sqlite-sf__status">{{ t('modules.sqlite.io.objectsEmpty') }}</p>
            </li>
          </ul>
        </DataTransferSection>
      </template>

      <DataTransferSection v-else :title="t('modules.sqlite.io.sectionOptions')">
        <div class="nm-sqlite-sf__scope nm-sqlite-sf__scope--mb">{{ scopeLabel }}</div>
        <DataTransferCheck
          v-model="continueOnError"
          :label="t('modules.sqlite.io.execContinueOnError')"
          :hint="t('modules.sqlite.io.execContinueOnErrorHint')"
          :disabled="busy"
        />
      </DataTransferSection>

      <template #note>
        {{ isDump ? t('modules.sqlite.io.dumpHint') : t('modules.sqlite.io.execHint') }}
      </template>
    </DataTransferPanel>
  </DataTransferShell>
</template>

<style scoped>
.nm-sqlite-sf__row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 12px;
}

@media (max-width: 640px) {
  .nm-sqlite-sf__row {
    grid-template-columns: 1fr;
  }
}

.nm-sqlite-sf__scope {
  font-size: var(--rs-font-size-sm, 13px);
  line-height: 1.35;
  word-break: break-all;
}

.nm-sqlite-sf__scope--mb {
  margin-bottom: 8px;
  color: var(--rs-muted);
}

.nm-sqlite-sf__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.nm-sqlite-sf__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 14px;
}

@media (max-width: 520px) {
  .nm-sqlite-sf__options {
    grid-template-columns: 1fr;
  }
}

.nm-sqlite-sf__select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-sqlite-sf__status {
  margin: 0;
  font-size: 12px;
  color: var(--rs-muted);
}

.nm-sqlite-sf__status--error {
  color: var(--rs-danger, #dc2626);
}

.nm-sqlite-sf__objects {
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

.nm-sqlite-sf__object-item {
  margin: 0;
  padding: 0;
}

.nm-sqlite-sf__object {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.nm-sqlite-sf__object:hover {
  background: var(--rs-item-hover);
}

.nm-sqlite-sf__object-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-sqlite-sf__object-type {
  flex: 0 0 auto;
  color: var(--rs-muted);
  font-size: 11px;
}
</style>
