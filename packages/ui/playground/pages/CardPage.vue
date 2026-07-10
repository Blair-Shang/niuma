<script setup lang="ts">
import { RsButton, RsCard } from '@ruoshui/ui'
import type { RsCardVariant } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const macVariants: { id: RsCardVariant; label: string; hint: string }[] = [
  {
    id: 'grouped',
    label: 'grouped',
    hint: '系统设置式分组面板：header 微分层 + inset 高光，适合表单/配置区。',
  },
  {
    id: 'plain',
    label: 'plain',
    hint: '小组件/仪表盘：单表面、标题弱化，适合 KPI 与统计数字。',
  },
  {
    id: 'glass',
    label: 'glass',
    hint: 'Vibrancy 毛玻璃：强模糊 + 半透明，适合浮层或壁纸背景上。',
  },
]

const materialVariants: { id: RsCardVariant; label: string; hint: string }[] = [
  {
    id: 'outlined',
    label: 'outlined',
    hint: 'MD3 Outlined：1px 描边、无底色 header，信息密度高。',
  },
  {
    id: 'filled',
    label: 'filled',
    hint: 'MD3 Filled：色调填充、无边框，elevated 时叠加 elevation 阴影。',
  },
]
</script>

<template>
  <DemoPage title="RsCard" test-file="RsCard.spec.ts">
    <DemoBlock title="设计风格对比：macOS">
      <p class="hint">
        macOS 强调<strong>分层材质</strong>（grouped / glass）与<strong>内容优先</strong>（plain）。
        仪表盘数字卡推荐 <code>variant="plain"</code>，避免 header 灰底显得像工具面板。
      </p>
      <div class="style-lab style-lab--mac">
        <div v-for="item in macVariants" :key="item.id" class="style-lab__item">
          <p class="style-lab__label">{{ item.label }}</p>
          <p class="style-lab__hint">{{ item.hint }}</p>
          <RsCard :variant="item.id" :title="item.label" elevated class="card-flex">
            <p class="metric">12,480</p>
            <p class="metric-hint">较昨日 +8.2%</p>
          </RsCard>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="设计风格对比：Material 3（Google）">
      <p class="hint">
        Google Material 3 用<strong>描边 vs 填充</strong>区分层级：Outlined 靠边框、Filled 靠 surface tone；
        标题用 Title Medium（500 字重），圆角 12dp，阴影按 elevation 分级而非 macOS 发丝高光。
      </p>
      <div class="style-lab style-lab--material">
        <div v-for="item in materialVariants" :key="item.id" class="style-lab__item">
          <p class="style-lab__label">{{ item.label }}</p>
          <p class="style-lab__hint">{{ item.hint }}</p>
          <RsCard
            :variant="item.id"
            :title="item.label"
            description="Material 3 card surface"
            elevated
            class="card-flex"
          >
            <p class="body-text">正文区域使用 surface 语义色，header 无 macOS 式灰底分层。</p>
          </RsCard>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="同内容 · 五风格横排">
      <div class="variant-row">
        <RsCard variant="grouped" title="grouped" elevated class="card-flex">
          <p class="metric-sm">128</p>
        </RsCard>
        <RsCard variant="plain" title="plain" elevated class="card-flex">
          <p class="metric-sm">128</p>
        </RsCard>
        <RsCard variant="outlined" title="outlined" elevated class="card-flex">
          <p class="metric-sm">128</p>
        </RsCard>
        <RsCard variant="filled" title="filled" elevated class="card-flex">
          <p class="metric-sm">128</p>
        </RsCard>
        <RsCard variant="glass" title="glass" elevated class="card-flex">
          <p class="metric-sm">128</p>
        </RsCard>
      </div>
    </DemoBlock>

    <DemoBlock title="毛玻璃背景预览">
      <p class="hint">将卡片置于渐变背景上，观察 <code>glass</code> 的 vibrancy 效果。</p>
      <div class="glass-stage">
        <RsCard variant="glass" title="glass · elevated" elevated>
          <template #actions>
            <RsButton size="sm" variant="ghost">详情</RsButton>
          </template>
          <p class="body-text">背景模糊 + 半透明材质，贴近 macOS Big Sur 以来的面板风格。</p>
        </RsCard>
        <RsCard variant="grouped" title="grouped · 对照" elevated>
          <p class="body-text">同背景下的实底 grouped 卡片，层次更「实」。</p>
        </RsCard>
      </div>
    </DemoBlock>

    <DemoBlock title="基础内容区">
      <p class="hint">默认 <code>variant="grouped"</code>，带内边距；无标题时不渲染 header。</p>
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
          <p class="body-text">无额外抬升阴影，靠描边区分层级。</p>
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

    <DemoBlock title="组合示例：仪表盘面板（推荐 plain）">
      <div class="dashboard">
        <RsCard variant="plain" title="今日调用" elevated>
          <template #actions>
            <RsButton size="sm" variant="ghost">详情</RsButton>
          </template>
          <p class="metric">12,480</p>
          <p class="metric-hint">较昨日 +8.2%</p>
        </RsCard>
        <RsCard variant="plain" title="错误率" elevated>
          <p class="metric metric--warn">0.12%</p>
          <p class="metric-hint">过去 24 小时</p>
        </RsCard>
        <RsCard variant="plain" title="最近任务" :padding="false">
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
  line-height: var(--rs-line-height-normal);
}
.hint code {
  font-size: 0.85em;
  color: var(--rs-text);
}
.hint strong {
  font-weight: 600;
  color: var(--rs-text);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.row,
.variant-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.variant-row {
  align-items: stretch;
}
.card-flex {
  flex: 1 1 10rem;
  min-width: 0;
}
.style-lab {
  display: grid;
  gap: 1rem;
}
.style-lab--mac {
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
}
.style-lab--material {
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
}
.style-lab__item {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.style-lab__label {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  font-family: ui-monospace, monospace;
  color: var(--rs-primary);
}
.style-lab__hint {
  margin: 0 0 0.25rem;
  font-size: 0.6875rem;
  color: var(--rs-muted);
  line-height: 1.4;
}
.glass-stage {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: 0.75rem;
  padding: 1.25rem;
  border-radius: var(--rs-radius-lg);
  background:
    radial-gradient(ellipse 80% 60% at 20% 30%, color-mix(in srgb, var(--rs-primary) 28%, transparent), transparent),
    radial-gradient(ellipse 70% 50% at 80% 70%, color-mix(in srgb, var(--rs-success) 22%, transparent), transparent),
    linear-gradient(135deg, var(--rs-bg), var(--rs-surface-hover));
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
  letter-spacing: -0.02em;
}
.metric-sm {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--rs-text);
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
