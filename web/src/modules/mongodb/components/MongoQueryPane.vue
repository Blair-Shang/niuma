<script setup lang="ts">
import { RsButton, RsInput, RsLabel, RsLoading, useRsToast } from '@niuma/ui'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import { formatMongoJson } from '@/modules/mongodb/utils/format'

const props = defineProps<{
  sessionId: string | null
  initialDatabase?: string
  initialCollection?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

const database = ref(props.initialDatabase ?? '')
const collection = ref(props.initialCollection ?? '')
const pipelineText = ref('[\n  { "$match": {} },\n  { "$limit": 20 }\n]')
const resultText = ref('')
const loading = ref(false)

async function run(explain: boolean): Promise<void> {
  if (!props.sessionId || !database.value.trim() || !collection.value.trim()) {
    return
  }
  loading.value = true
  try {
    const pipeline = JSON.parse(pipelineText.value) as unknown
    if (!Array.isArray(pipeline)) {
      throw new Error(t('modules.mongodb.query.pipelineArrayRequired'))
    }
    if (explain) {
      const result = await mongodbApi.aggregateExplain({
        sessionId: props.sessionId,
        database: database.value.trim(),
        collection: collection.value.trim(),
        pipeline,
      })
      resultText.value = formatMongoJson(result.explain)
    } else {
      const result = await mongodbApi.aggregateRun({
        sessionId: props.sessionId,
        database: database.value.trim(),
        collection: collection.value.trim(),
        pipeline,
      })
      resultText.value = formatMongoJson(result.documents)
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.query.runError'))
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.initialDatabase, props.initialCollection] as const,
  ([db, coll]) => {
    if (db) database.value = db
    if (coll) collection.value = coll
  },
  { immediate: true },
)
</script>

<template>
  <div class="nm-mongo-query">
    <div class="nm-mongo-query__fields">
      <div class="nm-mongo-query__field">
        <RsLabel>{{ t('modules.mongodb.query.database') }}</RsLabel>
        <RsInput v-model="database" autocomplete="off" />
      </div>
      <div class="nm-mongo-query__field">
        <RsLabel>{{ t('modules.mongodb.query.collection') }}</RsLabel>
        <RsInput v-model="collection" autocomplete="off" />
      </div>
    </div>
    <label class="nm-mongo-query__editor-label">{{ t('modules.mongodb.query.pipeline') }}</label>
    <textarea v-model="pipelineText" class="nm-mongo-query__editor" spellcheck="false" />
    <div class="nm-mongo-query__actions">
      <RsButton size="sm" variant="primary" :loading="loading" :disabled="!sessionId" @click="run(false)">
        {{ t('modules.mongodb.query.run') }}
      </RsButton>
      <RsButton size="sm" variant="ghost" :loading="loading" :disabled="!sessionId" @click="run(true)">
        {{ t('modules.mongodb.query.explain') }}
      </RsButton>
    </div>
    <label class="nm-mongo-query__editor-label">{{ t('modules.mongodb.query.result') }}</label>
    <RsLoading v-if="loading && !resultText" class="nm-mongo-query__loading" />
    <pre v-else class="nm-mongo-query__result">{{ resultText || t('modules.mongodb.query.empty') }}</pre>
  </div>
</template>

<style scoped>
.nm-mongo-query {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
  height: 100%;
  min-height: 0;
  padding: var(--rs-space-md);
}

.nm-mongo-query__fields {
  display: flex;
  gap: var(--rs-space-md);
}

.nm-mongo-query__field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-mongo-query__editor-label {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-mongo-query__editor {
  min-height: 140px;
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-sm);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  padding: var(--rs-space-sm);
  resize: vertical;
}

.nm-mongo-query__actions {
  display: flex;
  gap: var(--rs-space-sm);
}

.nm-mongo-query__result {
  flex: 1;
  min-height: 160px;
  margin: 0;
  overflow: auto;
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-sm);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  padding: var(--rs-space-sm);
  white-space: pre-wrap;
}

.nm-mongo-query__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
