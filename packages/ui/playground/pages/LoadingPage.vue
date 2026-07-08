<script setup lang="ts">
import { ref } from 'vue'
import { RsButton, RsLoading } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const panelLoading = ref(true)
const inlineLoading = ref(false)

function simulateInlineLoad() {
  inlineLoading.value = true
  globalThis.setTimeout(() => {
    inlineLoading.value = false
  }, 1500)
}
</script>

<template>
  <DemoPage title="RsLoading" test-file="RsLoading.spec.ts">
    <DemoBlock title="变体一览">
      <p class="hint">
        <code>variant</code> 支持 <code>spinner</code>、<code>dots</code>、<code>skeleton</code>。
      </p>
      <div class="row">
        <RsLoading variant="spinner" />
        <RsLoading variant="dots" />
        <RsLoading variant="skeleton" class="skeleton-inline" />
      </div>
    </DemoBlock>

    <DemoBlock title="尺寸 sm / md / lg">
      <div class="stack">
        <div class="row">
          <span class="row-label">Spinner</span>
          <RsLoading size="sm" />
          <RsLoading size="md" />
          <RsLoading size="lg" />
        </div>
        <div class="row">
          <span class="row-label">Dots</span>
          <RsLoading variant="dots" size="sm" />
          <RsLoading variant="dots" size="md" />
          <RsLoading variant="dots" size="lg" />
        </div>
        <div class="skeleton-grid">
          <RsLoading variant="skeleton" size="sm" />
          <RsLoading variant="skeleton" size="md" />
          <RsLoading variant="skeleton" size="lg" />
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="Spinner 色调">
      <div class="row">
        <RsLoading tone="default" />
        <RsLoading tone="primary" />
      </div>
    </DemoBlock>

    <DemoBlock title="文案与无障碍">
      <p class="hint">
        默认 <code>aria-label</code> 走 i18n（<code>loading.label</code>）；切换 Playground
        右上角语言可目测变化。显式文案用 <code>show-label</code> 或 <code>label</code>。
      </p>
      <div class="row">
        <RsLoading show-label />
        <RsLoading show-label label="正在同步数据…" />
      </div>
    </DemoBlock>

    <DemoBlock title="loading 开关">
      <p class="hint"><code>loading=false</code> 时不渲染任何 DOM，适合与异步状态绑定。</p>
      <div class="row">
        <RsButton size="sm" variant="default" @click="panelLoading = !panelLoading">
          {{ panelLoading ? '隐藏加载' : '显示加载' }}
        </RsButton>
        <RsLoading :loading="panelLoading" show-label />
      </div>
    </DemoBlock>

    <DemoBlock title="块级居中（block）">
      <div class="panel">
        <RsLoading block show-label />
      </div>
    </DemoBlock>

    <DemoBlock title="遮罩层（overlay）">
      <p class="hint">
        父容器需 <code>position: relative</code>；<code>overlay</code> 覆盖内容区并半透明铺底。
      </p>
      <div class="panel panel--overlay-host">
        <p class="panel-content">仪表盘指标、图表或表格内容区域。</p>
        <p class="panel-content muted">加载完成后遮罩会自动消失。</p>
        <RsLoading overlay show-label />
      </div>
      <div class="panel panel--overlay-host">
        <p class="panel-content">可切换遮罩：</p>
        <RsLoading :loading="panelLoading" overlay variant="dots" />
      </div>
    </DemoBlock>

    <DemoBlock title="骨架屏行数">
      <p class="hint"><code>skeleton-lines</code> 控制占位行数，末行默认 70% 宽度。</p>
      <div class="skeleton-grid">
        <RsLoading variant="skeleton" :skeleton-lines="2" />
        <RsLoading variant="skeleton" :skeleton-lines="4" />
        <RsLoading variant="skeleton" :skeleton-lines="6" />
      </div>
    </DemoBlock>

    <DemoBlock title="业务场景示例">
      <div class="stack">
        <div class="panel">
          <p class="panel-label">按钮旁内联加载</p>
          <div class="row">
            <RsButton size="sm" :disabled="inlineLoading" @click="simulateInlineLoad">
              提交表单
            </RsButton>
            <RsLoading v-if="inlineLoading" size="sm" variant="dots" />
          </div>
        </div>
        <div class="panel">
          <p class="panel-label">卡片内容骨架</p>
          <RsLoading variant="skeleton" :skeleton-lines="3" />
        </div>
        <div class="panel panel--overlay-host panel--tall">
          <p class="panel-label overlay-label">列表面板刷新</p>
          <ul class="fake-list">
            <li>项目 Alpha · 进行中</li>
            <li>项目 Beta · 待评审</li>
            <li>项目 Gamma · 已归档</li>
          </ul>
          <RsLoading overlay block variant="spinner" show-label label="刷新列表中…" />
        </div>
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
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.row-label {
  min-width: 3.5rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.skeleton-inline {
  width: 12rem;
}
.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 1rem;
}
.panel {
  padding: 0.75rem;
  border-radius: var(--rs-radius);
  border: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
}
.panel--overlay-host {
  position: relative;
  min-height: 5.5rem;
}
.panel--tall {
  min-height: 8rem;
}
.panel-label {
  margin: 0 0 0.5rem;
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  color: var(--rs-muted);
}
.panel-label.overlay-label {
  position: relative;
  z-index: 0;
}
.panel-content {
  margin: 0 0 0.375rem;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
}
.panel-content.muted {
  color: var(--rs-muted);
}
.fake-list {
  margin: 0;
  padding-left: 1.125rem;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
  line-height: 1.6;
}
</style>
