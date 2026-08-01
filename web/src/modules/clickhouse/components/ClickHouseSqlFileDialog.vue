<script setup lang="ts">
import { RsSelect, useRsToast, type RsSelectOptions } from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { clickhouseApi, dialogApi, fsApi } from '@/api'
import type { ClickHouseIoDumpMode } from '@/api/types/clickhouse'
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
import { useClickHouseIoTasks } from '@/modules/clickhouse/composables/useClickHouseIoTasks'
import { readClickHouseIoContext } from '@/modules/clickhouse/data-tasks'

const props = withDefaults(defineProps<{
  taskId: string
  presentation?: 'float' | 'inline'
  activeInDock?: boolean
}>(), { presentation: 'float', activeInDock: false })

const { t } = useI18n()
const toast = useRsToast()
const { track, waitForTask, lines, clearLines, activeTaskId } = useClickHouseIoTasks()
const {
  hub, task, floatOpen, busy, dockReady, activeInDock, onFloatOpenUpdate, onClose, onDock, onPopOut,
} = useDataTransferPresentation({
  taskId: toRef(props, 'taskId'),
  presentation: toRef(props, 'presentation'),
  activeInDock: toRef(props, 'activeInDock'),
})

const ctx = computed(() => task.value ? readClickHouseIoContext(task.value.context) : null)
const isDump = computed(() => task.value?.kind === 'dump_sql')
const isSingleTable = computed(() => Boolean(ctx.value?.table || ctx.value?.dumpScope === 'table'))
const isCategoryScope = computed(() =>
  ctx.value?.dumpScope === 'tables'
  || ctx.value?.dumpScope === 'views'
  || ctx.value?.dumpScope === 'materializedViews'
  || ctx.value?.dumpScope === 'dictionaries',
)
const isDatabaseScope = computed(() => isDump.value && !isSingleTable.value && !isCategoryScope.value)
const filePath = ref('')
const mode = ref<ClickHouseIoDumpMode>('structure_and_data')
const includeTables = ref(true)
const includeViews = ref(true)
const includeMaterializedViews = ref(true)
const includeDictionaries = ref(true)
const includeCreateDatabase = ref(false)
const dropIfExists = ref(true)
const truncateBeforeData = ref(false)
const continueOnError = ref(true)
const canConfirm = computed(() => Boolean(task.value && ctx.value?.database && filePath.value.trim() && !busy.value))
const windowTitle = computed(() => task.value?.title ?? t('modules.clickhouse.io.dumpTitle'))
const scopeLabel = computed(() => {
  if (!ctx.value?.database) return '—'
  if (ctx.value.table) return `${ctx.value.database}.${ctx.value.table}`
  if (ctx.value.dumpScope === 'tables') return t('modules.clickhouse.io.dumpScopeTables', { name: ctx.value.database })
  if (ctx.value.dumpScope === 'views') return t('modules.clickhouse.io.dumpScopeViews', { name: ctx.value.database })
  if (ctx.value.dumpScope === 'materializedViews') return t('modules.clickhouse.io.dumpScopeMaterializedViews', { name: ctx.value.database })
  if (ctx.value.dumpScope === 'dictionaries') return t('modules.clickhouse.io.dumpScopeDictionaries', { name: ctx.value.database })
  return ctx.value.database
})
const modeOptions = computed<RsSelectOptions>(() => [
  { value: 'structure_and_data', label: t('modules.clickhouse.io.dumpModeBoth') },
  { value: 'structure_only', label: t('modules.clickhouse.io.dumpModeStructure') },
  { value: 'data_only', label: t('modules.clickhouse.io.dumpModeData') },
])
const shellLabels = computed((): DataTransferShellLabels => ({
  dockToBottom: t('modules.clickhouse.io.dockToBottom'), popOut: t('modules.clickhouse.io.popOut'),
  cancelTask: t('modules.clickhouse.io.cancelTask'), close: t('common.close'),
  confirm: isDump.value ? t('modules.clickhouse.io.dump') : t('modules.clickhouse.io.execSql'),
}))
const panelLabels = computed((): DataTransferPanelLabels => ({
  progressLog: t('modules.clickhouse.io.progressLog'), progressEmpty: t('modules.clickhouse.io.progressEmpty'),
  running: t('modules.clickhouse.io.running'),
}))
const fileLabels = computed((): DataTransferFileFieldLabels => ({
  filePath: t('modules.clickhouse.io.filePath'), browse: t('modules.clickhouse.io.browse'),
}))

function applyDumpScopeDefaults(): void {
  const scope = ctx.value?.dumpScope
  includeTables.value = scope !== 'views' && scope !== 'materializedViews' && scope !== 'dictionaries'
  includeViews.value = scope !== 'tables' && scope !== 'materializedViews' && scope !== 'dictionaries'
  includeMaterializedViews.value = scope !== 'tables' && scope !== 'views' && scope !== 'dictionaries'
  includeDictionaries.value = scope !== 'tables' && scope !== 'views' && scope !== 'materializedViews'
  includeCreateDatabase.value = false
  if (scope === 'views' || scope === 'materializedViews' || scope === 'dictionaries') {
    mode.value = 'structure_only'
  }
}

function reset(): void {
  filePath.value = ''
  mode.value = 'structure_and_data'
  includeCreateDatabase.value = false
  dropIfExists.value = true
  truncateBeforeData.value = false
  continueOnError.value = true
  clearLines()
  applyDumpScopeDefaults()
}

watch(() => props.taskId, reset, { immediate: true })
watch(() => ctx.value?.dumpScope, applyDumpScopeDefaults)

function dumpDefaultFileName(): string {
  if (!ctx.value) return 'dump.sql'
  if (ctx.value.table) return `${ctx.value.database}.${ctx.value.table}.sql`
  if (ctx.value.dumpScope === 'tables') return `${ctx.value.database}-tables.sql`
  if (ctx.value.dumpScope === 'views') return `${ctx.value.database}-views.sql`
  if (ctx.value.dumpScope === 'materializedViews') return `${ctx.value.database}-materialized-views.sql`
  if (ctx.value.dumpScope === 'dictionaries') return `${ctx.value.database}-dictionaries.sql`
  return `${ctx.value.database ?? 'dump'}.sql`
}

async function pickPath(): Promise<void> {
  try {
    const result = isDump.value
      ? await dialogApi.saveFile({ title: t('modules.clickhouse.io.browseDumpTitle'), defaultPath: dumpDefaultFileName(), accept: ['.sql'] })
      : await dialogApi.openFile({ title: t('modules.clickhouse.io.browseExecTitle'), accept: ['.sql'] })
    if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('modules.clickhouse.io.browseError'))
  }
}

async function onConfirm(): Promise<void> {
  const scope = ctx.value
  if (!scope?.database || !canConfirm.value) return
  hub.setBusy(props.taskId, true)
  clearLines()
  track()
  try {
    const result = isDump.value
      ? await clickhouseApi.ioDumpSql({
          profileId: scope.profileId,
          dump: {
            database: scope.database, tables: scope.table ? [scope.table] : undefined, mode: mode.value,
            outputPath: filePath.value, dropIfExists: dropIfExists.value,
            truncateBeforeData: truncateBeforeData.value, includeCreateDatabase: includeCreateDatabase.value,
            includeTables: includeTables.value, includeViews: includeViews.value,
            includeMaterializedViews: includeMaterializedViews.value,
            includeDictionaries: includeDictionaries.value,
          },
        })
      : await clickhouseApi.ioExecSqlFile({
          profileId: scope.profileId, database: scope.database, inputPath: filePath.value,
          execOptions: { continueOnError: continueOnError.value },
        })
    const done = await waitForTask(result.taskId)
    if (!done.ok) {
      toast.error(done.message || t('modules.clickhouse.io.failed'))
      return
    }
    toast.success(isDump.value ? t('modules.clickhouse.io.dumpDone') : t('modules.clickhouse.io.execDone'))
    if (isDump.value && done.outputPath) await fsApi.showInFolder({ path: done.outputPath }).catch(() => undefined)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('modules.clickhouse.io.failed'))
  } finally {
    hub.setBusy(props.taskId, false)
  }
}

async function onCancelTask(): Promise<void> {
  if (!activeTaskId.value) return
  try {
    await clickhouseApi.ioCancel({
      taskId: activeTaskId.value,
      profileId: ctx.value?.profileId,
      sessionId: ctx.value?.sessionId || undefined,
    })
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('modules.clickhouse.io.failed'))
  }
}
</script>

<template>
  <DataTransferShell
    :labels="shellLabels" :title="windowTitle" :description="task?.description ?? ''"
    :busy="busy" :can-confirm="canConfirm" :presentation="presentation" :float-open="floatOpen"
    :active-in-dock="activeInDock" :dock-ready="dockReady"
    @update:float-open="onFloatOpenUpdate" @dock="onDock" @pop-out="onPopOut"
    @close="onClose" @cancel="onCancelTask" @confirm="onConfirm"
  >
    <DataTransferPanel :labels="panelLabels" :lines="lines" :busy="busy">
      <DataTransferSection :title="t('modules.clickhouse.io.sectionFile')">
        <DataTransferFileField v-model="filePath" :labels="fileLabels" :disabled="busy" required @browse="pickPath" />
      </DataTransferSection>
      <template v-if="isDump">
        <div class="nm-clickhouse-sf__row">
          <DataTransferSection :title="t('modules.clickhouse.io.sectionTarget')"><div class="nm-clickhouse-sf__scope">{{ scopeLabel }}</div></DataTransferSection>
          <DataTransferSection :title="t('modules.clickhouse.io.dumpMode')"><RsSelect v-model="mode" :options="modeOptions" :disabled="busy" /></DataTransferSection>
        </div>
        <DataTransferSection v-if="!isSingleTable" :title="t('modules.clickhouse.io.sectionObjects')">
          <div class="nm-clickhouse-sf__chips">
            <DataTransferCheck v-model="includeTables" variant="chip" :label="t('modules.clickhouse.io.dumpIncludeTables')" :disabled="busy || isCategoryScope" />
            <DataTransferCheck v-model="includeViews" variant="chip" :label="t('modules.clickhouse.io.dumpIncludeViews')" :disabled="busy || isCategoryScope" />
            <DataTransferCheck v-model="includeMaterializedViews" variant="chip" :label="t('modules.clickhouse.io.dumpIncludeMaterializedViews')" :disabled="busy || isCategoryScope" />
            <DataTransferCheck v-model="includeDictionaries" variant="chip" :label="t('modules.clickhouse.io.dumpIncludeDictionaries')" :disabled="busy || isCategoryScope" />
          </div>
        </DataTransferSection>
        <DataTransferSection :title="t('modules.clickhouse.io.sectionOptions')">
          <div class="nm-clickhouse-sf__options">
            <DataTransferCheck v-if="isDatabaseScope" v-model="includeCreateDatabase" :label="t('modules.clickhouse.io.dumpIncludeCreateDatabase')" :disabled="busy" />
            <DataTransferCheck v-model="dropIfExists" :label="t('modules.clickhouse.io.dumpDropIfExists')" :disabled="busy" />
            <DataTransferCheck v-if="mode !== 'structure_only'" v-model="truncateBeforeData" :label="t('modules.clickhouse.io.dumpTruncate')" :disabled="busy" />
          </div>
        </DataTransferSection>
      </template>
      <DataTransferSection v-else :title="t('modules.clickhouse.io.sectionOptions')">
        <div class="nm-clickhouse-sf__scope nm-clickhouse-sf__scope--mb">{{ scopeLabel }}</div>
        <DataTransferCheck v-model="continueOnError" :label="t('modules.clickhouse.io.execContinueOnError')" :hint="t('modules.clickhouse.io.execContinueOnErrorHint')" :disabled="busy" />
      </DataTransferSection>
      <template #note>{{ isDump ? t('modules.clickhouse.io.dumpHint') : t('modules.clickhouse.io.execHint') }}</template>
    </DataTransferPanel>
  </DataTransferShell>
</template>

<style scoped>
.nm-clickhouse-sf__row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 12px; }
.nm-clickhouse-sf__scope { font-size: var(--rs-font-size-sm, 13px); line-height: 1.35; word-break: break-all; }
.nm-clickhouse-sf__scope--mb { margin-bottom: 8px; color: var(--rs-muted); }
.nm-clickhouse-sf__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.nm-clickhouse-sf__options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; }
@media (max-width: 640px) { .nm-clickhouse-sf__row, .nm-clickhouse-sf__options { grid-template-columns: 1fr; } }
</style>
