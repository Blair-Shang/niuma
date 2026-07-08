<script setup lang="ts">
import { RsButton, RsCard } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'
</script>

<template>
  <DemoPage title="RsCard" test-file="RsCard.spec.ts">
    <DemoBlock title="基础内容区">
      <p class="hint">默认带内边距，仅展示 body 插槽；无标题时不渲染 header。</p>
      <RsCard>
        <p class="body-text">卡片主体内容，适合承载表单、说明文字或列表。</p>
      </RsCard>
    </DemoBlock>

    <DemoBlock title="标题与描述">
      <div class="stack">
        <RsCard title="项目概览" description="查看当前工作区的运行状态与配额使用情况。">
          <p class="body-text">正文区域与 header 通过底部分割线区分。</p>
        </RsCard>
        <RsCard title="仅标题">
          <p class="body-text">未传 description 时只展示标题行。</p>
        </RsCard>
      </div>
    </DemoBlock>

    <DemoBlock title="elevated 阴影">
      <div class="row">
        <RsCard title="默认平面" class="card-flex">
          <p class="body-text">无阴影，靠描边区分层级。</p>
        </RsCard>
        <RsCard title="elevated" elevated class="card-flex">
          <p class="body-text">轻阴影，适合浮层感面板或选中卡片。</p>
        </RsCard>
      </div>
    </DemoBlock>

    <DemoBlock title="padding 内边距">
      <div class="stack">
        <RsCard title="padding: true（默认）">
          <p class="body-text">body 区域有 1.25rem 内边距。</p>
        </RsCard>
        <RsCard title="padding: false" :padding="false">
          <div class="flush-content">无内边距，适合内嵌表格或全宽图表。</div>
        </RsCard>
      </div>
    </DemoBlock>

    <DemoBlock title="actions 操作区">
      <RsCard title="成员管理" description="邀请协作者并分配角色。">
        <template #actions>
          <RsButton size="sm" variant="ghost">导出</RsButton>
          <RsButton size="sm">邀请</RsButton>
        </template>
        <p class="body-text">header 右侧 actions 插槽，与标题同行对齐。</p>
      </RsCard>
    </DemoBlock>

    <DemoBlock title="自定义 header 插槽">
      <RsCard>
        <template #header>
          <div class="custom-header">
            <span class="custom-header__badge">Beta</span>
            <h3 class="custom-header__title">自定义标题区</h3>
            <p class="custom-header__desc">完全接管 header 内容，适合复杂筛选或 Tab。</p>
          </div>
        </template>
        <p class="body-text">使用 header 插槽时 title / description props 被插槽内容替代。</p>
      </RsCard>
    </DemoBlock>

    <DemoBlock title="as 语义标签">
      <p class="hint">默认渲染为 <code>section</code>，可通过 <code>as</code> 改为 article 等。</p>
      <RsCard as="article" title="文章卡片" description="as=&quot;article&quot;">
        <p class="body-text">语义化标签便于无障碍与 SEO 结构。</p>
      </RsCard>
    </DemoBlock>

    <DemoBlock title="组合示例：仪表盘面板">
      <div class="dashboard">
        <RsCard title="今日调用" elevated>
          <template #actions>
            <RsButton size="sm" variant="ghost">详情</RsButton>
          </template>
          <p class="metric">12,480</p>
          <p class="metric-hint">较昨日 +8.2%</p>
        </RsCard>
        <RsCard title="错误率" elevated>
          <p class="metric metric--warn">0.12%</p>
          <p class="metric-hint">过去 24 小时</p>
        </RsCard>
        <RsCard title="最近任务" :padding="false">
          <ul class="task-list">
            <li>索引重建 · 完成</li>
            <li>模型微调 · 进行中</li>
            <li>数据导出 · 排队中</li>
          </ul>
        </RsCard>
      </div>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.hint code {
  font-size: 0.85em;
  color: var(--rs-text);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.card-flex {
  flex: 1 1 14rem;
  min-width: 0;
}
.body-text {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
  line-height: var(--rs-line-height-normal);
}
.flush-content {
  padding: 0.75rem 1.25rem;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
  background: var(--rs-surface-elevated);
  border-top: 1px solid var(--rs-border-subtle);
}
.custom-header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.custom-header__badge {
  align-self: flex-start;
  padding: 0.125rem 0.375rem;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--rs-primary);
  background: var(--rs-primary-container);
  border-radius: var(--rs-radius-sm);
}
.custom-header__title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}
.custom-header__desc {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.dashboard {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: 0.75rem;
}
.metric {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--rs-text);
  line-height: 1.2;
}
.metric--warn {
  color: var(--rs-warning);
}
.metric-hint {
  margin: 0.25rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.task-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.task-list li {
  padding: 0.625rem 1.25rem;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
}
.task-list li + li {
  border-top: 1px solid var(--rs-border-subtle);
}
</style>
