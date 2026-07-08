<script setup lang="ts">
import { ref } from 'vue'
import { RsButton, RsSplitPane } from '@ruoshui/ui'
import type { RsSplitPaneItem } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const basicPanes: RsSplitPaneItem[] = [
  { key: 'left', size: 40 },
  { key: 'right', size: 60 },
]

const verticalPanes: RsSplitPaneItem[] = [
  { key: 'top', size: 60 },
  { key: 'bottom', size: 40 },
]

const constrainedPanes: RsSplitPaneItem[] = [
  { key: 'nav', size: 25, min: 15, max: 40 },
  { key: 'main', size: 50, min: 30 },
  { key: 'aside', size: 25, min: 15, max: 40 },
]

const collapsiblePanes: RsSplitPaneItem[] = [
  { key: 'side', size: 28, min: 18, collapsible: true, collapsedSize: 0 },
  { key: 'content', size: 72 },
]

const controlledSizes = ref<number[]>([30, 70])

const ideOuter: RsSplitPaneItem[] = [
  { key: 'explorer', size: 22, min: 12, collapsible: true, collapsedSize: 0 },
  { key: 'workbench', size: 78 },
]
const ideInner: RsSplitPaneItem[] = [
  { key: 'editor', size: 70, min: 30 },
  { key: 'terminal', size: 30, min: 12, collapsible: true, collapsedSize: 0 },
]

const splitRef = ref<{ collapse: (k: string) => void; expand: (k: string) => void; reset: () => void } | null>(null)
</script>

<template>
  <DemoPage title="RsSplitPane" test-file="RsSplitPane.spec.ts">
    <DemoBlock title="基础：横向分割">
      <p class="hint">拖动中缝调整左右占比；开启 with-handle 展示中央抓手。双击缝隙复位。</p>
      <div class="frame frame--md">
        <RsSplitPane :panes="basicPanes" with-handle>
          <template #left>
            <div class="pane pane--accent">
              <span class="pane__tag">left</span>
              <p class="pane__desc">拖动右侧分隔条</p>
            </div>
          </template>
          <template #right="{ size }">
            <div class="pane">
              <span class="pane__tag">right</span>
              <p class="pane__desc">{{ Math.round(size ?? 0) }}%</p>
            </div>
          </template>
        </RsSplitPane>
      </div>
    </DemoBlock>

    <DemoBlock title="纵向分割">
      <p class="hint">orientation=&quot;vertical&quot; 时上下排布，拖动纵向调整。</p>
      <div class="frame frame--md">
        <RsSplitPane :panes="verticalPanes" orientation="vertical" with-handle>
          <template #top>
            <div class="pane pane--accent"><span class="pane__tag">top</span></div>
          </template>
          <template #bottom>
            <div class="pane"><span class="pane__tag">bottom</span></div>
          </template>
        </RsSplitPane>
      </div>
    </DemoBlock>

    <DemoBlock title="多栏 + 最小/最大约束">
      <p class="hint">三栏布局；两侧栏 min 15% / max 40%，中栏 min 30%，拖动时自动夹紧。</p>
      <div class="frame frame--md">
        <RsSplitPane :panes="constrainedPanes">
          <template #nav>
            <div class="pane pane--accent"><span class="pane__tag">nav · 15~40%</span></div>
          </template>
          <template #main="{ size }">
            <div class="pane"><span class="pane__tag">main · {{ Math.round(size ?? 0) }}%</span></div>
          </template>
          <template #aside>
            <div class="pane pane--accent"><span class="pane__tag">aside · 15~40%</span></div>
          </template>
        </RsSplitPane>
      </div>
    </DemoBlock>

    <DemoBlock title="可折叠面板">
      <p class="hint">side 面板 collapsible；向左拖过阈值自动折叠，中缝聚焦后按 Enter 亦可切换。</p>
      <div class="frame frame--md">
        <RsSplitPane :panes="collapsiblePanes" with-handle>
          <template #side="{ collapsed }">
            <div class="pane pane--accent">
              <span class="pane__tag">side</span>
              <p class="pane__desc">{{ collapsed ? '已折叠' : '可折叠' }}</p>
            </div>
          </template>
          <template #content>
            <div class="pane"><span class="pane__tag">content</span></div>
          </template>
        </RsSplitPane>
      </div>
    </DemoBlock>

    <DemoBlock title="受控 + 程序化控制">
      <p class="hint">v-model:sizes 双向绑定；通过组件方法 collapse / expand / reset 编程操作。</p>
      <div class="toolbar">
        <RsButton size="sm" variant="ghost" @click="splitRef?.collapse('panel')">折叠</RsButton>
        <RsButton size="sm" variant="ghost" @click="splitRef?.expand('panel')">展开</RsButton>
        <RsButton size="sm" variant="ghost" @click="splitRef?.reset()">复位</RsButton>
        <span class="meta">sizes：[{{ controlledSizes.map((n) => Math.round(n)).join(', ') }}]</span>
      </div>
      <div class="frame frame--md">
        <RsSplitPane
          ref="splitRef"
          v-model:sizes="controlledSizes"
          :panes="[
            { key: 'panel', size: 30, min: 18, collapsible: true, collapsedSize: 0 },
            { key: 'viewer', size: 70 },
          ]"
          with-handle
        >
          <template #panel><div class="pane pane--accent"><span class="pane__tag">panel</span></div></template>
          <template #viewer><div class="pane"><span class="pane__tag">viewer</span></div></template>
        </RsSplitPane>
      </div>
    </DemoBlock>

    <DemoBlock title="嵌套：IDE 布局">
      <p class="hint">横向分割内嵌纵向分割，构成「资源管理器 + 编辑器 / 终端」的典型工作区。</p>
      <div class="frame frame--tall">
        <RsSplitPane :panes="ideOuter">
          <template #explorer>
            <div class="pane pane--panel">
              <span class="pane__tag">EXPLORER</span>
            </div>
          </template>
          <template #workbench>
            <RsSplitPane :panes="ideInner" orientation="vertical">
              <template #editor>
                <div class="pane pane--editor"><span class="pane__tag">editor</span></div>
              </template>
              <template #terminal>
                <div class="pane pane--panel"><span class="pane__tag">TERMINAL</span></div>
              </template>
            </RsSplitPane>
          </template>
        </RsSplitPane>
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

.meta {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  margin-bottom: var(--rs-space-md);
}

.frame {
  width: 100%;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-bg);
  overflow: hidden;
}

.frame--md {
  height: 12rem;
}

.frame--tall {
  height: 18rem;
}

.pane {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: var(--rs-space-md);
  box-sizing: border-box;
  background: var(--rs-surface);
  color: var(--rs-text);
}

.pane--accent {
  background: var(--rs-surface-hover);
}

.pane--panel {
  align-items: flex-start;
  justify-content: flex-start;
  background: color-mix(in srgb, var(--rs-surface) 90%, var(--rs-bg));
}

.pane--editor {
  align-items: flex-start;
  justify-content: flex-start;
  background: var(--rs-surface);
}

.pane__tag {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--rs-muted);
}

.pane__desc {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
}
</style>
