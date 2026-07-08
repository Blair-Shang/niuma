<script setup lang="ts">
import { RsAvatar } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const sampleImage = 'https://api.dicebear.com/7.x/avataaars/svg?seed=ruoshui'
const sampleImage2 = 'https://api.dicebear.com/7.x/initials/svg?seed=Jane%20Doe'

const members = [
  { name: '张三', role: '管理员', tone: 'primary' as const },
  { name: 'Jane Doe', role: '编辑', tone: 'success' as const },
  { name: 'Bob', role: '访客', tone: 'default' as const },
  { name: '李明华', role: '审核中', tone: 'warning' as const },
]
</script>

<template>
  <DemoPage title="RsAvatar" test-file="RsAvatar.spec.ts">
    <DemoBlock title="图片头像">
      <p class="hint">传入 <code>src</code> 时优先展示图片；加载失败时回退到缩写或图标。</p>
      <div class="row">
        <RsAvatar :src="sampleImage" name="弱水用户" alt="弱水用户" />
        <RsAvatar :src="sampleImage2" name="Jane Doe" />
        <RsAvatar src="https://invalid.example/404.png" name="Fallback Demo" />
      </div>
    </DemoBlock>

    <DemoBlock title="姓名缩写">
      <p class="hint">
        无 <code>src</code> 时根据 <code>name</code> 自动生成缩写（英文取首字母，中文取前两字）。
      </p>
      <div class="row">
        <RsAvatar name="张三" />
        <RsAvatar name="Jane Doe" />
        <RsAvatar name="Alice" />
        <RsAvatar name="OpenAI Studio" />
      </div>
    </DemoBlock>

    <DemoBlock title="自定义 fallback / 图标占位">
      <div class="row">
        <RsAvatar fallback="RS" tone="primary" />
        <RsAvatar icon="bot" tone="primary" />
        <RsAvatar icon="user" />
        <RsAvatar icon="settings" tone="default" />
      </div>
    </DemoBlock>

    <DemoBlock title="尺寸 sm / md / lg">
      <div class="row align-end">
        <div class="cell">
          <RsAvatar name="SM" size="sm" tone="primary" />
          <small>sm · 28px</small>
        </div>
        <div class="cell">
          <RsAvatar name="MD" size="md" tone="primary" />
          <small>md · 36px</small>
        </div>
        <div class="cell">
          <RsAvatar name="LG" size="lg" tone="primary" />
          <small>lg · 48px</small>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="形状 circle / square">
      <div class="row">
        <RsAvatar name="圆" shape="circle" tone="primary" />
        <RsAvatar name="方" shape="square" tone="primary" />
        <RsAvatar :src="sampleImage" shape="circle" name="圆图" />
        <RsAvatar :src="sampleImage" shape="square" name="方图" />
      </div>
    </DemoBlock>

    <DemoBlock title="占位色调 tone">
      <p class="hint">使用 container 语义色作为占位背景，避免大面积高饱和功能色。</p>
      <div class="row">
        <RsAvatar name="默" tone="default" />
        <RsAvatar name="主" tone="primary" />
        <RsAvatar name="成" tone="success" />
        <RsAvatar name="警" tone="warning" />
        <RsAvatar name="险" tone="danger" />
      </div>
    </DemoBlock>

    <DemoBlock title="自定义 fallback 插槽">
      <div class="row">
        <RsAvatar name="不会显示">
          <template #fallback>
            <span class="custom-fallback">★</span>
          </template>
        </RsAvatar>
        <RsAvatar>
          <template #fallback>
            <span class="custom-fallback custom-fallback--brand">若</span>
          </template>
        </RsAvatar>
      </div>
    </DemoBlock>

    <DemoBlock title="成员列表示例">
      <ul class="list">
        <li v-for="member in members" :key="member.name" class="list-item">
          <RsAvatar :name="member.name" :tone="member.tone" size="sm" />
          <div class="list-body">
            <span class="list-name">{{ member.name }}</span>
            <span class="list-role">{{ member.role }}</span>
          </div>
        </li>
      </ul>
    </DemoBlock>

    <DemoBlock title="无障碍 label">
      <p class="hint">
        可通过 <code>label</code>、<code>alt</code> 或 <code>name</code> 提供
        <code>aria-label</code>，屏幕阅读器可识别头像语义。
      </p>
      <RsAvatar name="弱水" label="当前用户：弱水" tone="primary" />
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.row.align-end {
  align-items: flex-end;
}
.cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
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
.custom-fallback {
  font-size: 0.875rem;
  line-height: 1;
}
.custom-fallback--brand {
  font-weight: 700;
  color: var(--rs-primary);
}
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-md);
  overflow: hidden;
}
.list-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.875rem;
  background: var(--rs-surface);
}
.list-item + .list-item {
  border-top: 1px solid var(--rs-border-subtle);
}
.list-body {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}
.list-name {
  font-size: var(--rs-font-size-sm);
  font-weight: 500;
  color: var(--rs-text);
}
.list-role {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
