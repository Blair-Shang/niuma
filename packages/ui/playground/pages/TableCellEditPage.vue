<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  RsButton,
  RsSelect,
  RsTable,
  type RsTableColumn,
  type RsTableCellEditTrigger,
} from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

interface EditRow {
  id: string
  name: string
  qty: number
  price: number | null
  active: boolean
  kind: string
  status: string
  birthday: string | null
  updatedAt: string
  note: string
  remark: string
}

interface ChecklistItem {
  id: string
  label: string
  done: boolean
}

const editTrigger = ref<RsTableCellEditTrigger>('dblclick')
const compact = ref(false)
const columnBordered = ref(true)
const striped = ref(true)

const eventLog = ref<string[]>([])

function pushLog(line: string): void {
  eventLog.value = [`${new Date().toLocaleTimeString()}  ${line}`, ...eventLog.value].slice(0, 16)
}

function seedRows(): EditRow[] {
  return [
    {
      id: '1',
      name: 'users',
      qty: 128,
      price: 19.5,
      active: true,
      kind: 'table',
      status: 'ready',
      birthday: '2024-01-15',
      updatedAt: '2026-06-15T10:30:00',
      note: '主用户表',
      remark: '可多行\n备注',
    },
    {
      id: '2',
      name: 'orders',
      qty: 540,
      price: null,
      active: true,
      kind: 'view',
      status: 'draft',
      birthday: null,
      updatedAt: '2026-06-14T18:00:00',
      note: '订单视图',
      remark: '',
    },
    {
      id: '3',
      name: 'sessions',
      qty: 12,
      price: 3.14,
      active: false,
      kind: 'table',
      status: 'archived',
      birthday: '2023-11-20',
      updatedAt: '2026-05-01T09:15:00',
      note: '名称列只读',
      remark: '只读名称',
    },
    {
      id: '4',
      name: 'audit_log',
      qty: 9999,
      price: 100,
      active: false,
      kind: 'materialized',
      status: 'ready',
      birthday: '2026-01-01',
      updatedAt: '2026-07-01T12:00:00',
      note: '审计日志',
      remark: '长文本',
    },
  ]
}

const immediateRows = ref<EditRow[]>(seedRows())
const clickRows = ref<EditRow[]>(seedRows())
const rowCommitRows = ref<EditRow[]>(seedRows())
const denseRows = ref<EditRow[]>(seedRows().slice(0, 3))
const selectRows = ref<EditRow[]>(seedRows().slice(0, 3))
const nullRows = ref<EditRow[]>(seedRows().slice(0, 2))
const readonlyRows = ref<EditRow[]>(seedRows().slice(0, 3))
const selectedKeys = ref<string[]>(['1', '2'])

const LARGE_ROW_COUNT = 3000
const kindCycle = ['table', 'view', 'materialized'] as const
const statusCycle = ['draft', 'ready', 'archived'] as const

function createLargeRow(index: number): EditRow {
  const n = index + 1
  const month = String((index % 12) + 1).padStart(2, '0')
  const day = String((index % 28) + 1).padStart(2, '0')
  const hour = String(index % 24).padStart(2, '0')
  const minute = String((index * 7) % 60).padStart(2, '0')
  return {
    id: String(n),
    name: `row_${String(n).padStart(4, '0')}`,
    qty: (index % 997) + 1,
    price: index % 5 === 0 ? null : Number(((index % 50) + 0.5).toFixed(1)),
    active: index % 3 !== 0,
    kind: kindCycle[index % kindCycle.length]!,
    status: statusCycle[index % statusCycle.length]!,
    birthday: index % 11 === 0 ? null : `2024-${month}-${day}`,
    updatedAt: `2026-${month}-${day}T${hour}:${minute}:00`,
    note: `备注 ${n}`,
    remark: index % 17 === 0 ? `多行\n备注 ${n}` : '',
  }
}

const resizeRows = ref<EditRow[]>(seedRows())
const largeRows = ref<EditRow[]>(
  Array.from({ length: LARGE_ROW_COUNT }, (_, index) => createLargeRow(index)),
)
const resizeInitialWidths: Record<string, number> = {
  name: 140,
  qty: 88,
  price: 88,
  active: 64,
  kind: 120,
  status: 100,
  birthday: 130,
  updatedAt: 170,
  note: 140,
  remark: 160,
}
const lastColumnResize = ref<string | null>(null)
const largeEditCount = ref(0)

const kindOptions = [
  { value: 'table', label: '表' },
  { value: 'view', label: '视图' },
  { value: 'materialized', label: '物化视图' },
]

const statusOptions = [
  { value: 'draft', label: '草稿' },
  { value: 'ready', label: '就绪' },
  { value: 'archived', label: '归档' },
]

const checklist = ref<ChecklistItem[]>([
  { id: 'select-no-x', label: '下拉编辑：触发器无清除 X，只能点选项切换', done: false },
  { id: 'select-change', label: '下拉选择后立即提交，无需额外关闭处理', done: false },
  { id: 'kb-f2', label: '单击聚焦后 F2 / Enter 进入编辑，光标在末尾', done: false },
  { id: 'kb-tab', label: '编辑中 Tab / Shift+Tab 提交并跳格', done: false },
  { id: 'kb-esc', label: 'Esc 取消编辑且不写回', done: false },
  { id: 'null-ctrl0', label: '文本/数字格 Ctrl+0 写入 NULL（非下拉清除）', done: false },
  { id: 'async-valid', label: '数量列填负数：异步校验红框阻断', done: false },
  { id: 'batch', label: '勾选多行后改「类型」：同列批量提交', done: false },
  { id: 'undo', label: 'Ctrl+Z 撤销最近一次提交', done: false },
  { id: 'row-commit', label: 'row-commit：改多格后点 gutter 一次提交', done: false },
  { id: 'textarea', label: '多行列 Ctrl+Enter 提交，普通 Enter 换行', done: false },
  { id: 'readonly', label: '条件只读列不可进入编辑（灰态）', done: false },
  { id: 'style', label: '进入编辑无背景/下划线突变，仅单元格外轮廓', done: false },
  { id: 'resize', label: '列宽拖拽后仍可进入编辑，弹层不错位', done: false },
  { id: 'large', label: '虚拟滚动大数据：滚动后编辑仍提交正确行', done: false },
])

function markDone(id: string): void {
  const item = checklist.value.find((entry) => entry.id === id)
  if (item) item.done = true
}

function buildColumns(opts?: {
  readonlyName?: boolean
}): RsTableColumn<EditRow>[] {
  return [
    {
      key: 'name',
      title: '名称',
      editable: opts?.readonlyName
        ? (row) => row.id !== '3'
        : true,
      width: 120,
    },
    {
      key: 'qty',
      title: '数量',
      align: 'right',
      editable: true,
      valueType: 'number',
      width: 88,
      parser: (input) => Number(String(input).replace(/,/g, '')) || 0,
      validator: async (value) => {
        await new Promise((resolve) => setTimeout(resolve, 120))
        return Number(value) >= 0 ? null : '不能为负（异步校验）'
      },
    },
    {
      key: 'price',
      title: '单价',
      align: 'right',
      editable: true,
      valueType: 'number',
      width: 88,
      nullable: true,
      emptyAsNull: true,
      parser: (input) => {
        const cleaned = String(input).replace(/,/g, '').trim()
        if (!cleaned) return null
        return Number(cleaned)
      },
    },
    {
      key: 'active',
      title: '启用',
      align: 'center',
      editable: true,
      valueType: 'boolean',
      width: 64,
    },
    {
      key: 'kind',
      title: '类型',
      editable: true,
      valueType: 'select',
      width: 120,
      // 默认无 clearable：仅选择，无清除 X
      editorOptions: { options: kindOptions, searchable: true },
    },
    {
      key: 'status',
      title: '状态',
      editable: true,
      valueType: 'select',
      width: 100,
      editorOptions: { options: statusOptions, searchable: false },
    },
    {
      key: 'birthday',
      title: '日期',
      editable: true,
      valueType: 'date',
      width: 130,
      nullable: true,
      editorOptions: { clearable: true },
    },
    {
      key: 'updatedAt',
      title: '日期时间',
      editable: true,
      valueType: 'datetime',
      width: 170,
      editorOptions: { withSeconds: false, timezone: 'local' },
    },
    {
      key: 'note',
      title: '备注',
      editable: true,
      ellipsis: true,
      width: 140,
    },
    {
      key: 'remark',
      title: '多行',
      editable: true,
      valueType: 'textarea',
      width: 160,
      editorOptions: { rows: 2 },
    },
  ]
}

const selectOnlyColumns = computed((): RsTableColumn<EditRow>[] => [
  { key: 'name', title: '名称', width: 120 },
  {
    key: 'kind',
    title: '类型（无 X）',
    editable: true,
    valueType: 'select',
    width: 140,
    editorOptions: { options: kindOptions, searchable: true },
  },
  {
    key: 'status',
    title: '状态（无 X）',
    editable: true,
    valueType: 'select',
    width: 120,
    editorOptions: { options: statusOptions, searchable: false },
  },
])

const nullColumns = computed((): RsTableColumn<EditRow>[] => [
  { key: 'name', title: '名称', width: 100 },
  {
    key: 'price',
    title: '单价 NULL',
    editable: true,
    valueType: 'number',
    width: 100,
    nullable: true,
    emptyAsNull: true,
    parser: (input) => {
      const cleaned = String(input).replace(/,/g, '').trim()
      if (!cleaned) return null
      return Number(cleaned)
    },
  },
  {
    key: 'note',
    title: '备注 Ctrl+0',
    editable: true,
    width: 160,
    nullable: true,
    emptyAsNull: true,
  },
])

const immediateColumns = computed(() => buildColumns())
const clickColumns = computed(() =>
  buildColumns().map((col) =>
    col.key === 'active' || col.valueType === 'select' || col.valueType === 'date' || col.valueType === 'datetime'
      ? col
      : { ...col, editTrigger: 'click' as const },
  ),
)
const rowCommitColumns = computed(() => buildColumns())
const denseColumns = computed(() => buildColumns())
const readonlyColumns = computed(() => buildColumns({ readonlyName: true }))
const resizeColumns = computed(() => buildColumns())
const largeColumns = computed(() => buildColumns())

function patchRows(
  source: { value: EditRow[] },
  row: EditRow,
  column: RsTableColumn<EditRow>,
  value: unknown,
): void {
  source.value = source.value.map((item) =>
    item.id === row.id ? { ...item, [column.key]: value as never } : item,
  )
}

function onImmediateCommit(
  row: EditRow,
  column: RsTableColumn<EditRow>,
  _index: number,
  value: unknown,
): void {
  patchRows(immediateRows, row, column, value)
  pushLog(`立即提交  ${row.id}.${column.key} → ${value === null ? 'NULL' : String(value)}`)
  if (column.valueType === 'select') {
    markDone('select-change')
    markDone('select-no-x')
  }
  if (column.key === 'qty' && Number(value) >= 0) markDone('async-valid')
  if (value === null) markDone('null-ctrl0')
  if (column.valueType === 'textarea') markDone('textarea')
}

function onImmediateCancel(row: EditRow, column: RsTableColumn<EditRow>): void {
  pushLog(`取消编辑  ${row.id}.${column.key}`)
  markDone('kb-esc')
}

function onImmediateInvalid(
  row: EditRow,
  column: RsTableColumn<EditRow>,
  _index: number,
  message: string,
): void {
  pushLog(`校验失败  ${row.id}.${column.key}: ${message}`)
  markDone('async-valid')
}

function onImmediateUndo(entry: { items?: Array<{ rowKey: string; colKey: string }> }): void {
  const first = entry.items?.[0]
  pushLog(`撤销  ${first ? `${first.rowKey}.${first.colKey}` : 'batch'}`)
  markDone('undo')
}

function onImmediateBatch(
  column: RsTableColumn<EditRow>,
  changes: Array<{ row: EditRow; index: number; value: unknown }>,
): void {
  pushLog(`批量提交  ${column.key} × ${changes.length}`)
  if (changes.length > 1) markDone('batch')
}

function onSelectCommit(
  row: EditRow,
  column: RsTableColumn<EditRow>,
  _index: number,
  value: unknown,
): void {
  patchRows(selectRows, row, column, value)
  pushLog(`下拉专项  ${row.id}.${column.key} → ${String(value)}`)
  markDone('select-no-x')
  markDone('select-change')
}

function onNullCommit(
  row: EditRow,
  column: RsTableColumn<EditRow>,
  _index: number,
  value: unknown,
): void {
  patchRows(nullRows, row, column, value)
  pushLog(`NULL 专项  ${row.id}.${column.key} → ${value === null ? 'NULL' : String(value)}`)
  if (value === null) markDone('null-ctrl0')
}

function onClickCommit(
  row: EditRow,
  column: RsTableColumn<EditRow>,
  _index: number,
  value: unknown,
): void {
  patchRows(clickRows, row, column, value)
  pushLog(`单击提交  ${row.id}.${column.key} → ${String(value)}`)
}

function onRowEditCommit(
  row: EditRow,
  _index: number,
  changes: Array<{ colKey: string; value: unknown; previous: unknown }>,
): void {
  const patch = Object.fromEntries(changes.map((item) => [item.colKey, item.value]))
  rowCommitRows.value = rowCommitRows.value.map((item) =>
    item.id === row.id ? { ...item, ...patch } : item,
  )
  const summary = changes
    .map((item) => `${item.colKey}: ${String(item.previous)}→${String(item.value)}`)
    .join(', ')
  pushLog(`行提交  ${row.id}（${summary}）`)
  markDone('row-commit')
}

function onRowEditRollback(row: EditRow): void {
  pushLog(`行撤销  ${row.id}`)
}

function onDenseCommit(
  row: EditRow,
  column: RsTableColumn<EditRow>,
  _index: number,
  value: unknown,
): void {
  patchRows(denseRows, row, column, value)
  markDone('style')
}

function onReadonlyCommit(
  row: EditRow,
  column: RsTableColumn<EditRow>,
  _index: number,
  value: unknown,
): void {
  patchRows(readonlyRows, row, column, value)
  pushLog(`只读表  ${row.id}.${column.key} → ${String(value)}`)
  if (column.key !== 'name' || row.id !== '3') markDone('readonly')
}

function onColumnResize(key: string, width: number): void {
  lastColumnResize.value = `${key}: ${Math.round(width)}px`
  pushLog(`列宽拖拽  ${key} → ${Math.round(width)}px`)
  markDone('resize')
}

function onResizeCommit(
  row: EditRow,
  column: RsTableColumn<EditRow>,
  _index: number,
  value: unknown,
): void {
  patchRows(resizeRows, row, column, value)
  pushLog(`列宽表编辑  ${row.id}.${column.key} → ${value === null ? 'NULL' : String(value)}`)
  markDone('resize')
}

function onLargeCommit(
  row: EditRow,
  column: RsTableColumn<EditRow>,
  index: number,
  value: unknown,
): void {
  patchRows(largeRows, row, column, value)
  largeEditCount.value += 1
  pushLog(
    `大数据编辑  #${index} id=${row.id}.${column.key} → ${value === null ? 'NULL' : String(value)}`,
  )
  markDone('large')
}

function regenerateLargeRows(count = LARGE_ROW_COUNT): void {
  largeRows.value = Array.from({ length: count }, (_, index) => createLargeRow(index))
  largeEditCount.value = 0
  pushLog(`已重新生成大数据 ${count} 行`)
}

function resetAll(): void {
  immediateRows.value = seedRows()
  clickRows.value = seedRows()
  rowCommitRows.value = seedRows()
  denseRows.value = seedRows().slice(0, 3)
  selectRows.value = seedRows().slice(0, 3)
  nullRows.value = seedRows().slice(0, 2)
  readonlyRows.value = seedRows().slice(0, 3)
  resizeRows.value = seedRows()
  lastColumnResize.value = null
  regenerateLargeRows()
  selectedKeys.value = ['1', '2']
  eventLog.value = []
  for (const item of checklist.value) item.done = false
  pushLog('已重置全部数据与清单')
}

const triggerOptions = [
  { value: 'dblclick', label: '双击进入编辑' },
  { value: 'click', label: '单击进入编辑' },
]

const checklistDoneCount = computed(() => checklist.value.filter((item) => item.done).length)
</script>

<template>
  <DemoPage title="RsTable 单元格编辑" test-file="RsTable.spec.ts · RsTable.perf.spec.ts">
    <DemoBlock title="手工验收清单">
      <p class="hint">
        按下列项操作后，对应条目会自动勾选（也可手动点选）。目标：下拉<strong>只有选择、无清除 X</strong>；
        键盘 / NULL / 批量 / 异步校验 / row-commit 均可在本页覆盖。
      </p>
      <p class="meta">进度 {{ checklistDoneCount }} / {{ checklist.length }}</p>
      <ul class="checklist">
        <li
          v-for="item in checklist"
          :key="item.id"
          :class="{ 'checklist__item--done': item.done }"
          @click="item.done = !item.done"
        >
          <span class="checklist__box" aria-hidden="true">{{ item.done ? '✓' : '' }}</span>
          <span>{{ item.label }}</span>
        </li>
      </ul>
      <div class="toolbar">
        <RsButton size="sm" variant="default" @click="resetAll">重置数据与清单</RsButton>
        <label class="toggle">
          <input v-model="compact" type="checkbox">
          compact
        </label>
        <label class="toggle">
          <input v-model="columnBordered" type="checkbox">
          column-bordered
        </label>
        <label class="toggle">
          <input v-model="striped" type="checkbox">
          striped
        </label>
        <div class="trigger-field">
          <span>全局 edit-trigger</span>
          <RsSelect
            v-model="editTrigger"
            :options="triggerOptions"
            size="sm"
            :searchable="false"
            :clearable="false"
          />
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="专项 · 下拉仅选择（无清除 X）">
      <p class="hint">
        单击「类型 / 状态」进入编辑：触发器右侧<strong>不应出现清除 X</strong>，只能点选项切换并立即提交。
        NULL 请用文本列 <code>Ctrl+0</code>，不要依赖下拉清空。
      </p>
      <RsTable
        :columns="selectOnlyColumns"
        :data="selectRows"
        row-key="id"
        editable
        highlight-row
        column-bordered
        @cell-edit-commit="onSelectCommit"
      />
    </DemoBlock>

    <DemoBlock title="专项 · NULL / 空值（Ctrl+0）">
      <p class="hint">
        双击「单价」或「备注」，按 <code>Ctrl+0</code>（Mac: <code>Cmd+0</code>）写入 NULL；展示为灰色斜体
        <code>(NULL)</code>。清空数字并失焦也可经 <code>emptyAsNull</code> 提交 null。
      </p>
      <RsTable
        :columns="nullColumns"
        :data="nullRows"
        row-key="id"
        editable
        allow-null
        highlight-row
        column-bordered
        @cell-edit-commit="onNullCommit"
      />
    </DemoBlock>

    <DemoBlock title="全类型 · 立即提交 + 多选批量">
      <p class="hint">
        默认已勾选前两行：改「类型」应批量写入并打日志。数量列异步校验（负数红框）。
        下拉仍无清除 X。键盘：先点单元格聚焦，再 F2 / 方向键 / Tab。
      </p>
      <RsTable
        v-model:selected-row-keys="selectedKeys"
        :columns="immediateColumns"
        :data="immediateRows"
        row-key="id"
        editable
        selectable
        edit-batch
        highlight-row
        allow-null
        edit-keyboard
        edit-undo
        edit-paste
        :compact="compact"
        :column-bordered="columnBordered"
        :striped="striped"
        :edit-trigger="editTrigger"
        @cell-edit-commit="onImmediateCommit"
        @cell-edit-cancel="onImmediateCancel"
        @cell-edit-invalid="onImmediateInvalid"
        @cell-edit-undo="onImmediateUndo"
        @cell-edit-batch-commit="onImmediateBatch"
      />
    </DemoBlock>

    <DemoBlock title="专项 · 条件只读">
      <p class="hint">
        <code>sessions</code> 行的「名称」不可编辑（灰态）；其它行与其它列可改。用于核对
        <code>editable(row)</code>。
      </p>
      <RsTable
        :columns="readonlyColumns"
        :data="readonlyRows"
        row-key="id"
        editable
        highlight-row
        column-bordered
        @cell-edit-commit="onReadonlyCommit"
      />
    </DemoBlock>

    <DemoBlock title="单击触发编辑（文本列）">
      <p class="hint">
        文本/数字列使用列级 <code>editTrigger: 'click'</code>；布尔/下拉/日期保持各自默认手势。
      </p>
      <RsTable
        :columns="clickColumns"
        :data="clickRows"
        row-key="id"
        editable
        highlight-row
        :compact="compact"
        :column-bordered="columnBordered"
        :striped="striped"
        @cell-edit-commit="onClickCommit"
      />
    </DemoBlock>

    <DemoBlock title="row-commit 整行暂存提交">
      <p class="hint">
        编辑后暂存到行草稿，左侧 gutter 出现提交/撤销；适合结果集写回前确认。
      </p>
      <RsTable
        :columns="rowCommitColumns"
        :data="rowCommitRows"
        row-key="id"
        editable
        row-commit
        highlight-row
        :compact="compact"
        :column-bordered="columnBordered"
        :striped="striped"
        :edit-trigger="editTrigger"
        @row-edit-commit="onRowEditCommit"
        @row-edit-rollback="onRowEditRollback"
      />
    </DemoBlock>

    <DemoBlock title="紧凑密度 · 编辑态样式">
      <p class="hint">固定 <code>compact</code>：进入编辑应无背景/下划线突变，仅外轮廓。</p>
      <RsTable
        :columns="denseColumns"
        :data="denseRows"
        row-key="id"
        editable
        compact
        column-bordered
        highlight-row
        @cell-edit-commit="onDenseCommit"
      />
    </DemoBlock>

    <DemoBlock title="专项 · 列宽拖拽 + 编辑">
      <p class="hint">
        开启 <code>resizable</code>：在表头列缝拖拽改宽后，再双击单元格编辑（含下拉 / 日期弹层）。
        核对：列宽生效、编辑器宽度跟随、浮层不错位、提交仍写回正确列。
      </p>
      <RsTable
        :columns="resizeColumns"
        :data="resizeRows"
        :initial-column-widths="resizeInitialWidths"
        row-key="id"
        editable
        resizable
        highlight-row
        allow-null
        column-bordered
        column-layout="auto"
        :compact="compact"
        :striped="striped"
        :edit-trigger="editTrigger"
        @column-resize="onColumnResize"
        @cell-edit-commit="onResizeCommit"
      />
      <p class="meta">
        初始列宽：<code>{{ JSON.stringify(resizeInitialWidths) }}</code>
        <template v-if="lastColumnResize"> · 最近拖拽：<code>{{ lastColumnResize }}</code></template>
      </p>
    </DemoBlock>

    <DemoBlock title="专项 · 虚拟滚动大数据编辑">
      <p class="hint">
        <code>virtual</code> + 固定高度，共 {{ largeRows.length }} 行。滚动到中后段再编辑：提交日志中的
        <code>id</code> / 行号应与可见行一致；编辑中滚动应保留草稿（不误取消）。可测文本、下拉、日期时间。
      </p>
      <div class="toolbar">
        <RsButton size="sm" variant="default" @click="regenerateLargeRows()">重新生成 {{ LARGE_ROW_COUNT }} 行</RsButton>
        <RsButton size="sm" variant="default" @click="regenerateLargeRows(500)">改为 500 行</RsButton>
        <RsButton size="sm" variant="default" @click="regenerateLargeRows(8000)">改为 8000 行</RsButton>
      </div>
      <RsTable
        :columns="largeColumns"
        :data="largeRows"
        row-key="id"
        editable
        virtual
        :height="360"
        :row-height="compact ? 28 : 36"
        highlight-row
        allow-null
        edit-keyboard
        edit-undo
        column-bordered
        :compact="compact"
        :striped="striped"
        :edit-trigger="editTrigger"
        @cell-edit-commit="onLargeCommit"
      />
      <p class="meta">
        共 <code>{{ largeRows.length }}</code> 行 · 已提交编辑
        <code>{{ largeEditCount }}</code> 次 · DOM 仅挂载可视片段
      </p>
    </DemoBlock>

    <DemoBlock title="事件日志">
      <p v-if="!eventLog.length" class="hint">编辑单元格后将在此显示 commit / cancel / batch 记录。</p>
      <ul v-else class="log">
        <li v-for="(line, index) in eventLog" :key="index">
          <code>{{ line }}</code>
        </li>
      </ul>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.6;
}
.hint code {
  color: var(--rs-text);
  font-size: 0.85em;
}
.meta {
  margin: 0 0 0.5rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.checklist {
  margin: 0 0 1rem;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: 0.35rem 0.75rem;
}
.checklist li {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-text);
  cursor: pointer;
  user-select: none;
  line-height: 1.45;
}
.checklist__box {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.9rem;
  height: 0.9rem;
  margin-top: 0.1rem;
  border: 1px solid var(--rs-border);
  border-radius: 3px;
  font-size: 0.65rem;
  line-height: 1;
  background: var(--rs-surface);
}
.checklist__item--done {
  color: var(--rs-muted);
  text-decoration: line-through;
}
.checklist__item--done .checklist__box {
  border-color: var(--rs-primary);
  background: var(--rs-primary);
  color: var(--rs-primary-foreground, #fff);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  margin-bottom: 0.25rem;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-text);
  cursor: pointer;
  user-select: none;
}
.trigger-field {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  min-width: 14rem;
}
.trigger-field :deep(.rs-select) {
  min-width: 10rem;
  max-width: 12rem;
}
.log {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.log code {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-text);
}
</style>
