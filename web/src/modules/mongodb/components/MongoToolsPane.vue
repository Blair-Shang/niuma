<script setup lang="ts">
import { RsButton, RsInput, RsLoading, RsSelect, useRsToast } from '@niuma/ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
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
const running = ref(false)

const toolRows = computed(() => {
  const d = detect.value
  if (!d) {
    return []
  }
  return [
    { id: 'mongodump', label: 'mongodump', entry: d.mongodump },
    { id: 'mongorestore', label: 'mongorestore', entry: d.mongorestore },
    { id: 'mongoexport', label: 'mongoexport', entry: d.mongoexport },
    { id: 'mongoimport', label: 'mongoimport', entry: d.mongoimport },
  ]
})

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
  if (!props.sessionId) {
    return
  }
  running.value = true
  tasks.track()
  try {
    const result = await runner()
    toast.success(t('modules.mongodb.tools.started', { taskId: result.taskId, tool: label }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.tools.runError'))
  } finally {
    running.value = false
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
      <h3 class="nm-mongo-tools__title">{{ t('modules.mongodb.tools.title') }}</h3>
      <RsButton size="sm" variant="ghost" :loading="loading" @click="refreshDetect">
        {{ t('modules.mongodb.tools.refresh') }}
      </RsButton>
    </header>

    <RsLoading v-if="loading" class="nm-mongo-tools__loading" :label="t('modules.mongodb.tools.detecting')" show-label />

    <div v-else class="nm-mongo-tools__body">
      <section class="nm-mongo-tools__section">
        <h4>{{ t('modules.mongodb.tools.status') }}</h4>
        <ul class="nm-mongo-tools__status">
          <li v-for="row in toolRows" :key="row.id">
            <span>{{ row.label }}</span>
            <span :class="row.entry.available ? 'ok' : 'missing'">
              {{ row.entry.available ? row.entry.path || t('modules.mongodb.tools.available') : t('modules.mongodb.tools.missing') }}
            </span>
          </li>
        </ul>
        <p class="nm-mongo-tools__hint">{{ t('modules.mongodb.tools.settingsHint') }}</p>
      </section>

      <section class="nm-mongo-tools__section">
        <h4>{{ t('modules.mongodb.tools.common') }}</h4>
        <div class="nm-mongo-tools__grid">
          <label>
            <span>{{ t('modules.mongodb.tools.database') }}</span>
            <RsInput v-model="database" :placeholder="t('modules.mongodb.tools.databasePlaceholder')" />
          </label>
          <label>
            <span>{{ t('modules.mongodb.tools.collection') }}</span>
            <RsInput v-model="collection" :placeholder="t('modules.mongodb.tools.collectionPlaceholder')" />
          </label>
          <label>
            <span>{{ t('modules.mongodb.tools.format') }}</span>
            <RsSelect v-model="format" :options="[
              { value: 'json', label: 'JSON' },
              { value: 'csv', label: 'CSV' },
            ]" />
          </label>
        </div>
      </section>

      <section class="nm-mongo-tools__section">
        <h4>{{ t('modules.mongodb.tools.backup') }}</h4>
        <div class="nm-mongo-tools__actions">
          <RsInput v-model="dumpOutputDir" :placeholder="t('modules.mongodb.tools.dumpDirPlaceholder')" />
          <RsButton size="sm" :disabled="!sessionId || running" @click="runDump">mongodump</RsButton>
        </div>
        <div class="nm-mongo-tools__actions">
          <RsInput v-model="restoreInputDir" :placeholder="t('modules.mongodb.tools.restoreDirPlaceholder')" />
          <RsButton size="sm" :disabled="!sessionId || running || !restoreInputDir" @click="runRestore">
            mongorestore
          </RsButton>
        </div>
      </section>

      <section class="nm-mongo-tools__section">
        <h4>{{ t('modules.mongodb.tools.importExport') }}</h4>
        <div class="nm-mongo-tools__actions">
          <RsInput v-model="exportOutputPath" :placeholder="t('modules.mongodb.tools.exportPathPlaceholder')" />
          <RsButton
            size="sm"
            :disabled="!sessionId || running || !database || !collection"
            @click="runExport"
          >
            mongoexport
          </RsButton>
        </div>
        <div class="nm-mongo-tools__actions">
          <RsInput v-model="importInputPath" :placeholder="t('modules.mongodb.tools.importPathPlaceholder')" />
          <RsButton
            size="sm"
            :disabled="!sessionId || running || !database || !collection || !importInputPath"
            @click="runImport"
          >
            mongoimport
          </RsButton>
        </div>
      </section>

      <section v-if="tasks.lines.value.length" class="nm-mongo-tools__section">
        <h4>{{ t('modules.mongodb.tools.log') }}</h4>
        <pre class="nm-mongo-tools__log">
          <div v-for="(line, idx) in tasks.lines.value" :key="idx" :class="line.ok === false ? 'err' : ''">
            [{{ line.taskId }}] {{ line.message }}
            <template v-if="line.outputPath"> → {{ line.outputPath }}</template>
          </div>
        </pre>
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
  overflow: auto;
}

.nm-mongo-tools__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-mongo-tools__title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-mongo-tools__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-mongo-tools__body {
  padding: var(--rs-space-md);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-lg);
}

.nm-mongo-tools__section h4 {
  margin: 0 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-sm);
}

.nm-mongo-tools__status {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--rs-space-xs);
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
}

.nm-mongo-tools__status li {
  display: flex;
  justify-content: space-between;
  gap: var(--rs-space-md);
}

.nm-mongo-tools__status .ok {
  color: var(--rs-success);
}

.nm-mongo-tools__status .missing {
  color: var(--rs-danger);
}

.nm-mongo-tools__hint {
  margin: var(--rs-space-sm) 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-mongo-tools__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--rs-space-sm);
}

.nm-mongo-tools__grid label {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
  font-size: var(--rs-font-size-xs);
}

.nm-mongo-tools__actions {
  display: flex;
  gap: var(--rs-space-sm);
  align-items: center;
  margin-bottom: var(--rs-space-sm);
}

.nm-mongo-tools__actions :deep(.rs-input) {
  flex: 1;
}

.nm-mongo-tools__log {
  margin: 0;
  padding: var(--rs-space-sm);
  background: var(--rs-surface-raised);
  border-radius: var(--rs-radius-sm);
  font-size: var(--rs-font-size-xs);
  max-height: 200px;
  overflow: auto;
}

.nm-mongo-tools__log .err {
  color: var(--rs-danger);
}
</style>
