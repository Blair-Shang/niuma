<script setup lang="ts">
import { RsButton, RsInput, RsLabel, RsLoading, RsTable, useRsToast } from '@niuma/ui'
import type { RsTableColumn } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import type { MongoSchemaField } from '@/api/types/mongodb'

const props = defineProps<{
  sessionId: string | null
  initialDatabase?: string
  initialCollection?: string
  active: boolean
}>()

interface FieldRow extends Record<string, unknown> {
  id: string
  path: string
  types: string
  frequency: string
}

const { t } = useI18n()
const toast = useRsToast()

const database = ref(props.initialDatabase ?? '')
const collection = ref(props.initialCollection ?? '')
const fields = ref<MongoSchemaField[]>([])
const loading = ref(false)

const columns = computed((): RsTableColumn<FieldRow>[] => [
  { key: 'path', title: t('modules.mongodb.schema.path'), minWidth: 180 },
  { key: 'types', title: t('modules.mongodb.schema.types'), width: 160 },
  { key: 'frequency', title: t('modules.mongodb.schema.frequency'), width: 100, align: 'right' },
])

const rows = computed((): FieldRow[] =>
  fields.value.map((f) => ({
    id: f.path,
    path: f.path,
    types: f.types.join(', '),
    frequency: `${Math.round(f.frequency * 100)}%`,
  })),
)

async function sample(): Promise<void> {
  if (!props.sessionId || !database.value.trim() || !collection.value.trim()) {
    return
  }
  loading.value = true
  try {
    const result = await mongodbApi.schemaSample({
      sessionId: props.sessionId,
      database: database.value.trim(),
      collection: collection.value.trim(),
      sampleSize: 100,
    })
    fields.value = result.fields
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.schema.sampleError'))
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
  <div class="nm-mongo-schema">
    <div class="nm-mongo-schema__fields">
      <div class="nm-mongo-schema__field">
        <RsLabel>{{ t('modules.mongodb.query.database') }}</RsLabel>
        <RsInput v-model="database" autocomplete="off" />
      </div>
      <div class="nm-mongo-schema__field">
        <RsLabel>{{ t('modules.mongodb.query.collection') }}</RsLabel>
        <RsInput v-model="collection" autocomplete="off" />
      </div>
      <RsButton size="sm" variant="primary" :loading="loading" :disabled="!sessionId" @click="sample">
        {{ t('modules.mongodb.schema.sample') }}
      </RsButton>
    </div>
    <RsLoading v-if="loading && fields.length === 0" class="nm-mongo-schema__loading" />
    <RsTable v-else :columns="columns" :data="rows" row-key="id" />
  </div>
</template>

<style scoped>
.nm-mongo-schema {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  height: 100%;
  min-height: 0;
  padding: var(--rs-space-md);
}

.nm-mongo-schema__fields {
  display: flex;
  gap: var(--rs-space-md);
  align-items: flex-end;
}

.nm-mongo-schema__field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-mongo-schema__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
