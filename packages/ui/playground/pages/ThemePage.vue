<script setup lang="ts">
import { computed, ref } from 'vue'
import { RsBadge, RsButton, useRsConfig } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const { theme, locale, t } = useRsConfig()

const brandActive = ref(false)

const brandLabel = computed(() =>
  brandActive.value ? '品牌紫（CSS 覆盖）' : '公共 preset（国际 SaaS）',
)

const integrationExample = `// main.ts — 顺序：先公共，后业务
import '@ruoshui/ui/styles.css'
import './theme/brand.css'

// theme/brand.css
[data-rs-theme='light'] {
  --rs-primary: #6366f1;
  --rs-primary-hover: #4f46e5;
}
[data-rs-theme='dark'] {
  --rs-primary: #818cf8;
  --rs-primary-hover: #a5b4fc;
}

// App.vue — JS 只负责切换明暗
<RsConfigProvider theme="dark">
  <App />
</RsConfigProvider>`

function toggleBrand() {
  brandActive.value = !brandActive.value
  if (brandActive.value) {
    document.documentElement.setAttribute('data-rs-brand', 'indigo')
  } else {
    document.documentElement.removeAttribute('data-rs-brand')
  }
}
</script>

<template>
  <DemoPage title="主题 / 多语言" test-file="RsConfigProvider">
    <DemoBlock title="当前配置">
      <p>主题：<RsBadge variant="primary">{{ theme }}</RsBadge></p>
      <p>色板：<RsBadge variant="info">{{ brandLabel }}</RsBadge></p>
      <p>语言：<RsBadge>{{ locale }}</RsBadge></p>
      <p>文案示例 select.placeholder：{{ t('select.placeholder') }}</p>
    </DemoBlock>

    <DemoBlock title="CSS 覆盖公共主题">
      <p class="text">
        色值定义在 <code>styles.css</code>；业务在<strong>之后</strong>加载自己的 CSS，
        重写 <code>--rs-*</code> 即可。JS 的 <code>setTheme</code> 只切换
        <code>data-rs-theme</code>。
      </p>
      <div class="row">
        <RsButton @click="toggleBrand">
          {{ brandActive ? '恢复公共 preset' : '切换为品牌紫' }}
        </RsButton>
        <RsButton variant="default">default 按钮</RsButton>
        <RsButton variant="ghost">ghost 按钮</RsButton>
      </div>
    </DemoBlock>

    <DemoBlock title="接入方式">
      <pre class="code-block">{{ integrationExample }}</pre>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.text {
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
  line-height: 1.6;
  margin: 0 0 0.75rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
code {
  color: var(--rs-primary-hover);
}
.code-block {
  margin: 0;
  padding: 0.75rem 1rem;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface-hover);
  color: var(--rs-text);
  font-size: var(--rs-font-size-xs);
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre;
}
</style>
