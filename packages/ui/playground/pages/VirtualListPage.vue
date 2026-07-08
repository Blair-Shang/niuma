<script setup lang="ts">
import { ref } from 'vue'
import { RsVirtualList } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const basicItems = Array.from({ length: 200 }, (_, index) => `Item ${index + 1}`)

const largeItems = Array.from({ length: 10_000 }, (_, index) => ({
  id: index + 1,
  label: `虚拟项 ${String(index + 1).padStart(5, '0')}`,
}))

const dynamicHeight = ref(40)
const activeListIndex = ref(12)
</script>

<template>
  <DemoPage title="RsVirtualList" test-file="RsVirtualList.spec.ts">
    <DemoBlock title="基础虚拟列表">
      <p class="hint">
        固定 <code>item-size</code> + <code>height</code>，仅渲染可视区条目，适合万级字符串或简单行。
      </p>
      <RsVirtualList :items="basicItems" :height="240" :item-size="32">
        <template #default="{ item, index }">
          <div class="row">{{ index + 1 }}. {{ item }}</div>
        </template>
      </RsVirtualList>
    </DemoBlock>

    <DemoBlock title="万级对象列表">
      <RsVirtualList :items="largeItems" :height="360" :item-size="36" :overscan="6">
        <template #default="{ item }">
          <div class="row row--object">
            <span class="row__id">#{{ item.id }}</span>
            <span>{{ item.label }}</span>
          </div>
        </template>
      </RsVirtualList>
      <p class="meta">共 <code>{{ largeItems.length }}</code> 条</p>
    </DemoBlock>

    <DemoBlock title="高亮行 activeIndex">
      <p class="hint">
        <code>active-index</code> 为当前高亮行索引，适合键盘导航或选中态展示（左侧主色条 + 背景）。
      </p>
      <div class="toolbar">
        <button type="button" class="nav-btn" @click="activeListIndex = Math.max(0, activeListIndex - 1)">上一行</button>
        <button type="button" class="nav-btn" @click="activeListIndex = Math.min(basicItems.length - 1, activeListIndex + 1)">下一行</button>
        <span class="meta-inline">当前：<code>{{ activeListIndex }}</code></span>
      </div>
      <RsVirtualList :items="basicItems" :height="240" :item-size="32" :active-index="activeListIndex">
        <template #default="{ item, index }">
          <div class="row">{{ index + 1 }}. {{ item }}</div>
        </template>
      </RsVirtualList>
    </DemoBlock>

    <DemoBlock title="动态行高 itemSize 函数">
      <p class="hint"><code>item-size</code> 可为函数，按索引返回不同高度。</p>
      <RsVirtualList
        :items="basicItems.slice(0, 80)"
        :height="280"
        :item-size="(index) => (index % 3 === 0 ? dynamicHeight + 12 : dynamicHeight)"
      >
        <template #default="{ item, index }">
          <div
            class="row"
            :class="{ 'row--tall': index % 3 === 0 }"
          >
            {{ item }}
          </div>
        </template>
      </RsVirtualList>
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
  color: var(--rs-text);
}
.meta {
  margin: 0.75rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.row {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-sm);
}
.row--tall {
  align-items: flex-start;
  padding-top: var(--rs-space-xs);
}
.row--object {
  gap: var(--rs-space-sm);
}
.row__id {
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-variant-numeric: tabular-nums;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.nav-btn {
  padding: 0.25rem 0.625rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  color: var(--rs-text);
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
}
.nav-btn:hover {
  background: var(--rs-item-hover);
}
.meta-inline {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
