<script setup lang="ts">
import { RsButton, RsEmpty, RsLoading, RsTable, useRsToast } from '@niuma/ui'
import type { RsTableColumn } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import type { MongoCollectionInfo, MongoDatabaseInfo, MongoDocument } from '@/api/types/mongodb'
import MongoDocumentViewer from '@/modules/mongodb/components/MongoDocumentViewer.vue'
import { formatMongoId, previewMongoDocument } from '@/modules/mongodb/utils/format'

const props = defineProps<{
  sessionId: string | null
  profileId: string
  initialDatabase?: string
  initialCollection?: string
  active: boolean
}>()

interface DocRow extends Record<string, unknown> {
  id: string
  doc: MongoDocument
  preview: string
}

const { t } = useI18n()
const toast = useRsToast()

const databases = ref<MongoDatabaseInfo[]>([])
const collections = ref<MongoCollectionInfo[]>([])
const selectedDatabase = ref('')
const selectedCollection = ref('')
const documents = ref<MongoDocument[]>([])
const skip = ref(0)
const hasMore = ref(false)
const total = ref<number | undefined>(undefined)
const loadingMeta = ref(false)
const loadingDocs = ref(false)

const viewerOpen = ref(false)
const viewerDoc = ref<MongoDocument | null>(null)
const insertMode = ref(false)

const columns = computed((): RsTableColumn<DocRow>[] => [
  { key: 'id', title: '_id', ellipsis: true, minWidth: 180 },
  { key: 'preview', title: t('modules.mongodb.collections.preview'), ellipsis: true, minWidth: 280 },
  { key: 'actions', title: t('modules.mongodb.collections.actions'), width: 100 },
])

const rows = computed((): DocRow[] =>
  documents.value.map((doc, index) => ({
    id: `${formatMongoId(doc._id)}-${index}`,
    doc,
    preview: previewMongoDocument(doc),
  })),
)

async function loadDatabases(): Promise<void> {
  if (!props.sessionId) {
    return
  }
  loadingMeta.value = true
  try {
    const result = await mongodbApi.treeDatabases({ profileId: props.profileId })
    databases.value = result.databases
    if (!selectedDatabase.value && result.databases.length > 0) {
      selectedDatabase.value = props.initialDatabase ?? result.databases[0]?.name ?? ''
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.collections.loadDbError'))
  } finally {
    loadingMeta.value = false
  }
}

async function loadCollections(): Promise<void> {
  if (!props.sessionId || !selectedDatabase.value) {
    collections.value = []
    return
  }
  loadingMeta.value = true
  try {
    const result = await mongodbApi.treeCollections({
      sessionId: props.sessionId,
      database: selectedDatabase.value,
    })
    collections.value = result.collections
    if (props.initialCollection && result.collections.some((c) => c.name === props.initialCollection)) {
      selectedCollection.value = props.initialCollection
    } else if (!selectedCollection.value && result.collections.length > 0) {
      selectedCollection.value = result.collections[0]?.name ?? ''
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.collections.loadCollError'))
  } finally {
    loadingMeta.value = false
  }
}

async function loadDocuments(reset: boolean): Promise<void> {
  if (!props.sessionId || !selectedDatabase.value || !selectedCollection.value || loadingDocs.value) {
    return
  }
  loadingDocs.value = true
  try {
    if (reset) {
      skip.value = 0
    }
    const result = await mongodbApi.documentFind({
      sessionId: props.sessionId,
      database: selectedDatabase.value,
      collection: selectedCollection.value,
      skip: skip.value,
      limit: 50,
    })
    documents.value = reset ? result.documents : [...documents.value, ...result.documents]
    hasMore.value = result.hasMore
    total.value = result.total
    skip.value += result.documents.length
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.collections.loadDocError'))
  } finally {
    loadingDocs.value = false
  }
}

function selectDatabase(name: string): void {
  if (selectedDatabase.value === name) {
    return
  }
  selectedDatabase.value = name
  selectedCollection.value = ''
  documents.value = []
}

function selectCollection(name: string): void {
  if (selectedCollection.value === name) {
    return
  }
  selectedCollection.value = name
  documents.value = []
}

watch(selectedCollection, (coll) => {
  if (coll && props.sessionId) {
    void loadDocuments(true)
  }
})

function openDocument(doc: MongoDocument): void {
  viewerDoc.value = doc
  insertMode.value = false
  viewerOpen.value = true
}

function openInsert(): void {
  viewerDoc.value = {}
  insertMode.value = true
  viewerOpen.value = true
}

function onViewerSaved(): void {
  viewerOpen.value = false
  void loadDocuments(true)
}

function onViewerDeleted(): void {
  viewerOpen.value = false
  void loadDocuments(true)
}

watch(
  () => props.sessionId,
  (sid) => {
    if (sid && props.active) {
      void loadDatabases()
    }
  },
  { immediate: true },
)

watch(selectedDatabase, () => {
  void loadCollections()
})

watch(
  () => props.active,
  (active) => {
    if (active && props.sessionId && databases.value.length === 0) {
      void loadDatabases()
    }
  },
)

watch(
  () => [props.initialDatabase, props.initialCollection] as const,
  ([db, coll]) => {
    if (db) {
      selectedDatabase.value = db
    }
    if (coll) {
      selectedCollection.value = coll
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="nm-mongo-collections">
    <aside class="nm-mongo-collections__sidebar">
      <section class="nm-mongo-collections__section">
        <h3 class="nm-mongo-collections__section-title">{{ t('modules.mongodb.session.databases') }}</h3>
        <RsLoading v-if="loadingMeta && databases.length === 0" />
        <ul v-else class="nm-mongo-collections__list">
          <li
            v-for="db in databases"
            :key="db.name"
            class="nm-mongo-collections__item"
            :class="{ 'nm-mongo-collections__item--active': selectedDatabase === db.name }"
            @click="selectDatabase(db.name)"
          >
            {{ db.name }}
          </li>
        </ul>
      </section>

      <section v-if="selectedDatabase" class="nm-mongo-collections__section">
        <h3 class="nm-mongo-collections__section-title">{{ t('modules.mongodb.collections.title') }}</h3>
        <ul v-if="collections.length" class="nm-mongo-collections__list">
          <li
            v-for="coll in collections"
            :key="coll.name"
            class="nm-mongo-collections__item"
            :class="{ 'nm-mongo-collections__item--active': selectedCollection === coll.name }"
            @click="selectCollection(coll.name)"
          >
            <span>{{ coll.name }}</span>
            <span v-if="coll.count !== undefined" class="nm-mongo-collections__badge">{{ coll.count }}</span>
          </li>
        </ul>
        <p v-else class="nm-mongo-collections__empty">{{ t('modules.mongodb.session.noCollections') }}</p>
      </section>
    </aside>

    <main class="nm-mongo-collections__main">
      <header class="nm-mongo-collections__toolbar">
        <div class="nm-mongo-collections__path">
          <span v-if="selectedDatabase">{{ selectedDatabase }}</span>
          <span v-if="selectedCollection"> / {{ selectedCollection }}</span>
        </div>
        <div class="nm-mongo-collections__actions">
          <span v-if="total !== undefined" class="nm-mongo-collections__count">
            {{ t('modules.mongodb.collections.total', { count: total }) }}
          </span>
          <RsButton size="sm" variant="ghost" :disabled="!selectedCollection || loadingDocs" @click="loadDocuments(true)">
            {{ t('modules.mongodb.collections.refresh') }}
          </RsButton>
          <RsButton size="sm" variant="primary" :disabled="!selectedCollection" @click="openInsert">
            {{ t('modules.mongodb.collections.insert') }}
          </RsButton>
        </div>
      </header>

      <RsLoading v-if="loadingDocs && documents.length === 0" class="nm-mongo-collections__loading" />

      <RsEmpty v-else-if="!selectedCollection" :description="t('modules.mongodb.collections.pickCollection')" />

      <RsEmpty v-else-if="documents.length === 0 && !loadingDocs" :description="t('modules.mongodb.collections.empty')" />

      <div v-else class="nm-mongo-collections__table-wrap">
        <RsTable :columns="columns" :data="rows" row-key="id">
          <template #cell-id="{ row }">
            <button type="button" class="nm-mongo-collections__link" @click="openDocument(row.doc)">
              {{ formatMongoId(row.doc._id) }}
            </button>
          </template>
          <template #cell-actions="{ row }">
            <RsButton size="sm" variant="ghost" @click="openDocument(row.doc)">
              {{ t('modules.mongodb.collections.view') }}
            </RsButton>
          </template>
        </RsTable>
        <div v-if="hasMore" class="nm-mongo-collections__more">
          <RsButton size="sm" variant="ghost" :loading="loadingDocs" @click="loadDocuments(false)">
            {{ t('modules.mongodb.collections.loadMore') }}
          </RsButton>
        </div>
      </div>
    </main>

    <MongoDocumentViewer
      v-if="sessionId && selectedDatabase && selectedCollection"
      v-model:open="viewerOpen"
      :session-id="sessionId"
      :database="selectedDatabase"
      :collection="selectedCollection"
      :document="viewerDoc"
      :insert-mode="insertMode"
      @saved="onViewerSaved"
      @deleted="onViewerDeleted"
    />
  </div>
</template>

<style scoped>
.nm-mongo-collections {
  display: flex;
  height: 100%;
  min-height: 0;
}

.nm-mongo-collections__sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--rs-border-subtle);
  overflow: auto;
  padding: var(--rs-space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
}

.nm-mongo-collections__section-title {
  margin: 0 0 var(--rs-space-xs);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.nm-mongo-collections__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nm-mongo-collections__item {
  display: flex;
  justify-content: space-between;
  gap: var(--rs-space-xs);
  padding: var(--rs-space-xs) var(--rs-space-sm);
  border-radius: var(--rs-radius-sm);
  font-size: var(--rs-font-size-sm);
  cursor: pointer;
}

.nm-mongo-collections__item:hover {
  background: var(--rs-surface-hover);
}

.nm-mongo-collections__item--active {
  background: var(--rs-accent-subtle);
  color: var(--rs-accent);
}

.nm-mongo-collections__badge {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-mongo-collections__empty {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-mongo-collections__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.nm-mongo-collections__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-mongo-collections__path {
  font-size: var(--rs-font-size-sm);
  font-family: var(--rs-font-mono);
}

.nm-mongo-collections__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
}

.nm-mongo-collections__count {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-mongo-collections__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-mongo-collections__table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--rs-space-sm);
}

.nm-mongo-collections__link {
  border: none;
  background: none;
  padding: 0;
  color: var(--rs-accent);
  cursor: pointer;
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-sm);
}

.nm-mongo-collections__more {
  display: flex;
  justify-content: center;
  padding: var(--rs-space-sm);
}
</style>
