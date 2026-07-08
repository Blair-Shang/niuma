<script setup lang="ts">
import { RsLink } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'
</script>

<template>
  <DemoPage title="RsLink" test-file="RsLink.spec.ts">
    <DemoBlock title="基础用法">
      <div class="row">
        <RsLink href="#/button">跳转到 Button 页面</RsLink>
        <RsLink href="https://vuejs.org" target="_blank">Vue 官网（新窗口）</RsLink>
      </div>
    </DemoBlock>

    <DemoBlock title="下划线模式">
      <div class="row">
        <RsLink href="#/input" underline="hover">hover（默认）</RsLink>
        <RsLink href="#/input" underline="always">always</RsLink>
        <RsLink href="#/input" underline="none">none</RsLink>
      </div>
    </DemoBlock>

    <DemoBlock title="禁用态">
      <div class="row">
        <RsLink href="#/theme" disabled>已禁用链接</RsLink>
      </div>
      <p class="hint">禁用时不会跳转，并附带 aria-disabled 与 tabindex 处理。</p>
    </DemoBlock>

    <DemoBlock title="_blank 安全 rel 合并">
      <div class="row">
        <RsLink href="https://example.com" target="_blank" rel="external">external + noopener + noreferrer</RsLink>
      </div>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}
.hint {
  margin: 0.75rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
