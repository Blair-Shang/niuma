<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, useRsToast, type RsSelectOptions } from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi, fsApi, kingbaseApi } from '@/api'
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
const isExport = computed(() => task.value?.kind === 'export_csv')

const filePath = ref('')
const header = ref(true)
const delimiter = ref(',')
const nullString = ref('')
const truncate = ref(false)

const canConfirm = computed(
  () =>
    !!task.value &&
    !!ctx.value?.schema &&
    !!ctx.value?.table &&
    !!filePath.value.trim() &&
    !busy.value,
)

const windowTitle = computed(() => task.value?.title ?? t('modules.kingbase.io.exportTitle'))
const scopeLabel = computed(() => {
  const scope = ctx.value
  if (!scope?.schema || !scope.table) return '—'
  return `${scope.schema}.${scope.table}`
})

const shellLabels = computed(
  (): DataTransferShellLabels => ({
    dockToBottom: t('modules.kingbase.io.dockToBottom'),
    popOut: t('modules.kingbase.io.popOut'),
    cancelTask: t('modules.kingbase.io.cancelTask'),
    close: t('common.close'),
    confirm: isExport.value ? t('modules.kingbase.io.export') : t('modules.kingbase.io.import'),
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

const delimiterOptions = computed<RsSelectOptions>(() => [
  { value: ',', label: t('modules.kingbase.io.delimiterComma') },
  { value: '\t', label: t('modules.kingbase.io.delimiterTab') },
  { value: ';', label: t('modules.kingbase.io.delimiterSemicolon') },
  { value: '|', label: t('modules.kingbase.io.delimiterPipe') },
])

watch(
  () => props.taskId,
  () => {
    filePath.value = ''
    header.value = true
    delimiter.value = ','
    nullString.value = ''
    truncate.value = false
    clearLines()
  },
  { immediate: true },
)

async function pickPath(): Promise<void> {
  const current = task.value
  const scope = ctx.value
  if (!current || !scope) return
  try {
    if (current.kind === 'export_csv') {
      const result = await dialogApi.saveFile({
        title: t('modules.kingbase.io.browseExportTitle'),
        defaultPath: `${scope.table ?? 'export'}.csv`,
        accept: ['.csv'],
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
      }
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.kingbase.io.browseImportTitle'),
        accept: ['.csv'],
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.kingbase.io.browseError'))
  }
}

async function onConfirm(): Promise<void> {
  const scope = ctx.value
  if (!scope?.schema || !scope.table || !canConfirm.value) return
  hub.setBusy(props.taskId, true)
  clearLines()
  track()
  try {
    const csvOptions = {
      header: header.value,
      delimiter: delimiter.value || ',',
      nullString: nullString.value || undefined,
      truncate: !isExport.value && truncate.value,
    }
    const base = {
      profileId: scope.profileId,
      sessionId: scope.sessionId || undefined,
      database: scope.database,
      schema: scope.schema,
      table: scope.table,
      csvOptions,
    }
    const result = isExport.value
      ? await kingbaseApi.ioExportCsv({ ...base, outputPath: filePath.value })
      : await kingbaseApi.ioImportCsv({ ...base, inputPath: filePath.value })
    const done = await waitForTask(result.taskId)
    if (!done.ok) {
      toast.error(done.message || t('modules.kingbase.io.failed'))
      return
    }
    toast.success(
      isExport.value
        ? t('modules.kingbase.io.exportDone')
        : t('modules.kingbase.io.importDone'),
    )
    if (done.outputPath && isExport.value) {
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
      <DataTransferSection :title="t('modules.kingbase.io.sectionTarget')">
        <div class="nm-vast-dt__scope" :title="scopeLabel">{{ scopeLabel }}</div>
      </DataTransferSection>

      <DataTransferSection :title="t('modules.kingbase.io.sectionFile')">
        <DataTransferFileField
          v-model="filePath"
          :labels="fileLabels"
          :disabled="busy"
          required
          @browse="pickPath"
        />
      </DataTransferSection>

      <DataTransferSection :title="t('modules.kingbase.io.sectionFormat')">
        <div class="nm-vast-dt__grid">
          <div class="nm-vast-dt__field">
            <RsLabel>{{ t('modules.kingbase.io.delimiter') }}</RsLabel>
            <RsSelect v-model="delimiter" :options="delimiterOptions" :disabled="busy" />
          </div>
          <div class="nm-vast-dt__field">
            <RsLabel>{{ t('modules.kingbase.io.nullString') }}</RsLabel>
            <RsInput
              v-model="nullString"
              :disabled="busy"
              :placeholder="t('modules.kingbase.io.nullStringPh')"
            />
          </div>
        </div>
        <div class="nm-vast-dt__checks">
          <DataTransferCheck
            v-model="header"
            variant="chip"
            :label="t('modules.kingbase.io.header')"
            :disabled="busy"
          />
          <DataTransferCheck
            v-if="!isExport"
            v-model="truncate"
            variant="chip"
            :label="t('modules.kingbase.io.truncateFirst')"
            :disabled="busy"
          />
        </div>
      </DataTransferSection>

      <template #note>
        {{
          isExport
            ? t('modules.kingbase.io.exportDesc', { name: scopeLabel })
            : t('modules.kingbase.io.importDesc', { name: scopeLabel })
        }}
      </template>
    </DataTransferPanel>
  </DataTransferShell>
</template>

<style scoped>
.nm-vast-dt__scope {
  font-size: var(--rs-font-size-sm, 13px);
  line-height: 1.35;
  word-break: break-all;
}

.nm-vast-dt__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 520px) {
  .nm-vast-dt__grid {
    grid-template-columns: 1fr;
  }
}

.nm-vast-dt__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nm-vast-dt__checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
</style>
