<script setup lang="ts">
import { ref } from 'vue'
import {
  RsButton,
  RsIcon,
  RsInput,
  RsToolbar,
  type RsToolbarBorder,
  type RsToolbarSize,
} from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const sizes: RsToolbarSize[] = ['sm', 'md', 'lg']
const borders: RsToolbarBorder[] = ['bottom', 'top', 'both', 'none']

const running = ref(false)
const filterText = ref('')

function toggleRun() {
  running.value = !running.value
}
</script>

<template>
  <DemoPage title="RsToolbar" test-file="RsToolbar.spec.ts">
    <DemoBlock title="左 + 右（查询页顶栏）">
      <p class="hint">
        典型编辑器 / 查询面板：左侧身份信息，右侧操作按钮。仅布局壳，业务按钮自行放入插槽。
      </p>
      <div class="frame">
        <RsToolbar label="查询工具栏" elevated>
          <template #left>
            <RsIcon name="database" :size="15" />
            <span class="identity">prod / public / orders</span>
            <span class="chip">
              <RsIcon name="terminal" :size="12" />
              查询
            </span>
          </template>
          <template #right>
            <RsButton variant="ghost" size="sm">
              <RsIcon name="braces" :size="13" />
              格式化
            </RsButton>
            <RsButton variant="ghost" size="sm">Explain</RsButton>
            <RsButton variant="primary" size="sm" @click="toggleRun">
              <RsIcon :name="running ? 'square' : 'play'" :size="13" />
              {{ running ? '取消' : '运行' }}
            </RsButton>
          </template>
        </RsToolbar>
        <div class="frame__body">结果区占位</div>
      </div>
    </DemoBlock>

    <DemoBlock title="左 + 中 + 右">
      <p class="hint">中间可放模式切换等控件；右侧用 <code>margin-inline-start: auto</code> 贴右。</p>
      <div class="frame">
        <RsToolbar size="lg" label="Mongo 查询">
          <template #left>
            <RsIcon name="database" :size="13" />
            <span class="mono">demo</span>
            <span class="dot">.</span>
            <RsIcon name="table-2" :size="13" />
            <span class="mono">users</span>
          </template>
          <template #center>
            <div class="mode-switch" role="tablist">
              <button type="button" class="mode-btn mode-btn--active">Shell</button>
              <button type="button" class="mode-btn">Pipeline</button>
            </div>
          </template>
          <template #right>
            <RsButton variant="ghost" size="sm">格式化</RsButton>
            <RsButton variant="primary" size="sm">
              <RsIcon name="play" :size="13" />
              运行
            </RsButton>
          </template>
        </RsToolbar>
      </div>
    </DemoBlock>

    <DemoBlock title="默认插槽（连续流）">
      <p class="hint">不拆左右时，内容全部落在 start 区，适合路径栏 / 筛选条。</p>
      <div class="frame">
        <RsToolbar size="sm" compact>
          <span class="label">REMOTE</span>
          <RsInput
            v-model="filterText"
            size="sm"
            class="path-input"
            placeholder="/var/www/html"
          />
          <RsButton variant="ghost" size="sm">
            <RsIcon name="refresh-cw" :size="13" />
          </RsButton>
          <RsButton variant="ghost" size="sm">
            <RsIcon name="folder-up" :size="13" />
          </RsButton>
        </RsToolbar>
      </div>
    </DemoBlock>

    <DemoBlock title="仅右侧">
      <p class="hint">无 left / default 时不渲染 start，右侧仍贴右。</p>
      <div class="frame">
        <RsToolbar>
          <template #right>
            <RsButton variant="ghost" size="sm">刷新</RsButton>
            <RsButton variant="primary" size="sm">新建</RsButton>
          </template>
        </RsToolbar>
      </div>
    </DemoBlock>

    <DemoBlock title="高度密度">
      <div class="stack">
        <div v-for="size in sizes" :key="size" class="frame">
          <RsToolbar :size="size" :label="`size=${size}`">
            <template #left>
              <span class="meta">size={{ size }}</span>
            </template>
            <template #right>
              <RsButton variant="ghost" size="sm">操作</RsButton>
            </template>
          </RsToolbar>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="分割线 / 底色">
      <div class="stack">
        <div v-for="border in borders" :key="border" class="frame">
          <RsToolbar :border="border" :elevated="border === 'both'">
            <template #left>
              <span class="meta">border={{ border }}{{ border === 'both' ? ' · elevated' : '' }}</span>
            </template>
            <template #right>
              <RsButton variant="ghost" size="sm">…</RsButton>
            </template>
          </RsToolbar>
          <div class="frame__body frame__body--tight">内容区</div>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="自定义根标签">
      <p class="hint">默认 <code>header</code>；嵌套在已有 header 内时可改为 <code>div</code>。</p>
      <div class="frame">
        <RsToolbar tag="div" size="sm">
          <template #left>
            <span class="meta">tag=&quot;div&quot;</span>
          </template>
          <template #right>
            <RsButton variant="ghost" size="sm">关闭</RsButton>
          </template>
        </RsToolbar>
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

.stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.frame {
  overflow: hidden;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-bg);
}

.frame__body {
  padding: 1.25rem;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}

.frame__body--tight {
  padding: 0.5rem 0.75rem;
}

.identity {
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  flex-shrink: 0;
}

.mono {
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-sm);
  font-weight: 500;
}

.dot {
  color: var(--rs-muted);
}

.label {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rs-muted);
  flex-shrink: 0;
}

.path-input {
  flex: 1;
  min-width: 0;
}

.meta {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.mode-switch {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-surface) 70%, var(--rs-bg));
}

.mode-btn {
  padding: 0.125rem 0.625rem;
  border: none;
  border-radius: calc(var(--rs-radius-sm) - 1px);
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
}

.mode-btn--active {
  background: var(--rs-surface-elevated);
  color: var(--rs-text);
  box-shadow: var(--rs-shadow-sm);
}
</style>
