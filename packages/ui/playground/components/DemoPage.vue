<script setup lang="ts">
import { useRsConfig } from '@ruoshui/ui'

defineProps<{
  title: string
  testFile?: string
}>()

const { t } = useRsConfig()
</script>

<template>
  <article class="demo-page">
    <header class="demo-page__header">
      <h1 class="demo-page__title">{{ title }}</h1>
      <p v-if="testFile" class="demo-page__meta">
        {{ t('playground.demo.testFile') }}：
        <code>src/__tests__/{{ testFile }}</code>
      </p>
    </header>
    <div class="demo-page__body">
      <slot />
    </div>
  </article>
</template>

<style scoped>
.demo-page__header {
  margin-bottom: var(--rs-space-xl);
}

.demo-page__title {
  margin: 0 0 var(--rs-space-xs);
  font-size: var(--rs-font-size-lg);
  font-weight: 600;
  line-height: var(--rs-line-height-tight);
  letter-spacing: -0.01em;
  color: var(--rs-text);
}

.demo-page__meta {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-normal);
  color: var(--rs-muted);
}

.demo-page__meta code {
  color: var(--rs-primary);
  font-size: var(--rs-font-size-xs);
}

.demo-page__body {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xl);
}
</style>
