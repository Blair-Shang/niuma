<script setup lang="ts">
import { RsButton, RsEmpty, RsIcon, RsLoading, RsMonacoEditor, RsSplitPane, MONACO_MONGODB_SHELL_LANGUAGE } from '@niuma/ui'
import type { RsSplitPaneItem } from '@niuma/ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import { useMongoPipelineSuggest } from '@/modules/mongodb/composables/useMongoPipelineSuggest'
import { useMongoQuerySuggest } from '@/modules/mongodb/composables/useMongoQuerySuggest'
import { formatMongoJson } from '@/modules/mongodb/utils/format'
import { mongoPipelineJsonSchema } from '@/modules/mongodb/utils/pipeline-schema'
import { resolveMongoShellCompletionPrefix } from '@/modules/mongodb/utils/shell-completion-prefix'
import { loadMongoToolPaths } from '@/modules/mongodb/utils/tool-paths'
import {
  clearDiagnostic,
  clearEditorSelection,
  publishDiagnostic,
  publishEditorSelection,
} from '@/shell/panels/ai/workspace-context'
import { useTabStore } from '@/stores/tab'

type QueryMode = 'shell' | 'pipeline'

const props = defineProps<{
  sessionId: string | null
  initialDatabase?: string
  initialCollection?: string
  active: boolean
}>()

const { t } = useI18n()

const editorRef = ref<InstanceType<typeof RsMonacoEditor> | null>(null)

const database = ref(props.initialDatabase ?? '')
const collection = ref(props.initialCollection ?? '')
const queryMode = ref<QueryMode>('shell')

const DEFAULT_PIPELINE = '[\n  { "$match": {} },\n  { "$limit": 20 }\n]'

function defaultShellQuery(db: string, coll: string): string {
  const name = coll.trim() || 'collection'
  const needsGet = /[.\-$ ]/.test(name) || /^\d/.test(name)
  if (needsGet) {
    const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    return `db.getCollection('${escaped}').find({}).limit(20)`
  }
  if (db.trim()) {
    return `db.getCollection('${name}').find({}).limit(20)`
  }
  return `db.${name}.find({}).limit(20)`
}

const queryText = ref(defaultShellQuery(props.initialDatabase ?? '', props.initialCollection ?? ''))

const resultRaw = ref('')
const loading = ref(false)
const elapsed = ref<number | null>(null)
const isExplain = ref(false)
const resultCount = ref(0)
const resultExecuted = ref(false)
const resultRevision = ref(0)
const resultEngine = ref<string | null>(null)
const toolPaths = ref<Record<string, string>>({})

const showResult = computed(() => resultExecuted.value)

const splitPanes: RsSplitPaneItem[] = [
  { key: 'editor', size: 44, min: 20, resizerHandle: true },
  { key: 'result', size: 56, min: 22 },
]

const hasTarget = computed(() => {
  if (!props.sessionId || database.value.trim().length === 0) return false
  if (queryMode.value === 'pipeline') {
    return collection.value.trim().length > 0
  }
  return true
})

const editorLanguage = computed(() =>
  queryMode.value === 'shell' ? MONACO_MONGODB_SHELL_LANGUAGE : 'json',
)

const shellTriggerCharacters = ['.', '$', "'", '"', '{', ',', ' ']

const { provideCompletions: providePipelineCompletions } = useMongoPipelineSuggest(() => ({
  sessionId: props.sessionId,
  database: database.value,
  collection: collection.value,
}))

const { provideCompletions: provideQueryCompletions, warmMetadata: warmQuerySuggest } =
  useMongoQuerySuggest(() => ({
  sessionId: props.sessionId,
  database: database.value,
  collection: collection.value,
}))

const editorCompletion = computed(() =>
  queryMode.value === 'shell' ? provideQueryCompletions : providePipelineCompletions,
)

const editorTriggerCharacters = computed(() =>
  queryMode.value === 'shell' ? shellTriggerCharacters : undefined,
)

const editorPrefixResolver = computed(() =>
  queryMode.value === 'shell' ? resolveMongoShellCompletionPrefix : undefined,
)

function formatQueryResult(result: {
  documents?: unknown[]
  document?: unknown
  explain?: unknown
  count?: number
  output?: string
  engine?: string
}, explain: boolean): void {
  resultEngine.value = result.engine ?? null
  if (explain) {
    resultRaw.value = formatMongoJson(result.explain ?? result.document ?? result.output)
    resultCount.value = 1
    return
  }
  if (result.documents) {
    resultRaw.value = formatMongoJson(result.documents)
    resultCount.value = result.documents.length
    return
  }
  if (result.document !== undefined) {
    resultRaw.value = formatMongoJson(result.document)
    resultCount.value = result.document == null ? 0 : 1
    return
  }
  if (result.output) {
    resultRaw.value = result.output
    resultCount.value = result.count ?? 1
    return
  }
  if (result.count !== undefined) {
    resultRaw.value = String(result.count)
    resultCount.value = 1
    return
  }
  resultRaw.value = '[]'
  resultCount.value = 0
}

async function runShell(explain: boolean): Promise<void> {
  const result = await mongodbApi.queryExec({
    sessionId: props.sessionId!,
    database: database.value.trim(),
    input: queryText.value,
    explain,
    toolPaths: toolPaths.value,
  })
  formatQueryResult(result, explain)
}

async function runPipeline(explain: boolean): Promise<void> {
  const pipeline = JSON.parse(queryText.value) as unknown
  if (!Array.isArray(pipeline)) {
    throw new TypeError(t('modules.mongodb.query.pipelineArrayRequired'))
  }
  if (explain) {
    const result = await mongodbApi.aggregateExplain({
      sessionId: props.sessionId!,
      database: database.value.trim(),
      collection: collection.value.trim(),
      pipeline,
    })
    formatQueryResult({ explain: result.explain }, true)
  } else {
    const result = await mongodbApi.aggregateRun({
      sessionId: props.sessionId!,
      database: database.value.trim(),
      collection: collection.value.trim(),
      pipeline,
    })
    formatQueryResult({ documents: result.documents }, false)
  }
}

async function run(explain: boolean): Promise<void> {
  if (!hasTarget.value) return
  loading.value = true
  isExplain.value = explain
  resultRaw.value = ''
  resultCount.value = 0
  resultEngine.value = null
  resultExecuted.value = false
  elapsed.value = null
  const t0 = performance.now()
  try {
    if (queryMode.value === 'shell') {
      await runShell(explain)
    } else {
      await runPipeline(explain)
    }
    elapsed.value = Math.round(performance.now() - t0)
    resultExecuted.value = true
    resultRevision.value += 1
    clearDiagnostic(`mongo-query:${props.sessionId ?? 'na'}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : t('modules.mongodb.query.runError')
    elapsed.value = Math.round(performance.now() - t0)
    resultRaw.value = msg
    resultCount.value = 0
    resultEngine.value = null
    resultExecuted.value = true
    resultRevision.value += 1
    publishDiagnostic({
      id: `mongo-query:${props.sessionId ?? 'na'}`,
      label: explain ? 'Mongo Explain' : 'Mongo Query',
      detail: database.value.trim() || undefined,
      text: msg,
      kind: explain ? 'explain' : 'query',
      tabId: useTabStore().activeTabId || undefined,
    })
  } finally {
    loading.value = false
  }
}

function formatQuery(): void {
  if (queryMode.value === 'shell') {
    editorRef.value?.format()
    return
  }
  try {
    const parsed: unknown = JSON.parse(queryText.value)
    queryText.value = JSON.stringify(parsed, null, 2)
  } catch {
    editorRef.value?.format()
    return
  }
  editorRef.value?.format()
}

function setQueryMode(mode: QueryMode): void {
  if (queryMode.value === mode) return
  queryMode.value = mode
  queryText.value = mode === 'shell'
    ? defaultShellQuery(database.value, collection.value)
    : DEFAULT_PIPELINE
  resultExecuted.value = false
}

async function copyResult(): Promise<void> {
  await navigator.clipboard.writeText(resultRaw.value)
}

watch(
  () => [props.initialDatabase, props.initialCollection] as const,
  ([db, coll]) => {
    if (db) database.value = db
    if (coll) collection.value = coll
  },
  { immediate: true },
)

watch([database, collection], ([db, coll]) => {
  if (queryMode.value !== 'shell') return
  const current = queryText.value.trim()
  const previousDefaults = [
    defaultShellQuery('', ''),
    defaultShellQuery(db ?? '', ''),
    defaultShellQuery('', coll ?? ''),
  ].map((item) => item.trim())
  if (previousDefaults.includes(current)) {
    queryText.value = defaultShellQuery(db ?? '', coll ?? '')
  }
})

onMounted(async () => {
  toolPaths.value = await loadMongoToolPaths()
  void warmQuerySuggest()
  void nextTick(() => bindEditorSelection())
})

watch([database, collection, () => props.sessionId], () => {
  void warmQuerySuggest()
})

watch(
  () => props.active,
  (active) => {
    if (active) {
      void nextTick(() => bindEditorSelection())
      return
    }
    clearEditorSelection(useTabStore().activeTabId || undefined)
  },
)

let selectionDisposable: { dispose: () => void } | null = null

function bindEditorSelection(): void {
  selectionDisposable?.dispose()
  selectionDisposable = null
  const editor = editorRef.value?.getEditor?.() ?? null
  if (!editor) {
    return
  }
  const sync = () => {
    if (!props.active) {
      return
    }
    const model = editor.getModel()
    const sel = editor.getSelection()
    if (!model || !sel || sel.isEmpty()) {
      clearEditorSelection(useTabStore().activeTabId || undefined)
      return
    }
    publishEditorSelection({
      tabId: useTabStore().activeTabId || undefined,
      text: model.getValueInRange(sel),
      language: queryMode.value === 'shell' ? 'javascript' : 'json',
      source: 'monaco',
    })
  }
  selectionDisposable = editor.onDidChangeCursorSelection(sync)
  sync()
}

onUnmounted(() => {
  selectionDisposable?.dispose()
  selectionDisposable = null
  clearEditorSelection(useTabStore().activeTabId || undefined)
})
</script>

<template>
  <div class="nm-query">
    <!-- ── Top toolbar ── -->
    <header class="nm-query__toolbar">
      <div class="nm-query__breadcrumb">
        <RsIcon name="database" :size="13" class="nm-query__bc-icon" />
        <input
          v-model="database"
          class="nm-query__seg-input"
          :placeholder="t('modules.mongodb.query.database')"
          spellcheck="false"
          :aria-label="t('modules.mongodb.query.database')"
        />
        <span class="nm-query__bc-dot">.</span>
        <RsIcon name="table-2" :size="13" class="nm-query__bc-icon" />
        <input
          v-model="collection"
          class="nm-query__seg-input nm-query__seg-input--coll"
          :placeholder="t('modules.mongodb.query.collection')"
          spellcheck="false"
          :aria-label="t('modules.mongodb.query.collection')"
        />
      </div>

      <div class="nm-query__mode-switch" role="tablist" :aria-label="t('modules.mongodb.query.modeLabel')">
        <button
          type="button"
          class="nm-query__mode-btn"
          :class="{ 'nm-query__mode-btn--active': queryMode === 'shell' }"
          role="tab"
          :aria-selected="queryMode === 'shell'"
          @click="setQueryMode('shell')"
        >
          {{ t('modules.mongodb.query.modeShell') }}
        </button>
        <button
          type="button"
          class="nm-query__mode-btn"
          :class="{ 'nm-query__mode-btn--active': queryMode === 'pipeline' }"
          role="tab"
          :aria-selected="queryMode === 'pipeline'"
          @click="setQueryMode('pipeline')"
        >
          {{ t('modules.mongodb.query.modePipeline') }}
        </button>
      </div>

      <div class="nm-query__toolbar-right">
        <RsButton size="sm" variant="ghost" :disabled="loading" @click="formatQuery">
          <RsIcon name="braces" :size="13" />
          {{ t('modules.mongodb.query.format') }}
        </RsButton>
        <RsButton
          size="sm"
          variant="ghost"
          :loading="loading"
          :disabled="!hasTarget"
          @click="run(true)"
        >
          {{ t('modules.mongodb.query.explain') }}
        </RsButton>
        <RsButton
          size="sm"
          variant="primary"
          :loading="loading"
          :disabled="!hasTarget"
          @click="run(false)"
        >
          <RsIcon name="play" :size="13" />
          {{ t('modules.mongodb.query.run') }}
        </RsButton>
      </div>
    </header>

    <RsSplitPane :panes="splitPanes" orientation="vertical" class="nm-query__split" with-handle>
      <template #editor>
        <div class="nm-query__pane-shell">
          <div class="nm-query__pane-head">
            <span class="nm-query__pane-title">
              {{ queryMode === 'shell' ? t('modules.mongodb.query.shell') : t('modules.mongodb.query.pipeline') }}
            </span>
            <span class="nm-query__pane-hint">
              {{ queryMode === 'shell' ? t('modules.mongodb.query.shellHint') : t('modules.mongodb.query.pipelineHint') }}
            </span>
          </div>
          <RsMonacoEditor
            ref="editorRef"
            v-model="queryText"
            :language="editorLanguage"
            height="100%"
            class="nm-query__editor"
            :json-schema="queryMode === 'pipeline' ? mongoPipelineJsonSchema : undefined"
            :completion-request="editorCompletion"
            :completion-trigger-characters="editorTriggerCharacters"
            :completion-prefix-resolver="editorPrefixResolver"
          />
        </div>
      </template>

      <template #result>
        <div class="nm-query__pane-shell">
          <div class="nm-query__pane-head nm-query__pane-head--result">
            <span class="nm-query__pane-title">{{ t('modules.mongodb.query.result') }}</span>
            <template v-if="showResult && !loading">
              <span class="nm-query__result-meta">
                {{
                  isExplain
                    ? t('modules.mongodb.query.explainResult')
                    : t('modules.mongodb.query.docsCount', { count: resultCount })
                }}
              </span>
              <span
                v-if="queryMode === 'shell' && resultEngine"
                class="nm-query__engine"
                :title="resultEngine === 'mongosh'
                  ? t('modules.mongodb.query.engineMongosh')
                  : t('modules.mongodb.query.engineDriver')"
              >
                {{ resultEngine === 'mongosh'
                  ? t('modules.mongodb.query.engineMongosh')
                  : t('modules.mongodb.query.engineDriver') }}
              </span>
              <span v-if="elapsed !== null" class="nm-query__elapsed">{{ elapsed }}ms</span>
            </template>
            <div class="nm-query__result-actions">
              <button
                v-if="showResult && !loading"
                type="button"
                class="nm-query__icon-btn"
                :title="t('modules.mongodb.query.copy')"
                @click="copyResult"
              >
                <RsIcon name="copy" :size="13" />
              </button>
            </div>
          </div>

          <div class="nm-query__result-body">
            <RsLoading v-if="loading" class="nm-query__loading" />

            <RsEmpty
              v-else-if="!showResult"
              fill
              class="nm-query__empty"
              icon="play-circle"
              :description="t('modules.mongodb.query.empty')"
            />

            <RsMonacoEditor
              v-else
              :key="resultRevision"
              v-model="resultRaw"
              language="plaintext"
              height="100%"
              :readonly="true"
              class="nm-query__result-editor"
            />
          </div>
        </div>
      </template>
    </RsSplitPane>
  </div>
</template>

<style scoped>
.nm-query {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-query__toolbar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding: 0 var(--rs-space-md);
  height: 44px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-query__breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.nm-query__mode-switch {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: var(--rs-radius-xs);
  background: var(--rs-surface-subtle);
  border: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-query__mode-btn {
  border: none;
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  padding: 4px 10px;
  border-radius: calc(var(--rs-radius-xs) - 1px);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.nm-query__mode-btn:hover {
  color: var(--rs-foreground);
}

.nm-query__mode-btn--active {
  background: var(--rs-surface);
  color: var(--rs-foreground);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.nm-query__bc-icon {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-query__bc-dot {
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
  font-family: var(--rs-font-mono);
}

.nm-query__seg-input {
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--rs-font-size-sm);
  font-family: var(--rs-font-mono);
  color: var(--rs-foreground);
  font-weight: 500;
  min-width: 60px;
  max-width: 160px;
  padding: 2px 4px;
  border-radius: var(--rs-radius-xs);
}

.nm-query__seg-input:focus {
  background: var(--rs-surface-subtle);
  outline: 1px solid var(--rs-border);
}

.nm-query__seg-input::placeholder {
  color: var(--rs-placeholder);
  font-weight: 400;
}

.nm-query__seg-input--coll {
  max-width: 200px;
}

.nm-query__toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

.nm-query__split {
  flex: 1;
  min-height: 0;
}

.nm-query__split :deep(.rs-split__pane) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.nm-query__pane-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-query__pane-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
  padding: 0 var(--rs-space-md);
  height: 32px;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-subtle);
}

.nm-query__pane-head--result {
  gap: var(--rs-space-xs);
}

.nm-query__pane-title {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-foreground);
}

.nm-query__pane-hint {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-query__editor,
.nm-query__result-editor {
  flex: 1;
  min-height: 0;
  border-radius: 0;
  border: none;
}

.nm-query__result-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-query__result-meta {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-family: var(--rs-font-mono);
}

.nm-query__elapsed {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-family: var(--rs-font-mono);
  background: var(--rs-surface);
  border: 1px solid var(--rs-border-subtle);
  border-radius: 999px;
  padding: 0 6px;
}

.nm-query__engine {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-family: var(--rs-font-mono);
  background: var(--rs-surface);
  border: 1px solid var(--rs-border-subtle);
  border-radius: 999px;
  padding: 0 6px;
}

.nm-query__result-actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  margin-left: auto;
}

.nm-query__icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.nm-query__icon-btn:hover {
  background: var(--rs-item-hover);
  color: var(--rs-foreground);
}

.nm-query__loading,
.nm-query__empty {
  flex: 1;
}
</style>
