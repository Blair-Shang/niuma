<script setup lang="ts">
import { RsContainer } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'
</script>

<template>
  <DemoPage title="RsContainer" test-file="RsContainer.spec.ts">
    <DemoBlock title="默认（lg · 居中 · md 内边距）">
      <div class="viewport">
        <RsContainer>
          <div class="content-box">主内容区域，最大宽度 lg，水平居中。</div>
        </RsContainer>
      </div>
    </DemoBlock>

    <DemoBlock title="宽度档位">
      <div class="viewport stack">
        <RsContainer v-for="size in ['sm', 'md', 'lg', 'xl', 'full']" :key="size" :max-width="size">
          <div class="content-box">{{ size }} 档容器</div>
        </RsContainer>
      </div>
    </DemoBlock>

    <DemoBlock title="内边距">
      <p class="hint">虚线框为 Container 边界，实线框为内容区；两者之间为水平 padding。</p>
      <div class="viewport stack stack--padding">
        <RsContainer v-for="pad in ['none', 'sm', 'md', 'lg']" :key="pad" :padding="pad" max-width="md">
          <div class="content-box">
            <span class="content-box__label">padding: {{ pad }}</span>
          </div>
        </RsContainer>
      </div>
    </DemoBlock>

    <DemoBlock title="fluid 全宽">
      <div class="viewport">
        <RsContainer fluid>
          <div class="content-box fluid">fluid 模式占满父级，适合横幅或全宽表格。</div>
        </RsContainer>
      </div>
    </DemoBlock>

    <DemoBlock title="嵌套：外层 xl + 内层 sm">
      <div class="viewport">
        <RsContainer max-width="xl" padding="lg">
          <p class="section-label">外层 xl</p>
          <RsContainer max-width="sm" padding="sm">
            <div class="content-box nested">内层 sm，常用于表单或窄阅读区。</div>
          </RsContainer>
        </RsContainer>
      </div>
    </DemoBlock>

    <DemoBlock title="栅格：12 列 + span">
      <div class="viewport">
        <RsContainer grid :columns="12" gap="md">
          <div class="grid-card col-12">Header（12）</div>
          <div class="grid-card col-8">Main（8）</div>
          <div class="grid-card col-4">Aside（4）</div>
          <div class="grid-card col-6">Card A（6）</div>
          <div class="grid-card col-6">Card B（6）</div>
        </RsContainer>
      </div>
    </DemoBlock>

    <DemoBlock title="响应式栅格">
      <div class="viewport">
        <RsContainer
          grid
          :columns="{ sm: 2, md: 4, lg: 6, xl: 12 }"
          :gap="{ sm: 'xs', md: 'sm', lg: 'md', xl: 'lg' }"
          :padding="{ sm: 'sm', md: 'md', lg: 'lg' }"
          :max-width="{ sm: 'sm', md: 'md', lg: 'lg', xl: 'xl' }"
        >
          <div v-for="cell in 12" :key="cell" class="grid-card">Item {{ cell }}</div>
        </RsContainer>
      </div>
    </DemoBlock>

    <DemoBlock title="暗色层级对照">
      <p class="hint">暗色下通过描边、阴影与背景分层区分 viewport → container → content。</p>
      <div class="viewport viewport--layered">
        <RsContainer max-width="lg" padding="md">
          <div class="content-box">
            <span class="layer-tag layer-tag--container">Container 内边距区</span>
            <span class="layer-tag layer-tag--content">Content 内容区</span>
          </div>
        </RsContainer>
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

.viewport {
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-bg);
  overflow: hidden;
  box-shadow: inset 0 0 0 1px var(--rs-border-subtle);
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.625rem;
}

.stack--padding :deep(.rs-container) {
  background: color-mix(in srgb, var(--rs-primary) 6%, var(--rs-surface));
  outline: 1px dashed color-mix(in srgb, var(--rs-primary) 42%, var(--rs-border));
  outline-offset: -1px;
  border-radius: var(--rs-radius-xs);
}

.viewport--layered :deep(.rs-container) {
  background: color-mix(in srgb, var(--rs-primary) 8%, var(--rs-surface));
  outline: 1px dashed color-mix(in srgb, var(--rs-primary) 50%, var(--rs-border));
  outline-offset: -1px;
  border-radius: var(--rs-radius-xs);
}

.content-box {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.75rem 1rem;
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-elevated);
  border: 1px solid var(--rs-border);
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
  box-shadow: var(--rs-shadow-sm);
}

.content-box__label {
  font-weight: 500;
}

.content-box.fluid {
  background: var(--rs-primary-container);
  color: var(--rs-on-primary-container);
  border-color: color-mix(in srgb, var(--rs-primary) 45%, var(--rs-border));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--rs-primary) 24%, transparent);
}

.content-box.nested {
  background: color-mix(in srgb, var(--rs-surface-elevated) 88%, var(--rs-primary-container) 12%);
  border-color: color-mix(in srgb, var(--rs-primary) 35%, var(--rs-border));
}

.section-label {
  margin: 0 0 0.5rem;
  padding-inline: var(--rs-space-xl);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  color: var(--rs-muted);
}

.grid-card {
  min-height: 2.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface-elevated);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  color: var(--rs-text);
  box-shadow: var(--rs-shadow-sm);
}

.layer-tag {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 0.125rem 0.5rem;
  border-radius: var(--rs-radius-xs);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  line-height: var(--rs-line-height-tight);
}

.layer-tag--container {
  color: var(--rs-on-info-container);
  background: color-mix(in srgb, var(--rs-info-container) 72%, var(--rs-surface-elevated) 28%);
  border: 1px solid color-mix(in srgb, var(--rs-info) 40%, var(--rs-border));
}

.layer-tag--content {
  color: var(--rs-text);
  background: var(--rs-surface-hover);
  border: 1px solid var(--rs-border);
}

.col-12 {
  grid-column: span 12;
}
.col-8 {
  grid-column: span 8;
}
.col-6 {
  grid-column: span 6;
}
.col-4 {
  grid-column: span 4;
}

/* 暗色：拉开 viewport / container / content 三层对比 */
:global([data-rs-theme='dark']) .viewport {
  background: color-mix(in srgb, var(--rs-bg) 55%, var(--rs-surface) 45%);
  border-color: rgb(255 255 255 / 0.22);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.06),
    inset 0 0 0 1px rgb(255 255 255 / 0.04);
}

:global([data-rs-theme='dark']) .stack--padding :deep(.rs-container),
:global([data-rs-theme='dark']) .viewport--layered :deep(.rs-container) {
  background: color-mix(in srgb, var(--rs-primary) 14%, var(--rs-surface-elevated) 86%);
  outline-color: color-mix(in srgb, var(--rs-primary) 58%, rgb(255 255 255 / 0.28));
}

:global([data-rs-theme='dark']) .content-box,
:global([data-rs-theme='dark']) .grid-card {
  background: color-mix(in srgb, var(--rs-surface-elevated) 82%, rgb(255 255 255 / 0.08) 18%);
  border-color: rgb(255 255 255 / 0.24);
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.45),
    0 0 0 1px rgb(255 255 255 / 0.06);
  color: var(--rs-text);
}

:global([data-rs-theme='dark']) .content-box.fluid {
  background: color-mix(in srgb, var(--rs-primary-container) 78%, var(--rs-surface-elevated) 22%);
  border-color: color-mix(in srgb, var(--rs-primary) 55%, rgb(255 255 255 / 0.2));
  color: var(--rs-on-primary-container);
}

:global([data-rs-theme='dark']) .hint,
:global([data-rs-theme='dark']) .section-label {
  color: var(--rs-text);
}

:global([data-rs-theme='dark']) .layer-tag--container {
  background: var(--rs-info-container);
  border-color: color-mix(in srgb, var(--rs-info) 50%, var(--rs-border));
  color: var(--rs-on-info-container);
}

:global([data-rs-theme='dark']) .layer-tag--content {
  background: var(--rs-surface-hover);
  border-color: var(--rs-border);
  color: var(--rs-text);
}

@media (width < 48rem) {
  .col-8,
  .col-6,
  .col-4 {
    grid-column: span 12;
  }
}
</style>
