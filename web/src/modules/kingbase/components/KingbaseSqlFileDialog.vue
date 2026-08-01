<script setup lang="ts">
import { RsSelect, useRsToast, type RsSelectOptions } from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi, fsApi, kingbaseApi } from '@/api'
import type { KingbaseIoDumpMode, KingbaseTableInfo } from '@/api/types/kingbase'
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
import { useKingbaseIoTasks } from '@/modules/kingbase/composables/useKingbaseIoTasks'
import { readKingbaseIoContext } from '@/modules/kingbase/data-tasks'

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
const { track, waitForTask, lines, clearLines, activeTaskId } = useKingbaseIoTasks()

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

const ctx = computed(() => (task.value ? readKingbaseIoContext(task.value.context) : null))
const isDump = computed(() => task.value?.kind === 'dump_sql')

const filePath = ref('')
const mode = ref<KingbaseIoDumpMode>('structure_and_data')
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
const objectRows = ref<KingbaseTableInfo[]>([])
const objectsLoading = ref(false)
const objectsError = ref('')

const modeOptions = computed<RsSelectOptions>(() => [
  { value: 'structure_and_data', label: t('modules.kingbase.io.dumpModeBoth') },
  { value: 'structure_only', label: t('modules.kingbase.io.dumpModeStructure') },
  { value: 'data_only', label: t('modules.kingbase.io.dumpModeData') },
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
    ? t('modules.kingbase.io.dumpHintSingle')
    : t('modules.kingbase.io.dumpHint'),
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

const windowTitle = computed(() => task.value?.title ?? t('modules.kingbase.io.dumpTitle'))

const shellLabels = computed(
  (): DataTransferShellLabels => ({
    dockToBottom: t('modules.kingbase.io.dockToBottom'),
    popOut: t('modules.kingbase.io.popOut'),
    cancelTask: t('modules.kingbase.io.cancelTask'),
    close: t('common.close'),
    confirm: isDump.value ? t('modules.kingbase.io.dump') : t('modules.kingbase.io.execFile'),
  }),
)

const panelLabels = computed(
  (): DataTransferPanelLabels => ({
    progressLog: t('modules.kingbase.io.progressLog'),
    progressEmpty: t('modules.kingbase.io.progressEmpty'),
    running: t('modules.kingbase.io.running'),
  }),
)

const fileLabels = computed(
  (): DataTransferFileFieldLabels => ({
    filePath: t('modules.kingbase.io.filePath'),
    browse: t('modules.kingbase.io.browse'),
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
    const result = await kingbaseApi.treeTables({
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
    objectsError.value = e instanceof Error ? e.message : t('modules.kingbase.io.objectsLoadError')
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
        title: t('modules.kingbase.io.browseDumpTitle'),
        defaultPath: defaultName,
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
      }
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.kingbase.io.browseExecTitle'),
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.kingbase.io.browseError'))
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
      ? await kingbaseApi.ioDumpSql({
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
      : await kingbaseApi.ioExecSqlFile({
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
        toast.warning(done.message || t('modules.kingbase.io.execPartialDone'))
      } else {
        toast.error(done.message || t('modules.kingbase.io.failed'))
      }
      return
    }
    toast.success(
      isDump.value ? t('modules.kingbase.io.dumpDone') : t('modules.kingbase.io.execDone'),
    )
    if (done.outputPath && isDump.value) {
      try {
        await fsApi.showInFolder({ path: done.outputPath })
      } catch {
        // ignore
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.kingbase.io.failed'))
  } finally {
    hub.setBusy(props.taskId, false)
  }
}

async function onCancelTask(): Promise<void> {
  const backendTaskId = activeTaskId.value
  const scope = ctx.value
  if (!backendTaskId || !scope) return
  try {
    await kingbaseApi.ioCancel({
      profileId: scope.profileId,
      sessionId: scope.sessionId || undefined,
      taskId: backendTaskId,
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.kingbase.io.failed'))
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
      <DataTransferSection :title="t('modules.kingbase.io.sectionFile')">
        <DataTransferFileField
          v-model="filePath"
          :labels="fileLabels"
          :disabled="busy"
          required
          @browse="pickPath"
        />
      </DataTransferSection>

      <template v-if="isDump">
        <div class="nm-kingbase-sf__row">
          <DataTransferSection :title="t('modules.kingbase.io.dumpScope')">
            <div class="nm-kingbase-sf__scope" :title="scopeLabel">{{ scopeLabel }}</div>
          </DataTransferSection>
          <DataTransferSection :title="t('modules.kingbase.io.dumpMode')">
            <RsSelect v-model="mode" :options="modeOptions" :disabled="busy" />
          </DataTransferSection>
        </div>

        <DataTransferSection
          v-if="showObjectTypes"
          :title="t('modules.kingbase.io.dumpObjects')"
        >
          <div class="nm-kingbase-sf__chips">
            <DataTransferCheck
              v-model="includeTables"
              variant="chip"
              :label="t('modules.kingbase.io.includeTables')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="includeViews"
              variant="chip"
              :label="t('modules.kingbase.io.includeViews')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="includeMatViews"
              variant="chip"
              :label="t('modules.kingbase.io.includeMatViews')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="includeSequences"
              variant="chip"
              :label="t('modules.kingbase.io.includeSequences')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="includeFunctions"
              variant="chip"
              :label="t('modules.kingbase.io.includeFunctions')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="includeProcedures"
              variant="chip"
              :label="t('modules.kingbase.io.includeProcedures')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="includeTriggers"
              variant="chip"
              :label="t('modules.kingbase.io.includeTriggers')"
              :disabled="busy"
            />
          </div>
        </DataTransferSection>

        <DataTransferSection :title="t('modules.kingbase.io.dumpOptions')">
          <div class="nm-kingbase-sf__options">
            <DataTransferCheck
              v-if="includeStructure"
              v-model="createSchema"
              :label="t('modules.kingbase.io.createSchema')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-if="includeStructure"
              v-model="dropIfExists"
              :label="t('modules.kingbase.io.dropIfExists')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-if="includeData"
              v-model="truncateBeforeData"
              :label="t('modules.kingbase.io.truncateBeforeData')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-if="showExcludeSystem"
              v-model="excludeSystem"
              :label="t('modules.kingbase.io.excludeSystem')"
              :disabled="busy"
            />
          </div>
        </DataTransferSection>

        <DataTransferSection v-if="canPickObjects" :title="t('modules.kingbase.io.dumpObjectList')">
          <template #head>
            <label class="nm-kingbase-sf__select-all">
              <input
                type="checkbox"
                :checked="allObjectsSelected"
                :disabled="busy || objectsLoading || objectRows.length === 0"
                @change="toggleSelectAll(($event.target as HTMLInputElement).checked)"
              />
              {{ t('modules.kingbase.io.selectAllObjects') }}
            </label>
          </template>
          <p v-if="objectsLoading" class="nm-kingbase-sf__status">
            {{ t('modules.kingbase.io.objectsLoading') }}
          </p>
          <p v-else-if="objectsError" class="nm-kingbase-sf__status nm-kingbase-sf__status--error">
            {{ objectsError }}
          </p>
          <ul v-else class="nm-kingbase-sf__objects">
            <li v-for="row in objectRows" :key="row.name" class="nm-kingbase-sf__object-item">
              <label class="nm-kingbase-sf__object">
                <input
                  type="checkbox"
                  :checked="selectedTables.includes(row.name)"
                  :disabled="busy"
                  @change="
                    toggleObject(row.name, ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="nm-kingbase-sf__object-name">{{ row.name }}</span>
                <span class="nm-kingbase-sf__object-type">{{ row.type }}</span>
              </label>
            </li>
            <li v-if="objectRows.length === 0" class="nm-kingbase-sf__object-item">
              <p class="nm-kingbase-sf__status">{{ t('modules.kingbase.io.objectsEmpty') }}</p>
            </li>
          </ul>
        </DataTransferSection>
      </template>

      <DataTransferSection v-else :title="t('modules.kingbase.io.execOptions')">
        <div class="nm-kingbase-sf__scope nm-kingbase-sf__scope--mb">{{ scopeLabel }}</div>
        <DataTransferCheck
          v-model="continueOnError"
          :label="t('modules.kingbase.io.continueOnError')"
          :hint="t('modules.kingbase.io.continueOnErrorHint')"
          :disabled="busy"
        />
      </DataTransferSection>

      <template #note>
        {{ isDump ? dumpHintText : t('modules.kingbase.io.execHint') }}
      </template>
    </DataTransferPanel>
  </DataTransferShell>
</template>

<style scoped>
.nm-kingbase-sf__row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 12px;
}

@media (max-width: 640px) {
  .nm-kingbase-sf__row {
    grid-template-columns: 1fr;
  }
}

.nm-kingbase-sf__scope {
  font-size: var(--rs-font-size-sm, 13px);
  line-height: 1.35;
  word-break: break-all;
}

.nm-kingbase-sf__scope--mb {
  margin-bottom: 8px;
  color: var(--rs-muted);
}

.nm-kingbase-sf__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.nm-kingbase-sf__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 14px;
}

@media (max-width: 520px) {
  .nm-kingbase-sf__options {
    grid-template-columns: 1fr;
  }
}

.nm-kingbase-sf__select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-kingbase-sf__status {
  margin: 0;
  font-size: 12px;
  color: var(--rs-muted);
}

.nm-kingbase-sf__status--error {
  color: var(--rs-danger, #dc2626);
}

.nm-kingbase-sf__objects {
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

.nm-kingbase-sf__object-item {
  margin: 0;
  padding: 0;
}

.nm-kingbase-sf__object {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.nm-kingbase-sf__object:hover {
  background: var(--rs-item-hover);
}

.nm-kingbase-sf__object-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-kingbase-sf__object-type {
  flex: 0 0 auto;
  color: var(--rs-muted);
  font-size: 11px;
}
</style>
