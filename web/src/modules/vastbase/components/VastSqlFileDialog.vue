<script setup lang="ts">
import { RsButton, RsDialog, useRsToast } from '@niuma/ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { dialogApi, fsApi, vastbaseApi } from '@/api'
import type { VastIoDumpMode, VastTableInfo } from '@/api/types/vastbase'
import VastSqlFilePanel from '@/modules/vastbase/components/VastSqlFilePanel.vue'
import { useVastIoTasks } from '@/modules/vastbase/composables/useVastIoTasks'
import { readVastIoContext } from '@/modules/vastbase/data-tasks'
import { dataTaskDockMountSelector } from '@/shell/data-tasks/mount'
import { useDataTaskHubStore } from '@/stores/data-task-hub'
import { useShellStore } from '@/stores/shell'

const props = withDefaults(
  defineProps<{
    taskId: string
    /** float=浮窗；inline=底部 Dock 内嵌 */
    presentation?: 'float' | 'inline'
    /** 当前是否应显示在 Dock 挂载点 */
    activeInDock?: boolean
  }>(),
  { presentation: 'float', activeInDock: false },
)

const { t } = useI18n()
const toast = useRsToast()
const hub = useDataTaskHubStore()
const shell = useShellStore()
const { tasks } = storeToRefs(hub)
const { track, waitForTask, lines, clearLines, activeTaskId } = useVastIoTasks()

const panelRef = ref<{ scrollLogToBottom: () => void } | null>(null)

const task = computed(() => tasks.value.find((item) => item.id === props.taskId))
const ctx = computed(() => (task.value ? readVastIoContext(task.value.context) : null))
const isInline = computed(() => props.presentation === 'inline')

/** 浮窗是否显示；关闭只认 surface===float，避免弹出挂载抖动误删任务 */
const floatOpen = computed(() => !!task.value && task.value.surface === 'float')
let floatShownAt = 0

watch(floatOpen, (visible) => {
  if (visible) floatShownAt = Date.now()
})

const canTeleportToDock = computed(
  () =>
    props.activeInDock &&
    shell.bottomDockOpen &&
    shell.bottomDockTab === 'dataTasks',
)

function onFloatOpenUpdate(next: boolean): void {
  if (next) return
  const current = task.value
  if (!current || current.busy || current.surface !== 'float') return
  if (Date.now() - floatShownAt < 120) return
  hub.close(props.taskId)
}

const isDump = computed(() => task.value?.kind === 'dump_sql')
const filePath = ref('')
const mode = ref<VastIoDumpMode>('structure_and_data')
const includeTables = ref(true)
const includeViews = ref(true)
const includeMatViews = ref(true)
const dropIfExists = ref(false)
const createSchema = ref(true)
const truncateBeforeData = ref(false)
const excludeSystem = ref(true)
/** 执行 SQL：默认开启失败继续，便于导入含系统对象 DROP 的转储 */
const continueOnError = ref(true)
const selectedTables = ref<string[]>([])
const objectRows = ref<VastTableInfo[]>([])
const objectsLoading = ref(false)
const objectsError = ref('')

const modeOptions = computed(() => [
  { value: 'structure_and_data', label: t('modules.vastbase.io.dumpModeBoth') },
  { value: 'structure_only', label: t('modules.vastbase.io.dumpModeStructure') },
  { value: 'data_only', label: t('modules.vastbase.io.dumpModeData') },
])

const busy = computed(() => task.value?.busy ?? false)
const fixedTable = computed(() => !!ctx.value?.table)
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
  if (!includeTables.value && !includeViews.value && !includeMatViews.value) return false
  if (canPickObjects.value && objectRows.value.length > 0 && selectedTables.value.length === 0) {
    return false
  }
  return true
})

const windowTitle = computed(() => task.value?.title ?? t('modules.vastbase.io.dumpTitle'))

function resetDumpOptions(): void {
  mode.value = 'structure_and_data'
  includeTables.value = true
  includeViews.value = true
  includeMatViews.value = true
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
    const result = await vastbaseApi.treeTables({
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
    objectsError.value = e instanceof Error ? e.message : t('modules.vastbase.io.objectsLoadError')
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

watch(
  lines,
  async () => {
    await nextTick()
    panelRef.value?.scrollLogToBottom()
  },
  { deep: true },
)

async function pickPath(): Promise<void> {
  const current = task.value
  const scope = ctx.value
  if (!current || !scope) return
  try {
    if (current.kind === 'dump_sql') {
      const result = await dialogApi.saveFile({
        title: t('modules.vastbase.io.browseDumpTitle'),
        defaultPath: `${scope.database ?? 'dump'}.sql`,
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
      }
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.vastbase.io.browseExecTitle'),
        accept: ['.sql'],
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.io.browseError'))
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
    const result = isDump.value
      ? await vastbaseApi.ioDumpSql({
          ...base,
          schema: scope.schema,
          tables: resolveDumpTables(),
          mode: mode.value,
          outputPath: filePath.value,
          includeTables: includeTables.value,
          includeViews: includeViews.value,
          includeMatViews: includeMatViews.value,
          dropIfExists: dropIfExists.value,
          truncateBeforeData: truncateBeforeData.value,
          createSchema: createSchema.value,
          excludeSystem: excludeSystem.value,
        })
      : await vastbaseApi.ioExecSqlFile({
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
        toast.warning(done.message || t('modules.vastbase.io.execPartialDone'))
      } else {
        toast.error(done.message || t('modules.vastbase.io.failed'))
      }
      return
    }
    toast.success(
      isDump.value ? t('modules.vastbase.io.dumpDone') : t('modules.vastbase.io.execDone'),
    )
    if (done.outputPath && isDump.value) {
      try {
        await fsApi.showInFolder({ path: done.outputPath })
      } catch {
        // ignore
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.io.failed'))
  } finally {
    hub.setBusy(props.taskId, false)
  }
}

async function onCancelTask(): Promise<void> {
  const backendTaskId = activeTaskId.value
  if (!backendTaskId) return
  try {
    await vastbaseApi.ioCancel({ taskId: backendTaskId })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.io.failed'))
  }
}

function onClose(): void {
  if (busy.value) return
  hub.close(props.taskId)
}

function onDock(): void {
  hub.dockTask(props.taskId)
}

function onPopOut(): void {
  hub.popOutTask(props.taskId)
}
</script>

<template>
  <RsDialog
    v-if="!isInline"
    :open="floatOpen"
    :title="windowTitle"
    :description="task?.description ?? ''"
    width="lg"
    layout="window"
    tone="default"
    :modal="false"
    :show-overlay="false"
    :draggable="true"
    :resizable="true"
    :fullscreenable="true"
    :show-close="!busy"
    :close-on-overlay-click="false"
    @update:open="onFloatOpenUpdate"
  >
    <template #body>
      <VastSqlFilePanel
        ref="panelRef"
        v-model:file-path="filePath"
        v-model:mode="mode"
        v-model:include-tables="includeTables"
        v-model:include-views="includeViews"
        v-model:include-mat-views="includeMatViews"
        v-model:create-schema="createSchema"
        v-model:drop-if-exists="dropIfExists"
        v-model:truncate-before-data="truncateBeforeData"
        v-model:exclude-system="excludeSystem"
        v-model:continue-on-error="continueOnError"
        :is-dump="isDump"
        :busy="busy"
        :scope-label="scopeLabel"
        :mode-options="modeOptions"
        :include-structure="includeStructure"
        :include-data="includeData"
        :show-exclude-system="showExcludeSystem"
        :can-pick-objects="canPickObjects"
        :all-objects-selected="allObjectsSelected"
        :object-rows="objectRows"
        :selected-tables="selectedTables"
        :objects-loading="objectsLoading"
        :objects-error="objectsError"
        :lines="lines"
        @pick-path="pickPath"
        @toggle-select-all="toggleSelectAll"
        @toggle-object="toggleObject"
      />
    </template>
    <template #footer>
      <RsButton variant="ghost" @click.stop="onDock">
        {{ t('modules.vastbase.io.dockToBottom') }}
      </RsButton>
      <RsButton v-if="busy" variant="ghost" @click="onCancelTask">
        {{ t('modules.vastbase.io.cancelTask') }}
      </RsButton>
      <RsButton v-else variant="ghost" @click="onClose">
        {{ t('common.close') }}
      </RsButton>
      <RsButton variant="primary" :disabled="!canConfirm" :loading="busy" @click="onConfirm">
        {{ isDump ? t('modules.vastbase.io.dump') : t('modules.vastbase.io.execFile') }}
      </RsButton>
    </template>
  </RsDialog>

  <Teleport
    v-else
    :to="dataTaskDockMountSelector()"
    :disabled="!canTeleportToDock"
  >
    <div v-show="canTeleportToDock" class="nm-vast-sql-inline">
      <div class="nm-vast-sql-inline__head">
        <div class="nm-vast-sql-inline__meta">
          <div class="nm-vast-sql-inline__title">{{ windowTitle }}</div>
          <div v-if="task?.description" class="nm-vast-sql-inline__desc">
            {{ task.description }}
          </div>
        </div>
        <div class="nm-vast-sql-inline__head-actions">
          <RsButton variant="ghost" size="sm" @click="onPopOut">
            {{ t('modules.vastbase.io.popOut') }}
          </RsButton>
          <RsButton v-if="!busy" variant="ghost" size="sm" @click="onClose">
            {{ t('common.close') }}
          </RsButton>
        </div>
      </div>

      <VastSqlFilePanel
        ref="panelRef"
        class="nm-vast-sql-inline__panel"
        v-model:file-path="filePath"
        v-model:mode="mode"
        v-model:include-tables="includeTables"
        v-model:include-views="includeViews"
        v-model:include-mat-views="includeMatViews"
        v-model:create-schema="createSchema"
        v-model:drop-if-exists="dropIfExists"
        v-model:truncate-before-data="truncateBeforeData"
        v-model:exclude-system="excludeSystem"
        v-model:continue-on-error="continueOnError"
        :is-dump="isDump"
        :busy="busy"
        :scope-label="scopeLabel"
        :mode-options="modeOptions"
        :include-structure="includeStructure"
        :include-data="includeData"
        :show-exclude-system="showExcludeSystem"
        :can-pick-objects="canPickObjects"
        :all-objects-selected="allObjectsSelected"
        :object-rows="objectRows"
        :selected-tables="selectedTables"
        :objects-loading="objectsLoading"
        :objects-error="objectsError"
        :lines="lines"
        @pick-path="pickPath"
        @toggle-select-all="toggleSelectAll"
        @toggle-object="toggleObject"
      />

      <div class="nm-vast-sql-inline__footer">
        <RsButton v-if="busy" variant="ghost" @click="onCancelTask">
          {{ t('modules.vastbase.io.cancelTask') }}
        </RsButton>
        <RsButton variant="primary" :disabled="!canConfirm" :loading="busy" @click="onConfirm">
          {{ isDump ? t('modules.vastbase.io.dump') : t('modules.vastbase.io.execFile') }}
        </RsButton>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.nm-vast-sql-inline {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-height: 100%;
  height: auto;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm) var(--rs-space-md) var(--rs-space-md);
  color: var(--rs-text);
}

.nm-vast-sql-inline__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
  flex-shrink: 0;
}

.nm-vast-sql-inline__title {
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}

.nm-vast-sql-inline__desc {
  margin-top: 2px;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-vast-sql-inline__head-actions {
  display: flex;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

.nm-vast-sql-inline__panel {
  flex: 1 1 auto;
  min-height: 0;
}

.nm-vast-sql-inline__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}
</style>
