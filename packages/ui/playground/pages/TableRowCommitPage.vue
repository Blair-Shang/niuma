<script setup lang="ts">
import { ref } from 'vue'
import { RsTable, type RsTableColumn } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

interface DocRow {
  id: string
  name: string
  count: number
  note: string
}

const rows = ref<DocRow[]>([
  { id: '1', name: 'users', count: 1280, note: '主用户集合' },
  { id: '2', name: 'orders', count: 5420, note: '订单流水' },
  { id: '3', name: 'sessions', count: 86, note: '活跃会话缓存' },
])

const commitLog = ref<string[]>([])

const columns: RsTableColumn<DocRow>[] = [
  { key: 'name', title: '集合名', editable: true, width: 140 },
  {
    key: 'count',
    title: '文档数',
    align: 'right',
    editable: true,
    width: 100,
    parser: (input) => Number(input) || 0,
    validator: (value) => (Number(value) >= 0 ? null : '不能为负数'),
  },
  { key: 'note', title: '说明', editable: true, ellipsis: true, width: 180 },
]

function onRowEditCommit(
  row: DocRow,
  _index: number,
  changes: Array<{ colKey: string; value: unknown; previous: unknown }>,
): void {
  const patch = Object.fromEntries(changes.map((item) => [item.colKey, item.value]))
  rows.value = rows.value.map((item) => (item.id === row.id ? { ...item, ...patch } : item))
  const summary = changes.map((item) => `${item.colKey}: ${String(item.previous)} → ${String(item.value)}`).join(', ')
  commitLog.value = [`提交 ${row.name}（${summary}）`, ...commitLog.value].slice(0, 6)
}

function onRowEditRollback(row: DocRow): void {
  commitLog.value = [`撤销 ${row.name} 的未提交变更`, ...commitLog.value].slice(0, 6)
}
</script>

<template>
  <DemoPage title="RsTable 单行手动提交" test-file="RsTable.spec.ts">
    <DemoBlock title="row-commit 模式">
      <p class="hint">
        开启 <code>row-commit</code> 后，单元格编辑会先<strong>暂存</strong>到行级草稿；
        左侧 <code>edit-gutter</code> 在有变更时显示 <code>check</code> / <code>x</code>，手动提交或撤销整行变更。
        适合 Mongo / SQL 结果集「编辑后确认再写库」的场景。
      </p>
      <RsTable
        :columns="columns"
        :data="rows"
        row-key="id"
        editable
        row-commit
        highlight-row
        striped
        bordered
        @row-edit-commit="onRowEditCommit"
        @row-edit-rollback="onRowEditRollback"
      />
      <p v-if="commitLog.length" class="meta">
        最近操作：
        <code v-for="(line, index) in commitLog" :key="index">{{ line }}</code>
      </p>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.hint {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  margin: 0 0 0.75rem;
  line-height: 1.6;
}
.hint code {
  color: var(--rs-text);
  font-size: 0.85em;
}
.meta {
  margin: 0.75rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.meta code {
  color: var(--rs-text);
}
</style>
