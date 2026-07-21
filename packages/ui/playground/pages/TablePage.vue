<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  RsBadge,
  RsButton,
  RsEmpty,
  RsIcon,
  RsInput,
  RsPagination,
  RsScrollbar,
  RsSelect,
  RsTable,
  slicePageData,
  type RsContextMenuItem,
  type RsTableColumn,
  type RsTableRowDropPosition,
  type RsTableSortState,
} from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

interface TaskRow {
  id: string
  name: string
  status: 'running' | 'stopped' | 'pending'
  count: number
  updatedAt: string
  disabled?: boolean
}

const statusLabels: Record<TaskRow['status'], string> = {
  running: '运行中',
  stopped: '已停止',
  pending: '待处理',
}

const statusVariants: Record<TaskRow['status'], 'success' | 'default' | 'warning'> = {
  running: 'success',
  stopped: 'default',
  pending: 'warning',
}

const basicColumns: RsTableColumn<TaskRow>[] = [
  { key: 'name', title: '名称' },
  { key: 'status', title: '状态' },
  { key: 'count', title: '数量', align: 'right' },
]

const basicRows: TaskRow[] = [
  { id: '1', name: '任务编排', status: 'running', count: 12, updatedAt: '2026-06-15' },
  { id: '2', name: '数据同步', status: 'stopped', count: 7, updatedAt: '2026-06-14' },
  { id: '3', name: '质量检查', status: 'pending', count: 23, updatedAt: '2026-06-13' },
]

const stripedColumns: RsTableColumn<TaskRow>[] = [
  { key: 'name', title: '名称', width: 160 },
  { key: 'status', title: '状态', width: 100 },
  { key: 'count', title: '数量', align: 'right', width: 80 },
  { key: 'updatedAt', title: '更新日期', width: 120 },
]

const stripedRows: TaskRow[] = [
  ...basicRows,
  { id: '4', name: '归档任务', status: 'stopped', count: 0, updatedAt: '2026-06-12' },
  { id: '5', name: '指标汇总', status: 'running', count: 41, updatedAt: '2026-06-11' },
  { id: '6', name: '日志清理', status: 'pending', count: 3, updatedAt: '2026-06-10' },
]

const sortColumns: RsTableColumn<TaskRow>[] = [
  { key: 'name', title: '名称', sortable: true, width: 180 },
  { key: 'status', title: '状态', sortable: true, width: 120 },
  { key: 'count', title: '数量', align: 'right', sortable: true, width: 100 },
  { key: 'updatedAt', title: '更新日期', sortable: true, width: 140 },
]

const alignColumns: RsTableColumn<{ label: string; center: string; amount: number }>[] = [
  { key: 'label', title: '左对齐', align: 'left' },
  { key: 'center', title: '居中', align: 'center' },
  { key: 'amount', title: '右对齐', align: 'right' },
]

const alignRows = [
  { id: '1', label: '文本列', center: '状态', amount: 1280 },
  { id: '2', label: '另一行', center: '标签', amount: 42 },
]

const customColumns: RsTableColumn<TaskRow>[] = [
  { key: 'name', title: '任务' },
  {
    key: 'status',
    title: '状态',
    render: (row) => statusLabels[row.status],
  },
  { key: 'count', title: '数量', align: 'right' },
]

const loading = ref(false)
const emptyDemoHasData = ref(false)
const clickedRow = ref<string | null>(null)

const allUsers = Array.from({ length: 47 }, (_, index) => ({
  id: String(index + 1),
  name: `用户 ${String(index + 1).padStart(2, '0')}`,
  status: (['running', 'stopped', 'pending'] as const)[index % 3],
  count: (index + 1) * 3,
  updatedAt: `2026-06-${String((index % 28) + 1).padStart(2, '0')}`,
}))

const tablePage = ref(1)
const tablePageSize = ref(8)
const pagedRows = computed(() => slicePageData(allUsers, tablePage.value, tablePageSize.value))

const filterText = ref('')
const columnFilters = ref<Record<string, string>>({})
const statusFilter = ref<TaskRow['status'] | ''>('')

const filterableColumns: RsTableColumn<TaskRow>[] = [
  { key: 'name', title: '名称', sortable: true, filterable: true, width: 180 },
  { key: 'status', title: '状态', sortable: true, filterable: true, width: 120 },
  { key: 'count', title: '数量', align: 'right', sortable: true, width: 100 },
  { key: 'updatedAt', title: '更新日期', sortable: true, width: 140 },
]

const filteredRows = computed(() => {
  if (!statusFilter.value) return allUsers
  return allUsers.filter((row) => row.status === statusFilter.value)
})

const controlledSort = ref<RsTableSortState | null>({ key: 'count', order: 'desc' })

const virtualRows = Array.from({ length: 5000 }, (_, index) => ({
  id: String(index + 1),
  name: `虚拟行 ${String(index + 1).padStart(4, '0')}`,
  status: (['running', 'stopped', 'pending'] as const)[index % 3],
  count: (index % 97) + 1,
  updatedAt: `2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
}))

const INFINITE_TOTAL = 10_000
const INFINITE_BATCH = 150

function createInfiniteRow(index: number): TaskRow {
  return {
    id: String(index + 1),
    name: `任务 ${String(index + 1).padStart(5, '0')}`,
    status: (['running', 'stopped', 'pending'] as const)[index % 3],
    count: (index % 97) + 1,
    updatedAt: `2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
  }
}

const infiniteRows = ref<TaskRow[]>(Array.from({ length: INFINITE_BATCH }, (_, index) => createInfiniteRow(index)))
const infiniteHasMore = computed(() => infiniteRows.value.length < INFINITE_TOTAL)
const infiniteLoadingMore = ref(false)

const resizeColumns = ref(sortColumns.map((column) => ({ ...column })))
const resizeInitialWidths: Record<string, number> = {
  name: 180,
  status: 120,
  count: 100,
  updatedAt: 140,
}
const lastColumnResize = ref<string | null>(null)

function onColumnResize(key: string, width: number): void {
  lastColumnResize.value = `${key}: ${width}px`
}

const selectedRowKeys = ref<string[]>(['1'])

const selectableRows = [
  ...basicRows,
  { id: '4', name: '归档任务', status: 'stopped' as const, count: 0, updatedAt: '2026-06-01', disabled: true },
]

const ellipsisColumns: RsTableColumn<TaskRow>[] = [
  { key: 'name', title: '名称', ellipsis: true, width: 120 },
  {
    key: 'status',
    title: '状态',
    width: 88,
    tooltip: (row) => `当前状态：${statusLabels[row.status]}（count=${row.count}）`,
  },
  { key: 'updatedAt', title: '更新日期', ellipsis: true, width: 100 },
]

const editableRows = ref<TaskRow[]>([...basicRows])
const highlightedRowKey = ref<string | undefined>('1')

const editableColumns: RsTableColumn<TaskRow>[] = [
  { key: 'name', title: '名称', editable: true, width: 180 },
  {
    key: 'count',
    title: '数量',
    align: 'right',
    editable: true,
    valueType: 'number',
    width: 100,
    validator: (value) => (Number(value) >= 0 ? null : '不能为负数'),
  },
  {
    key: 'updatedAt',
    title: '更新日期',
    editable: true,
    valueType: 'date',
    width: 160,
  },
  {
    key: 'status',
    title: '状态',
    width: 120,
    editable: true,
    valueType: 'select',
    editorOptions: {
      options: [
        { value: 'running', label: '运行中' },
        { value: 'done', label: '已完成' },
        { value: 'failed', label: '失败' },
      ],
      searchable: true,
    },
  },
]

function onEditableCellCommit(
  row: TaskRow,
  column: RsTableColumn<TaskRow>,
  _index: number,
  value: unknown,
): void {
  editableRows.value = editableRows.value.map((item) =>
    item.id === row.id ? { ...item, [column.key]: value as never } : item,
  )
}

const ellipsisRows: TaskRow[] = [
  {
    id: 'e1',
    name: '这是一条非常非常长的任务名称用于测试文本省略与 tooltip 场景',
    status: 'running',
    count: 12,
    updatedAt: '2026-06-15T23:59:59+08:00',
  },
  {
    id: 'e2',
    name: '另一条超长记录：跨部门数据同步编排与质量校验流水线',
    status: 'stopped',
    count: 3,
    updatedAt: '2026-06-14T08:30:00+08:00',
  },
  {
    id: 'e3',
    name: '短名',
    status: 'pending',
    count: 1,
    updatedAt: '2026-06-01',
  },
]

const expandedRowKeys = ref<string[]>(['1'])
const zebraSelectedRowKeys = ref<string[]>([])
const zebraExpandedRowKeys = ref<string[]>([])
const radioSelectedKey = ref<string[]>([])
const remoteSort = ref<RsTableSortState | null>(null)
const remoteRows = ref([...basicRows])

const ctxEventLog = ref<string[]>([])
const dblclickLog = ref<string>('')
const ctxSelectedKeys = ref<string[]>([])

const fixedColumns: RsTableColumn<TaskRow>[] = [
  { key: 'name', title: '名称', fixed: 'left', width: 140 },
  { key: 'status', title: '状态', width: 120 },
  { key: 'count', title: '数量', align: 'right', width: 100 },
  { key: 'updatedAt', title: '更新日期', width: 160 },
  { key: 'action', title: '操作', fixed: 'right', width: 100, render: () => '查看' },
]

function onRemoteSort(sort: RsTableSortState | null): void {
  remoteSort.value = sort
  if (!sort) {
    remoteRows.value = [...basicRows]
    return
  }
  remoteRows.value = [...basicRows].sort((left, right) => {
    const direction = sort.order === 'asc' ? 1 : -1
    return String(left[sort.key as keyof TaskRow] ?? '').localeCompare(String(right[sort.key as keyof TaskRow] ?? '')) * direction
  })
}

function simulateLoading(): void {
  loading.value = true
  globalThis.setTimeout(() => {
    loading.value = false
  }, 1200)
}

function onRowClick(row: TaskRow): void {
  clickedRow.value = row.name
}

function onRowDblclick(row: TaskRow): void {
  dblclickLog.value = row.name
}

function onRowContextmenu(row: TaskRow): void {
  ctxEventLog.value = [`右键：${row.name}`, ...ctxEventLog.value].slice(0, 5)
}

function loadMoreInfinite(): void {
  if (infiniteLoadingMore.value || !infiniteHasMore.value) return
  infiniteLoadingMore.value = true
  globalThis.setTimeout(() => {
    const start = infiniteRows.value.length
    const next = Array.from(
      { length: Math.min(INFINITE_BATCH, INFINITE_TOTAL - start) },
      (_, index) => createInfiniteRow(start + index),
    )
    infiniteRows.value = [...infiniteRows.value, ...next]
    infiniteLoadingMore.value = false
  }, 300)
}

function resetInfinite(): void {
  infiniteRows.value = Array.from({ length: INFINITE_BATCH }, (_, index) => createInfiniteRow(index))
  infiniteLoadingMore.value = false
}

const multiSorts = ref<RsTableSortState[]>([])
const columnOrder = ref<string[]>(['name', 'status', 'count', 'updatedAt'])
const draggableRows = ref([...basicRows])

// ── 空白区域右键测试 ──
const ctxRowCount = ref(0)
const ctxTestRows = computed(() => basicRows.slice(0, ctxRowCount.value))
const ctxTestLog = ref<string[]>([])

function buildTestCtxItems(row: TaskRow | null, _selectedRows: TaskRow[] = []): RsContextMenuItem[] {
  if (row) {
    return [
      { key: 'open', label: '打开', icon: 'folder-open' },
      { key: 'rename', label: '重命名', icon: 'pen-line' },
      { key: 'sep', label: '', separator: true },
      { key: 'delete', label: '删除', icon: 'trash-2', danger: true },
    ]
  }
  return [
    { key: 'mkdir', label: '新建文件夹', icon: 'folder-plus' },
    { key: 'refresh', label: '刷新', icon: 'rotate-cw' },
  ]
}

function onCtxTestSelect(key: string, row: TaskRow | null, _selectedRows: TaskRow[] = []): void {
  const label = row ? `行「${row.name}」→ ${key}` : `空白区域 → ${key}`
  ctxTestLog.value = [`[${new Date().toLocaleTimeString()}] ${label}`, ...ctxTestLog.value].slice(0, 10)
}

function onRowDrop(dragKeys: string[], dropKey: string, position: RsTableRowDropPosition): void {
  if (position === 'into') {
    return
  }
  const dragKey = dragKeys[0]
  if (!dragKey) return
  const dragIndex = draggableRows.value.findIndex((row) => row.id === dragKey)
  const dropIndex = draggableRows.value.findIndex((row) => row.id === dropKey)
  if (dragIndex < 0 || dropIndex < 0) return
  const next = [...draggableRows.value]
  const [moved] = next.splice(dragIndex, 1)
  if (!moved) return
  let targetIndex = dropIndex
  if (dragIndex < dropIndex) targetIndex -= 1
  if (position === 'after') targetIndex += 1
  next.splice(targetIndex, 0, moved)
  draggableRows.value = next
}

// ── 拖入目录 rowDropMode=into（无拖拽手柄，按住行拖动）──
type ExplorerKind = 'file' | 'dir' | 'parent'

interface ExplorerRow {
  id: string
  name: string
  kind: ExplorerKind
  size: number
  sizeLabel: string
}

const INTO_PARENT_ID = '__parent__'

const intoRows = ref<ExplorerRow[]>([
  { id: INTO_PARENT_ID, name: '..', kind: 'parent', size: 0, sizeLabel: '—' },
  { id: 'dir-docs', name: 'documents', kind: 'dir', size: 0, sizeLabel: '—' },
  { id: 'dir-img', name: 'images', kind: 'dir', size: 0, sizeLabel: '—' },
  { id: 'dir-src', name: 'src', kind: 'dir', size: 0, sizeLabel: '—' },
  { id: 'f-1', name: 'readme.txt', kind: 'file', size: 512, sizeLabel: '512 B' },
  { id: 'f-2', name: 'photo.png', kind: 'file', size: 2048, sizeLabel: '2 KB' },
  { id: 'f-3', name: 'main.ts', kind: 'file', size: 340, sizeLabel: '340 B' },
])

const intoSelectedKeys = ref<string[]>([])
const intoPath = ref('/demo')
const intoLog = ref('按住文件/文件夹行拖动，松手到目录行或 .. 上完成移动')

const intoColumns: RsTableColumn<ExplorerRow>[] = [
  { key: 'name', title: '名称', minWidth: 220 },
  { key: 'sizeLabel', title: '大小', align: 'right', width: 96 },
]

function canIntoDrag(row: ExplorerRow): boolean {
  return row.kind !== 'parent'
}

function canIntoDropTarget(row: ExplorerRow): boolean {
  return row.kind === 'parent' || row.kind === 'dir'
}

function canIntoRowDrop(dragKeys: string[], dropKey: string): boolean {
  if (dragKeys.includes(dropKey)) {
    return false
  }
  const dropRow = intoRows.value.find((row) => row.id === dropKey)
  return Boolean(dropRow && canIntoDropTarget(dropRow))
}

function sortIntoRows(rows: ExplorerRow[]): ExplorerRow[] {
  const parent = rows.filter((row) => row.kind === 'parent')
  const dirs = rows
    .filter((row) => row.kind === 'dir')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  const files = rows
    .filter((row) => row.kind === 'file')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return [...parent, ...dirs, ...files]
}

function onIntoRowDrop(
  dragKeys: string[],
  dropKey: string,
  position: RsTableRowDropPosition,
): void {
  if (position !== 'into') {
    return
  }
  const dropRow = intoRows.value.find((row) => row.id === dropKey)
  if (!dropRow) {
    return
  }
  const moving = dragKeys
    .map((key) => intoRows.value.find((row) => row.id === key))
    .filter((row): row is ExplorerRow => Boolean(row && row.kind !== 'parent'))
  if (!moving.length) {
    return
  }
  const remaining = intoRows.value.filter((row) => !dragKeys.includes(row.id))
  const targetName = dropRow.kind === 'parent' ? '上级目录' : dropRow.name
  intoPath.value =
    dropRow.kind === 'parent'
      ? '/'
      : `${intoPath.value.replace(/\/$/, '')}/${dropRow.name}`
  const insertIndex =
    dropRow.kind === 'parent'
      ? 1
      : remaining.findIndex((row) => row.id === dropKey) + 1
  intoRows.value = sortIntoRows([
    ...remaining.slice(0, insertIndex),
    ...moving,
    ...remaining.slice(insertIndex),
  ])
  intoLog.value = `已移动 ${moving.map((row) => row.name).join('、')} → ${targetName}/`
}
</script>

<template>
  <DemoPage title="RsTable" test-file="RsTable.spec.ts / table-utils.spec.ts">
    <DemoBlock title="基础表格">
      <p class="hint">
        通过 <code>columns</code> 定义列、<code>data</code> 传入行数据；默认带边框，表头吸顶。
      </p>
      <RsTable :columns="basicColumns" :data="basicRows" row-key="id" />
    </DemoBlock>

    <DemoBlock title="表头列筛选">
      <p class="hint">
        列配置 <code>filterable: true</code> 时在表头显示筛选图标；点击输入条件后确定生效。支持
        <code>v-model:column-filters</code> 受控。
      </p>
      <RsTable
        v-model:column-filters="columnFilters"
        :columns="filterableColumns"
        :data="allUsers"
        row-key="id"
      >
        <template #status="{ row }">
          <RsBadge :variant="statusVariants[row.status]">{{ statusLabels[row.status] }}</RsBadge>
        </template>
      </RsTable>
      <p class="meta">
        列筛选：<code>{{ Object.keys(columnFilters).length ? JSON.stringify(columnFilters) : '（无）' }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="过滤">
      <p class="hint">
        内置 <code>filter-text</code> 对列做模糊匹配；也可在外部先过滤再传入
        <code>data</code>（如下方状态筛选）。
      </p>
      <div class="toolbar">
        <RsInput v-model="filterText" placeholder="搜索名称、状态…" />
        <RsSelect
          v-model="statusFilter"
          :options="[
            { label: '全部状态', value: '' },
            { label: '运行中', value: 'running' },
            { label: '已停止', value: 'stopped' },
            { label: '待处理', value: 'pending' },
          ]"
          placeholder="状态"
        />
      </div>
      <RsTable
        :columns="sortColumns"
        :data="filteredRows"
        :filter-text="filterText"
        row-key="id"
      >
        <template #status="{ row }">
          <RsBadge :variant="statusVariants[row.status]">{{ statusLabels[row.status] }}</RsBadge>
        </template>
      </RsTable>
      <p class="meta">
        匹配 <code>{{ filterText || '（全部）' }}</code> · 状态
        <code>{{ statusFilter || '全部' }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="排序（受控）">
      <p class="hint">
        使用 <code>v-model:sort</code> 受控排序；可排序列默认显示排序图标，激活后高亮。
      </p>
      <RsTable
        v-model:sort="controlledSort"
        :columns="sortColumns"
        :data="basicRows"
        row-key="id"
      />
      <p class="meta">
        当前排序：<code>{{ controlledSort ? `${controlledSort.key} ${controlledSort.order}` : '无' }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="分组">
      <p class="hint">
        <code>group-by</code> 按字段分组并插入分组行；可用 <code>group-label</code> 或
        <code>#group</code> 插槽自定义标题。
      </p>
      <RsTable
        :columns="sortColumns"
        :data="allUsers.slice(0, 18)"
        group-by="status"
        :group-label="(key) => `状态 · ${statusLabels[key as TaskRow['status']] ?? key}`"
        row-key="id"
      >
        <template #status="{ row }">
          <RsBadge :variant="statusVariants[row.status]">{{ statusLabels[row.status] }}</RsBadge>
        </template>
      </RsTable>
    </DemoBlock>

    <DemoBlock title="虚拟滚动（大数据）">
      <p class="hint">
        <code>virtual</code> + 固定 <code>height</code> 仅渲染可视区行，适合万级本地数据。
      </p>
      <RsTable
        :columns="sortColumns"
        :data="virtualRows"
        virtual
        :height="320"
        :row-height="40"
        row-key="id"
      />
      <p class="meta">共 <code>{{ virtualRows.length }}</code> 行，DOM 仅挂载可视片段</p>
    </DemoBlock>

    <DemoBlock title="无限加载（万级）">
      <p class="hint">
        <code>infinite</code> 滚动接近底部时触发 <code>@load-more</code>；开启后默认自动启用虚拟滚动（
        <code>virtual-on-infinite</code>），已加载万行也只渲染可视区 DOM。
      </p>
      <div class="row">
        <RsButton size="sm" variant="default" @click="resetInfinite">重置</RsButton>
      </div>
      <RsTable
        :columns="sortColumns"
        :data="infiniteRows"
        infinite
        :has-more="infiniteHasMore"
        :loading-more="infiniteLoadingMore"
        :height="360"
        :row-height="40"
        row-key="id"
        @load-more="loadMoreInfinite"
      />
      <p class="meta">
        已加载 <code>{{ infiniteRows.length }}</code> / <code>{{ INFINITE_TOTAL }}</code> 条 · 每批
        <code>{{ INFINITE_BATCH }}</code> 条
      </p>
    </DemoBlock>

    <DemoBlock title="行展开 expandable">
      <p class="hint">
        对齐 Ant <code>expandable</code> / Arco 展开行；<code>v-model:expanded-row-keys</code> +
        <code>#expand</code> 插槽。
      </p>
      <RsTable
        v-model:expanded-row-keys="expandedRowKeys"
        :columns="basicColumns"
        :data="basicRows"
        expandable
        row-key="id"
      >
        <template #expand="{ row }">
          <div class="expand-panel">
            <p>任务详情：{{ row.name }}</p>
            <p>最近更新 {{ row.updatedAt }} · 数量 {{ row.count }}</p>
          </div>
        </template>
      </RsTable>
      <p class="meta">展开：<code>{{ expandedRowKeys.join(', ') || '无' }}</code></p>
    </DemoBlock>

    <DemoBlock title="单选行 selectionType=radio">
      <RsTable
        v-model:selected-row-keys="radioSelectedKey"
        :columns="basicColumns"
        :data="basicRows"
        selectable
        selection-type="radio"
        row-key="id"
      />
      <p class="meta">选中：<code>{{ radioSelectedKey[0] || '无' }}</code></p>
    </DemoBlock>

    <DemoBlock title="固定列 + 横向滚动 scrollX">
      <p class="hint">左右 <code>fixed</code> 列 + <code>scroll-x</code>，对齐 Ant / Arco 宽表体验。</p>
      <div class="scroll-x-demo">
        <RsTable
          :columns="fixedColumns"
          :data="basicRows"
          :scroll-x="720"
          row-key="id"
        />
      </div>
    </DemoBlock>

    <DemoBlock title="远程排序 remoteSort">
      <p class="hint">
        <code>remote-sort</code> 仅更新排序状态，由业务方拉取/重排数据（此处本地模拟）。
      </p>
      <RsTable
        :sort="remoteSort"
        :columns="sortColumns"
        :data="remoteRows"
        remote-sort
        row-key="id"
        @update:sort="onRemoteSort"
      />
    </DemoBlock>

    <DemoBlock title="多列组合排序 multiSort">
      <p class="hint">
        <code>multi-sort</code> + <code>v-model:sorts</code> 支持多列优先级排序；表头显示序号表示优先级。
      </p>
      <RsTable
        v-model:sorts="multiSorts"
        :columns="sortColumns"
        :data="basicRows"
        multi-sort
        row-key="id"
      />
      <p class="meta">
        排序：<code>{{ multiSorts.map((item) => `${item.key} ${item.order}`).join(' → ') || '无' }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="列拖拽排序 columnDraggable">
      <p class="hint">表头左侧拖拽手柄调整列顺序；<code>v-model:column-order</code> 持久化。</p>
      <RsTable
        v-model:column-order="columnOrder"
        :columns="sortColumns"
        :data="basicRows"
        column-draggable
        row-key="id"
      />
      <p class="meta">列顺序：<code>{{ columnOrder.join(' → ') }}</code></p>
    </DemoBlock>

    <DemoBlock title="行拖拽排序 rowDraggable">
      <p class="hint">
        行首拖拽手柄触发 <code>@row-drop</code>，由业务方重排数据（此处本地演示）。
      </p>
      <RsTable
        :columns="basicColumns"
        :data="draggableRows"
        row-draggable
        row-key="id"
        @row-drop="onRowDrop"
      />
      <p class="meta">顺序：<code>{{ draggableRows.map((row) => row.name).join(' → ') }}</code></p>
    </DemoBlock>

    <DemoBlock title="拖入目录 rowDropMode=into">
      <p class="hint">
        <code>row-drag-trigger="row"</code> 不显示拖拽手柄列；在单元格上按住并拖动（浏览器需轻微移动才触发拖拽）。
        <code>row-drop-mode="into"</code> 时拖到文件夹或 <code>..</code> 行高亮，松手触发
        <code>@row-drop</code> 且 <code>position === 'into'</code>。
      </p>
      <p class="meta">当前路径：<code>{{ intoPath }}</code></p>
      <RsTable
        :columns="intoColumns"
        :data="intoRows"
        row-key="id"
        size="sm"
        striped
        selectable
        :selected-row-keys="intoSelectedKeys"
        row-draggable
        row-drag-trigger="row"
        row-drop-mode="into"
        :row-draggable-when="canIntoDrag"
        :row-drop-target-when="canIntoDropTarget"
        :can-row-drop="canIntoRowDrop"
        @update:selected-row-keys="intoSelectedKeys = $event"
        @row-drop="onIntoRowDrop"
      >
        <template #name="{ row }">
          <span class="into-name" :class="`into-name--${row.kind}`">
            {{ row.kind === 'parent' ? '📁' : row.kind === 'dir' ? '📂' : '📄' }}
            {{ row.name }}
          </span>
        </template>
      </RsTable>
      <p class="meta">{{ intoLog }}</p>
    </DemoBlock>

    <DemoBlock title="汇总行 summary">
      <RsTable :columns="basicColumns" :data="basicRows" row-key="id">
        <template #summary>
          合计数量：{{ basicRows.reduce((sum, row) => sum + row.count, 0) }}
        </template>
      </RsTable>
    </DemoBlock>

    <DemoBlock title="尺寸 size">
      <p class="hint">
        <code>size</code> 支持 <code>sm</code> / <code>md</code>（默认）/ <code>lg</code> 三档，
        分别调整单元格内边距与字号，适配不同信息密度场景。
      </p>
      <div class="stack">
        <div>
          <p class="panel-label">sm · 紧凑 · 行高 33px</p>
          <RsTable :columns="basicColumns" :data="basicRows.slice(0, 2)" size="sm" row-key="id" />
        </div>
        <div>
          <p class="panel-label">md · 默认 · 行高 41px</p>
          <RsTable :columns="basicColumns" :data="basicRows.slice(0, 2)" row-key="id" />
        </div>
        <div>
          <p class="panel-label">lg · 宽松 · 行高 48px</p>
          <RsTable :columns="basicColumns" :data="basicRows.slice(0, 2)" size="lg" row-key="id" />
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="行选择">
      <p class="hint">
        <code>selectable</code> + <code>v-model:selected-row-keys</code>；表头全选、禁用行（
        <code>disabled: true</code>）与半选态与 Ant Design / Element Plus 对齐。
      </p>
      <RsTable
        v-model:selected-row-keys="selectedRowKeys"
        :columns="sortColumns"
        :data="selectableRows"
        selectable
        show-index
        row-key="id"
      />
      <p class="meta">已选：<code>{{ selectedRowKeys.join(', ') || '（无）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="斑马纹 striped">
      <p class="hint">
        <code>striped</code> 隔行底色由 <code>--rs-table-row-stripe</code> 控制（对齐 VS Code 列表/表格色板，随明暗主题切换）。
      </p>
      <RsTable
        :columns="stripedColumns"
        :data="stripedRows"
        striped
        row-key="id"
      />
    </DemoBlock>

    <DemoBlock title="斑马纹 + 前缀列组合">
      <p class="hint">
        <code>striped</code> 与选择列、序号列、展开列组合时整行背景一致。
      </p>
      <RsTable
        v-model:expanded-row-keys="zebraExpandedRowKeys"
        v-model:selected-row-keys="zebraSelectedRowKeys"
        :columns="basicColumns"
        :data="basicRows"
        striped
        selectable
        show-index
        expandable
        row-key="id"
      >
        <template #expand="{ row }">
          <div class="expand-panel">
            <p>任务详情：{{ row.name }}</p>
            <p>状态 {{ row.status }} · 数量 {{ row.count }}</p>
          </div>
        </template>
      </RsTable>
    </DemoBlock>

    <DemoBlock title="文本省略 ellipsis">
      <p class="hint">
        列配置 <code>ellipsis: true</code> + 固定列宽；超出部分省略，悬停由表格级共享 Tooltip 展示完整内容。
      </p>
      <div class="ellipsis-wrap">
        <RsTable
          :columns="ellipsisColumns"
          :data="ellipsisRows"
          row-key="id"
          :cell-tooltip-delay="200"
        />
      </div>
      <p class="meta">窄容器宽度 <code>22rem</code>，名称列 <code>120px</code></p>
    </DemoBlock>

    <DemoBlock title="行高亮 + 行内编辑">
      <p class="hint">
        <code>highlight-row</code> 单击任意数据单元格即可高亮当前行（与 checkbox 选区独立，可通过 <code>--rs-table-row-highlight*</code> 定制样式）；
        <code>editable</code> 开启后双击可编辑单元格，左侧行号列默认带列边框（<code>edit-gutter-width</code> 设置初始宽度，默认 32px），
        有未提交变更时行号位置显示「提交」提示。
        通过 <code>@cell-edit-commit</code> 回写数据。列级 <code>valueType</code>：
        <code>text</code> / <code>number</code> / <code>boolean</code>（单击勾选）/
        <code>select</code>（单击下拉）/ <code>date</code> / <code>datetime</code>；
        编辑器仅在进入编辑态时挂载，不影响大表展示性能。
      </p>
      <RsTable
        v-model:highlighted-row-key="highlightedRowKey"
        :columns="editableColumns"
        :data="editableRows"
        row-key="id"
        highlight-row
        editable
        column-bordered
        striped
        @cell-edit-commit="onEditableCellCommit"
      />
      <p class="meta">
        当前高亮行：<code>{{ highlightedRowKey ?? '—' }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="列宽拖拽">
      <p class="hint">
        <code>resizable</code> 在表头列边框处悬浮拖拽调整列宽；通过 <code>initial-column-widths</code> 传入初始宽度，
        拖拽后由表格内部维护（非双向绑定）。<code>column-layout="auto"</code> 下未指定宽度的列随内容自适应。
      </p>
      <RsTable
        :columns="resizeColumns"
        :data="basicRows"
        :initial-column-widths="resizeInitialWidths"
        resizable
        column-bordered
        column-layout="auto"
        row-key="id"
        @column-resize="onColumnResize"
      />
      <p class="meta">
        初始列宽：<code>{{ JSON.stringify(resizeInitialWidths) }}</code>
        <template v-if="lastColumnResize"> · 最近拖拽：<code>{{ lastColumnResize }}</code></template>
      </p>
    </DemoBlock>

    <DemoBlock title="列对齐">
      <p class="hint">
        <code>align</code> 支持 <code>left</code> / <code>center</code> / <code>right</code>。
      </p>
      <RsTable :columns="alignColumns" :data="alignRows" />
    </DemoBlock>

    <DemoBlock title="紧凑模式、无边框与直角">
      <div class="stack">
        <div>
          <p class="panel-label">compact</p>
          <RsTable :columns="basicColumns" :data="basicRows" compact row-key="id" />
        </div>
        <div>
          <p class="panel-label">bordered=false</p>
          <RsTable :columns="basicColumns" :data="basicRows" :bordered="false" row-key="id" />
        </div>
        <div>
          <p class="panel-label">rounded=false（嵌套父级容器时用）</p>
          <RsTable :columns="basicColumns" :data="basicRows" :rounded="false" row-key="id" />
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="加载状态">
      <p class="hint">
        <code>loading</code> 为 <code>true</code> 时展示加载占位行。
      </p>
      <div class="row">
        <RsButton size="sm" variant="default" @click="simulateLoading">模拟加载 1.2s</RsButton>
      </div>
      <RsTable :columns="basicColumns" :data="basicRows" :loading="loading" row-key="id" />
    </DemoBlock>

    <DemoBlock title="空数据">
      <p class="hint">
        <code>data</code> 为空且非 <code>loading</code> 时渲染空态行；可用
        <code>#empty</code> 插槽覆盖默认文案，常见做法是嵌套 <code>RsEmpty</code>。
      </p>
      <div class="stack">
        <div>
          <p class="panel-label">默认空态（i18n：table.empty）</p>
          <RsTable :columns="basicColumns" :data="[]" row-key="id" />
        </div>
        <div>
          <p class="panel-label">自定义 #empty 文案</p>
          <RsTable :columns="basicColumns" :data="[]" row-key="id">
            <template #empty>暂无任务，点击右上角新建。</template>
          </RsTable>
        </div>
        <div>
          <p class="panel-label">#empty 嵌套 RsEmpty（图标 + 描述 + 操作）</p>
          <RsTable :columns="basicColumns" :data="[]" row-key="id">
            <template #empty>
              <RsEmpty
                fill
                title="还没有任务"
                description="创建第一条任务后，列表会显示在这里。"
              >
                <template #icon>
                  <RsIcon name="inbox" :size="22" label="空列表" />
                </template>
                <div class="row" style="margin: 0; justify-content: center">
                  <RsButton size="sm">新建任务</RsButton>
                </div>
              </RsEmpty>
            </template>
          </RsTable>
        </div>
        <div>
          <p class="panel-label">fill + 固定高度容器（面板内空态）</p>
          <div class="empty-fill-host">
            <RsTable :columns="basicColumns" :data="[]" fill size="sm" row-key="id">
              <template #empty>
                <RsEmpty fill description="查询结果为空，调整条件后再试。">
                  <template #icon>
                    <RsIcon name="search-x" :size="22" label="无结果" />
                  </template>
                </RsEmpty>
              </template>
            </RsTable>
          </div>
        </div>
        <div>
          <p class="panel-label">切换有/无数据（对照空态与正常行）</p>
          <div class="row">
            <RsButton
              size="sm"
              :variant="emptyDemoHasData ? 'default' : 'primary'"
              @click="emptyDemoHasData = false"
            >
              无数据
            </RsButton>
            <RsButton
              size="sm"
              :variant="emptyDemoHasData ? 'primary' : 'default'"
              @click="emptyDemoHasData = true"
            >
              有数据
            </RsButton>
          </div>
          <RsTable
            :columns="basicColumns"
            :data="emptyDemoHasData ? basicRows : []"
            row-key="id"
            striped
            column-bordered
          >
            <template #empty>
              <RsEmpty fill description="当前没有可展示的行。">
                <template #icon>
                  <RsIcon name="table" :size="22" label="空表" />
                </template>
              </RsEmpty>
            </template>
          </RsTable>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="自定义单元格">
      <p class="hint">
        可用列 <code>render</code> 函数，或通过 <code>#[column.key]</code> 插槽渲染单元格。
      </p>
      <RsTable :columns="customColumns" :data="basicRows" row-key="id">
        <template #status="{ row }">
          <RsBadge :variant="statusVariants[row.status]">
            {{ statusLabels[row.status] }}
          </RsBadge>
        </template>
      </RsTable>
    </DemoBlock>

    <DemoBlock title="自定义表头">
      <RsTable :columns="basicColumns" :data="basicRows" row-key="id">
        <template #header-count="{ column }">
          <span class="header-accent">{{ column.title }}</span>
          <span class="header-hint">（条）</span>
        </template>
      </RsTable>
    </DemoBlock>

    <DemoBlock title="行点击">
      <p class="hint">
        监听 <code>@row-click</code>，行 hover 有高亮反馈。
      </p>
      <RsTable :columns="basicColumns" :data="basicRows" row-key="id" @row-click="onRowClick" />
      <p v-if="clickedRow" class="meta">
        最近点击：<code>{{ clickedRow }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="行双击 rowDblclick">
      <p class="hint">
        监听 <code>@row-dblclick</code>，双击行时触发，适合"进入详情"场景。
      </p>
      <RsTable
        :columns="basicColumns"
        :data="basicRows"
        row-key="id"
        @row-dblclick="onRowDblclick"
      />
      <p v-if="dblclickLog" class="meta">最近双击：<code>{{ dblclickLog }}</code></p>
    </DemoBlock>

    <DemoBlock title="行右键 rowContextmenu">
      <p class="hint">
        监听 <code>@row-contextmenu</code>，可用于业务层接管右键菜单逻辑，无需 DOM 遍历。
      </p>
      <RsTable
        :columns="basicColumns"
        :data="basicRows"
        row-key="id"
        @row-contextmenu="onRowContextmenu"
      />
      <div v-if="ctxEventLog.length" class="meta">
        <div v-for="(log, i) in ctxEventLog" :key="i"><code>{{ log }}</code></div>
      </div>
    </DemoBlock>

    <DemoBlock title="右键自动选中 selectOnContextmenu">
      <p class="hint">
        开启 <code>selectable</code> 后，右键某行会自动将其选中（默认行为），
        方便上下文菜单操作已选行。传入 <code>:select-on-contextmenu="false"</code> 可关闭。
      </p>
      <RsTable
        :columns="basicColumns"
        :data="basicRows"
        row-key="id"
        selectable
        :selected-row-keys="ctxSelectedKeys"
        @update:selected-row-keys="ctxSelectedKeys = $event"
      />
      <p class="meta">已选：<code>{{ ctxSelectedKeys.join(', ') || '（无）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="分页联动（业务场景）">
      <p class="hint">
        配合 <code>RsPagination</code> 与 <code>slicePageData</code> 对本地数据分页，常见于列表页底栏。
      </p>
      <RsTable :columns="sortColumns" :data="pagedRows" row-key="id" />
      <RsPagination
        v-model:page="tablePage"
        v-model:page-size="tablePageSize"
        :total="allUsers.length"
        show-page-size
        :page-size-options="[5, 8, 15]"
      />
      <p class="meta">
        第 <code>{{ tablePage }}</code> 页 · 每页 <code>{{ tablePageSize }}</code> 条 · 共
        <code>{{ allUsers.length }}</code> 条
      </p>
    </DemoBlock>
    <DemoBlock title="🔬 空白区域右键（RsTable 内置菜单）">
      <p class="hint">
        默认启用内置右键菜单：<strong>复制单元格</strong>（数据列上右键）、<strong>复制行</strong>（任意行区域右键）。
        可通过 <code>context-menu-items</code> 追加自定义项，<code>context-menu="false"</code> 关闭内置菜单。
        表格置于固定 <code>300px</code> 高容器内（Table 内部滚动），
        调整行数为 <strong>0 行</strong> 或 <strong>1 行</strong>，在下方空白处右键，
        应弹出「<strong>新建文件夹 / 刷新</strong>」；在行上右键应弹出「打开 / 重命名 / 删除」及默认复制项。
      </p>
      <div class="row">
        <label class="hint" style="margin: 0;">
          行数：
          <input
            v-model.number="ctxRowCount"
            type="range"
            min="0"
            max="3"
            step="1"
            style="width: 8rem; vertical-align: middle; margin: 0 0.5rem;"
          />
          {{ ctxRowCount }} / 3
        </label>
      </div>
      <div class="ctx-test-host">
        <RsTable
          :columns="basicColumns"
          :data="ctxTestRows"
          row-key="id"
          size="sm"
          :bordered="false"
          :context-menu-items="buildTestCtxItems"
          @context-menu-select="onCtxTestSelect"
        >
          <template #empty>
            <div style="padding: 1.5rem; text-align: center; font-size: 0.8rem; color: var(--rs-muted);">
              空表 — 在此区域右键应出现面板菜单
            </div>
          </template>
        </RsTable>
      </div>
      <div class="ctx-test-log">
        <div v-if="!ctxTestLog.length" class="ctx-test-log__empty">暂无操作</div>
        <div v-for="(line, i) in ctxTestLog" :key="i">{{ line }}</div>
      </div>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: var(--rs-line-height-normal);
}
.hint code {
  font-size: 0.85em;
  color: var(--rs-text);
}
.meta {
  margin: 0.75rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  word-break: break-all;
}
.meta code {
  padding: 0.125rem 0.375rem;
  border-radius: var(--rs-radius-xs);
  background: var(--rs-surface-hover);
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  color: var(--rs-text);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 10rem;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.panel-label {
  margin: 0 0 0.5rem;
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  color: var(--rs-muted);
}
.header-accent {
  color: var(--rs-primary);
}
.header-hint {
  margin-left: 0.125rem;
  font-size: var(--rs-font-size-xs);
  font-weight: 400;
  color: var(--rs-muted);
}
.ellipsis-wrap {
  max-width: 22rem;
}
.expand-panel {
  display: grid;
  gap: 0.25rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.expand-panel p {
  margin: 0;
}
.scroll-x-demo {
  max-width: 28rem;
  min-width: 0;
}

.empty-fill-host {
  height: 240px;
  border: 1px dashed var(--rs-border);
  border-radius: var(--rs-radius-sm);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.empty-fill-host :deep(.rs-table-shell--fill) {
  flex: 1;
  min-height: 0;
}

/* ── 空白区域右键测试（RsTable 内置滚动 + 菜单） ── */
.ctx-test-host {
  height: 300px;
  border: 2px dashed var(--rs-primary);
  border-radius: var(--rs-radius-sm);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ctx-test-host :deep(.rs-table-shell--ctx) {
  flex: 1;
  min-height: 0;
}
.ctx-test-log {
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  height: 6rem;
  overflow-y: auto;
  font-size: 0.75rem;
  font-family: ui-monospace, monospace;
  background: var(--rs-surface-raised, var(--rs-surface));
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm);
}

.into-name {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}
.into-name--parent {
  color: var(--rs-primary);
  font-weight: 500;
}
.into-name--dir {
  color: var(--rs-primary);
}
.ctx-test-log__empty {
  color: var(--rs-muted);
  font-style: italic;
}
</style>
