<script setup lang="ts">
import { RsButton, RsDialog, RsIcon, RsInput, RsLabel, useRsToast } from '@niuma/ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { dialogApi, fsApi, mysqlApi } from '@/api'
import { useMysqlIoTasks } from '@/modules/mysql/composables/useMysqlIoTasks'
import { readMysqlIoContext } from '@/modules/mysql/data-tasks'
import { dataTaskDockMountSelector } from '@/shell/data-tasks/mount'
import { useDataTaskHubStore } from '@/stores/data-task-hub'
import { useShellStore } from '@/stores/shell'

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
const hub = useDataTaskHubStore()
const shell = useShellStore()
const { tasks } = storeToRefs(hub)
const { track, waitForTask, lines, clearLines, activeTaskId } = useMysqlIoTasks()

const task = computed(() => tasks.value.find((item) => item.id === props.taskId))
const ctx = computed(() => (task.value ? readMysqlIoContext(task.value.context) : null))
const isInline = computed(() => props.presentation === 'inline')
const floatOpen = computed(() => !!task.value && task.value.surface === 'float')
let floatShownAt = 0

watch(floatOpen, (visible) => {
  if (visible) floatShownAt = Date.now()
})

const canTeleportToDock = computed(
  () => props.activeInDock && shell.bottomDockOpen && shell.bottomDockTab === 'dataTasks',
)

function onFloatOpenUpdate(next: boolean): void {
  if (next) return
  const current = task.value
  if (!current || current.busy || current.surface !== 'float') return
  if (Date.now() - floatShownAt < 120) return
  hub.close(props.taskId)
}

const isExport = computed(() => task.value?.kind === 'export_csv')
const filePath = ref('')
const header = ref(true)
const delimiter = ref(',')
const nullString = ref('')
const truncate = ref(false)
const logEl = ref<HTMLElement | null>(null)
const busy = computed(() => task.value?.busy ?? false)

const canConfirm = computed(
  () =>
    !!task.value &&
    !!ctx.value?.database &&
    !!ctx.value?.table &&
    !!filePath.value.trim() &&
    !busy.value,
)

const windowTitle = computed(() => task.value?.title ?? t('modules.mysql.io.exportTitle'))

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

watch(lines, async () => {
  await nextTick()
  if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
}, { deep: true })

async function pickPath(): Promise<void> {
  const current = task.value
  const scope = ctx.value
  if (!current || !scope) return
  try {
    if (current.kind === 'export_csv') {
      const result = await dialogApi.saveFile({
        title: t('modules.mysql.io.browseExportTitle'),
        defaultPath: `${scope.table ?? 'export'}.csv`,
        accept: ['.csv'],
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    } else {
      const result = await dialogApi.openFile({
        title: t('modules.mysql.io.browseImportTitle'),
        accept: ['.csv'],
      })
      if (!result.canceled && result.filePaths[0]) filePath.value = result.filePaths[0]
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.io.browseError'))
  }
}

async function onConfirm(): Promise<void> {
  const scope = ctx.value
  if (!scope?.database || !scope.table || !canConfirm.value) return
  hub.setBusy(props.taskId, true)
  clearLines()
  track()
  try {
    const options = {
      header: header.value,
      delimiter: delimiter.value || ',',
      nullString: nullString.value || undefined,
      truncate: !isExport.value && truncate.value,
    }
    const sessionId = scope.sessionId || undefined
    const result = isExport.value
      ? await mysqlApi.ioExportCsv({
          profileId: scope.profileId,
          sessionId,
          database: scope.database,
          table: scope.table,
          outputPath: filePath.value,
          options,
        })
      : await mysqlApi.ioImportCsv({
          profileId: scope.profileId,
          sessionId,
          database: scope.database,
          table: scope.table,
          inputPath: filePath.value,
          options,
        })
    const done = await waitForTask(result.taskId)
    if (!done.ok) {
      toast.error(done.message || t('modules.mysql.io.failed'))
      return
    }
    toast.success(isExport.value ? t('modules.mysql.io.exportDone') : t('modules.mysql.io.importDone'))
    if (done.outputPath && isExport.value) {
      try { await fsApi.showInFolder({ path: done.outputPath }) } catch { /* ignore */ }
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

function onClose(): void {
  if (busy.value) return
  hub.close(props.taskId)
}

function onDock(): void { hub.dockTask(props.taskId) }
function onPopOut(): void { hub.popOutTask(props.taskId) }
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
      <div class="nm-mysql-io-window">
        <div class="nm-mysql-io-window__form">
          <div class="nm-mysql-io-window__field">
            <RsLabel required>{{ t('modules.mysql.io.filePath') }}</RsLabel>
            <RsInput v-model="filePath" :disabled="busy" class="nm-mysql-io-window__path">
              <template #suffix>
                <button
                  type="button"
                  class="nm-mysql-io-window__browse"
                  :disabled="busy"
                  @pointerdown.prevent
                  @click="pickPath"
                >
                  <RsIcon name="folder-open" :size="14" />
                </button>
              </template>
            </RsInput>
          </div>
          <div class="nm-mysql-io-window__grid">
            <div class="nm-mysql-io-window__field">
              <RsLabel>{{ t('modules.mysql.io.delimiter') }}</RsLabel>
              <RsInput v-model="delimiter" :disabled="busy" :maxlength="1" />
            </div>
            <div class="nm-mysql-io-window__field">
              <RsLabel>{{ t('modules.mysql.io.nullString') }}</RsLabel>
              <RsInput v-model="nullString" :disabled="busy" :placeholder="t('modules.mysql.io.nullStringPh')" />
            </div>
          </div>
          <label class="nm-mysql-io-window__check">
            <input v-model="header" type="checkbox" :disabled="busy" />
            {{ t('modules.mysql.io.header') }}
          </label>
          <label v-if="!isExport" class="nm-mysql-io-window__check">
            <input v-model="truncate" type="checkbox" :disabled="busy" />
            {{ t('modules.mysql.io.truncateFirst') }}
          </label>
        </div>
        <div class="nm-mysql-io-window__log-head">
          <span>{{ t('modules.mysql.io.progressLog') }}</span>
          <span v-if="busy" class="nm-mysql-io-window__running">{{ t('modules.mysql.io.running') }}</span>
        </div>
        <div ref="logEl" class="nm-mysql-io-window__log" role="log" aria-live="polite">
          <p v-if="lines.length === 0" class="nm-mysql-io-window__log-empty">{{ t('modules.mysql.io.progressEmpty') }}</p>
          <div
            v-for="(line, idx) in lines"
            :key="`${line.at}-${idx}`"
            class="nm-mysql-io-window__log-line"
            :class="{ 'is-done': line.ok === true, 'is-failed': line.ok === false, 'is-canceled': line.phase === 'canceled' }"
          >
            <span v-if="line.ok !== undefined || line.phase === 'canceled'" class="nm-mysql-io-window__log-phase">{{ line.phase }}</span>
            <span class="nm-mysql-io-window__log-msg">{{ line.message }}</span>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <RsButton variant="ghost" @click.stop="onDock">{{ t('modules.mysql.io.dockToBottom') }}</RsButton>
      <RsButton v-if="busy" variant="ghost" @click="onCancelTask">{{ t('modules.mysql.io.cancelTask') }}</RsButton>
      <RsButton v-else variant="ghost" @click="onClose">{{ t('common.close') }}</RsButton>
      <RsButton variant="primary" :disabled="!canConfirm" :loading="busy" @click="onConfirm">
        {{ isExport ? t('modules.mysql.io.export') : t('modules.mysql.io.import') }}
      </RsButton>
    </template>
  </RsDialog>

  <Teleport v-else :to="dataTaskDockMountSelector()" :disabled="!canTeleportToDock">
    <div v-show="canTeleportToDock" class="nm-mysql-io-inline">
      <div class="nm-mysql-io-inline__head">
        <div class="nm-mysql-io-inline__meta">
          <div class="nm-mysql-io-inline__title">{{ windowTitle }}</div>
          <div v-if="task?.description" class="nm-mysql-io-inline__desc">{{ task.description }}</div>
        </div>
        <div class="nm-mysql-io-inline__head-actions">
          <RsButton variant="ghost" size="sm" @click="onPopOut">{{ t('modules.mysql.io.popOut') }}</RsButton>
          <RsButton v-if="!busy" variant="ghost" size="sm" @click="onClose">{{ t('common.close') }}</RsButton>
        </div>
      </div>
      <div class="nm-mysql-io-window nm-mysql-io-window--inline">
        <div class="nm-mysql-io-window__form">
          <div class="nm-mysql-io-window__field">
            <RsLabel required>{{ t('modules.mysql.io.filePath') }}</RsLabel>
            <RsInput v-model="filePath" :disabled="busy" class="nm-mysql-io-window__path">
              <template #suffix>
                <button type="button" class="nm-mysql-io-window__browse" :disabled="busy" @pointerdown.prevent @click="pickPath">
                  <RsIcon name="folder-open" :size="14" />
                </button>
              </template>
            </RsInput>
          </div>
          <div class="nm-mysql-io-window__grid">
            <div class="nm-mysql-io-window__field">
              <RsLabel>{{ t('modules.mysql.io.delimiter') }}</RsLabel>
              <RsInput v-model="delimiter" :disabled="busy" :maxlength="1" />
            </div>
            <div class="nm-mysql-io-window__field">
              <RsLabel>{{ t('modules.mysql.io.nullString') }}</RsLabel>
              <RsInput v-model="nullString" :disabled="busy" :placeholder="t('modules.mysql.io.nullStringPh')" />
            </div>
          </div>
          <label class="nm-mysql-io-window__check">
            <input v-model="header" type="checkbox" :disabled="busy" />
            {{ t('modules.mysql.io.header') }}
          </label>
          <label v-if="!isExport" class="nm-mysql-io-window__check">
            <input v-model="truncate" type="checkbox" :disabled="busy" />
            {{ t('modules.mysql.io.truncateFirst') }}
          </label>
        </div>
        <div class="nm-mysql-io-window__log-head">
          <span>{{ t('modules.mysql.io.progressLog') }}</span>
          <span v-if="busy" class="nm-mysql-io-window__running">{{ t('modules.mysql.io.running') }}</span>
        </div>
        <div ref="logEl" class="nm-mysql-io-window__log" role="log" aria-live="polite">
          <p v-if="lines.length === 0" class="nm-mysql-io-window__log-empty">{{ t('modules.mysql.io.progressEmpty') }}</p>
          <div
            v-for="(line, idx) in lines"
            :key="`${line.at}-${idx}`"
            class="nm-mysql-io-window__log-line"
            :class="{ 'is-done': line.ok === true, 'is-failed': line.ok === false, 'is-canceled': line.phase === 'canceled' }"
          >
            <span v-if="line.ok !== undefined || line.phase === 'canceled'" class="nm-mysql-io-window__log-phase">{{ line.phase }}</span>
            <span class="nm-mysql-io-window__log-msg">{{ line.message }}</span>
          </div>
        </div>
      </div>
      <div class="nm-mysql-io-inline__footer">
        <RsButton v-if="busy" variant="ghost" @click="onCancelTask">{{ t('modules.mysql.io.cancelTask') }}</RsButton>
        <RsButton v-else variant="ghost" @click="onClose">{{ t('common.close') }}</RsButton>
        <RsButton variant="primary" :disabled="!canConfirm" :loading="busy" @click="onConfirm">
          {{ isExport ? t('modules.mysql.io.export') : t('modules.mysql.io.import') }}
        </RsButton>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.nm-mysql-io-window {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  min-height: 300px;
}
.nm-mysql-io-window--inline {
  padding: 10px 14px;
}
.nm-mysql-io-window__form { display: flex; flex-direction: column; gap: 10px; }
.nm-mysql-io-window__field { display: flex; flex-direction: column; gap: 4px; }
.nm-mysql-io-window__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.nm-mysql-io-window__path { flex: 1; }
.nm-mysql-io-window__browse {
  background: none; border: none; cursor: pointer; padding: 0 6px; color: var(--rs-fg-muted);
}
.nm-mysql-io-window__check { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.nm-mysql-io-window__log-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; font-weight: 600; color: var(--rs-fg-muted); margin-top: 4px;
}
.nm-mysql-io-window__running { color: var(--rs-accent); }
.nm-mysql-io-window__log {
  flex: 1; overflow-y: auto; min-height: 120px; max-height: 260px;
  background: var(--rs-bg-code, #f8f9fa); border-radius: var(--rs-radius-sm, 4px);
  padding: 8px 10px; font-family: var(--rs-font-mono, monospace); font-size: 12px;
}
.nm-mysql-io-window__log-empty { color: var(--rs-fg-muted); margin: 0; }
.nm-mysql-io-window__log-line { display: flex; gap: 6px; line-height: 1.5; }
.nm-mysql-io-window__log-line.is-done { color: var(--rs-fg-success, #16a34a); }
.nm-mysql-io-window__log-line.is-failed { color: var(--rs-fg-danger, #dc2626); }
.nm-mysql-io-window__log-line.is-canceled { color: var(--rs-fg-muted); }
.nm-mysql-io-window__log-phase { font-weight: 600; min-width: 56px; }
.nm-mysql-io-window__log-msg { word-break: break-all; }

.nm-mysql-io-inline { display: flex; flex-direction: column; height: 100%; }
.nm-mysql-io-inline__head {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid var(--rs-border-subtle); flex-shrink: 0;
}
.nm-mysql-io-inline__meta { display: flex; flex-direction: column; gap: 2px; }
.nm-mysql-io-inline__title { font-weight: 600; font-size: 13px; }
.nm-mysql-io-inline__desc { font-size: 12px; color: var(--rs-fg-muted); }
.nm-mysql-io-inline__head-actions { display: flex; gap: 4px; }
.nm-mysql-io-inline__footer {
  display: flex; justify-content: flex-end; gap: 6px;
  padding: 8px 12px; border-top: 1px solid var(--rs-border-subtle); flex-shrink: 0;
}
</style>
