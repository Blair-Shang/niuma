<script setup lang="ts">
import { RsButton, RsEmpty, RsIcon, RsLoading, RsSplitPane, RsTree, useRsToast } from '@niuma/ui'
import type { RsSplitPaneItem } from '@niuma/ui'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import type { MongoSchemaField } from '@/api/types/mongodb'
import MongoSchemaFieldCard from '@/modules/mongodb/components/MongoSchemaFieldCard.vue'
import {
  buildSchemaTree,
  flattenSchemaTreeKeys,
  type SchemaTreeNode,
} from '@/modules/mongodb/utils/schema-tree'
import { formatSchemaPercent, schemaTypeColor } from '@/modules/mongodb/utils/schema-type-colors'

/** Validator 依赖 Monaco，延迟加载以免首开 Schema Tab 触发 Vite 依赖重优化打断动态 import */
const MongoSchemaValidatorPanel = defineAsyncComponent(
  () => import('@/modules/mongodb/components/MongoSchemaValidatorPanel.vue'),
)

const DEFAULT_SAMPLE_SIZE = 1000
const DEFAULT_MAX_TIME_MS = 60_000

const props = defineProps<{
  sessionId: string | null
  initialDatabase?: string
  initialCollection?: string
  scopeLocked?: boolean
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

const database = ref(props.initialDatabase ?? '')
const collection = ref(props.initialCollection ?? '')
const filterText = ref('{}')
const filterError = ref<string | null>(null)
const fields = ref<MongoSchemaField[]>([])
const sampleCount = ref(0)
const sampleSizeSetting = ref(DEFAULT_SAMPLE_SIZE)
const maxTimeMs = ref(DEFAULT_MAX_TIME_MS)
const showOptions = ref(false)
const showValidation = ref(false)
const treeFilter = ref('')
const loading = ref(false)
const sampled = ref(false)
const selectedPath = ref('')
const expandedKeys = ref<string[]>([])

const splitPanes: RsSplitPaneItem[] = [
  { key: 'tree', size: 30, min: 22, resizerHandle: true },
  { key: 'detail', size: 70, min: 35 },
]

const hasTarget = computed(
  () => !!props.sessionId && database.value.trim().length > 0 && collection.value.trim().length > 0,
)

const fieldMap = computed(() => new Map(fields.value.map((field) => [field.path, field])))

const treeNodes = computed((): SchemaTreeNode[] => buildSchemaTree(fields.value))

const selectedField = computed(() => {
  if (!selectedPath.value) return null
  return fieldMap.value.get(selectedPath.value) ?? null
})

function parseFilter(): Record<string, unknown> | undefined {
  const raw = filterText.value.trim()
  if (!raw || raw === '{}') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new TypeError(t('modules.mongodb.schema.filterInvalid'))
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(t('modules.mongodb.schema.filterInvalid'))
  }
  return parsed as Record<string, unknown>
}

async function sample(): Promise<void> {
  if (!hasTarget.value) return
  loading.value = true
  filterError.value = null
  try {
    const filter = parseFilter()
    const result = await mongodbApi.schemaSample({
      sessionId: props.sessionId!,
      database: database.value.trim(),
      collection: collection.value.trim(),
      sampleSize: sampleSizeSetting.value,
      filter,
      maxTimeMS: maxTimeMs.value > 0 ? maxTimeMs.value : undefined,
    })
    fields.value = result.fields
    sampleCount.value = result.sampleCount
    sampled.value = true

    const tree = buildSchemaTree(result.fields)
    expandedKeys.value = flattenSchemaTreeKeys(tree)
    selectedPath.value = result.fields[0]?.path ?? ''
  } catch (e) {
    const message = e instanceof Error ? e.message : t('modules.mongodb.schema.sampleError')
    if (e instanceof TypeError) {
      filterError.value = message
    }
    toast.error(message)
  } finally {
    loading.value = false
  }
}

function onTreeSelect(path: string | string[]): void {
  const value = Array.isArray(path) ? path[0] : path
  if (!value) return
  selectedPath.value = value
}

function fieldTypeLabel(field?: MongoSchemaField): string {
  if (!field?.types.length) return ''
  return field.types.join(' | ')
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
  <div class="nm-schema">
    <header class="nm-schema__toolbar">
      <div v-if="!scopeLocked" class="nm-schema__scope">
        <RsIcon name="database" :size="13" class="nm-schema__bc-icon" />
        <label for="nm-schema-db" class="nm-schema__sr-only">{{ t('modules.mongodb.query.database') }}</label>
        <input
          id="nm-schema-db"
          v-model="database"
          class="nm-schema__seg-input"
          :placeholder="t('modules.mongodb.query.database')"
          spellcheck="false"
        />
        <span class="nm-schema__bc-dot">.</span>
        <RsIcon name="table-2" :size="13" class="nm-schema__bc-icon" />
        <label for="nm-schema-coll" class="nm-schema__sr-only">{{ t('modules.mongodb.query.collection') }}</label>
        <input
          id="nm-schema-coll"
          v-model="collection"
          class="nm-schema__seg-input nm-schema__seg-input--coll"
          :placeholder="t('modules.mongodb.query.collection')"
          spellcheck="false"
        />
      </div>

      <div class="nm-schema__filter-wrap" :class="{ 'nm-schema__filter-wrap--error': filterError }">
        <RsIcon name="filter" :size="13" class="nm-schema__filter-icon" />
        <input
          v-model="filterText"
          type="text"
          class="nm-schema__filter-input"
          :placeholder="t('modules.mongodb.schema.filterPlaceholder')"
          :aria-label="t('modules.mongodb.schema.filterPlaceholder')"
          spellcheck="false"
          @keydown.enter="sample"
        />
      </div>

      <div class="nm-schema__actions">
        <RsButton
          size="sm"
          variant="ghost"
          :title="t('modules.mongodb.schema.validation')"
          :class="{ 'nm-schema__btn--active': showValidation }"
          @click="showValidation = !showValidation"
        >
          <RsIcon name="shield-check" :size="13" />
        </RsButton>
        <RsButton
          size="sm"
          variant="ghost"
          :title="t('modules.mongodb.schema.options')"
          @click="showOptions = !showOptions"
        >
          <RsIcon name="settings-2" :size="13" />
        </RsButton>
        <span v-if="sampled" class="nm-schema__meta">
          {{ t('modules.mongodb.schema.sampleMeta', { count: sampleCount, size: sampleSizeSetting }) }}
        </span>
        <RsButton size="sm" variant="primary" :loading="loading" :disabled="!hasTarget" @click="sample">
          <RsIcon name="scan-search" :size="13" />
          {{ t('modules.mongodb.schema.analyze') }}
        </RsButton>
      </div>
    </header>

    <div v-if="showOptions" class="nm-schema__options">
      <label class="nm-schema__option">
        <span>{{ t('modules.mongodb.schema.sampleSize') }}</span>
        <input v-model.number="sampleSizeSetting" type="number" min="1" max="1000" class="nm-schema__option-input" />
      </label>
      <label class="nm-schema__option">
        <span>{{ t('modules.mongodb.schema.maxTimeMS') }}</span>
        <input v-model.number="maxTimeMs" type="number" min="0" step="1000" class="nm-schema__option-input" />
      </label>
    </div>

    <p v-if="filterError" class="nm-schema__filter-error" role="alert">{{ filterError }}</p>

    <div class="nm-schema__body">
      <RsLoading v-if="loading" class="nm-schema__loading" />

      <RsEmpty
        v-else-if="!sampled"
        fill
        class="nm-schema__empty"
        icon="scan-search"
        :description="t('modules.mongodb.schema.hint')"
      />

      <RsEmpty
        v-else-if="fields.length === 0"
        fill
        class="nm-schema__empty"
        :description="t('modules.mongodb.schema.empty')"
      />

      <RsSplitPane v-else :panes="splitPanes" orientation="horizontal" class="nm-schema__split" with-handle>
        <template #tree>
          <div class="nm-schema__tree-pane">
            <div class="nm-schema__tree-head">
              <span>{{ t('modules.mongodb.schema.fieldTree') }}</span>
              <span class="nm-schema__count">{{ fields.length }} {{ t('modules.mongodb.schema.fields') }}</span>
            </div>
            <div class="nm-schema__tree-filter">
              <RsIcon name="search" :size="13" class="nm-schema__tree-filter-icon" />
              <input
                v-model="treeFilter"
                type="text"
                class="nm-schema__tree-filter-input"
                :placeholder="t('modules.mongodb.schema.treeFilter')"
                spellcheck="false"
              />
            </div>
            <RsTree
              v-model="selectedPath"
              v-model:expanded-keys="expandedKeys"
              :nodes="treeNodes"
              :filter="treeFilter"
              block-node
              show-line
              default-expand-all
              auto-expand-parent
              highlight
              class="nm-schema__tree"
              @update:model-value="onTreeSelect"
            >
              <template #title="{ node, label }">
                <div class="nm-schema__tree-title">
                  <span class="nm-schema__tree-label">{{ label }}</span>
                  <span v-if="(node as SchemaTreeNode).field" class="nm-schema__tree-meta">
                    <span
                      class="nm-schema__tree-type-dot"
                      :style="{ background: schemaTypeColor((node as SchemaTreeNode).field!.types[0] ?? '') }"
                    />
                    <span>{{ fieldTypeLabel((node as SchemaTreeNode).field) }}</span>
                    <span>{{ formatSchemaPercent((node as SchemaTreeNode).field!.frequency) }}</span>
                  </span>
                </div>
              </template>
            </RsTree>
          </div>
        </template>

        <template #detail>
          <div class="nm-schema__detail-pane">
            <MongoSchemaFieldCard v-if="selectedField" :field="selectedField" />
            <RsEmpty
              v-else
              fill
              class="nm-schema__detail-empty"
              :description="t('modules.mongodb.schema.selectField')"
            />
          </div>
        </template>
      </RsSplitPane>

      <MongoSchemaValidatorPanel
        v-if="showValidation"
        v-model:open="showValidation"
        :session-id="sessionId"
        :database="database"
        :collection="collection"
        :fields="fields"
      />
    </div>
  </div>
</template>

<style scoped>
.nm-schema {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-schema__toolbar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding: 0 var(--rs-space-md);
  min-height: 44px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-wrap: wrap;
}

.nm-schema__scope {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.nm-schema__bc-icon {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-schema__bc-dot {
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
  font-family: var(--rs-font-mono);
}

.nm-schema__seg-input {
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--rs-font-size-sm);
  font-family: var(--rs-font-mono);
  color: var(--rs-foreground);
  font-weight: 500;
  min-width: 60px;
  max-width: 140px;
  padding: 2px 4px;
  border-radius: var(--rs-radius-xs);
}

.nm-schema__seg-input:focus {
  background: var(--rs-surface-subtle);
  outline: 1px solid var(--rs-border);
}

.nm-schema__seg-input::placeholder {
  color: var(--rs-placeholder);
  font-weight: 400;
}

.nm-schema__seg-input--coll {
  max-width: 180px;
}

.nm-schema__filter-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 160px;
  padding: 4px 10px;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-subtle);
}

.nm-schema__filter-wrap--error {
  border-color: color-mix(in srgb, var(--rs-danger) 50%, transparent);
}

.nm-schema__filter-icon {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-schema__filter-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-sm);
  color: var(--rs-foreground);
}

.nm-schema__filter-input::placeholder {
  color: var(--rs-placeholder);
}

.nm-schema__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: auto;
}

.nm-schema__meta {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  white-space: nowrap;
}

.nm-schema__options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-md);
  padding: 8px var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-subtle);
}

.nm-schema__option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-schema__option-input {
  width: 88px;
  padding: 2px 6px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-xs);
  background: var(--rs-surface);
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-foreground);
}

.nm-schema__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.nm-schema__filter-error {
  margin: 0;
  padding: 6px var(--rs-space-md);
  font-size: var(--rs-font-size-sm);
  color: var(--rs-danger);
  background: color-mix(in srgb, var(--rs-danger) 8%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--rs-danger) 20%, transparent);
  flex-shrink: 0;
}

.nm-schema__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-schema__loading,
.nm-schema__empty {
  flex: 1;
}

.nm-schema__split {
  flex: 1;
  min-height: 0;
}

.nm-schema__tree-pane,
.nm-schema__detail-pane {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-schema__tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.nm-schema__count {
  font-weight: 500;
  text-transform: none;
  letter-spacing: normal;
  color: var(--rs-muted);
  background: var(--rs-surface-subtle);
  padding: 1px 7px;
  border-radius: 999px;
}

.nm-schema__btn--active {
  color: var(--rs-accent);
  background: color-mix(in srgb, var(--rs-accent) 10%, transparent);
}

.nm-schema__tree-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 var(--rs-space-sm) 6px;
  padding: 4px 8px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
}

.nm-schema__tree-filter-icon {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-schema__tree-filter-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-foreground);
}

.nm-schema__tree-filter-input::placeholder {
  color: var(--rs-placeholder);
}

.nm-schema__tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 0;
}

.nm-schema__tree-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.nm-schema__tree-label {
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-sm);
}

.nm-schema__tree-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-schema__tree-type-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.nm-schema__detail-pane {
  overflow: auto;
  padding: var(--rs-space-md);
}

.nm-schema__detail-empty {
  flex: 1;
}
</style>
