<script setup lang="ts">
import { RsScrollbar } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const logs = Array.from({ length: 60 }, (_, index) => ({
  id: index + 1,
  title: `部署日志 #${index + 1}`,
  desc: `节点 ${((index % 5) + 1).toString().padStart(2, '0')} · 任务执行完成`,
}))

const columns = [
  '环境',
  '服务',
  '版本',
  '实例',
  '状态',
  '发布时间',
  '发布人',
  '备注',
]
</script>

<template>
  <DemoPage title="RsScrollbar" test-file="RsScrollbar.spec.ts">
    <DemoBlock title="纵向滚动">
      <p class="hint">统一滚动条视觉，适合日志、消息、通知等长列表容器。</p>
      <RsScrollbar height="16rem">
        <ul class="log-list">
          <li v-for="item in logs" :key="item.id" class="log-item">
            <strong>{{ item.title }}</strong>
            <span>{{ item.desc }}</span>
          </li>
        </ul>
      </RsScrollbar>
    </DemoBlock>

    <DemoBlock title="横向 + 纵向滚动">
      <p class="hint">内容宽度超出时提供横向滚动，适合宽表格、看板、时序面板。</p>
      <RsScrollbar height="14rem">
        <table class="wide-table">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in 24" :key="row">
              <td>生产</td>
              <td>ruoshui-gateway</td>
              <td>v1.{{ row }}</td>
              <td>pod-{{ row.toString().padStart(2, '0') }}</td>
              <td>Success</td>
              <td>2026-06-16 17:{{ row.toString().padStart(2, '0') }}</td>
              <td>ops-bot</td>
              <td>灰度 10%</td>
            </tr>
          </tbody>
        </table>
      </RsScrollbar>
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

.log-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.log-item {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-sm);
}

.log-item strong {
  color: var(--rs-text);
  font-weight: 600;
}

.log-item span {
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

.wide-table {
  border-collapse: collapse;
  min-width: 56rem;
  width: 56rem;
  font-size: var(--rs-font-size-sm);
}

.wide-table th,
.wide-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  text-align: left;
  white-space: nowrap;
}

.wide-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--rs-surface);
  color: var(--rs-muted);
  font-weight: 600;
}
</style>
