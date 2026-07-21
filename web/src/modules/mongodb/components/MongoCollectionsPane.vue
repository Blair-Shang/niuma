<script setup lang="ts">
import {
  RsButton,
  RsCodeEditor,
  RsConfirmDialog,
  RsDialog,
  RsEmpty,
  RsIcon,
  RsPagination,
  RsTable,
  useRsToast,
} from '@niuma/ui'
import type { RsTableColumn } from '@niuma/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import type { MongoDocument } from '@/api/types/mongodb'
import { formatMongoId, formatMongoJson, parseMongoJson, previewMongoDocument } from '@/modules/mongodb/utils/format'

const props = defineProps<{
  sessionId: string | null
  database?: string
  collection?: string
  active: boolean
}>()

interface DocRow extends Record<string, unknown> {
  _key: string
  doc: MongoDocument
  id: string
  preview: string
}

const { t } = useI18n()
const toast = useRsToast()

const documents = ref<MongoDocument[]>([])
const page = ref(1)
const pageSize = ref(20)
const hasMore = ref(false)
const total = ref<number | undefined>(undefined)
const loadingDocs = ref(false)

const filterText = ref('')
const filterError = ref<string | null>(null)
const activeFilter = ref<MongoDocument | null>(null)

const viewerOpen = ref(false)
const viewerDoc = ref<MongoDocument | null>(null)
const insertMode = ref(false)
const jsonText = ref('{}')
const saving = ref(false)
const deleting = ref(false)
const deleteConfirm = ref(false)
const parseError = ref<string | null>(null)

/**
 * Dialog Portal 挂载点：必须用 Element（非同树 CSS 选择器），且在 onMounted 后再挂 Dialog。
 * 页签切换 / 异步面板首挂时，选择器 Teleport 会在挂载点进 DOM 前 querySelector 失败。
 */
const dialogHostEl = ref<HTMLElement | null>(null)
const dialogTeleportReady = ref(false)

onMounted(() => {
  dialogTeleportReady.value = dialogHostEl.value != null
})

const viewerTitle = computed(() =>
  insertMode.value
    ? t('modules.mongodb.document.insertTitle')
    : t('modules.mongodb.document.editTitle'),
)

const columns = computed((): RsTableColumn<DocRow>[] => [
  { key: 'id', title: '_id', ellipsis: true, minWidth: 220 },
  { key: 'preview', title: t('modules.mongodb.collections.preview'), ellipsis: true },
  { key: 'actions', title: '', width: 80 },
])

const rows = computed((): DocRow[] =>
  documents.value.map((doc, idx) => ({
    _key: `${formatMongoId(doc._id)}-${idx}`,
    doc,
    id: formatMongoId(doc._id),
    preview: previewMongoDocument(doc),
  })),
)

const pageFrom = computed(() =>
  documents.value.length === 0 ? 0 : (page.value - 1) * pageSize.value + 1,
)

const pageTo = computed(() => (page.value - 1) * pageSize.value + documents.value.length)

const paginationTotal = computed(() => {
  if (total.value !== undefined) return total.value
  const loaded = (page.value - 1) * pageSize.value + documents.value.length
  return hasMore.value ? loaded + 1 : loaded
})

const showPagination = computed(
  () => documents.value.length > 0 || page.value > 1 || (total.value !== undefined && total.value > 0),
)

const showPaginationSummary = computed(() => total.value !== undefined)

const activeFilterPreview = computed(() => {
  if (!activeFilter.value) return ''
  try {
    return JSON.stringify(activeFilter.value)
  } catch {
    return ''
  }
})

function hasCollection(): boolean {
  return !!(props.sessionId && props.database && props.collection)
}

async function loadDocuments(): Promise<void> {
  if (!hasCollection() || loadingDocs.value) return
  loadingDocs.value = true
  try {
    const result = await mongodbApi.documentFind({
      sessionId: props.sessionId!,
      database: props.database!,
      collection: props.collection!,
      filter: activeFilter.value ?? undefined,
      skip: (page.value - 1) * pageSize.value,
      limit: pageSize.value,
    })
    if (result.documents.length === 0 && page.value > 1) {
      page.value -= 1
      return
    }
    documents.value = result.documents
    hasMore.value = result.hasMore
    if (result.total !== undefined) {
      total.value = result.total
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.collections.loadDocError'))
  } finally {
    loadingDocs.value = false
  }
}

function reloadDocuments(): void {
  void loadDocuments()
}

function resetPageAndLoad(): void {
  if (page.value === 1) {
    void loadDocuments()
  } else {
    page.value = 1
  }
}

function applyFilter(): void {
  filterError.value = null
  const raw = filterText.value.trim()
  if (!raw || raw === '{}') {
    activeFilter.value = null
    total.value = undefined
    resetPageAndLoad()
    return
  }
  try {
    activeFilter.value = JSON.parse(raw) as MongoDocument
    total.value = undefined
    resetPageAndLoad()
  } catch {
    filterError.value = t('modules.mongodb.document.invalidJson')
  }
}

function resetFilter(): void {
  filterText.value = ''
  filterError.value = null
  activeFilter.value = null
  total.value = undefined
  resetPageAndLoad()
}

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

watch(
  () => [viewerOpen.value, viewerDoc.value, insertMode.value] as const,
  ([isOpen, doc, insert]) => {
    if (!isOpen) return
    parseError.value = null
    jsonText.value = formatMongoJson(insert ? {} : (doc ?? {}))
  },
)

async function onViewerSave(): Promise<void> {
  if (!props.sessionId || !props.database || !props.collection) return
  parseError.value = null
  let parsed: MongoDocument
  try {
    parsed = parseMongoJson(jsonText.value)
  } catch (e) {
    parseError.value = e instanceof Error ? e.message : t('modules.mongodb.document.invalidJson')
    return
  }

  saving.value = true
  try {
    if (insertMode.value) {
      await mongodbApi.documentInsert({
        sessionId: props.sessionId,
        database: props.database,
        collection: props.collection,
        document: parsed,
      })
      toast.success(t('modules.mongodb.document.inserted'))
    } else if (viewerDoc.value?._id !== undefined) {
      const body = { ...parsed }
      delete body._id
      await mongodbApi.documentUpdate({
        sessionId: props.sessionId,
        database: props.database,
        collection: props.collection,
        id: viewerDoc.value._id,
        document: body,
      })
      toast.success(t('modules.mongodb.document.updated'))
    }
    viewerOpen.value = false
    reloadDocuments()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.document.saveError'))
  } finally {
    saving.value = false
  }
}

async function onViewerDelete(): Promise<void> {
  if (!props.sessionId || !props.database || !props.collection || viewerDoc.value?._id === undefined) {
    return
  }
  deleting.value = true
  try {
    await mongodbApi.documentDelete({
      sessionId: props.sessionId,
      database: props.database,
      collection: props.collection,
      id: viewerDoc.value._id,
    })
    toast.success(t('modules.mongodb.document.deleted'))
    deleteConfirm.value = false
    viewerOpen.value = false
    reloadDocuments()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.document.deleteError'))
  } finally {
    deleting.value = false
  }
}

watch([page, pageSize], () => {
  if (hasCollection() && props.active) void loadDocuments()
})

watch(
  () => [props.sessionId, props.database, props.collection, props.active] as const,
  ([sid, db, coll, active]) => {
    if (sid && db && coll && active) {
      documents.value = []
      activeFilter.value = null
      filterText.value = ''
      filterError.value = null
      total.value = undefined
      if (page.value !== 1) {
        page.value = 1
      } else {
        void loadDocuments()
      }
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="nm-mongo-docs">
    <!-- 对话框挂载点（页面内 Portal，非 modal 以免挡住 Tab 分屏/更多） -->
    <div ref="dialogHostEl" class="nm-mongo-docs__dialog-mount" aria-hidden="true" />

    <!-- 无集合时的引导状态 -->
    <RsEmpty
      v-if="!database || !collection"
      fill
      class="nm-mongo-docs__guide"
      icon="table"
      :description="t('modules.mongodb.collections.pickCollection')"
    />

    <template v-else>
      <!-- 顶栏 -->
      <header class="nm-mongo-docs__header">
        <div class="nm-mongo-docs__header-top">
          <div class="nm-mongo-docs__breadcrumb">
            <RsIcon name="database" :size="14" class="nm-mongo-docs__bc-icon" />
            <span class="nm-mongo-docs__bc-seg">{{ database }}</span>
            <RsIcon name="chevron-right" :size="12" class="nm-mongo-docs__bc-sep" />
            <RsIcon name="table-2" :size="14" class="nm-mongo-docs__bc-icon" />
            <span class="nm-mongo-docs__bc-seg nm-mongo-docs__bc-seg--active">{{ collection }}</span>
            <span v-if="total !== undefined" class="nm-mongo-docs__count">
              {{ t('modules.mongodb.collections.total', { count: total.toLocaleString() }) }}
            </span>
          </div>

          <div class="nm-mongo-docs__actions">
            <RsButton
              size="sm"
              variant="ghost"
              :disabled="loadingDocs"
              :title="t('modules.mongodb.collections.refresh')"
              @click="reloadDocuments"
            >
              <RsIcon name="refresh-cw" :size="13" />
            </RsButton>
            <RsButton size="sm" variant="primary" @click="openInsert">
              <RsIcon name="plus" :size="13" />
              {{ t('modules.mongodb.collections.insert') }}
            </RsButton>
          </div>
        </div>

        <div class="nm-mongo-docs__header-filter">
          <div class="nm-mongo-docs__filter-wrap" :class="{ 'nm-mongo-docs__filter-wrap--error': filterError }">
            <RsIcon name="filter" :size="13" class="nm-mongo-docs__filter-icon" />
            <input
              v-model="filterText"
              type="text"
              class="nm-mongo-docs__filter-input"
              :placeholder="t('modules.mongodb.collections.filterPlaceholder')"
              :aria-label="t('modules.mongodb.collections.filterApply')"
              spellcheck="false"
              @keydown.enter="applyFilter"
            />
          </div>
          <RsButton size="sm" variant="ghost" @click="applyFilter">
            {{ t('modules.mongodb.collections.filterApply') }}
          </RsButton>
          <RsButton
            v-if="activeFilter"
            size="sm"
            variant="ghost"
            :title="t('modules.mongodb.collections.filterReset')"
            @click="resetFilter"
          >
            <RsIcon name="x" :size="13" />
            {{ t('modules.mongodb.collections.filterReset') }}
          </RsButton>
        </div>

        <p v-if="filterError" class="nm-mongo-docs__filter-error">
          <RsIcon name="alert-circle" :size="12" />
          {{ filterError }}
        </p>

        <div v-else-if="activeFilter" class="nm-mongo-docs__filter-active">
          <RsIcon name="filter" :size="12" />
          <span class="nm-mongo-docs__filter-active-label">{{ t('modules.mongodb.collections.filterActive') }}</span>
          <code class="nm-mongo-docs__filter-active-code">{{ activeFilterPreview }}</code>
        </div>
      </header>

      <!-- 文档列表：滚动 / loading / 斑马纹走 RsTable 公共能力 -->
      <div class="nm-mongo-docs__body">
        <RsEmpty
          v-if="documents.length === 0 && !loadingDocs"
          fill
          class="nm-mongo-docs__empty"
          :description="activeFilter ? t('modules.mongodb.collections.filterEmpty') : t('modules.mongodb.collections.empty')"
        />

        <div v-else class="nm-mongo-docs__table-wrap">
          <RsTable
            :columns="columns"
            :data="rows"
            row-key="_key"
            :loading="loadingDocs"
            size="sm"
            striped
            resizable
            column-layout="auto"
            column-bordered
            fill
            :virtual-auto-threshold="30"
          >
            <template #id="{ row }">
              <button type="button" class="nm-mongo-docs__id-btn" @click="openDocument(row.doc)">
                {{ row.id }}
              </button>
            </template>
            <template #preview="{ row }">
              <span class="nm-mongo-docs__preview">{{ row.preview }}</span>
            </template>
            <template #actions="{ row }">
              <RsButton
                size="sm"
                variant="ghost"
                :title="t('modules.mongodb.collections.view')"
                @click="openDocument(row.doc)"
              >
                <RsIcon name="pencil" :size="13" />
              </RsButton>
            </template>
          </RsTable>
        </div>
      </div>

      <footer v-if="showPagination" class="nm-mongo-docs__footer">
        <span v-if="pageFrom > 0" class="nm-mongo-docs__page-range">
          {{ t('modules.mongodb.collections.pageRange', { from: pageFrom, to: pageTo }) }}
        </span>
        <RsPagination
          v-model:page="page"
          v-model:page-size="pageSize"
          :total="paginationTotal"
          :show-summary="showPaginationSummary"
          show-page-size
          size="sm"
          :disabled="loadingDocs"
        />
      </footer>

      <!-- 文档编辑对话框：等挂载点 onMounted 后再创建 Portal，避免页签切换竞态 -->
      <RsDialog
        v-if="dialogTeleportReady && sessionId && database && collection"
        v-model:open="viewerOpen"
        :title="viewerTitle"
        width="lg"
        :modal="false"
        :teleport-to="dialogHostEl ?? undefined"
      >
        <template #body>
        <RsCodeEditor
          v-model="jsonText"
          language="json"
          height="100%"
          :show-toolbar="false"
          class="nm-mongo-docs__editor"
        />
        <p v-if="parseError" class="nm-mongo-docs__editor-error" role="alert">{{ parseError }}</p>
        </template>

        <template #footer>
          <RsButton
            v-if="!insertMode"
            variant="danger"
            :loading="deleting"
            @click="deleteConfirm = true"
          >
            {{ t('modules.mongodb.document.delete') }}
          </RsButton>
          <div class="nm-mongo-docs__editor-footer-spacer" />
          <RsButton variant="ghost" @click="viewerOpen = false">{{ t('common.cancel') }}</RsButton>
          <RsButton variant="primary" :loading="saving" @click="onViewerSave">
            {{ insertMode ? t('modules.mongodb.document.insert') : t('modules.mongodb.document.save') }}
          </RsButton>
        </template>
      </RsDialog>

      <RsConfirmDialog
        v-if="dialogTeleportReady && sessionId && database && collection"
        v-model:open="deleteConfirm"
        :title="t('modules.mongodb.document.deleteTitle')"
        :description="t('modules.mongodb.document.deleteDesc')"
        variant="danger"
        :loading="deleting"
        :teleport-to="dialogHostEl ?? undefined"
        @confirm="onViewerDelete"
      />
    </template>
  </div>
</template>

<style scoped>
.nm-mongo-docs {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-mongo-docs__guide {
  flex: 1;
}

.nm-mongo-docs__dialog-mount {
  position: absolute;
  inset: 0;
  z-index: var(--rs-z-modal);
  pointer-events: none;
}

.nm-mongo-docs__dialog-mount :deep(.rs-dialog__content),
.nm-mongo-docs__dialog-mount :deep(.rs-confirm-dialog__content) {
  pointer-events: auto;
}

.nm-mongo-docs__editor {
  flex: 1;
  min-height: 0;
  width: 100%;
  border-radius: var(--rs-radius-md);
}

.nm-mongo-docs__editor-error {
  margin: var(--rs-space-xs) 0 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-mongo-docs__editor-footer-spacer {
  flex: 1;
}

/* ── 顶栏 ── */
.nm-mongo-docs__header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-surface-subtle) 55%, var(--rs-surface));
}

.nm-mongo-docs__header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-md);
  padding: var(--rs-space-sm) var(--rs-space-md) 0;
  min-width: 0;
}

.nm-mongo-docs__header-filter {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  padding: var(--rs-space-sm) var(--rs-space-md);
  min-width: 0;
}

/* 面包屑 */
.nm-mongo-docs__breadcrumb {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: var(--rs-font-size-sm);
}

.nm-mongo-docs__bc-icon {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-mongo-docs__bc-sep {
  color: var(--rs-border);
  flex-shrink: 0;
}

.nm-mongo-docs__bc-seg {
  color: var(--rs-muted);
  font-weight: 500;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mongo-docs__bc-seg--active {
  color: var(--rs-foreground);
  font-weight: 600;
}

.nm-mongo-docs__count {
  margin-left: 4px;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
  background: var(--rs-surface);
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

/* 过滤栏 */
.nm-mongo-docs__filter-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  padding: 0 var(--rs-space-sm);
  height: 32px;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  min-width: 0;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.nm-mongo-docs__filter-wrap:focus-within {
  border-color: var(--rs-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--rs-accent) 18%, transparent);
}

.nm-mongo-docs__filter-wrap--error {
  border-color: var(--rs-danger, #ef4444);
}

.nm-mongo-docs__filter-icon {
  flex-shrink: 0;
  color: var(--rs-muted);
}

.nm-mongo-docs__filter-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--rs-font-size-sm);
  font-family: var(--rs-font-mono);
  color: var(--rs-foreground);
  min-width: 0;
}

.nm-mongo-docs__filter-input::placeholder {
  color: var(--rs-placeholder);
  font-family: var(--rs-font-sans, inherit);
  font-style: italic;
}

.nm-mongo-docs__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

.nm-mongo-docs__filter-error {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  padding: 4px var(--rs-space-md) var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-danger, #ef4444);
}

.nm-mongo-docs__filter-active {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0 var(--rs-space-md) var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  min-width: 0;
}

.nm-mongo-docs__filter-active-label {
  flex-shrink: 0;
}

.nm-mongo-docs__filter-active-code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-foreground);
  background: var(--rs-surface);
  padding: 2px 6px;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border-subtle);
}

/* 主体 */
.nm-mongo-docs__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-mongo-docs__empty {
  flex: 1;
}

/* 表格区域：flex 容器，滚动由 RsTable fill 模式内置处理 */
.nm-mongo-docs__table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-mongo-docs__id-btn {
  max-width: 100%;
  border: none;
  background: none;
  padding: 0;
  color: var(--rs-accent);
  cursor: pointer;
  font-family: var(--rs-font-mono);
  font-weight: 500;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mongo-docs__id-btn:hover {
  text-decoration: underline;
}

.nm-mongo-docs__preview {
  color: var(--rs-muted);
  font-family: var(--rs-font-mono);
}

/* 底部分页 */
.nm-mongo-docs__footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-md);
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-top: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-surface-subtle) 45%, var(--rs-surface));
  min-width: 0;
}

.nm-mongo-docs__page-range {
  flex-shrink: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
}
</style>
