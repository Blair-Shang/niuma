<script setup lang="ts">
import {
  RsButton,
  RsEmpty,
  RsLoading,
  RsTable,
  RsTabs,
  useRsToast,
} from '@niuma/ui'
import type { RsContextMenuItem, RsTabItem, RsTableColumn } from '@niuma/ui'
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi, vastbaseApi } from '@/api'
import type { VastDependencyInfo } from '@/api/types/vastbase'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import type { VastSessionTab } from '@/modules/vastbase/pane-registry'
import { VAST_SESSION_HEADER_ACTIONS_KEY } from '@/modules/vastbase/session-chrome'
import { qualifiedName } from '@/modules/vastbase/sql-seed'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  table?: string
  routine?: string
  routineKind?: 'function' | 'procedure'
  args?: string
  oid?: number
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()
const nav = useConnectionNavigation()

const headerActionsEl = inject(VAST_SESSION_HEADER_ACTIONS_KEY, ref<HTMLElement | null>(null))
const actionsHost = computed(() => headerActionsEl.value)

const loading = ref(false)
const deps = ref<VastDependencyInfo[]>([])
const directionFilter = ref<'all' | 'depends_on' | 'referenced_by'>('all')
let loadSeq = 0

type Row = Record<string, unknown> & {
  __rowKey: string
  direction: string
  directionLabel: string
  schema: string
  name: string
  kind: string
  kindLabel: string
  detail: string
  detailLabel: string
  qualified: string
}

function kindLabel(kind: string): string {
  const key = `modules.vastbase.deps.kinds.${kind}`
  const labeled = t(key)
  return labeled === key ? kind : labeled
}

function detailLabel(detail: string): string {
  if (!detail) return ''
  const key = `modules.vastbase.deps.deptypes.${detail}`
  const labeled = t(key)
  return labeled === key ? detail : labeled
}

function directionLabel(direction: string): string {
  if (direction === 'depends_on') return t('modules.vastbase.deps.dependsOn')
  if (direction === 'referenced_by') return t('modules.vastbase.deps.referencedBy')
  return direction
}

const dependsOnCount = computed(
  () => deps.value.filter((d) => d.direction === 'depends_on').length,
)
const referencedByCount = computed(
  () => deps.value.filter((d) => d.direction === 'referenced_by').length,
)

const directionTabs = computed((): RsTabItem[] => [
  {
    value: 'all',
    label: t('modules.vastbase.deps.tabAll'),
    badge: deps.value.length || undefined,
  },
  {
    value: 'depends_on',
    label: t('modules.vastbase.deps.dependsOn'),
    badge: dependsOnCount.value || undefined,
  },
  {
    value: 'referenced_by',
    label: t('modules.vastbase.deps.referencedBy'),
    badge: referencedByCount.value || undefined,
  },
])

const subjectName = computed(() => props.table ?? props.routine)

const scopeLabel = computed(() => {
  if (!props.schema || !subjectName.value) return ''
  if (props.routine && props.args) {
    return `${props.schema}.${props.routine}(${props.args})`
  }
  return `${props.schema}.${subjectName.value}`
})

const summaryText = computed(() => {
  if (!scopeLabel.value || deps.value.length === 0) return ''
  return t('modules.vastbase.deps.summary', {
    object: scopeLabel.value,
    dependsOn: dependsOnCount.value,
    referencedBy: referencedByCount.value,
  })
})

const rows = computed((): Row[] =>
  deps.value.map((d, i) => ({
    __rowKey: `${d.direction}:${d.schema}.${d.name}:${d.kind}:${d.detail ?? ''}:${i}`,
    direction: d.direction,
    directionLabel: directionLabel(d.direction),
    schema: d.schema,
    name: d.name,
    kind: d.kind,
    kindLabel: kindLabel(d.kind),
    detail: d.detail ?? '',
    detailLabel: detailLabel(d.detail ?? ''),
    qualified: d.schema ? `${d.schema}.${d.name}` : d.name,
  })),
)

const filteredRows = computed((): Row[] => {
  if (directionFilter.value === 'all') return rows.value
  return rows.value.filter((r) => r.direction === directionFilter.value)
})

const columns = computed((): RsTableColumn<Row>[] => [
  {
    key: 'schema',
    title: t('modules.vastbase.deps.colSchema'),
    minWidth: 100,
    ellipsis: true,
    filterable: true,
    sortable: true,
  },
  {
    key: 'name',
    title: t('modules.vastbase.deps.colName'),
    minWidth: 140,
    ellipsis: true,
    filterable: true,
    sortable: true,
  },
  {
    key: 'kindLabel',
    title: t('modules.vastbase.deps.colKind'),
    width: 120,
    filterable: true,
    sortable: true,
  },
  {
    key: 'detailLabel',
    title: t('modules.vastbase.deps.colDetail'),
    minWidth: 110,
    filterable: true,
    tooltip: (row) =>
      row.detail ? t('modules.vastbase.deps.deptypeTip', { code: row.detail }) : undefined,
  },
])

/** 「全部」时按方向分组；单方向页签不再重复分组。 */
const groupBy = computed(() => (directionFilter.value === 'all' ? 'directionLabel' : undefined))

const scopeOk = computed(
  () => !!(props.schema && subjectName.value && props.sessionId),
)

function canOpenObject(kind: string): boolean {
  return (
    kind === 'table' ||
    kind === 'foreign_table' ||
    kind === 'view' ||
    kind === 'materialized_view' ||
    kind === 'function' ||
    kind === 'procedure'
  )
}

function defaultFeatureForKind(kind: string): VastSessionTab {
  if (kind === 'function' || kind === 'procedure') return 'source'
  return 'browse'
}

function buildPathForRow(row: Row): ConnResourcePath | null {
  if (!props.database || !row.schema || !row.name) return null
  const base = [
    { kind: 'database', name: props.database },
    { kind: 'schema', name: row.schema },
  ]
  if (row.kind === 'table' || row.kind === 'foreign_table') {
    return {
      segments: [
        ...base,
        { kind: 'category', name: 'tables' },
        ...(row.kind !== 'table' ? [{ kind: 'reltype', name: row.kind }] : []),
        { kind: 'table', name: row.name },
      ],
    }
  }
  if (row.kind === 'view' || row.kind === 'materialized_view') {
    return {
      segments: [
        ...base,
        { kind: 'category', name: 'views' },
        { kind: 'reltype', name: row.kind },
        { kind: 'table', name: row.name },
      ],
    }
  }
  if (row.kind === 'function') {
    return {
      segments: [
        ...base,
        { kind: 'category', name: 'functions' },
        { kind: 'function', name: row.name },
      ],
    }
  }
  if (row.kind === 'procedure') {
    return {
      segments: [
        ...base,
        { kind: 'category', name: 'procedures' },
        { kind: 'procedure', name: row.name },
      ],
    }
  }
  return null
}

async function resolveConnItem(): Promise<ConnItem | null> {
  if (!props.profileId) return null
  const result = await connectionApi.get({ profileId: props.profileId })
  if (!result.profile) return null
  return { ...result.profile, kind: 'vastbase' }
}

async function openRow(row: Row, feature?: VastSessionTab): Promise<void> {
  if (!canOpenObject(row.kind)) {
    toast.error(t('modules.vastbase.deps.openUnsupported'))
    return
  }
  const path = buildPathForRow(row)
  if (!path) {
    toast.error(t('modules.vastbase.deps.openFailed'))
    return
  }
  try {
    const item = await resolveConnItem()
    if (!item) throw new Error(t('modules.vastbase.deps.openFailed'))
    nav.connect(item, {
      resourcePath: path,
      initialTab: feature ?? defaultFeatureForKind(row.kind),
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.deps.openFailed'))
  }
}

async function copyQualified(row: Row): Promise<void> {
  const text = row.schema ? qualifiedName(row.schema, row.name) : row.name
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('modules.vastbase.deps.copied'))
  } catch {
    toast.error(t('modules.vastbase.deps.copyFailed'))
  }
}

function contextMenuItems(row: Row | null): RsContextMenuItem[] {
  if (!row) return []
  const openable = canOpenObject(row.kind)
  const isRelation =
    row.kind === 'table' ||
    row.kind === 'foreign_table' ||
    row.kind === 'view' ||
    row.kind === 'materialized_view'
  const isRoutine = row.kind === 'function' || row.kind === 'procedure'
  return [
    {
      key: 'open',
      label: t(
        isRoutine
          ? row.kind === 'procedure'
            ? 'modules.vastbase.tree.procOpen'
            : 'modules.vastbase.tree.funcOpen'
          : 'modules.vastbase.tree.tableOpen',
      ),
      icon: isRoutine ? (row.kind === 'procedure' ? 'workflow' : 'square-function') : 'table',
      disabled: !openable,
    },
    ...(isRelation
      ? ([
          {
            key: 'ddl',
            label: t('modules.vastbase.tree.tableDdl'),
            icon: 'file-code',
            disabled: !openable,
          },
          {
            key: 'deps',
            label: t('modules.vastbase.tree.tableDeps'),
            icon: 'git-fork',
            disabled: !openable,
          },
        ] as RsContextMenuItem[])
      : []),
    { key: 'sep-copy', label: '', separator: true },
    {
      key: 'copy',
      label: t('modules.vastbase.deps.copyQualified'),
      icon: 'copy',
    },
  ]
}

function onContextMenuSelect(key: string, row: Row | null): void {
  if (!row) return
  if (key === 'open') void openRow(row)
  else if (key === 'ddl') void openRow(row, 'ddl')
  else if (key === 'deps') void openRow(row, 'deps')
  else if (key === 'copy') void copyQualified(row)
}

function onRowDblclick(row: Row): void {
  if (canOpenObject(row.kind)) void openRow(row)
}

async function loadDeps(): Promise<void> {
  if (!props.sessionId || !props.schema || !subjectName.value) return
  const seq = ++loadSeq
  loading.value = true
  try {
    const isRoutine = !!props.routine
    const result = await vastbaseApi.metaDependencies({
      sessionId: props.sessionId,
      database: props.database,
      schema: props.schema,
      name: subjectName.value,
      table: props.table,
      args: props.args,
      oid: props.oid,
      kind: isRoutine ? (props.routineKind ?? 'function') : undefined,
    })
    if (seq !== loadSeq) return
    deps.value = result.dependencies
  } catch (e) {
    if (seq !== loadSeq) return
    deps.value = []
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.deps.loadError'))
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

/** 作用域变化时重拉；keep-alive 切回不重复请求。 */
watch(
  () =>
    [
      props.sessionId,
      props.database,
      props.schema,
      props.table,
      props.routine,
      props.args,
      props.oid,
    ] as const,
  () => {
    deps.value = []
    directionFilter.value = 'all'
    if (props.active && scopeOk.value) void loadDeps()
  },
  { immediate: true },
)

watch(
  () => props.active,
  (active) => {
    if (active && deps.value.length === 0 && scopeOk.value) void loadDeps()
  },
)
</script>

<template>
  <div class="nm-vast-deps">
    <Teleport v-if="actionsHost" :to="actionsHost">
      <RsButton
        variant="ghost"
        size="sm"
        icon="refresh-cw"
        :loading="loading"
        :disabled="!scopeOk"
        @click="loadDeps"
      >
        {{ t('modules.vastbase.structure.refresh') }}
      </RsButton>
    </Teleport>

    <div class="nm-vast-deps__toolbar">
      <RsTabs
        v-model="directionFilter"
        class="nm-vast-deps__tabs"
        :items="directionTabs"
        size="sm"
        variant="segmented"
        panelless
      />
      <p v-if="summaryText" class="nm-vast-deps__summary">{{ summaryText }}</p>
      <p v-else class="nm-vast-deps__hint">{{ t('modules.vastbase.deps.hint') }}</p>
    </div>

    <RsLoading v-if="loading && deps.length === 0" class="nm-vast-deps__loading" />
    <RsEmpty
      v-else-if="!schema || !subjectName"
      fill
      icon="git-fork"
      :description="
        t(
          routine
            ? 'modules.vastbase.source.needRoutine'
            : 'modules.vastbase.structure.needTable',
        )
      "
    />
    <RsEmpty
      v-else-if="deps.length === 0"
      fill
      icon="git-fork"
      :description="t('modules.vastbase.deps.empty')"
    />
    <RsEmpty
      v-else-if="filteredRows.length === 0"
      fill
      icon="git-fork"
      :description="t('modules.vastbase.deps.emptyFilter')"
    />
    <RsTable
      v-else
      :columns="columns"
      :data="filteredRows"
      :group-by="groupBy"
      row-key="__rowKey"
      size="sm"
      striped
      fill
      :virtual-auto-threshold="40"
      :context-menu-items="contextMenuItems"
      @context-menu-select="onContextMenuSelect"
      @row-dblclick="onRowDblclick"
    >
      <template #kindLabel="{ row }">
        <span class="nm-vast-deps__kind">{{ row.kindLabel }}</span>
      </template>
    </RsTable>
  </div>
</template>

<style scoped>
.nm-vast-deps {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm);
}

.nm-vast-deps__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--rs-space-sm) var(--rs-space-md);
  flex-shrink: 0;
}

.nm-vast-deps__tabs {
  flex-shrink: 0;
}

.nm-vast-deps__summary,
.nm-vast-deps__hint {
  margin: 0;
  flex: 1;
  min-width: 12rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-vast-deps__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-vast-deps__kind {
  color: var(--rs-muted);
}
</style>
