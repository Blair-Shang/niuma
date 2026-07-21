<script setup lang="ts">
import { RsButton, RsDialog, RsIcon, RsInput, RsLabel, useRsToast } from '@niuma/ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { dialogApi, fsApi, vastbaseApi } from '@/api'
import { useVastIoTasks } from '@/modules/vastbase/composables/useVastIoTasks'
import { readVastIoContext } from '@/modules/vastbase/data-tasks'
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
const { track, waitForTask, lines, clearLines, activeTaskId } = useVastIoTasks()

const task = computed(() => tasks.value.find((item) => item.id === props.taskId))
const ctx = computed(() => (task.value ? readVastIoContext(task.value.context) : null))
const isInline = computed(() => props.presentation === 'inline')

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
    !!ctx.value?.schema &&
    !!ctx.value?.table &&
    !!filePath.value.trim() &&
    !busy.value,
)

const windowTitle = computed(() => task.value?.title ?? t('modules.vastbase.io.exportTitle'))

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

watch(
  lines,
  async () => {
    await nextTick()
    if (logEl.value) {
      logEl.value.scrollTop = logEl.value.scrollHeight
    }
  },
  { deep: true },
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
    const options = {
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
      options,
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
      <div class="nm-vast-io-window">
        <div class="nm-vast-io-window__form">
          <div class="nm-vast-io-window__field">
            <RsLabel required>{{ t('modules.vastbase.io.filePath') }}</RsLabel>
            <RsInput v-model="filePath" :disabled="busy" class="nm-vast-io-window__path">
              <template #suffix>
                <button
                  type="button"
                  class="nm-vast-io-window__browse"
                  :aria-label="t('modules.vastbase.io.browse')"
                  :title="t('modules.vastbase.io.browse')"
                  :disabled="busy"
                  @pointerdown.prevent
                  @click="pickPath"
                >
                  <RsIcon name="folder-open" :size="14" />
                </button>
              </template>
            </RsInput>
          </div>
          <div class="nm-vast-io-window__grid">
            <div class="nm-vast-io-window__field">
              <RsLabel>{{ t('modules.vastbase.io.delimiter') }}</RsLabel>
              <RsInput v-model="delimiter" :disabled="busy" :maxlength="1" />
            </div>
            <div class="nm-vast-io-window__field">
              <RsLabel>{{ t('modules.vastbase.io.nullString') }}</RsLabel>
              <RsInput
                v-model="nullString"
                :disabled="busy"
                :placeholder="t('modules.vastbase.io.nullStringPh')"
              />
            </div>
          </div>
          <label class="nm-vast-io-window__check">
            <input v-model="header" type="checkbox" :disabled="busy" />
            {{ t('modules.vastbase.io.header') }}
          </label>
          <label v-if="!isExport" class="nm-vast-io-window__check">
            <input v-model="truncate" type="checkbox" :disabled="busy" />
            {{ t('modules.vastbase.io.truncateFirst') }}
          </label>
        </div>

        <div class="nm-vast-io-window__log-head">
          <span>{{ t('modules.vastbase.io.progressLog') }}</span>
          <span v-if="busy" class="nm-vast-io-window__running">{{ t('modules.vastbase.io.running') }}</span>
        </div>
        <div ref="logEl" class="nm-vast-io-window__log" role="log" aria-live="polite">
          <p v-if="lines.length === 0" class="nm-vast-io-window__log-empty">
            {{ t('modules.vastbase.io.progressEmpty') }}
          </p>
          <div
            v-for="(line, idx) in lines"
            :key="`${line.at}-${idx}`"
            class="nm-vast-io-window__log-line"
            :class="{
              'is-done': line.ok === true,
              'is-failed': line.ok === false,
              'is-canceled': line.phase === 'canceled',
            }"
          >
            <span
              v-if="line.ok !== undefined || line.phase === 'canceled'"
              class="nm-vast-io-window__log-phase"
            >{{ line.phase }}</span>
            <span class="nm-vast-io-window__log-msg">{{ line.message }}</span>
          </div>
        </div>
      </div>
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
        {{ isExport ? t('modules.vastbase.io.export') : t('modules.vastbase.io.import') }}
      </RsButton>
    </template>
  </RsDialog>

  <Teleport
    v-else
    :to="dataTaskDockMountSelector()"
    :disabled="!canTeleportToDock"
  >
  <div v-show="canTeleportToDock" class="nm-vast-io-inline">
    <div class="nm-vast-io-inline__head">
      <div class="nm-vast-io-inline__meta">
        <div class="nm-vast-io-inline__title">{{ windowTitle }}</div>
        <div v-if="task?.description" class="nm-vast-io-inline__desc">{{ task.description }}</div>
      </div>
      <div class="nm-vast-io-inline__head-actions">
        <RsButton variant="ghost" size="sm" @click="onPopOut">
          {{ t('modules.vastbase.io.popOut') }}
        </RsButton>
        <RsButton v-if="!busy" variant="ghost" size="sm" @click="onClose">
          {{ t('common.close') }}
        </RsButton>
      </div>
    </div>
    <div class="nm-vast-io-window nm-vast-io-window--inline">
      <div class="nm-vast-io-window__form">
        <div class="nm-vast-io-window__field">
          <RsLabel required>{{ t('modules.vastbase.io.filePath') }}</RsLabel>
          <RsInput v-model="filePath" :disabled="busy" class="nm-vast-io-window__path">
            <template #suffix>
              <button
                type="button"
                class="nm-vast-io-window__browse"
                :aria-label="t('modules.vastbase.io.browse')"
                :title="t('modules.vastbase.io.browse')"
                :disabled="busy"
                @pointerdown.prevent
                @click="pickPath"
              >
                <RsIcon name="folder-open" :size="14" />
              </button>
            </template>
          </RsInput>
        </div>
        <div class="nm-vast-io-window__grid">
          <div class="nm-vast-io-window__field">
            <RsLabel>{{ t('modules.vastbase.io.delimiter') }}</RsLabel>
            <RsInput v-model="delimiter" :disabled="busy" :maxlength="1" />
          </div>
          <div class="nm-vast-io-window__field">
            <RsLabel>{{ t('modules.vastbase.io.nullString') }}</RsLabel>
            <RsInput
              v-model="nullString"
              :disabled="busy"
              :placeholder="t('modules.vastbase.io.nullStringPh')"
            />
          </div>
        </div>
        <label class="nm-vast-io-window__check">
          <input v-model="header" type="checkbox" :disabled="busy" />
          {{ t('modules.vastbase.io.header') }}
        </label>
        <label v-if="!isExport" class="nm-vast-io-window__check">
          <input v-model="truncate" type="checkbox" :disabled="busy" />
          {{ t('modules.vastbase.io.truncateFirst') }}
        </label>
      </div>

      <div class="nm-vast-io-window__log-head">
        <span>{{ t('modules.vastbase.io.progressLog') }}</span>
        <span v-if="busy" class="nm-vast-io-window__running">{{ t('modules.vastbase.io.running') }}</span>
      </div>
      <div ref="logEl" class="nm-vast-io-window__log" role="log" aria-live="polite">
        <p v-if="lines.length === 0" class="nm-vast-io-window__log-empty">
          {{ t('modules.vastbase.io.progressEmpty') }}
        </p>
        <div
          v-for="(line, idx) in lines"
          :key="`${line.at}-${idx}`"
          class="nm-vast-io-window__log-line"
          :class="{
            'is-done': line.ok === true,
            'is-failed': line.ok === false,
            'is-canceled': line.phase === 'canceled',
          }"
        >
          <span
            v-if="line.ok !== undefined || line.phase === 'canceled'"
            class="nm-vast-io-window__log-phase"
          >{{ line.phase }}</span>
          <span class="nm-vast-io-window__log-msg">{{ line.message }}</span>
        </div>
      </div>
    </div>
    <div class="nm-vast-io-inline__footer">
      <RsButton v-if="busy" variant="ghost" @click="onCancelTask">
        {{ t('modules.vastbase.io.cancelTask') }}
      </RsButton>
      <RsButton variant="primary" :disabled="!canConfirm" :loading="busy" @click="onConfirm">
        {{ isExport ? t('modules.vastbase.io.export') : t('modules.vastbase.io.import') }}
      </RsButton>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.nm-vast-io-window {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
  height: 100%;
}
.nm-vast-io-window--inline {
  min-height: 0;
  flex: 1 1 auto;
}
.nm-vast-io-window__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex-shrink: 0;
}
.nm-vast-io-window__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.nm-vast-io-window__path {
  width: 100%;
  min-width: 0;
}
.nm-vast-io-window__browse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  border: none;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
}
.nm-vast-io-window__browse:hover:not(:disabled) {
  color: var(--rs-text);
  background: var(--rs-item-hover);
}
.nm-vast-io-window__browse:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
.nm-vast-io-window__browse:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.nm-vast-io-window__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.nm-vast-io-window__check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.nm-vast-io-window__log-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--rs-fg-muted, #888);
  flex-shrink: 0;
}
.nm-vast-io-window__running {
  color: var(--rs-fg, #ddd);
}
.nm-vast-io-window__log {
  flex: 1 1 auto;
  min-height: 96px;
  max-height: 180px;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid var(--rs-border, #333);
  border-radius: 6px;
  background: var(--rs-bg-muted, #1a1a1a);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
}
.nm-vast-io-window__log-empty {
  margin: 0;
  color: var(--rs-fg-muted, #888);
}
.nm-vast-io-window__log-line {
  display: flex;
  gap: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--rs-fg, #e8e8e8);
}
.nm-vast-io-window__log-phase {
  flex: 0 0 auto;
  color: var(--rs-fg-muted, #888);
  min-width: 4.5em;
}
.nm-vast-io-window__log-msg {
  flex: 1 1 auto;
  min-width: 0;
  color: inherit;
}
.nm-vast-io-window__log-line.is-done {
  color: var(--rs-success, #3dd68c);
}
.nm-vast-io-window__log-line.is-failed {
  color: var(--rs-danger, #f87171);
}
.nm-vast-io-window__log-line.is-canceled {
  color: var(--rs-fg-muted, #888);
}
.nm-vast-io-inline {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-height: 100%;
  height: auto;
  gap: 8px;
  padding: 8px 12px 10px;
}
.nm-vast-io-inline__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}
.nm-vast-io-inline__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--rs-text);
}
.nm-vast-io-inline__desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--rs-muted);
}
.nm-vast-io-inline__head-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.nm-vast-io-inline__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}
</style>
