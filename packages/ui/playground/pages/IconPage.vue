<script setup lang="ts">
import {
  RsIcon,
  rsCommonIconNames,
  lucideIconCount,
  LUCIDE_ATTRIBUTION,
} from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

/** Lucide 扩展场景图标（非 rsCommonIconNames 子集） */
const extendedIcons = [
  'layout-dashboard',
  'credit-card',
  'shield-check',
  'bot',
  'sparkles',
  'file-text',
  'image',
  'video',
  'mail',
  'calendar',
  'clock',
  'globe',
] as const
</script>

<template>
  <DemoPage title="RsIcon" test-file="RsIcon.spec.ts">
    <DemoBlock title="Lucide 图标库（ISC · 可商用）">
      <p class="hint">
        底层接入
        <a href="https://lucide.dev/icons/" target="_blank" rel="noopener noreferrer">Lucide</a>
        ，全库约 <strong>{{ lucideIconCount }}</strong> 个图标，按名称动态加载，无需自行维护 SVG。
        {{ LUCIDE_ATTRIBUTION }}
      </p>
    </DemoBlock>

    <DemoBlock title="常用图标">
      <div class="grid">
        <div v-for="name in rsCommonIconNames" :key="name" class="cell">
          <RsIcon :name="name" :size="22" :label="name" />
          <small>{{ name }}</small>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="业务场景扩展（Lucide 直用 kebab-case）">
      <p class="hint">直接使用 Lucide 图标名，无需在弱水注册表中手动添加 path。</p>
      <div class="grid">
        <div v-for="name in extendedIcons" :key="name" class="cell">
          <RsIcon :name="name" :size="22" :label="name" />
          <small>{{ name }}</small>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="尺寸 sm / md / lg">
      <div class="row">
        <div class="cell">
          <RsIcon name="settings" size="sm" label="小" />
          <small>sm · 14px</small>
        </div>
        <div class="cell">
          <RsIcon name="settings" size="md" label="中" />
          <small>md · 16px</small>
        </div>
        <div class="cell">
          <RsIcon name="settings" size="lg" label="大" />
          <small>lg · 20px</small>
        </div>
        <div class="cell">
          <RsIcon name="settings" :size="28" label="自定义" />
          <small>28px</small>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="描边粗细 strokeWidth">
      <div class="row">
        <RsIcon name="search" :size="24" :stroke-width="1" label="细" />
        <RsIcon name="search" :size="24" :stroke-width="1.75" label="默认" />
        <RsIcon name="search" :size="24" :stroke-width="2.5" label="粗" />
      </div>
    </DemoBlock>

    <DemoBlock title="语义色 color">
      <p class="hint">通过 color 传入 token 或任意 CSS 颜色，默认继承父级 currentColor。</p>
      <div class="row">
        <RsIcon name="check" :size="22" color="var(--rs-success)" label="成功" />
        <RsIcon name="x" :size="22" color="var(--rs-danger)" label="错误" />
        <RsIcon name="message-square" :size="22" color="var(--rs-primary)" label="主色" />
        <RsIcon name="folder" :size="22" color="var(--rs-warning)" label="警告" />
        <RsIcon name="user" :size="22" color="var(--rs-muted)" label="次要" />
      </div>
    </DemoBlock>

    <DemoBlock title="旋转 rotate">
      <div class="row">
        <RsIcon name="chevron-right" :size="24" label="0°" />
        <RsIcon name="chevron-right" :size="24" :rotate="90" label="90°" />
        <RsIcon name="chevron-right" :size="24" :rotate="180" label="180°" />
        <RsIcon name="chevron-right" :size="24" :rotate="270" label="270°" />
      </div>
    </DemoBlock>

    <DemoBlock title="翻转 flip">
      <div class="row">
        <RsIcon name="chevron-right" :size="24" label="原始" />
        <RsIcon name="chevron-right" :size="24" flip="horizontal" label="水平翻转" />
        <RsIcon name="chevron-down" :size="24" flip="vertical" label="垂直翻转" />
      </div>
    </DemoBlock>

    <DemoBlock title="加载动画 spin">
      <p class="hint">配合 loader 图标用于按钮、列表等加载态。</p>
      <div class="row">
        <RsIcon name="loader" :size="22" spin label="加载中" />
        <RsIcon name="loader" :size="28" spin color="var(--rs-primary)" label="加载中" />
        <button type="button" class="demo-btn" disabled>
          <RsIcon name="loader" size="sm" spin />
          提交中…
        </button>
      </div>
    </DemoBlock>

    <DemoBlock title="无障碍：装饰性 vs 语义性">
      <p class="hint">
        无 label 时 <code>aria-hidden</code>，适合按钮内前缀图标；有 label 时提供
        <code>role="img"</code> 与 <code>aria-label</code>。
      </p>
      <div class="row">
        <button type="button" class="demo-btn">
          <RsIcon name="plus" size="sm" />
          新建（图标装饰性）
        </button>
        <RsIcon name="settings" :size="22" label="打开设置" />
      </div>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(5rem, 1fr));
  gap: 1rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1.25rem;
}
.cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  color: var(--rs-muted);
  font-size: 0.6875rem;
}
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.hint code {
  font-size: 0.85em;
  color: var(--rs-text);
}
.hint a {
  color: var(--rs-primary);
}
.demo-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-md);
  background: var(--rs-surface);
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  cursor: pointer;
}
.demo-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
