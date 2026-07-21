<script setup lang="ts">
import {
  RsButton,
  RsConfirmDialog,
  RsDialog,
  RsEmpty,
  RsIcon,
  RsInput,
  RsTable,
  useRsToast,
} from '@niuma/ui'
import type { RsTableColumn } from '@niuma/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import type { MongoIndexInfo } from '@/api/types/mongodb'

const props = defineProps<{
  sessionId: string | null
  database?: string
  collection?: string
  active: boolean
}>()

interface IndexRow extends Record<string, unknown> {
  name: string
  keys: string
  attrs: string[]
  ttl: string
  raw: string
  isDefault: boolean
}

const { t } = useI18n()
const toast = useRsToast()

const indexes = ref<MongoIndexInfo[]>([])
const loading = ref(false)

/**
 * Dialog Portal 挂载点：必须用 Element（非同树 CSS 选择器），且在 onMounted 后再挂 Dialog。
 * 页签切换 / 异步面板首挂时，选择器 Teleport 会在挂载点进 DOM 前 querySelector 失败。
 */
const dialogHostEl = ref<HTMLElement | null>(null)
const dialogTeleportReady = ref(false)

onMounted(() => {
  dialogTeleportReady.value = dialogHostEl.value != null
})

// ── 创建对话框 ──
const createOpen = ref(false)
const creating = ref(false)
const keysText = ref('{\n  "field": 1\n}')
const nameText = ref('')
const uniqueFlag = ref(false)
const sparseFlag = ref(false)
const ttlText = ref('')
const createError = ref<string | null>(null)

// ── 删除确认 ──
const dropConfirm = ref(false)
const dropping = ref(false)
const dropTarget = ref<string | null>(null)

const columns = computed((): RsTableColumn<IndexRow>[] => [
  { key: 'name', title: t('modules.mongodb.indexes.colName'), minWidth: 160, ellipsis: true },
  { key: 'keys', title: t('modules.mongodb.indexes.colKeys'), minWidth: 220, ellipsis: true },
  { key: 'attrs', title: t('modules.mongodb.indexes.colAttrs'), minWidth: 120 },
  { key: 'ttl', title: 'TTL', width: 90, align: 'right' },
  { key: 'actions', title: '', width: 60 },
])

const rows = computed((): IndexRow[] =>
  indexes.value.map((idx) => {
    const attrs: string[] = []
    if (idx.unique) attrs.push(t('modules.mongodb.indexes.attrUnique'))
    if (idx.sparse) attrs.push(t('modules.mongodb.indexes.attrSparse'))
    return {
      name: idx.name,
      keys: formatKeys(idx.keys),
      attrs,
      ttl: idx.expireAfterSeconds !== undefined ? `${idx.expireAfterSeconds}s` : '—',
      raw: JSON.stringify(idx.raw, null, 2),
      isDefault: idx.name === '_id_',
    }
  }),
)

function formatKeys(keys: Record<string, unknown>): string {
  return Object.entries(keys)
    .map(([field, dir]) => `${field}: ${JSON.stringify(dir)}`)
    .join(', ')
}

function hasCollection(): boolean {
  return !!(props.sessionId && props.database && props.collection)
}

async function loadIndexes(): Promise<void> {
  if (!hasCollection() || loading.value) return
  loading.value = true
  try {
    const result = await mongodbApi.indexList({
      sessionId: props.sessionId!,
      database: props.database!,
      collection: props.collection!,
    })
    indexes.value = result.indexes
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.indexes.loadError'))
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  keysText.value = '{\n  "field": 1\n}'
  nameText.value = ''
  uniqueFlag.value = false
  sparseFlag.value = false
  ttlText.value = ''
  createError.value = null
  createOpen.value = true
}

async function onCreate(): Promise<void> {
  if (!hasCollection()) return
  createError.value = null

  let keys: Record<string, unknown>
  try {
    keys = JSON.parse(keysText.value) as Record<string, unknown>
  } catch {
    createError.value = t('modules.mongodb.indexes.invalidKeys')
    return
  }
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys) || Object.keys(keys).length === 0) {
    createError.value = t('modules.mongodb.indexes.invalidKeys')
    return
  }

  let expireAfterSeconds: number | undefined
  const ttlRaw = ttlText.value.trim()
  if (ttlRaw) {
    const parsed = Number.parseInt(ttlRaw, 10)
    if (Number.isNaN(parsed) || parsed < 0) {
      createError.value = t('modules.mongodb.indexes.invalidTtl')
      return
    }
    expireAfterSeconds = parsed
  }

  creating.value = true
  try {
    const result = await mongodbApi.indexCreate({
      sessionId: props.sessionId!,
      database: props.database!,
      collection: props.collection!,
      keys,
      name: nameText.value.trim() || undefined,
      unique: uniqueFlag.value || undefined,
      sparse: sparseFlag.value || undefined,
      expireAfterSeconds,
    })
    toast.success(t('modules.mongodb.indexes.created', { name: result.name }))
    createOpen.value = false
    void loadIndexes()
  } catch (e) {
    createError.value = e instanceof Error ? e.message : t('modules.mongodb.indexes.createError')
  } finally {
    creating.value = false
  }
}

function askDrop(name: string): void {
  dropTarget.value = name
  dropConfirm.value = true
}

async function onDrop(): Promise<void> {
  if (!hasCollection() || !dropTarget.value) return
  dropping.value = true
  try {
    await mongodbApi.indexDrop({
      sessionId: props.sessionId!,
      database: props.database!,
      collection: props.collection!,
      name: dropTarget.value,
    })
    toast.success(t('modules.mongodb.indexes.dropped', { name: dropTarget.value }))
    dropConfirm.value = false
    dropTarget.value = null
    void loadIndexes()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.indexes.dropError'))
  } finally {
    dropping.value = false
  }
}

watch(
  () => [props.sessionId, props.database, props.collection, props.active] as const,
  ([sid, db, coll, active]) => {
    if (sid && db && coll && active) {
      indexes.value = []
      void loadIndexes()
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="nm-mongo-idx">
    <div ref="dialogHostEl" class="nm-mongo-idx__dialog-mount" aria-hidden="true" />

    <RsEmpty
      v-if="!database || !collection"
      fill
      class="nm-mongo-idx__guide"
      icon="list-ordered"
      :description="t('modules.mongodb.collections.pickCollection')"
    />

    <template v-else>
      <!-- 工具栏 -->
      <header class="nm-mongo-idx__toolbar">
        <div class="nm-mongo-idx__breadcrumb">
          <RsIcon name="database" :size="13" class="nm-mongo-idx__bc-icon" />
          <span class="nm-mongo-idx__bc-seg">{{ database }}</span>
          <RsIcon name="chevron-right" :size="12" class="nm-mongo-idx__bc-sep" />
          <RsIcon name="table-2" :size="13" class="nm-mongo-idx__bc-icon" />
          <span class="nm-mongo-idx__bc-seg nm-mongo-idx__bc-seg--active">{{ collection }}</span>
          <span v-if="indexes.length > 0" class="nm-mongo-idx__count">
            {{ t('modules.mongodb.indexes.total', { count: indexes.length }) }}
          </span>
        </div>

        <div class="nm-mongo-idx__actions">
          <RsButton
            size="sm"
            variant="ghost"
            :disabled="loading"
            :title="t('modules.mongodb.indexes.refresh')"
            @click="loadIndexes"
          >
            <RsIcon name="refresh-cw" :size="13" />
          </RsButton>
          <RsButton size="sm" variant="primary" @click="openCreate">
            <RsIcon name="plus" :size="13" />
            {{ t('modules.mongodb.indexes.create') }}
          </RsButton>
        </div>
      </header>

      <!-- 列表：滚动 / loading / 斑马纹走 RsTable 公共能力 -->
      <RsEmpty
        v-if="indexes.length === 0 && !loading"
        fill
        class="nm-mongo-idx__empty"
        :description="t('modules.mongodb.indexes.empty')"
      />

      <div v-else class="nm-mongo-idx__table-wrap">
        <RsTable
          :columns="columns"
          :data="rows"
          row-key="name"
          :loading="loading"
          size="sm"
          striped
          resizable
          column-layout="auto"
          column-bordered
          fill
          :virtual-auto-threshold="30"
        >
          <template #name="{ row }">
            <span class="nm-mongo-idx__name">
              {{ row.name }}
              <span v-if="row.isDefault" class="nm-mongo-idx__default-badge">
                {{ t('modules.mongodb.indexes.default') }}
              </span>
            </span>
          </template>
          <template #keys="{ row }">
            <code class="nm-mongo-idx__keys" :title="row.raw">{{ row.keys }}</code>
          </template>
          <template #attrs="{ row }">
            <span v-if="(row.attrs as string[]).length === 0" class="nm-mongo-idx__muted">—</span>
            <span
              v-for="attr in row.attrs as string[]"
              v-else
              :key="attr"
              class="nm-mongo-idx__attr-badge"
            >{{ attr }}</span>
          </template>
          <template #actions="{ row }">
            <RsButton
              v-if="!row.isDefault"
              size="sm"
              variant="ghost"
              :title="t('modules.mongodb.indexes.drop')"
              @click="askDrop(row.name)"
            >
              <RsIcon name="trash-2" :size="13" />
            </RsButton>
          </template>
        </RsTable>
      </div>

      <!-- 创建对话框：等挂载点 onMounted 后再创建 Portal，避免页签切换竞态 -->
      <RsDialog
        v-if="dialogTeleportReady"
        v-model:open="createOpen"
        :title="t('modules.mongodb.indexes.createTitle')"
        width="md"
        :modal="false"
        :teleport-to="dialogHostEl ?? undefined"
      >
        <template #body>
        <div class="nm-mongo-idx__form">
          <label class="nm-mongo-idx__field">
            <span class="nm-mongo-idx__field-label">{{ t('modules.mongodb.indexes.fieldKeys') }}</span>
            <textarea
              v-model="keysText"
              class="nm-mongo-idx__keys-input"
              rows="4"
              spellcheck="false"
              :placeholder="'{ &quot;field&quot;: 1 }'"
            />
            <span class="nm-mongo-idx__field-hint">{{ t('modules.mongodb.indexes.keysHint') }}</span>
          </label>

          <label class="nm-mongo-idx__field">
            <span class="nm-mongo-idx__field-label">{{ t('modules.mongodb.indexes.fieldName') }}</span>
            <RsInput v-model="nameText" size="sm" :placeholder="t('modules.mongodb.indexes.namePlaceholder')" />
          </label>

          <div class="nm-mongo-idx__flags">
            <label class="nm-mongo-idx__flag">
              <input v-model="uniqueFlag" type="checkbox" />
              <span>{{ t('modules.mongodb.indexes.attrUnique') }}</span>
            </label>
            <label class="nm-mongo-idx__flag">
              <input v-model="sparseFlag" type="checkbox" />
              <span>{{ t('modules.mongodb.indexes.attrSparse') }}</span>
            </label>
            <label class="nm-mongo-idx__flag nm-mongo-idx__flag--ttl">
              <span>TTL</span>
              <RsInput
                v-model="ttlText"
                size="sm"
                class="nm-mongo-idx__ttl-input"
                :placeholder="t('modules.mongodb.indexes.ttlPlaceholder')"
              />
              <span class="nm-mongo-idx__muted">{{ t('modules.mongodb.indexes.ttlUnit') }}</span>
            </label>
          </div>

          <p v-if="createError" class="nm-mongo-idx__error" role="alert">{{ createError }}</p>
        </div>
        </template>

        <template #footer>
          <RsButton variant="ghost" @click="createOpen = false">{{ t('common.cancel') }}</RsButton>
          <RsButton variant="primary" :loading="creating" @click="onCreate">
            {{ t('modules.mongodb.indexes.create') }}
          </RsButton>
        </template>
      </RsDialog>

      <!-- 删除确认 -->
      <RsConfirmDialog
        v-if="dialogTeleportReady"
        v-model:open="dropConfirm"
        :title="t('modules.mongodb.indexes.dropTitle')"
        :description="t('modules.mongodb.indexes.dropDesc', { name: dropTarget ?? '' })"
        variant="danger"
        :loading="dropping"
        :teleport-to="dialogHostEl ?? undefined"
        @confirm="onDrop"
      />
    </template>
  </div>
</template>

<style scoped>
.nm-mongo-idx {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-mongo-idx__guide,
.nm-mongo-idx__empty {
  flex: 1;
}

.nm-mongo-idx__dialog-mount {
  position: absolute;
  inset: 0;
  z-index: var(--rs-z-modal);
  pointer-events: none;
}

.nm-mongo-idx__dialog-mount :deep(.rs-dialog__content),
.nm-mongo-idx__dialog-mount :deep(.rs-confirm-dialog__content) {
  pointer-events: auto;
}

/* ── 工具栏 ── */
.nm-mongo-idx__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-md);
  padding: 0 var(--rs-space-md);
  height: 44px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--rs-border-subtle);
  min-width: 0;
}

.nm-mongo-idx__breadcrumb {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: var(--rs-font-size-sm);
}

.nm-mongo-idx__bc-icon {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-mongo-idx__bc-sep {
  color: var(--rs-border);
  flex-shrink: 0;
}

.nm-mongo-idx__bc-seg {
  color: var(--rs-muted);
  font-weight: 500;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mongo-idx__bc-seg--active {
  color: var(--rs-foreground);
  font-weight: 600;
}

.nm-mongo-idx__count {
  margin-left: 4px;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
  background: var(--rs-surface-subtle);
  padding: 1px 7px;
  border-radius: 999px;
  flex-shrink: 0;
}

.nm-mongo-idx__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

/* 表格区域：flex 容器，滚动由 RsTable fill 模式内置处理 */
.nm-mongo-idx__table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-mongo-idx__name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--rs-font-mono);
}

.nm-mongo-idx__default-badge {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  background: var(--rs-surface-subtle);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-xs);
  padding: 1px 6px;
}

.nm-mongo-idx__keys {
  font-family: var(--rs-font-mono);
  background: transparent;
}

.nm-mongo-idx__attr-badge {
  display: inline-block;
  margin-right: 4px;
  padding: 1px 6px;
  border-radius: var(--rs-radius-xs);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-accent);
  background: color-mix(in srgb, var(--rs-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--rs-accent) 22%, transparent);
}

.nm-mongo-idx__muted {
  color: var(--rs-muted);
}

/* ── 创建表单 ── */
.nm-mongo-idx__form {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
}

.nm-mongo-idx__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nm-mongo-idx__field-label {
  font-size: var(--rs-font-size-sm);
  font-weight: 500;
  color: var(--rs-foreground);
}

.nm-mongo-idx__field-hint {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-mongo-idx__keys-input {
  width: 100%;
  resize: vertical;
  min-height: 72px;
  padding: var(--rs-space-xs) var(--rs-space-sm);
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-subtle);
  color: var(--rs-foreground);
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-sm);
  outline: none;
  transition: border-color 0.15s;
}

.nm-mongo-idx__keys-input:focus {
  border-color: var(--rs-accent);
  background: var(--rs-surface);
}

.nm-mongo-idx__flags {
  display: flex;
  align-items: center;
  gap: var(--rs-space-md);
  flex-wrap: wrap;
}

.nm-mongo-idx__flag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-foreground);
  cursor: pointer;
}

.nm-mongo-idx__flag--ttl {
  cursor: default;
  flex-shrink: 0;
  white-space: nowrap;
}

.nm-mongo-idx__ttl-input {
  width: 90px;
}

.nm-mongo-idx__error {
  margin: 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}
</style>
