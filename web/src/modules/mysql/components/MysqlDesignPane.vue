<script setup lang="ts">
import {
  RsButton,
  RsEmpty,
  RsIcon,
  RsInput,
  RsLoading,
  RsSelect,
  RsTable,
  useRsToast,
  type RsSelectOptions,
  type RsTableColumn,
} from '@niuma/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mysqlApi } from '@/api'
import type { DesignColumnDraft, DesignIndexDraft } from '@/modules/mysql/utils/table-design'
import {
  MYSQL_BASE_TYPES,
  buildDataType,
  newEmptyColumn,
  newEmptyIndex,
  splitDataTypeFields,
} from '@/modules/mysql/utils/table-design'
import {
  buildAlterDesignOps,
  buildCreateColumns,
  buildCreateForeignKeys,
  buildCreateIndexes,
  toDesignRows,
  toIndexDrafts,
} from '@/modules/mysql/utils/table-design-ops'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database: string
  table?: string
  designMode: 'create' | 'alter'
  active: boolean
  sessionLabel?: string
}>()

const { t } = useI18n()
const toast = useRsToast()

type DesignTab = 'columns' | 'indexes'
const activeTab = ref<DesignTab>('columns')

const loading = ref(false)
const saving = ref(false)
const previewSqls = ref<string[]>([])
const showPreview = ref(false)
const tableName = ref(props.table ?? '')
const tableComment = ref('')
const tableEngine = ref('InnoDB')
const tableCharset = ref('utf8mb4')

const columns = ref<DesignColumnDraft[]>([])
const indexes = ref<DesignIndexDraft[]>([])

const origColumns = ref<DesignColumnDraft[]>([])
const origIndexes = ref<DesignIndexDraft[]>([])

// ─── Options ──────────────────────────────────────────────────────────────
const typeOptions = computed<RsSelectOptions>(() =>
  MYSQL_BASE_TYPES.map((t) => ({ value: t, label: t })),
)

const engineOptions: RsSelectOptions = [
  { value: 'InnoDB', label: 'InnoDB' },
  { value: 'MyISAM', label: 'MyISAM' },
  { value: 'MEMORY', label: 'MEMORY' },
]

const charsetOptions: RsSelectOptions = [
  { value: 'utf8mb4', label: 'utf8mb4' },
  { value: 'utf8', label: 'utf8' },
  { value: 'latin1', label: 'latin1' },
  { value: 'ascii', label: 'ascii' },
]

// ─── Column table ─────────────────────────────────────────────────────────
const colColumns = computed<RsTableColumn[]>(() => [
  { key: 'name', title: t('modules.mysql.design.colName'), minWidth: 120 },
  { key: 'dataType', title: t('modules.mysql.design.colType'), minWidth: 140 },
  { key: 'nullable', title: t('modules.mysql.design.colNullable'), width: 72 },
  { key: 'primaryKey', title: t('modules.mysql.design.colPk'), width: 48 },
  { key: 'autoIncrement', title: t('modules.mysql.design.colAi'), width: 48 },
  { key: 'defaultExpr', title: t('modules.mysql.design.colDefault'), minWidth: 100 },
  { key: 'comment', title: t('modules.mysql.design.colComment'), minWidth: 100 },
  { key: '_actions', title: '', width: 36 },
])

const colRows = computed(() =>
  columns.value
    .filter((c) => !c.removed)
    .map((c) => ({
      __rowKey: c.__rowKey,
      name: c.name,
      dataType: c.dataType,
      nullable: c.nullable ? '✓' : '',
      primaryKey: c.primaryKey ? '✓' : '',
      autoIncrement: c.autoIncrement ? '✓' : '',
      defaultExpr: c.defaultExpr,
      comment: c.comment,
    })),
)

// ─── Index table ──────────────────────────────────────────────────────────
const idxColumns = computed<RsTableColumn[]>(() => [
  { key: 'name', title: t('modules.mysql.design.idxName'), minWidth: 120 },
  { key: 'columnsText', title: t('modules.mysql.design.idxColumns'), minWidth: 150 },
  { key: 'unique', title: t('modules.mysql.design.idxUnique'), width: 72 },
  { key: '_actions', title: '', width: 36 },
])

const idxRows = computed(() =>
  indexes.value
    .filter((i) => !i.removed)
    .map((i) => ({
      __rowKey: i.__rowKey,
      name: i.name,
      columnsText: i.columnsText,
      unique: i.unique ? '✓' : '',
    })),
)

// ─── Edit state ───────────────────────────────────────────────────────────
const editingColKey = ref<string | null>(null)
const editingIdxKey = ref<string | null>(null)

const editingCol = computed(() =>
  columns.value.find((c) => c.__rowKey === editingColKey.value) ?? null,
)
const editingIdx = computed(() =>
  indexes.value.find((i) => i.__rowKey === editingIdxKey.value) ?? null,
)

function onColRowClick(row: Record<string, unknown>): void {
  editingColKey.value = String(row.__rowKey ?? '')
  editingIdxKey.value = null
}

function onIdxRowClick(row: Record<string, unknown>): void {
  editingIdxKey.value = String(row.__rowKey ?? '')
  editingColKey.value = null
}

function addColumn(): void {
  const col = newEmptyColumn()
  columns.value = [...columns.value, col]
  editingColKey.value = col.__rowKey
  editingIdxKey.value = null
}

function removeCol(key: string): void {
  columns.value = columns.value.map((c) =>
    c.__rowKey === key ? { ...c, removed: true } : c,
  )
  if (editingColKey.value === key) editingColKey.value = null
}

function addIndex(): void {
  const idx = newEmptyIndex()
  indexes.value = [...indexes.value, idx]
  editingIdxKey.value = idx.__rowKey
  editingColKey.value = null
}

function removeIdx(key: string): void {
  indexes.value = indexes.value.map((i) =>
    i.__rowKey === key ? { ...i, removed: true } : i,
  )
  if (editingIdxKey.value === key) editingIdxKey.value = null
}

function updateColField<K extends keyof DesignColumnDraft>(
  key: string,
  field: K,
  value: DesignColumnDraft[K],
): void {
  columns.value = columns.value.map((c) => {
    if (c.__rowKey !== key) return c
    const updated = { ...c, [field]: value }
    // 同步完整 dataType
    if (field === 'typeBase' || field === 'typeLength' || field === 'typeScale') {
      updated.dataType = buildDataType(
        updated.typeBase,
        updated.typeLength,
        updated.typeScale,
      )
    }
    if (field === 'dataType') {
      const parts = splitDataTypeFields(String(value))
      updated.typeBase = parts.typeBase
      updated.typeLength = parts.typeLength
      updated.typeScale = parts.typeScale
    }
    return updated
  })
}

function updateIdxField<K extends keyof DesignIndexDraft>(
  key: string,
  field: K,
  value: DesignIndexDraft[K],
): void {
  indexes.value = indexes.value.map((i) =>
    i.__rowKey === key ? { ...i, [field]: value } : i,
  )
}

// ─── Load ─────────────────────────────────────────────────────────────────
async function load(): Promise<void> {
  if (props.designMode !== 'alter' || !props.database || !props.table) return
  if (!props.sessionId && !props.profileId) return
  loading.value = true
  try {
    const base = props.sessionId
      ? { sessionId: props.sessionId, database: props.database, table: props.table }
      : { profileId: props.profileId!, database: props.database, table: props.table }
    const [colsResult, idxsResult, pkResult] = await Promise.all([
      mysqlApi.metaColumns(base),
      mysqlApi.metaIndexes(base),
      mysqlApi.metaPrimaryKey(base),
    ])
    const rows = toDesignRows(colsResult.columns, pkResult.columns)
    const idxDrafts = toIndexDrafts(idxsResult.indexes, pkResult.columns)
    columns.value = rows
    indexes.value = idxDrafts
    origColumns.value = rows.map((c) => ({ ...c }))
    origIndexes.value = idxDrafts.map((i) => ({ ...i }))
    tableComment.value = colsResult.tableComment ?? ''
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}

// ─── Preview + Apply ──────────────────────────────────────────────────────
async function buildOps() {
  if (props.designMode === 'create') {
    return null
  }
  return buildAlterDesignOps(
    origColumns.value,
    columns.value,
    origIndexes.value,
    indexes.value,
    [],
    [],
  )
}

async function onPreview(): Promise<void> {
  if (!props.sessionId) return
  try {
    if (props.designMode === 'create') {
      const cols = buildCreateColumns(columns.value)
      const idxs = buildCreateIndexes(indexes.value)
      if (!tableName.value.trim()) {
        toast.error(t('modules.mysql.design.needTableName'))
        return
      }
      const result = await mysqlApi.ddlDesignPreview({
        sessionId: props.sessionId,
        database: props.database,
        name: tableName.value.trim(),
        ops: [
          ...cols.map((col) => ({ op: 'add_column' as const, column: col })),
          ...idxs.map((idx) => ({ op: 'add_index' as const, index: idx })),
        ],
      })
      previewSqls.value = result.sql
    } else {
      const ops = await buildOps()
      if (!ops || ops.length === 0) {
        toast.info(t('modules.mysql.design.noChanges'))
        return
      }
      const result = await mysqlApi.ddlDesignPreview({
        sessionId: props.sessionId,
        database: props.database,
        name: props.table!,
        ops,
      })
      previewSqls.value = result.sql
    }
    showPreview.value = true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function onApply(): Promise<void> {
  if (!props.sessionId) return
  saving.value = true
  try {
    if (props.designMode === 'create') {
      const name = tableName.value.trim()
      if (!name) {
        toast.error(t('modules.mysql.design.needTableName'))
        return
      }
      const cols = buildCreateColumns(columns.value)
      const idxs = buildCreateIndexes(indexes.value)
      const fks = buildCreateForeignKeys([])
      await mysqlApi.ddlCreateTable({
        sessionId: props.sessionId,
        database: props.database,
        name,
        columns: cols,
        indexes: idxs.length ? idxs : undefined,
        foreignKeys: fks.length ? fks : undefined,
        comment: tableComment.value || undefined,
        engine: tableEngine.value || undefined,
        charset: tableCharset.value || undefined,
      })
      toast.success(t('modules.mysql.design.createOk', { name }))
      showPreview.value = false
    } else {
      const ops = await buildOps()
      if (!ops || ops.length === 0) {
        toast.info(t('modules.mysql.design.noChanges'))
        return
      }
      await mysqlApi.ddlDesignApply({
        sessionId: props.sessionId,
        database: props.database,
        name: props.table!,
        ops,
      })
      toast.success(t('modules.mysql.design.applyOk'))
      showPreview.value = false
      await load()
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}

watch(
  () => [props.sessionId, props.database, props.table, props.active] as const,
  ([sid, , , active]) => {
    if (active && (sid || props.profileId)) {
      void load()
    }
  },
  { immediate: true },
)

onMounted(() => {
  if (props.designMode === 'create' && columns.value.length === 0) {
    addColumn()
  }
})
</script>

<template>
  <div class="nm-mysql-design">
    <!-- Header -->
    <header class="nm-mysql-design__header">
      <div class="nm-mysql-design__header-left">
        <RsIcon name="layout-list" :size="15" />
        <span class="nm-mysql-design__title">
          {{ designMode === 'create' ? t('modules.mysql.design.createTitle') : t('modules.mysql.design.alterTitle', { name: table }) }}
        </span>
        <span v-if="sessionLabel" class="nm-mysql-design__label">{{ sessionLabel }}</span>
      </div>
      <div class="nm-mysql-design__header-right">
        <RsButton size="sm" variant="ghost" :loading="loading" icon="refresh-cw" @click="load">
          {{ t('modules.mysql.design.reload') }}
        </RsButton>
        <RsButton size="sm" variant="ghost" @click="onPreview">
          {{ t('modules.mysql.design.preview') }}
        </RsButton>
        <RsButton size="sm" variant="primary" :loading="saving" @click="onApply">
          {{ designMode === 'create' ? t('modules.mysql.design.create') : t('modules.mysql.design.apply') }}
        </RsButton>
      </div>
    </header>

    <RsLoading v-if="loading" class="nm-mysql-design__loading" />

    <div v-else class="nm-mysql-design__content">
      <!-- Create mode: table meta -->
      <div v-if="designMode === 'create'" class="nm-mysql-design__meta">
        <div class="nm-mysql-design__meta-row">
          <label class="nm-mysql-design__meta-label">{{ t('modules.mysql.design.tableName') }}</label>
          <RsInput v-model="tableName" size="sm" :placeholder="t('modules.mysql.design.tableNamePh')" />
        </div>
        <div class="nm-mysql-design__meta-row">
          <label class="nm-mysql-design__meta-label">{{ t('modules.mysql.design.tableEngine') }}</label>
          <RsSelect v-model="tableEngine" size="sm" :options="engineOptions" />
        </div>
        <div class="nm-mysql-design__meta-row">
          <label class="nm-mysql-design__meta-label">{{ t('modules.mysql.design.tableCharset') }}</label>
          <RsSelect v-model="tableCharset" size="sm" :options="charsetOptions" />
        </div>
        <div class="nm-mysql-design__meta-row nm-mysql-design__meta-row--full">
          <label class="nm-mysql-design__meta-label">{{ t('modules.mysql.design.tableComment') }}</label>
          <RsInput v-model="tableComment" size="sm" :placeholder="t('modules.mysql.design.tableCommentPh')" />
        </div>
      </div>

      <!-- Tabs -->
      <div class="nm-mysql-design__tabs">
        <button
          type="button"
          class="nm-mysql-design__tab"
          :class="{ 'nm-mysql-design__tab--active': activeTab === 'columns' }"
          @click="activeTab = 'columns'"
        >
          {{ t('modules.mysql.design.tabColumns') }}
          <span class="nm-mysql-design__tab-count">{{ columns.filter(c => !c.removed).length }}</span>
        </button>
        <button
          type="button"
          class="nm-mysql-design__tab"
          :class="{ 'nm-mysql-design__tab--active': activeTab === 'indexes' }"
          @click="activeTab = 'indexes'"
        >
          {{ t('modules.mysql.design.tabIndexes') }}
          <span class="nm-mysql-design__tab-count">{{ indexes.filter(i => !i.removed).length }}</span>
        </button>
      </div>

      <div class="nm-mysql-design__main">
        <!-- Left: table -->
        <div class="nm-mysql-design__table-area">
          <template v-if="activeTab === 'columns'">
            <RsTable
              :columns="colColumns"
              :data="colRows"
              size="sm"
              fill
              row-key="__rowKey"
              :highlighted-row-key="editingColKey ?? undefined"
              @row-click="onColRowClick"
            >
              <template #cell-_actions="{ row }">
                <button
                  type="button"
                  class="nm-mysql-design__del-btn"
                  :title="t('modules.mysql.design.remove')"
                  @click.stop="removeCol(String(row.__rowKey))"
                >
                  <RsIcon name="x" :size="13" />
                </button>
              </template>
            </RsTable>
            <div class="nm-mysql-design__add-row">
              <RsButton size="sm" variant="ghost" icon="plus" @click="addColumn">
                {{ t('modules.mysql.design.addColumn') }}
              </RsButton>
            </div>
          </template>

          <template v-else>
            <RsEmpty
              v-if="indexes.filter(i => !i.removed).length === 0"
              :description="t('modules.mysql.design.noIndexes')"
            />
            <RsTable
              v-else
              :columns="idxColumns"
              :data="idxRows"
              size="sm"
              fill
              row-key="__rowKey"
              :highlighted-row-key="editingIdxKey ?? undefined"
              @row-click="onIdxRowClick"
            >
              <template #cell-_actions="{ row }">
                <button
                  type="button"
                  class="nm-mysql-design__del-btn"
                  :title="t('modules.mysql.design.remove')"
                  @click.stop="removeIdx(String(row.__rowKey))"
                >
                  <RsIcon name="x" :size="13" />
                </button>
              </template>
            </RsTable>
            <div class="nm-mysql-design__add-row">
              <RsButton size="sm" variant="ghost" icon="plus" @click="addIndex">
                {{ t('modules.mysql.design.addIndex') }}
              </RsButton>
            </div>
          </template>
        </div>

        <!-- Right: editor panel -->
        <div class="nm-mysql-design__editor">
          <!-- Column editor -->
          <template v-if="activeTab === 'columns' && editingCol">
            <div class="nm-mysql-design__editor-title">{{ t('modules.mysql.design.editColumn') }}</div>
            <div class="nm-mysql-design__form">
              <div class="nm-mysql-design__field">
                <label>{{ t('modules.mysql.design.colName') }}</label>
                <RsInput
                  :model-value="editingCol.name"
                  size="sm"
                  :placeholder="t('modules.mysql.design.colNamePh')"
                  @update:model-value="updateColField(editingCol.__rowKey, 'name', String($event))"
                />
              </div>
              <div class="nm-mysql-design__field">
                <label>{{ t('modules.mysql.design.colType') }}</label>
                <RsSelect
                  :model-value="editingCol.typeBase"
                  size="sm"
                  :options="typeOptions"
                  @update:model-value="updateColField(editingCol.__rowKey, 'typeBase', String($event))"
                />
              </div>
              <div v-if="['VARCHAR','CHAR','DECIMAL','FLOAT','DOUBLE'].includes(editingCol.typeBase)" class="nm-mysql-design__field">
                <label>{{ t('modules.mysql.design.colLength') }}</label>
                <RsInput
                  :model-value="String(editingCol.typeLength ?? '')"
                  size="sm"
                  type="number"
                  @update:model-value="updateColField(editingCol.__rowKey, 'typeLength', $event ? Number($event) : undefined)"
                />
              </div>
              <div class="nm-mysql-design__field nm-mysql-design__field--check">
                <label>{{ t('modules.mysql.design.colNullable') }}</label>
                <input
                  type="checkbox"
                  :checked="editingCol.nullable"
                  @change="updateColField(editingCol.__rowKey, 'nullable', ($event.target as HTMLInputElement).checked)"
                />
              </div>
              <div class="nm-mysql-design__field nm-mysql-design__field--check">
                <label>{{ t('modules.mysql.design.colPk') }}</label>
                <input
                  type="checkbox"
                  :checked="editingCol.primaryKey"
                  @change="updateColField(editingCol.__rowKey, 'primaryKey', ($event.target as HTMLInputElement).checked)"
                />
              </div>
              <div class="nm-mysql-design__field nm-mysql-design__field--check">
                <label>{{ t('modules.mysql.design.colAi') }}</label>
                <input
                  type="checkbox"
                  :checked="editingCol.autoIncrement"
                  @change="updateColField(editingCol.__rowKey, 'autoIncrement', ($event.target as HTMLInputElement).checked)"
                />
              </div>
              <div class="nm-mysql-design__field">
                <label>{{ t('modules.mysql.design.colDefault') }}</label>
                <RsInput
                  :model-value="editingCol.defaultExpr"
                  size="sm"
                  :placeholder="t('modules.mysql.design.colDefaultPh')"
                  @update:model-value="updateColField(editingCol.__rowKey, 'defaultExpr', String($event ?? ''))"
                />
              </div>
              <div class="nm-mysql-design__field">
                <label>{{ t('modules.mysql.design.colComment') }}</label>
                <RsInput
                  :model-value="editingCol.comment"
                  size="sm"
                  :placeholder="t('modules.mysql.design.colCommentPh')"
                  @update:model-value="updateColField(editingCol.__rowKey, 'comment', String($event ?? ''))"
                />
              </div>
            </div>
          </template>

          <!-- Index editor -->
          <template v-else-if="activeTab === 'indexes' && editingIdx">
            <div class="nm-mysql-design__editor-title">{{ t('modules.mysql.design.editIndex') }}</div>
            <div class="nm-mysql-design__form">
              <div class="nm-mysql-design__field">
                <label>{{ t('modules.mysql.design.idxName') }}</label>
                <RsInput
                  :model-value="editingIdx.name"
                  size="sm"
                  :placeholder="t('modules.mysql.design.idxNamePh')"
                  @update:model-value="updateIdxField(editingIdx.__rowKey, 'name', String($event ?? ''))"
                />
              </div>
              <div class="nm-mysql-design__field">
                <label>{{ t('modules.mysql.design.idxColumns') }}</label>
                <RsInput
                  :model-value="editingIdx.columnsText"
                  size="sm"
                  :placeholder="t('modules.mysql.design.idxColumnsPh')"
                  @update:model-value="updateIdxField(editingIdx.__rowKey, 'columnsText', String($event ?? ''))"
                />
              </div>
              <div class="nm-mysql-design__field nm-mysql-design__field--check">
                <label>{{ t('modules.mysql.design.idxUnique') }}</label>
                <input
                  type="checkbox"
                  :checked="editingIdx.unique"
                  @change="updateIdxField(editingIdx.__rowKey, 'unique', ($event.target as HTMLInputElement).checked)"
                />
              </div>
            </div>
          </template>

          <div v-else class="nm-mysql-design__editor-empty">
            <RsEmpty :description="t('modules.mysql.design.selectRow')" icon="mouse-pointer-2" />
          </div>
        </div>
      </div>

      <!-- Preview panel -->
      <div v-if="showPreview" class="nm-mysql-design__preview">
        <div class="nm-mysql-design__preview-header">
          <span>{{ t('modules.mysql.design.previewTitle') }}</span>
          <button type="button" class="nm-mysql-design__preview-close" @click="showPreview = false">
            <RsIcon name="x" :size="14" />
          </button>
        </div>
        <pre class="nm-mysql-design__preview-sql">{{ previewSqls.join(';\n\n') }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nm-mysql-design {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.nm-mysql-design__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
}
.nm-mysql-design__header-left {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.nm-mysql-design__title {
  font-weight: 600;
  font-size: 13px;
}
.nm-mysql-design__label {
  font-size: 12px;
  color: var(--rs-fg-muted);
}
.nm-mysql-design__header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.nm-mysql-design__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nm-mysql-design__content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.nm-mysql-design__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
}
.nm-mysql-design__meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.nm-mysql-design__meta-row--full {
  flex: 1;
  min-width: 240px;
}
.nm-mysql-design__meta-label {
  font-size: 12px;
  color: var(--rs-fg-muted);
  white-space: nowrap;
  min-width: 60px;
}
.nm-mysql-design__tabs {
  display: flex;
  gap: 0;
  padding: 0 12px;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
}
.nm-mysql-design__tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  font-size: 12px;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  background: transparent;
  color: var(--rs-fg-muted, #6b7280);
}
.nm-mysql-design__tab--active {
  color: var(--rs-accent, #2563eb);
  border-bottom-color: var(--rs-accent, #2563eb);
  font-weight: 500;
}
.nm-mysql-design__tab-count {
  background: var(--rs-bg-elevated, #f3f4f6);
  color: var(--rs-fg-muted);
  border-radius: 10px;
  padding: 0 6px;
  font-size: 11px;
}
.nm-mysql-design__main {
  flex: 1;
  min-height: 0;
  display: flex;
}
.nm-mysql-design__table-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--rs-border-subtle, #e5e7eb);
}
.nm-mysql-design__add-row {
  padding: 6px 8px;
  border-top: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
}
.nm-mysql-design__del-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--rs-fg-danger, #ef4444);
  border-radius: 3px;
  opacity: 0.6;
}
.nm-mysql-design__del-btn:hover {
  opacity: 1;
  background: var(--rs-bg-danger-subtle, #fee2e2);
}
.nm-mysql-design__editor {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 10px;
  gap: 4px;
}
.nm-mysql-design__editor-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--rs-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.nm-mysql-design__editor-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nm-mysql-design__form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nm-mysql-design__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.nm-mysql-design__field label {
  font-size: 11px;
  color: var(--rs-fg-muted);
}
.nm-mysql-design__field--check {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.nm-mysql-design__preview {
  flex-shrink: 0;
  border-top: 1px solid var(--rs-border-subtle, #e5e7eb);
  max-height: 240px;
  display: flex;
  flex-direction: column;
}
.nm-mysql-design__preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  flex-shrink: 0;
}
.nm-mysql-design__preview-close {
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  color: var(--rs-fg-muted);
}
.nm-mysql-design__preview-sql {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
  margin: 0;
  font-size: 12px;
  font-family: var(--rs-font-mono, monospace);
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--rs-bg, #fff);
  color: var(--rs-fg);
}
</style>
