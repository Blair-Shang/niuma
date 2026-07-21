<script setup lang="ts">
import { RsButton, RsEmpty, RsIcon, RsLoading, RsTable, RsToolbar, useRsToast } from '@niuma/ui'
import type { RsTableColumn } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { vastbaseApi } from '@/api'
import type {
  VastMetaDatabaseOverviewResult,
  VastMetaSchemaOverviewResult,
} from '@/api/types/vastbase'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  /** 连接显示名（与 Session 顶栏合并后由面板自绘） */
  sessionLabel?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

const loading = ref(false)
const loadError = ref<string | null>(null)
const schemaOverview = ref<VastMetaSchemaOverviewResult | null>(null)
const databaseOverview = ref<VastMetaDatabaseOverviewResult | null>(null)
/** 丢弃过期的并发加载结果，避免快速切库/切 schema 时旧响应盖住新数据 */
let loadSeq = 0

const isSchemaMode = computed(() => !!props.schema)
const scopeOk = computed(
  () =>
    !!(props.sessionId || props.profileId) &&
    (isSchemaMode.value ? !!props.schema : !!props.database),
)

const scopeLabel = computed(() => {
  const parts = [props.database, props.schema].filter(Boolean)
  return parts.length ? parts.join('.') : ''
})

type CountRow = Record<string, unknown> & { __rowKey: string }

const countCols = computed((): RsTableColumn<CountRow>[] => [
  { key: 'category', title: t('modules.vastbase.overview.colCategory'), minWidth: 140 },
  { key: 'count', title: t('modules.vastbase.overview.colCount'), width: 100, align: 'right' },
])

const countRows = computed((): CountRow[] => {
  if (isSchemaMode.value) {
    const o = schemaOverview.value
    if (!o) return []
    return [
      { __rowKey: 'tables', category: t('modules.vastbase.tree.catTables'), count: o.tables },
      { __rowKey: 'views', category: t('modules.vastbase.tree.catViews'), count: o.views },
      { __rowKey: 'functions', category: t('modules.vastbase.tree.catFunctions'), count: o.functions },
      { __rowKey: 'procedures', category: t('modules.vastbase.tree.catProcedures'), count: o.procedures },
    ]
  }
  const o = databaseOverview.value
  if (!o) return []
  return [
    { __rowKey: 'schemas', category: t('modules.vastbase.overview.schemas'), count: o.schemas },
    { __rowKey: 'tables', category: t('modules.vastbase.tree.catTables'), count: o.tables },
    { __rowKey: 'views', category: t('modules.vastbase.tree.catViews'), count: o.views },
    { __rowKey: 'functions', category: t('modules.vastbase.tree.catFunctions'), count: o.functions },
    { __rowKey: 'procedures', category: t('modules.vastbase.tree.catProcedures'), count: o.procedures },
  ]
})

const totalObjects = computed(() => {
  if (isSchemaMode.value) {
    const o = schemaOverview.value
    if (!o) return 0
    return o.tables + o.views + o.functions + o.procedures
  }
  const o = databaseOverview.value
  if (!o) return 0
  return o.schemas + o.tables + o.views + o.functions + o.procedures
})

function formatSize(bytes: number | undefined): string {
  if (bytes == null || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

async function loadOverview(): Promise<void> {
  if (!scopeOk.value) return
  const seq = ++loadSeq
  loading.value = true
  loadError.value = null
  try {
    if (isSchemaMode.value && props.schema) {
      const result = await vastbaseApi.metaSchemaOverview({
        sessionId: props.sessionId ?? undefined,
        profileId: props.profileId,
        database: props.database,
        schema: props.schema,
      })
      if (seq !== loadSeq) return
      schemaOverview.value = result
      databaseOverview.value = null
    } else if (props.database) {
      const result = await vastbaseApi.metaDatabaseOverview({
        sessionId: props.sessionId ?? undefined,
        profileId: props.profileId,
        database: props.database,
      })
      if (seq !== loadSeq) return
      databaseOverview.value = result
      schemaOverview.value = null
    }
  } catch (e) {
    if (seq !== loadSeq) return
    const msg = e instanceof Error ? e.message : t('modules.vastbase.overview.loadError')
    loadError.value = msg
    toast.error(msg)
    schemaOverview.value = null
    databaseOverview.value = null
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

const hasData = computed(() => !!(schemaOverview.value || databaseOverview.value))

watch(
  () => [props.sessionId, props.profileId, props.database, props.schema, props.active] as const,
  () => {
    if (props.active && scopeOk.value) void loadOverview()
  },
  { immediate: true },
)
</script>

<template>
  <div class="nm-vast-overview">
    <RsToolbar size="sm" compact border="bottom" :label="t('modules.vastbase.session.tabOverview')">
      <template #left>
        <div class="nm-vast-overview__identity" :title="sessionLabel || undefined">
          <RsIcon name="vastbase" :size="15" />
          <span v-if="sessionLabel" class="nm-vast-overview__session">{{ sessionLabel }}</span>
          <span v-if="scopeLabel" class="nm-vast-overview__scope">{{ scopeLabel }}</span>
          <span class="nm-vast-overview__feature">
            <RsIcon name="layout-grid" :size="12" />
            {{ t('modules.vastbase.session.tabOverview') }}
          </span>
        </div>
      </template>
      <template #right>
        <RsButton
          variant="ghost"
          size="sm"
          icon="refresh-cw"
          :loading="loading"
          @click="loadOverview"
        >
          {{ t('modules.vastbase.structure.refresh') }}
        </RsButton>
      </template>
    </RsToolbar>

    <div class="nm-vast-overview__body">
    <RsLoading v-if="loading && !hasData" class="nm-vast-overview__loader" />

    <RsEmpty
      v-else-if="!scopeOk"
      icon="folder"
      :description="
        isSchemaMode
          ? t('modules.vastbase.overview.needSchema')
          : t('modules.vastbase.overview.needDatabase')
      "
    />

    <RsEmpty
      v-else-if="loadError"
      icon="circle-alert"
      :description="loadError"
    />

    <template v-else-if="schemaOverview">
      <dl class="nm-vast-overview__meta">
        <div class="nm-vast-overview__meta-row">
          <dt>{{ t('modules.vastbase.overview.schemaName') }}</dt>
          <dd>{{ schemaOverview.name }}</dd>
        </div>
        <div v-if="schemaOverview.owner" class="nm-vast-overview__meta-row">
          <dt>{{ t('modules.vastbase.overview.owner') }}</dt>
          <dd>{{ schemaOverview.owner }}</dd>
        </div>
        <div v-if="schemaOverview.comment" class="nm-vast-overview__meta-row">
          <dt>{{ t('modules.vastbase.overview.comment') }}</dt>
          <dd>{{ schemaOverview.comment }}</dd>
        </div>
        <div class="nm-vast-overview__meta-row">
          <dt>{{ t('modules.vastbase.overview.totalObjects') }}</dt>
          <dd>{{ totalObjects }}</dd>
        </div>
      </dl>
      <RsTable :columns="countCols" :data="countRows" size="sm" class="nm-vast-overview__table" />
    </template>

    <template v-else-if="databaseOverview">
      <dl class="nm-vast-overview__meta">
        <div class="nm-vast-overview__meta-row">
          <dt>{{ t('modules.vastbase.overview.databaseName') }}</dt>
          <dd>{{ databaseOverview.name }}</dd>
        </div>
        <div v-if="databaseOverview.owner" class="nm-vast-overview__meta-row">
          <dt>{{ t('modules.vastbase.overview.owner') }}</dt>
          <dd>{{ databaseOverview.owner }}</dd>
        </div>
        <div v-if="databaseOverview.encoding" class="nm-vast-overview__meta-row">
          <dt>{{ t('modules.vastbase.overview.encoding') }}</dt>
          <dd>{{ databaseOverview.encoding }}</dd>
        </div>
        <div v-if="databaseOverview.collate" class="nm-vast-overview__meta-row">
          <dt>{{ t('modules.vastbase.overview.collate') }}</dt>
          <dd>{{ databaseOverview.collate }}</dd>
        </div>
        <div v-if="databaseOverview.ctype" class="nm-vast-overview__meta-row">
          <dt>{{ t('modules.vastbase.overview.ctype') }}</dt>
          <dd>{{ databaseOverview.ctype }}</dd>
        </div>
        <div v-if="formatSize(databaseOverview.sizeBytes)" class="nm-vast-overview__meta-row">
          <dt>{{ t('modules.vastbase.overview.size') }}</dt>
          <dd>{{ formatSize(databaseOverview.sizeBytes) }}</dd>
        </div>
        <div v-if="databaseOverview.comment" class="nm-vast-overview__meta-row">
          <dt>{{ t('modules.vastbase.overview.comment') }}</dt>
          <dd>{{ databaseOverview.comment }}</dd>
        </div>
        <div class="nm-vast-overview__meta-row">
          <dt>{{ t('modules.vastbase.overview.totalObjects') }}</dt>
          <dd>{{ totalObjects }}</dd>
        </div>
      </dl>
      <RsTable :columns="countCols" :data="countRows" size="sm" class="nm-vast-overview__table" />
    </template>

    <RsEmpty
      v-else
      icon="folder"
      :description="t('modules.vastbase.overview.empty')"
    />
    </div>
  </div>
</template>

<style scoped>
.nm-vast-overview {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-vast-overview__identity {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-vast-overview__session {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-vast-overview__scope {
  color: var(--rs-muted);
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-vast-overview__feature {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.45rem;
  border-radius: var(--rs-radius-sm);
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.12));
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  flex-shrink: 0;
}

.nm-vast-overview__body {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  flex: 1;
  min-height: 0;
  padding: var(--rs-space-md);
}

.nm-vast-overview__loader {
  flex: 1;
}

.nm-vast-overview__meta {
  display: grid;
  gap: var(--rs-space-xs);
  margin: 0;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  background: var(--rs-surface-subtle);
}

.nm-vast-overview__meta-row {
  display: grid;
  grid-template-columns: 8rem 1fr;
  gap: var(--rs-space-sm);
  font-size: var(--rs-font-size-sm);
}

.nm-vast-overview__meta-row dt {
  margin: 0;
  color: var(--rs-muted);
}

.nm-vast-overview__meta-row dd {
  margin: 0;
  font-weight: 500;
  word-break: break-all;
}

.nm-vast-overview__table {
  flex: 1;
  min-height: 0;
}
</style>
