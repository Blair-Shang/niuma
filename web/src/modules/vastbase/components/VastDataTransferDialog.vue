<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, useRsToast, type RsSelectOptions } from '@niuma/ui'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi, fsApi, vastbaseApi } from '@/api'
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
import { useVastIoTasks } from '@/modules/vastbase/composables/useVastIoTasks'
import { readVastIoContext } from '@/modules/vastbase/data-tasks'

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
const { track, waitForTask, lines, clearLines, activeTaskId } = useVastIoTasks()

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

const ctx = computed(() => (task.value ? readVastIoContext(task.value.context) : null))
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

const windowTitle = computed(() => task.value?.title ?? t('modules.vastbase.io.exportTitle'))
const scopeLabel = computed(() => {
  const scope = ctx.value
  if (!scope?.schema || !scope.table) return '—'
  return `${scope.schema}.${scope.table}`
})

const shellLabels = computed(
  (): DataTransferShellLabels => ({
    dockToBottom: t('modules.vastbase.io.dockToBottom'),
    popOut: t('modules.vastbase.io.popOut'),
    cancelTask: t('modules.vastbase.io.cancelTask'),
    close: t('common.close'),
    confirm: isExport.value ? t('modules.vastbase.io.export') : t('modules.vastbase.io.import'),
  }),
)

const panelLabels = computed(
  (): DataTransferPanelLabels => ({
    progressLog: t('modules.vastbase.io.progressLog'),
    progressEmpty: t('modules.vastbase.io.progressEmpty'),
    running: t('modules.vastbase.io.running'),
  }),
)

const fileLabels = computed(
  (): DataTransferFileFieldLabels => ({
    filePath: t('modules.vastbase.io.filePath'),
    browse: t('modules.vastbase.io.browse'),
  }),
)

const delimiterOptions = computed<RsSelectOptions>(() => [
  { value: ',', label: t('modules.vastbase.io.delimiterComma') },
  { value: '\t', label: t('modules.vastbase.io.delimiterTab') },
  { value: ';', label: t('modules.vastbase.io.delimiterSemicolon') },
  { value: '|', label: t('modules.vastbase.io.delimiterPipe') },
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
        title: t('modules.vastbase.io.browseExportTitle'),
        defaultPath: `${scope.table ?? 'export'}.csv`,
        accept: ['.csv'],
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
      }
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.vastbase.io.browseImportTitle'),
        accept: ['.csv'],
      })
      if (!result.canceled && result.filePaths[0]) {
        filePath.value = result.filePaths[0]
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.io.browseError'))
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
      ? await vastbaseApi.ioExportCsv({ ...base, outputPath: filePath.value })
      : await vastbaseApi.ioImportCsv({ ...base, inputPath: filePath.value })
    const done = await waitForTask(result.taskId)
    if (!done.ok) {
      toast.error(done.message || t('modules.vastbase.io.failed'))
      return
    }
    toast.success(
      isExport.value
        ? t('modules.vastbase.io.exportDone')
        : t('modules.vastbase.io.importDone'),
    )
    if (done.outputPath && isExport.value) {
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
      <DataTransferSection :title="t('modules.vastbase.io.sectionTarget')">
        <div class="nm-vast-dt__scope" :title="scopeLabel">{{ scopeLabel }}</div>
      </DataTransferSection>

      <DataTransferSection :title="t('modules.vastbase.io.sectionFile')">
        <DataTransferFileField
          v-model="filePath"
          :labels="fileLabels"
          :disabled="busy"
          required
          @browse="pickPath"
        />
      </DataTransferSection>

      <DataTransferSection :title="t('modules.vastbase.io.sectionFormat')">
        <div class="nm-vast-dt__grid">
          <div class="nm-vast-dt__field">
            <RsLabel>{{ t('modules.vastbase.io.delimiter') }}</RsLabel>
            <RsSelect v-model="delimiter" :options="delimiterOptions" :disabled="busy" />
          </div>
          <div class="nm-vast-dt__field">
            <RsLabel>{{ t('modules.vastbase.io.nullString') }}</RsLabel>
            <RsInput
              v-model="nullString"
              :disabled="busy"
              :placeholder="t('modules.vastbase.io.nullStringPh')"
            />
          </div>
        </div>
        <div class="nm-vast-dt__checks">
          <DataTransferCheck
            v-model="header"
            variant="chip"
            :label="t('modules.vastbase.io.header')"
            :disabled="busy"
          />
          <DataTransferCheck
            v-if="!isExport"
            v-model="truncate"
            variant="chip"
            :label="t('modules.vastbase.io.truncateFirst')"
            :disabled="busy"
          />
        </div>
      </DataTransferSection>

      <template #note>
        {{
          isExport
            ? t('modules.vastbase.io.exportDesc', { name: scopeLabel })
            : t('modules.vastbase.io.importDesc', { name: scopeLabel })
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
