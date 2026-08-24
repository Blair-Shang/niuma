<script setup lang="ts">
import { RsSelect, useRsToast, type RsSelectOptions } from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi, fsApi, postgresApi } from '@/api'
import type { PostgresIoDumpMode, PostgresTableInfo } from '@/api/types/postgres'
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
import { usePostgresIoTasks } from '@/modules/postgres/composables/usePostgresIoTasks'
import { readPostgresIoContext } from '@/modules/postgres/data-tasks'

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
const { track, waitForTask, lines, clearLines, activeTaskId } = usePostgresIoTasks()

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

const ctx = computed(() => (task.value ? readPostgresIoContext(task.value.context) : null))
const isDump = computed(() => task.value?.kind === 'dump_sql')

const filePath = ref('')
const mode = ref<PostgresIoDumpMode>('structure_and_data')
const includeTables = ref(true)
const includeViews = ref(true)
const includeMatViews = ref(true)
const includeSequences = ref(true)
const includeFunctions = ref(true)
const includeProcedures = ref(true)
const includeTriggers = ref(true)
const dropIfExists = ref(false)
const createSchema = ref(true)
const truncateBeforeData = ref(false)
const excludeSystem = ref(true)
/** 执行 SQL：默认开启失败继续，便于导入含系统对象 DROP 的转储 */
const continueOnError = ref(true)
const selectedTables = ref<string[]>([])
const objectRows = ref<PostgresTableInfo[]>([])
const objectsLoading = ref(false)
const objectsError = ref('')

const modeOptions = computed<RsSelectOptions>(() => [
  { value: 'structure_and_data', label: t('modules.postgres.io.dumpModeBoth') },
  { value: 'structure_only', label: t('modules.postgres.io.dumpModeStructure') },
  { value: 'data_only', label: t('modules.postgres.io.dumpModeData') },
])

const fixedTable = computed(() => !!ctx.value?.table)
/** 单表/单视图转储：范围已固定，不展示对象类型勾选，也不带同 Schema 其它对象 */
const showObjectTypes = computed(() => isDump.value && !fixedTable.value)
const canPickObjects = computed(
  () => isDump.value && !!ctx.value?.schema && !fixedTable.value,
)
const showExcludeSystem = computed(() => isDump.value && !ctx.value?.schema)

const scopeLabel = computed(() => {
  const scope = ctx.value
  if (!scope?.database) return '—'
  if (scope.table && scope.schema) return `${scope.database} / ${scope.schema}.${scope.table}`
  if (scope.schema) return `${scope.database} / ${scope.schema}`
  return scope.database
})

const dumpHintText = computed(() =>
  fixedTable.value
    ? t('modules.postgres.io.dumpHintSingle')
    : t('modules.postgres.io.dumpHint'),
)

const includeData = computed(
  () => mode.value === 'structure_and_data' || mode.value === 'data_only',
)
const includeStructure = computed(
  () => mode.value === 'structure_and_data' || mode.value === 'structure_only',
)

const allObjectsSelected = computed(() => {
  if (objectRows.value.length === 0) return false
  return objectRows.value.every((row) => selectedTables.value.includes(row.name))
})

const canConfirm = computed(() => {
  if (!task.value || !ctx.value?.database || !filePath.value.trim() || busy.value) return false
  if (!isDump.value) return true
  if (fixedTable.value) return true
  if (
    !includeTables.value &&
    !includeViews.value &&
    !includeMatViews.value &&
    !includeSequences.value &&
    !includeFunctions.value &&
    !includeProcedures.value &&
    !includeTriggers.value
  ) {
    return false
  }
  if (canPickObjects.value && objectRows.value.length > 0 && selectedTables.value.length === 0) {
    return false
  }
  return true
})

/** 单对象转储：只导出该关系（及落在其上的触发器），不泄漏序列/函数/过程。 */
function resolveDumpIncludes(): {
  includeTables: boolean
  includeViews: boolean
  includeMatViews: boolean
  includeSequences: boolean
  includeFunctions: boolean
  includeProcedures: boolean
  includeTriggers: boolean
} {
  if (!fixedTable.value) {
    return {
      includeTables: includeTables.value,
      includeViews: includeViews.value,
      includeMatViews: includeMatViews.value,
      includeSequences: includeSequences.value,
      includeFunctions: includeFunctions.value,
      includeProcedures: includeProcedures.value,
      includeTriggers: includeTriggers.value,
    }
  }
  const category = ctx.value?.category
  const reltype = ctx.value?.reltype
  const isMatView = reltype === 'materialized_view'
  const isOrdinaryView = category === 'views' || reltype === 'view'
  // 未知子类型时放开三种关系，按名称命中；不带序列/例程
  if (!category && !reltype) {
    return {
      includeTables: true,
      includeViews: true,
      includeMatViews: true,
      includeSequences: false,
      includeFunctions: false,
      includeProcedures: false,
      includeTriggers: true,
    }
  }
  return {
    includeTables: !isOrdinaryView && !isMatView,
    includeViews: isOrdinaryView && !isMatView,
    includeMatViews: isMatView,
    includeSequences: false,
    includeFunctions: false,
    includeProcedures: false,
    includeTriggers: true,
  }
}

function isOrdinaryViewDump(): boolean {
  const scope = ctx.value
  if (!scope?.table) return false
  if (scope.reltype === 'materialized_view' || scope.reltype === 'foreign_table') return false
  return scope.category === 'views' || scope.reltype === 'view'
}

const windowTitle = computed(() => task.value?.title ?? t('modules.postgres.io.dumpTitle'))

const shellLabels = computed(
  (): DataTransferShellLabels => ({
    dockToBottom: t('modules.postgres.io.dockToBottom'),
    popOut: t('modules.postgres.io.popOut'),
    cancelTask: t('modules.postgres.io.cancelTask'),
    close: t('common.close'),
    confirm: isDump.value ? t('modules.postgres.io.dump') : t('modules.postgres.io.execFile'),
  }),
)

const panelLabels = computed(
  (): DataTransferPanelLabels => ({
    progressLog: t('modules.postgres.io.progressLog'),
    progressEmpty: t('modules.postgres.io.progressEmpty'),
    running: t('modules.postgres.io.running'),
  }),
)

const fileLabels = computed(
  (): DataTransferFileFieldLabels => ({
    filePath: t('modules.postgres.io.filePath'),
    browse: t('modules.postgres.io.browse'),
  }),
)

function resetDumpOptions(): void {
  // 普通视图默认仅结构（COPY 不能直接作用于普通视图）
  mode.value = isOrdinaryViewDump() ? 'structure_only' : 'structure_and_data'
  includeTables.value = true
  includeViews.value = true
  includeMatViews.value = true
  includeSequences.value = true
  includeFunctions.value = true
  includeProcedures.value = true
  includeTriggers.value = true
  dropIfExists.value = false
  createSchema.value = true
  truncateBeforeData.value = false
  excludeSystem.value = true
  continueOnError.value = true
  selectedTables.value = []
  objectRows.value = []
  objectsError.value = ''
}

async function loadDumpObjects(): Promise<void> {
  const scope = ctx.value
  if (!isDump.value || !scope?.database || !scope.schema || fixedTable.value) {
    objectRows.value = []
    selectedTables.value = scope?.table ? [scope.table] : []
    return
  }
  objectsLoading.value = true
  objectsError.value = ''
  try {
    const types: string[] = []
    if (includeTables.value) types.push('table')
    if (includeViews.value) types.push('view')
    if (includeMatViews.value) types.push('materialized_view')
    if (types.length === 0) {
      objectRows.value = []
      selectedTables.value = []
      return
    }
    const result = await postgresApi.treeTables({
      profileId: scope.profileId,
      sessionId: scope.sessionId || undefined,
      database: scope.database,
      schema: scope.schema,
      types,
      excludeSystem: true,
      limit: 2000,
    })
    objectRows.value = result.tables ?? []
    selectedTables.value = objectRows.value.map((row) => row.name)
  } catch (e) {
    objectRows.value = []
    selectedTables.value = []
    objectsError.value = e instanceof Error ? e.message : t('modules.postgres.io.objectsLoadError')
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
  selectedTables.value = selectedTables.value.filter((item) => item !== name)
}

watch(
  () => props.taskId,
  () => {
    filePath.value = ''
    resetDumpOptions()
    clearLines()
    void loadDumpObjects()
  },
  { immediate: true },
)

watch(
  () =>
    [
      isDump.value,
      ctx.value?.database,
      ctx.value?.schema,
      ctx.value?.table,
      includeTables.value,
      includeViews.value,
      includeMatViews.value,
    ] as const,
  () => {
    if (isDump.value) void loadDumpObjects()
  },
)

async function pickPath(): Promise<void> {
  const current = task.value
  const scope = ctx.value
  if (!current || !scope) return
  try {
    if (current.kind === 'dump_sql') {
      const defaultName =
        scope.schema && scope.table
          ? `${scope.schema}_${scope.table}.sql`
          : `${scope.database ?? 'dump'}.sql`
      const result = await dialogApi.saveFile({
        title: t('modules.postgres.io.browseDumpTitle'),
        defaultPath: defaultName,
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
      }
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.postgres.io.browseExecTitle'),
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.postgres.io.browseError'))
  }
}

function resolveDumpTables(): string[] | undefined {
  const scope = ctx.value
  if (!scope) return undefined
  if (scope.table) return [scope.table]
  if (canPickObjects.value) {
    if (objectRows.value.length === 0) return undefined
    if (selectedTables.value.length === objectRows.value.length) return undefined
    return [...selectedTables.value]
  }
  return undefined
}

async function onConfirm(): Promise<void> {
  const current = task.value
  const scope = ctx.value
  if (!current || !scope?.database || !canConfirm.value) return
  hub.setBusy(props.taskId, true)
  clearLines()
  track()
  try {
    const base = {
      profileId: scope.profileId,
      sessionId: scope.sessionId || undefined,
      database: scope.database,
    }
    const includes = resolveDumpIncludes()
    const result = isDump.value
      ? await postgresApi.ioDumpSql({
          ...base,
          schema: scope.schema,
          tables: resolveDumpTables(),
          mode: mode.value,
          outputPath: filePath.value,
          ...includes,
          dropIfExists: dropIfExists.value,
          truncateBeforeData: truncateBeforeData.value,
          createSchema: createSchema.value,
          excludeSystem: excludeSystem.value,
        })
      : await postgresApi.ioExecSqlFile({
          ...base,
          inputPath: filePath.value,
          continueOnError: continueOnError.value,
        })
    const done = await waitForTask(result.taskId)
    if (!done.ok) {
      const partial =
        !isDump.value &&
        typeof done.message === 'string' &&
        done.message.includes('completed with')
      if (partial) {
        toast.warning(done.message || t('modules.postgres.io.execPartialDone'))
      } else {
        toast.error(done.message || t('modules.postgres.io.failed'))
      }
      return
    }
    toast.success(
      isDump.value ? t('modules.postgres.io.dumpDone') : t('modules.postgres.io.execDone'),
    )
    if (done.outputPath && isDump.value) {
      try {
        await fsApi.showInFolder({ path: done.outputPath })
      } catch {
        // ignore
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.postgres.io.failed'))
  } finally {
    hub.setBusy(props.taskId, false)
  }
}

async function onCancelTask(): Promise<void> {
  const backendTaskId = activeTaskId.value
  const scope = ctx.value
  if (!backendTaskId || !scope) return
  try {
    await postgresApi.ioCancel({
      profileId: scope.profileId,
      sessionId: scope.sessionId || undefined,
      taskId: backendTaskId,
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.postgres.io.failed'))
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
      <DataTransferSection :title="t('modules.postgres.io.sectionFile')">
        <DataTransferFileField
          v-model="filePath"
          :labels="fileLabels"
          :disabled="busy"
          required
          @browse="pickPath"
        />
      </DataTransferSection>

      <template v-if="isDump">
        <div class="nm-postgres-sf__row">
          <DataTransferSection :title="t('modules.postgres.io.dumpScope')">
            <div class="nm-postgres-sf__scope" :title="scopeLabel">{{ scopeLabel }}</div>
          </DataTransferSection>
          <DataTransferSection :title="t('modules.postgres.io.dumpMode')">
            <RsSelect v-model="mode" :options="modeOptions" :disabled="busy" />
          </DataTransferSection>
        </div>

        <DataTransferSection
          v-if="showObjectTypes"
          :title="t('modules.postgres.io.dumpObjects')"
        >
          <div class="nm-postgres-sf__chips">
            <DataTransferCheck
              v-model="includeTables"
              variant="chip"
              :label="t('modules.postgres.io.includeTables')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="includeViews"
              variant="chip"
              :label="t('modules.postgres.io.includeViews')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="includeMatViews"
              variant="chip"
              :label="t('modules.postgres.io.includeMatViews')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="includeSequences"
              variant="chip"
              :label="t('modules.postgres.io.includeSequences')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="includeFunctions"
              variant="chip"
              :label="t('modules.postgres.io.includeFunctions')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="includeProcedures"
              variant="chip"
              :label="t('modules.postgres.io.includeProcedures')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="includeTriggers"
              variant="chip"
              :label="t('modules.postgres.io.includeTriggers')"
              :disabled="busy"
            />
          </div>
        </DataTransferSection>

        <DataTransferSection :title="t('modules.postgres.io.dumpOptions')">
          <div class="nm-postgres-sf__options">
            <DataTransferCheck
              v-if="includeStructure"
              v-model="createSchema"
              :label="t('modules.postgres.io.createSchema')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-if="includeStructure"
              v-model="dropIfExists"
              :label="t('modules.postgres.io.dropIfExists')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-if="includeData"
              v-model="truncateBeforeData"
              :label="t('modules.postgres.io.truncateBeforeData')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-if="showExcludeSystem"
              v-model="excludeSystem"
              :label="t('modules.postgres.io.excludeSystem')"
              :disabled="busy"
            />
          </div>
        </DataTransferSection>

        <DataTransferSection v-if="canPickObjects" :title="t('modules.postgres.io.dumpObjectList')">
          <template #head>
            <label class="nm-postgres-sf__select-all">
              <input
                type="checkbox"
                :checked="allObjectsSelected"
                :disabled="busy || objectsLoading || objectRows.length === 0"
                @change="toggleSelectAll(($event.target as HTMLInputElement).checked)"
              />
              {{ t('modules.postgres.io.selectAllObjects') }}
            </label>
          </template>
          <p v-if="objectsLoading" class="nm-postgres-sf__status">
            {{ t('modules.postgres.io.objectsLoading') }}
          </p>
          <p v-else-if="objectsError" class="nm-postgres-sf__status nm-postgres-sf__status--error">
            {{ objectsError }}
          </p>
          <ul v-else class="nm-postgres-sf__objects">
            <li v-for="row in objectRows" :key="row.name" class="nm-postgres-sf__object-item">
              <label class="nm-postgres-sf__object">
                <input
                  type="checkbox"
                  :checked="selectedTables.includes(row.name)"
                  :disabled="busy"
                  @change="
                    toggleObject(row.name, ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="nm-postgres-sf__object-name">{{ row.name }}</span>
                <span class="nm-postgres-sf__object-type">{{ row.type }}</span>
              </label>
            </li>
            <li v-if="objectRows.length === 0" class="nm-postgres-sf__object-item">
              <p class="nm-postgres-sf__status">{{ t('modules.postgres.io.objectsEmpty') }}</p>
            </li>
          </ul>
        </DataTransferSection>
      </template>

      <DataTransferSection v-else :title="t('modules.postgres.io.execOptions')">
        <div class="nm-postgres-sf__scope nm-postgres-sf__scope--mb">{{ scopeLabel }}</div>
        <DataTransferCheck
          v-model="continueOnError"
          :label="t('modules.postgres.io.continueOnError')"
          :hint="t('modules.postgres.io.continueOnErrorHint')"
          :disabled="busy"
        />
      </DataTransferSection>

      <template #note>
        {{ isDump ? dumpHintText : t('modules.postgres.io.execHint') }}
      </template>
    </DataTransferPanel>
  </DataTransferShell>
</template>

<style scoped>
.nm-postgres-sf__row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 12px;
}

@media (max-width: 640px) {
  .nm-postgres-sf__row {
    grid-template-columns: 1fr;
  }
}

.nm-postgres-sf__scope {
  font-size: var(--rs-font-size-sm, 13px);
  line-height: 1.35;
  word-break: break-all;
}

.nm-postgres-sf__scope--mb {
  margin-bottom: 8px;
  color: var(--rs-muted);
}

.nm-postgres-sf__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.nm-postgres-sf__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 14px;
}

@media (max-width: 520px) {
  .nm-postgres-sf__options {
    grid-template-columns: 1fr;
  }
}

.nm-postgres-sf__select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-postgres-sf__status {
  margin: 0;
  font-size: 12px;
  color: var(--rs-muted);
}

.nm-postgres-sf__status--error {
  color: var(--rs-danger, #dc2626);
}

.nm-postgres-sf__objects {
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

.nm-postgres-sf__object-item {
  margin: 0;
  padding: 0;
}

.nm-postgres-sf__object {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.nm-postgres-sf__object:hover {
  background: var(--rs-item-hover);
}

.nm-postgres-sf__object-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-postgres-sf__object-type {
  flex: 0 0 auto;
  color: var(--rs-muted);
  font-size: 11px;
}
</style>
