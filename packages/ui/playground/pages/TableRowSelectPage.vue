<script setup lang="ts">
import { computed, ref } from 'vue'
import { RsButton, RsTable, type RsTableColumn } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

interface DemoRow {
  id: string
  name: string
  status: string
  count: number
  note: string
  disabled?: boolean
}

const columns: RsTableColumn<DemoRow>[] = [
  { key: 'name', title: '名称', width: 140, ellipsis: true },
  { key: 'status', title: '状态', width: 100 },
  { key: 'count', title: '数量', align: 'right', width: 80 },
  { key: 'note', title: '说明', ellipsis: true, minWidth: 160 },
]

function seedRows(count = 24): DemoRow[] {
  const statuses = ['running', 'stopped', 'pending', 'archived']
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1
    return {
      id: String(n),
      name: `任务-${String(n).padStart(2, '0')}`,
      status: statuses[i % statuses.length]!,
      count: (i * 7) % 97,
      note: `示例行 #${n}`,
      disabled: n === 8,
    }
  })
}

const basicRows = ref(seedRows(12))
const basicSelected = ref<string[]>([])

const denseRows = ref(seedRows(40))
const denseSelected = ref<string[]>(['3'])

const editRows = ref(seedRows(10))
const editSelected = ref<string[]>([])

const eventLog = ref<string[]>([])

function pushLog(line: string): void {
  eventLog.value = [`${new Date().toLocaleTimeString()}  ${line}`, ...eventLog.value].slice(0, 20)
}

const basicSelectedLabel = computed(() =>
  basicSelected.value.length ? basicSelected.value.join(', ') : '（无）',
)

const denseSelectedLabel = computed(() =>
  denseSelected.value.length ? denseSelected.value.join(', ') : '（无）',
)

const editSelectedLabel = computed(() =>
  editSelected.value.length ? editSelected.value.join(', ') : '（无）',
)

function clearBasic(): void {
  basicSelected.value = []
  pushLog('清空基础选区')
}

function clearDense(): void {
  denseSelected.value = []
  pushLog('清空长表选区')
}

function onBasicUpdate(keys: string[]): void {
  basicSelected.value = keys
  pushLog(`基础选区 → [${keys.join(', ')}]`)
}

function onDenseUpdate(keys: string[]): void {
  denseSelected.value = keys
  pushLog(`长表选区 → [${keys.join(', ')}]（共 ${keys.length}）`)
}

function onEditUpdate(keys: string[]): void {
  editSelected.value = keys
  pushLog(`编辑表选区 → [${keys.join(', ')}]`)
}
</script>

<template>
  <DemoPage title="RsTable 行多选（无 Checkbox）" test-file="RsTable.spec.ts">
    <DemoBlock title="操作说明">
      <p class="hint">
        <code>selectable</code> + <code>selection-type="row"</code>：不渲染左侧勾选列，靠点击行多选。
      </p>
      <ul class="hint-list">
        <li><strong>单击</strong>：选中该行（替换当前选区），并记下 Shift 锚点</li>
        <li><strong>Ctrl / ⌘ + 单击</strong>：切换该行是否选中（追加 / 取消）</li>
        <li><strong>Shift + 单击</strong>：从锚点到当前行的连续范围选中</li>
        <li>禁用行（如 id=8）不可选；编辑态下单击单元格不抢选区</li>
      </ul>
    </DemoBlock>

    <DemoBlock title="基础：单击 / Ctrl / Shift">
      <div class="toolbar">
        <span class="meta">已选：{{ basicSelectedLabel }}</span>
        <RsButton size="sm" variant="ghost" @click="clearBasic">清空选区</RsButton>
      </div>
      <RsTable
        :columns="columns"
        :data="basicRows"
        row-key="id"
        size="sm"
        striped
        bordered
        column-bordered
        show-index
        highlight-row
        selectable
        selection-type="row"
        :selected-row-keys="basicSelected"
        @update:selected-row-keys="onBasicUpdate"
      />
      <p class="tip">
        试一下：先点第 2 行，再 <kbd>Shift</kbd>+点第 6 行 → 应选中 2–6；再
        <kbd>Ctrl</kbd>+点第 4 行 → 取消第 4 行。
      </p>
    </DemoBlock>

    <DemoBlock title="长表 + 行号：范围选">
      <div class="toolbar">
        <span class="meta">已选 {{ denseSelected.length }} 行：{{ denseSelectedLabel }}</span>
        <RsButton size="sm" variant="ghost" @click="clearDense">清空选区</RsButton>
      </div>
      <div class="table-host">
        <RsTable
          :columns="columns"
          :data="denseRows"
          row-key="id"
          size="sm"
          striped
          fill
          bordered
          column-bordered
          show-index
          highlight-row
          selectable
          selection-type="row"
          :selected-row-keys="denseSelected"
          :virtual="true"
          @update:selected-row-keys="onDenseUpdate"
        />
      </div>
      <p class="tip">
        初始锚点在 id=3。用 <kbd>Shift</kbd>+点更远的行验证范围；id=8 为 disabled，范围穿过时不会被选中（有序可选键列表已排除）。
      </p>
    </DemoBlock>

    <DemoBlock title="与单元格编辑并存（双击编辑）">
      <div class="toolbar">
        <span class="meta">已选：{{ editSelectedLabel }}</span>
      </div>
      <RsTable
        :columns="[
          { key: 'name', title: '名称', width: 140, editable: true },
          { key: 'count', title: '数量', align: 'right', width: 90, editable: true },
          { key: 'note', title: '说明', editable: true, ellipsis: true },
        ]"
        :data="editRows"
        row-key="id"
        size="sm"
        striped
        bordered
        column-bordered
        show-index
        selectable
        selection-type="row"
        editable
        edit-trigger="dblclick"
        :selected-row-keys="editSelected"
        @update:selected-row-keys="onEditUpdate"
      />
      <p class="tip">单击选行；双击进入编辑。编辑进行中单击其它行不会用行选覆盖（避免误触）。</p>
    </DemoBlock>

    <DemoBlock title="事件日志">
      <ul v-if="eventLog.length" class="log">
        <li v-for="(line, i) in eventLog" :key="i">{{ line }}</li>
      </ul>
      <p v-else class="hint">操作表格后这里会显示选区变化。</p>
      <RsButton size="sm" variant="ghost" :disabled="!eventLog.length" @click="eventLog = []">
        清空日志
      </RsButton>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0 0 var(--rs-space-sm);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
  line-height: 1.5;
}

.hint-list {
  margin: 0;
  padding-left: 1.25rem;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
  line-height: 1.7;
}

.hint-list strong {
  color: var(--rs-text);
  font-weight: 600;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  margin-bottom: var(--rs-space-sm);
}

.meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--rs-font-mono);
  font-size: 12px;
  color: var(--rs-muted);
}

.tip {
  margin: var(--rs-space-sm) 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.5;
}

.tip kbd {
  display: inline-block;
  padding: 0 0.35em;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.12));
  font-family: var(--rs-font-mono);
  font-size: 11px;
}

.table-host {
  height: 22rem;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  overflow: hidden;
}

.log {
  margin: 0 0 var(--rs-space-sm);
  padding: 0;
  list-style: none;
  max-height: 12rem;
  overflow: auto;
  font-family: var(--rs-font-mono);
  font-size: 12px;
  color: var(--rs-muted);
  line-height: 1.6;
}
</style>
