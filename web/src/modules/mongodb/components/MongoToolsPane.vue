<script setup lang="ts">
import {
  RsBadge,
  RsButton,
  RsIcon,
  RsInput,
  RsLoading,
  RsSelect,
  RsTooltip,
  useRsToast,
} from '@niuma/ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi, mongodbApi } from '@/api'
import type { MongoToolsDetectResult } from '@/api/types/mongodb'
import { useMongoToolTasks } from '@/modules/mongodb/composables/useMongoToolTasks'
import { loadMongoToolPaths } from '@/modules/mongodb/utils/tool-paths'

const props = defineProps<{
  sessionId: string | null
  initialDatabase?: string
  initialCollection?: string
  active?: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()
const tasks = useMongoToolTasks()

const loading = ref(true)
const toolPaths = ref<Record<string, string>>({})
const detect = ref<MongoToolsDetectResult | null>(null)

const database = ref(props.initialDatabase ?? '')
const collection = ref(props.initialCollection ?? '')
const format = ref<'json' | 'csv'>('json')
const dumpOutputDir = ref('')
const restoreInputDir = ref('')
const exportOutputPath = ref('')
const importInputPath = ref('')
const starting = ref(false)
const cancelling = ref(false)

const busy = computed(() => starting.value || !!tasks.activeTaskId.value)

const toolRows = computed(() => {
  const d = detect.value
  if (!d) {
    return []
  }
  return [
    {
      id: 'mongodump' as const,
      label: 'mongodump',
      icon: 'archive',
      entry: d.mongodump,
    },
    {
      id: 'mongorestore' as const,
      label: 'mongorestore',
      icon: 'package-open',
      entry: d.mongorestore,
    },
    {
      id: 'mongoexport' as const,
      label: 'mongoexport',
      icon: 'file-down',
      entry: d.mongoexport,
    },
    {
      id: 'mongoimport' as const,
      label: 'mongoimport',
      icon: 'file-up',
      entry: d.mongoimport,
    },
  ]
})

const availableCount = computed(() => toolRows.value.filter((row) => row.entry.available).length)

const canRunCollectionTools = computed(
  () => !!props.sessionId && !!database.value.trim() && !!collection.value.trim(),
)

function toolAvailable(id: keyof MongoToolsDetectResult): boolean {
  return detect.value?.[id]?.available === true
}

const formatAccept = computed(() =>
  format.value === 'csv' ? ['.csv', '.json'] : ['.json', '.csv'],
)

async function pickFolder(target: 'dump' | 'restore'): Promise<void> {
  try {
    const current = target === 'dump' ? dumpOutputDir.value : restoreInputDir.value
    const result = await dialogApi.openFolder({
      title:
        target === 'dump'
          ? t('modules.mongodb.tools.browseDumpDirTitle')
          : t('modules.mongodb.tools.browseRestoreDirTitle'),
      okButtonLabel: t('modules.mongodb.tools.browseConfirm'),
      defaultPath: current.trim() || undefined,
    })
    if (result.canceled || !result.filePaths[0]) {
      return
    }
    if (target === 'dump') {
      dumpOutputDir.value = result.filePaths[0]
    } else {
      restoreInputDir.value = result.filePaths[0]
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.tools.browseError'))
  }
}

async function pickExportFile(): Promise<void> {
  try {
    const result = await dialogApi.saveFile({
      title: t('modules.mongodb.tools.browseExportTitle'),
      defaultPath: exportOutputPath.value.trim() || undefined,
      accept: formatAccept.value,
    })
    if (result.canceled || !result.filePaths[0]) {
      return
    }
    exportOutputPath.value = result.filePaths[0]
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.tools.browseError'))
  }
}

async function pickImportFile(): Promise<void> {
  try {
    const result = await dialogApi.openFile({
      title: t('modules.mongodb.tools.browseImportTitle'),
      defaultPath: importInputPath.value.trim() || undefined,
      accept: formatAccept.value,
    })
    if (result.canceled || !result.filePaths[0]) {
      return
    }
    importInputPath.value = result.filePaths[0]
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.tools.browseError'))
  }
}

async function refreshDetect(): Promise<void> {
  loading.value = true
  try {
    toolPaths.value = await loadMongoToolPaths()
    detect.value = await mongodbApi.toolsDetect({ toolPaths: toolPaths.value })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.tools.detectError'))
  } finally {
    loading.value = false
  }
}

async function runTask(
  label: string,
  runner: () => Promise<{ taskId: string }>,
): Promise<void> {
  if (!props.sessionId || busy.value) {
    return
  }
  starting.value = true
  tasks.track()
  try {
    const result = await runner()
    tasks.trackTask(result.taskId)
    toast.success(t('modules.mongodb.tools.started', { taskId: result.taskId, tool: label }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.tools.runError'))
  } finally {
    starting.value = false
  }
}

async function stopActiveTask(): Promise<void> {
  const taskId = tasks.activeTaskId.value
  if (!taskId || cancelling.value) {
    return
  }
  cancelling.value = true
  try {
    await mongodbApi.toolsCancel({ taskId })
    toast.success(t('modules.mongodb.tools.stopped', { taskId }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.tools.stopError'))
  } finally {
    cancelling.value = false
  }
}

async function runDump(): Promise<void> {
  await runTask('mongodump', () =>
    mongodbApi.toolsDump({
      sessionId: props.sessionId!,
      database: database.value,
      outputDir: dumpOutputDir.value || undefined,
      toolPaths: toolPaths.value,
    }),
  )
}

async function runRestore(): Promise<void> {
  await runTask('mongorestore', () =>
    mongodbApi.toolsRestore({
      sessionId: props.sessionId!,
      inputDir: restoreInputDir.value,
      toolPaths: toolPaths.value,
    }),
  )
}

async function runExport(): Promise<void> {
  await runTask('mongoexport', () =>
    mongodbApi.toolsExport({
      sessionId: props.sessionId!,
      database: database.value,
      collection: collection.value,
      format: format.value,
      outputPath: exportOutputPath.value || undefined,
      toolPaths: toolPaths.value,
    }),
  )
}

async function runImport(): Promise<void> {
  await runTask('mongoimport', () =>
    mongodbApi.toolsImport({
      sessionId: props.sessionId!,
      database: database.value,
      collection: collection.value,
      format: format.value,
      inputPath: importInputPath.value,
      toolPaths: toolPaths.value,
    }),
  )
}

onMounted(() => {
  tasks.track()
  void refreshDetect()
})
</script>

<template>
  <div class="nm-mongo-tools">
    <header class="nm-mongo-tools__header">
      <div class="nm-mongo-tools__header-left">
        <div class="nm-mongo-tools__title-row">
          <RsIcon name="wrench" :size="15" class="nm-mongo-tools__title-icon" />
          <h3 class="nm-mongo-tools__title">{{ t('modules.mongodb.tools.title') }}</h3>
          <RsBadge
            v-if="!loading && toolRows.length"
            :variant="availableCount === toolRows.length ? 'success' : availableCount > 0 ? 'warning' : 'danger'"
          >
            {{ t('modules.mongodb.tools.readySummary', { n: availableCount, total: toolRows.length }) }}
          </RsBadge>
        </div>
        <p class="nm-mongo-tools__subtitle">{{ t('modules.mongodb.tools.settingsHint') }}</p>
      </div>
      <RsButton size="sm" variant="ghost" :loading="loading" @click="refreshDetect">
        <RsIcon name="refresh-cw" :size="13" />
        {{ t('modules.mongodb.tools.refresh') }}
      </RsButton>
    </header>

    <RsLoading
      v-if="loading"
      class="nm-mongo-tools__loading"
      :label="t('modules.mongodb.tools.detecting')"
      show-label
    />

    <div v-else class="nm-mongo-tools__body">
      <section class="nm-mongo-tools__status" aria-label="Tool status">
        <div
          v-for="row in toolRows"
          :key="row.id"
          class="nm-mongo-tools__status-chip"
          :class="row.entry.available ? 'is-ok' : 'is-missing'"
        >
          <div class="nm-mongo-tools__status-icon" aria-hidden="true">
            <RsIcon :name="row.icon" :size="14" />
          </div>
          <div class="nm-mongo-tools__status-meta min-w-0">
            <span class="nm-mongo-tools__status-name">{{ row.label }}</span>
            <RsTooltip
              v-if="row.entry.available && row.entry.path"
              :content="row.entry.path"
              side="bottom"
            >
              <span class="nm-mongo-tools__status-path truncate">
                {{ row.entry.path }}
              </span>
            </RsTooltip>
            <span v-else-if="row.entry.available" class="nm-mongo-tools__status-path">
              {{ t('modules.mongodb.tools.available') }}
            </span>
            <span v-else class="nm-mongo-tools__status-path is-missing">
              {{ t('modules.mongodb.tools.missing') }}
            </span>
          </div>
          <span
            class="nm-mongo-tools__status-dot"
            :class="row.entry.available ? 'is-ok' : 'is-missing'"
            aria-hidden="true"
          />
        </div>
      </section>

      <section class="nm-mongo-tools__panel">
        <div class="nm-mongo-tools__panel-head">
          <RsIcon name="sliders-horizontal" :size="13" />
          <span>{{ t('modules.mongodb.tools.common') }}</span>
          <span class="nm-mongo-tools__panel-hint">{{ t('modules.mongodb.tools.commonHint') }}</span>
        </div>
        <div class="nm-mongo-tools__target-grid">
          <label class="nm-mongo-tools__field">
            <span class="nm-mongo-tools__field-label">{{ t('modules.mongodb.tools.database') }}</span>
            <RsInput
              v-model="database"
              :placeholder="t('modules.mongodb.tools.databasePlaceholder')"
            />
          </label>
          <label class="nm-mongo-tools__field">
            <span class="nm-mongo-tools__field-label">{{ t('modules.mongodb.tools.collection') }}</span>
            <RsInput
              v-model="collection"
              :placeholder="t('modules.mongodb.tools.collectionPlaceholder')"
            />
          </label>
          <label class="nm-mongo-tools__field nm-mongo-tools__field--format">
            <span class="nm-mongo-tools__field-label">{{ t('modules.mongodb.tools.format') }}</span>
            <RsSelect
              v-model="format"
              :options="[
                { value: 'json', label: 'JSON' },
                { value: 'csv', label: 'CSV' },
              ]"
            />
          </label>
        </div>
      </section>

      <div class="nm-mongo-tools__ops">
        <section class="nm-mongo-tools__panel">
          <div class="nm-mongo-tools__panel-head">
            <RsIcon name="archive" :size="13" />
            <span>{{ t('modules.mongodb.tools.backup') }}</span>
            <span class="nm-mongo-tools__panel-hint">{{ t('modules.mongodb.tools.backupHint') }}</span>
          </div>

          <div class="nm-mongo-tools__op">
            <div class="nm-mongo-tools__op-info">
              <span class="nm-mongo-tools__op-title">mongodump</span>
              <span class="nm-mongo-tools__op-desc">{{ t('modules.mongodb.tools.dumpDesc') }}</span>
            </div>
            <div class="nm-mongo-tools__op-controls">
              <RsInput
                v-model="dumpOutputDir"
                class="nm-mongo-tools__op-input"
                :placeholder="t('modules.mongodb.tools.dumpDirPlaceholder')"
              >
                <template #suffix>
                  <button
                    type="button"
                    class="nm-mongo-tools__browse"
                    :aria-label="t('modules.mongodb.tools.browseFolder')"
                    :title="t('modules.mongodb.tools.browseFolder')"
                    :disabled="busy"
                    @pointerdown.prevent
                    @click="pickFolder('dump')"
                  >
                    <RsIcon name="folder-open" :size="14" />
                  </button>
                </template>
              </RsInput>
              <RsButton
                size="sm"
                :disabled="!sessionId || busy || !toolAvailable('mongodump') || !database.trim()"
                @click="runDump"
              >
                <RsIcon name="download" :size="13" />
                {{ t('modules.mongodb.tools.dumpAction') }}
              </RsButton>
            </div>
          </div>

          <div class="nm-mongo-tools__op">
            <div class="nm-mongo-tools__op-info">
              <span class="nm-mongo-tools__op-title">mongorestore</span>
              <span class="nm-mongo-tools__op-desc">{{ t('modules.mongodb.tools.restoreDesc') }}</span>
            </div>
            <div class="nm-mongo-tools__op-controls">
              <RsInput
                v-model="restoreInputDir"
                class="nm-mongo-tools__op-input"
                :placeholder="t('modules.mongodb.tools.restoreDirPlaceholder')"
              >
                <template #suffix>
                  <button
                    type="button"
                    class="nm-mongo-tools__browse"
                    :aria-label="t('modules.mongodb.tools.browseFolder')"
                    :title="t('modules.mongodb.tools.browseFolder')"
                    :disabled="busy"
                    @pointerdown.prevent
                    @click="pickFolder('restore')"
                  >
                    <RsIcon name="folder-open" :size="14" />
                  </button>
                </template>
              </RsInput>
              <RsButton
                size="sm"
                variant="secondary"
                :disabled="!sessionId || busy || !toolAvailable('mongorestore') || !restoreInputDir"
                @click="runRestore"
              >
                <RsIcon name="upload" :size="13" />
                {{ t('modules.mongodb.tools.restoreAction') }}
              </RsButton>
            </div>
          </div>
        </section>

        <section class="nm-mongo-tools__panel">
          <div class="nm-mongo-tools__panel-head">
            <RsIcon name="arrow-left-right" :size="13" />
            <span>{{ t('modules.mongodb.tools.importExport') }}</span>
            <span class="nm-mongo-tools__panel-hint">{{ t('modules.mongodb.tools.importExportHint') }}</span>
          </div>

          <div class="nm-mongo-tools__op">
            <div class="nm-mongo-tools__op-info">
              <span class="nm-mongo-tools__op-title">mongoexport</span>
              <span class="nm-mongo-tools__op-desc">{{ t('modules.mongodb.tools.exportDesc') }}</span>
            </div>
            <div class="nm-mongo-tools__op-controls">
              <RsInput
                v-model="exportOutputPath"
                class="nm-mongo-tools__op-input"
                :placeholder="t('modules.mongodb.tools.exportPathPlaceholder')"
              >
                <template #suffix>
                  <button
                    type="button"
                    class="nm-mongo-tools__browse"
                    :aria-label="t('modules.mongodb.tools.browseFileSave')"
                    :title="t('modules.mongodb.tools.browseFileSave')"
                    :disabled="busy"
                    @pointerdown.prevent
                    @click="pickExportFile"
                  >
                    <RsIcon name="save" :size="14" />
                  </button>
                </template>
              </RsInput>
              <RsButton
                size="sm"
                :disabled="!canRunCollectionTools || busy || !toolAvailable('mongoexport')"
                @click="runExport"
              >
                <RsIcon name="file-down" :size="13" />
                {{ t('modules.mongodb.tools.exportAction') }}
              </RsButton>
            </div>
          </div>

          <div class="nm-mongo-tools__op">
            <div class="nm-mongo-tools__op-info">
              <span class="nm-mongo-tools__op-title">mongoimport</span>
              <span class="nm-mongo-tools__op-desc">{{ t('modules.mongodb.tools.importDesc') }}</span>
            </div>
            <div class="nm-mongo-tools__op-controls">
              <RsInput
                v-model="importInputPath"
                class="nm-mongo-tools__op-input"
                :placeholder="t('modules.mongodb.tools.importPathPlaceholder')"
              >
                <template #suffix>
                  <button
                    type="button"
                    class="nm-mongo-tools__browse"
                    :aria-label="t('modules.mongodb.tools.browseFileOpen')"
                    :title="t('modules.mongodb.tools.browseFileOpen')"
                    :disabled="busy"
                    @pointerdown.prevent
                    @click="pickImportFile"
                  >
                    <RsIcon name="file" :size="14" />
                  </button>
                </template>
              </RsInput>
              <RsButton
                size="sm"
                variant="secondary"
                :disabled="!canRunCollectionTools || busy || !toolAvailable('mongoimport') || !importInputPath"
                @click="runImport"
              >
                <RsIcon name="file-up" :size="13" />
                {{ t('modules.mongodb.tools.importAction') }}
              </RsButton>
            </div>
          </div>
        </section>
      </div>

      <section class="nm-mongo-tools__panel nm-mongo-tools__panel--log">
        <div class="nm-mongo-tools__panel-head">
          <RsIcon name="scroll-text" :size="13" />
          <span>{{ t('modules.mongodb.tools.log') }}</span>
          <RsBadge v-if="tasks.activeTaskId.value" variant="info">
            {{ t('modules.mongodb.tools.running') }}
          </RsBadge>
          <span v-if="tasks.lines.value.length" class="nm-mongo-tools__panel-hint">
            {{ t('modules.mongodb.tools.logCount', { n: tasks.lines.value.length }) }}
          </span>
          <div class="nm-mongo-tools__panel-actions">
            <RsButton
              v-if="tasks.activeTaskId.value"
              size="sm"
              variant="danger"
              :loading="cancelling"
              @click="stopActiveTask"
            >
              <RsIcon name="square" :size="12" />
              {{ t('modules.mongodb.tools.stop') }}
            </RsButton>
            <RsButton
              v-if="tasks.lines.value.length"
              size="sm"
              variant="ghost"
              :disabled="!!tasks.activeTaskId.value"
              @click="tasks.clear()"
            >
              {{ t('modules.mongodb.tools.clearLog') }}
            </RsButton>
          </div>
        </div>
        <div v-if="tasks.lines.value.length" class="nm-mongo-tools__log" role="log">
          <div
            v-for="(line, idx) in tasks.lines.value"
            :key="idx"
            class="nm-mongo-tools__log-line"
            :class="{
              'is-err': line.ok === false && line.phase !== 'canceled',
              'is-ok': line.ok === true,
              'is-canceled': line.phase === 'canceled',
            }"
          >
            <span class="nm-mongo-tools__log-id">#{{ line.taskId }}</span>
            <span class="nm-mongo-tools__log-msg">{{ line.message }}</span>
            <span v-if="line.outputPath" class="nm-mongo-tools__log-path">→ {{ line.outputPath }}</span>
          </div>
        </div>
        <div v-else class="nm-mongo-tools__log-empty">
          {{ t('modules.mongodb.tools.logEmpty') }}
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.nm-mongo-tools {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--rs-surface);
}

.nm-mongo-tools__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
  padding: var(--rs-space-md) var(--rs-space-lg);
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-mongo-tools__header-left {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.nm-mongo-tools__title-row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-wrap: wrap;
}

.nm-mongo-tools__title-icon {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-mongo-tools__title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.nm-mongo-tools__subtitle {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.4;
}

.nm-mongo-tools__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-mongo-tools__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--rs-space-md) var(--rs-space-lg) var(--rs-space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
}

.nm-mongo-tools__status {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--rs-space-sm);
}

.nm-mongo-tools__status-chip {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
  padding: 0.625rem 0.75rem;
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-surface-raised) 88%, transparent);
}

.nm-mongo-tools__status-chip.is-ok {
  border-color: color-mix(in srgb, var(--rs-success) 28%, var(--rs-border-subtle));
}

.nm-mongo-tools__status-chip.is-missing {
  border-color: color-mix(in srgb, var(--rs-danger) 22%, var(--rs-border-subtle));
  opacity: 0.9;
}

.nm-mongo-tools__status-icon {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-hover);
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-mongo-tools__status-chip.is-ok .nm-mongo-tools__status-icon {
  color: var(--rs-success);
  background: color-mix(in srgb, var(--rs-success) 12%, transparent);
}

.nm-mongo-tools__status-chip.is-missing .nm-mongo-tools__status-icon {
  color: var(--rs-danger);
  background: color-mix(in srgb, var(--rs-danger) 10%, transparent);
}

.nm-mongo-tools__status-meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  flex: 1;
  min-width: 0;
}

.nm-mongo-tools__status-name {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  font-family: var(--rs-font-mono);
  line-height: 1.2;
}

.nm-mongo-tools__status-path {
  font-size: 0.6875rem;
  color: var(--rs-muted);
  line-height: 1.3;
}

.nm-mongo-tools__status-path.is-missing {
  color: var(--rs-danger);
}

.nm-mongo-tools__status-dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.nm-mongo-tools__status-dot.is-ok {
  background: var(--rs-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-success) 18%, transparent);
}

.nm-mongo-tools__status-dot.is-missing {
  background: var(--rs-danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-danger) 14%, transparent);
}

.nm-mongo-tools__panel {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-lg);
  background: color-mix(in srgb, var(--rs-surface-raised) 92%, transparent);
  padding: var(--rs-space-md);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-mongo-tools__panel-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-text);
  min-width: 0;
}

.nm-mongo-tools__panel-head > :deep(svg) {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-mongo-tools__panel-hint {
  margin-left: var(--rs-space-xs);
  font-weight: 400;
  color: var(--rs-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mongo-tools__panel-actions {
  margin-left: auto;
  flex-shrink: 0;
}

.nm-mongo-tools__target-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(120px, 0.6fr);
  gap: var(--rs-space-sm);
}

.nm-mongo-tools__field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.nm-mongo-tools__field-label {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-weight: 500;
}

.nm-mongo-tools__ops {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--rs-space-md);
  align-items: stretch;
}

.nm-mongo-tools__op {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
  padding: var(--rs-space-sm) 0;
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-mongo-tools__op:first-of-type {
  border-top: none;
  padding-top: 0;
}

.nm-mongo-tools__op-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.nm-mongo-tools__op-title {
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
}

.nm-mongo-tools__op-desc {
  font-size: 0.6875rem;
  color: var(--rs-muted);
  line-height: 1.35;
}

.nm-mongo-tools__op-controls {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
}

.nm-mongo-tools__browse {
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

.nm-mongo-tools__browse:hover:not(:disabled) {
  color: var(--rs-text);
  background: var(--rs-item-hover);
}

.nm-mongo-tools__browse:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.nm-mongo-tools__browse:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.nm-mongo-tools__op-input {
  flex: 1;
  min-width: 0;
}

.nm-mongo-tools__panel--log {
  flex: 1;
  min-height: 10rem;
}

.nm-mongo-tools__log {
  flex: 1;
  min-height: 0;
  max-height: 16rem;
  overflow: auto;
  margin: 0;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-radius: var(--rs-radius-md);
  background: color-mix(in srgb, var(--rs-surface) 70%, #000 8%);
  border: 1px solid var(--rs-border-subtle);
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
  line-height: 1.5;
}

.nm-mongo-tools__log-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.6rem;
  padding: 0.15rem 0;
}

.nm-mongo-tools__log-line + .nm-mongo-tools__log-line {
  border-top: 1px solid color-mix(in srgb, var(--rs-border-subtle) 70%, transparent);
}

.nm-mongo-tools__log-id {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-mongo-tools__log-msg {
  color: var(--rs-text);
}

.nm-mongo-tools__log-path {
  color: var(--rs-info, var(--rs-primary));
  word-break: break-all;
}

.nm-mongo-tools__log-line.is-err .nm-mongo-tools__log-msg {
  color: var(--rs-danger);
}

.nm-mongo-tools__log-line.is-ok .nm-mongo-tools__log-msg {
  color: var(--rs-success);
}

.nm-mongo-tools__log-line.is-canceled .nm-mongo-tools__log-msg {
  color: var(--rs-muted);
  font-style: italic;
}

.nm-mongo-tools__log-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 5rem;
  border-radius: var(--rs-radius-md);
  border: 1px dashed var(--rs-border-subtle);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

.min-w-0 {
  min-width: 0;
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 960px) {
  .nm-mongo-tools__status {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .nm-mongo-tools__ops {
    grid-template-columns: 1fr;
  }

  .nm-mongo-tools__target-grid {
    grid-template-columns: 1fr 1fr;
  }

  .nm-mongo-tools__field--format {
    grid-column: 1 / -1;
  }
}

@media (max-width: 560px) {
  .nm-mongo-tools__status {
    grid-template-columns: 1fr;
  }

  .nm-mongo-tools__target-grid {
    grid-template-columns: 1fr;
  }

  .nm-mongo-tools__op-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .nm-mongo-tools__header {
    flex-direction: column;
  }
}
</style>
