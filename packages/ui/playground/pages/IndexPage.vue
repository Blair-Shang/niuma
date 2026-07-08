<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useRsConfig } from '@ruoshui/ui'
import { playgroundRoutes } from '../routes'

const { t } = useRsConfig()

const playgroundUrl =
  typeof globalThis.window !== 'undefined' ? globalThis.window.location.origin : 'http://localhost:5180'
</script>

<template>
  <article class="index-page">
    <header class="index-page__header">
      <h1 class="index-page__title">{{ t('playground.index.title') }}</h1>
      <p class="index-page__intro">{{ t('playground.index.intro') }}</p>
    </header>

    <div class="index-page__table-wrap">
      <table class="index-page__table">
        <thead>
          <tr>
            <th>{{ t('playground.index.column.component') }}</th>
            <th>{{ t('playground.index.column.demo') }}</th>
            <th>{{ t('playground.index.column.test') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="route in playgroundRoutes" :key="route.path">
            <td>{{ route.title }}</td>
            <td>
              <RouterLink :to="route.path">#{{ route.path }}</RouterLink>
            </td>
            <td>
              <code v-if="route.testFile !== '—'">pnpm test:ui -- {{ route.testFile }}</code>
              <span v-else class="index-page__muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="index-page__hint">
      {{ t('playground.index.hint') }}：<code>pnpm dev:ui</code> →
      <a :href="playgroundUrl" target="_blank" rel="noreferrer">{{ playgroundUrl }}</a>
    </p>
  </article>
</template>

<style scoped>
.index-page__header {
  margin-bottom: var(--rs-space-xl);
}

.index-page__title {
  margin: 0 0 var(--rs-space-xs);
  font-size: var(--rs-font-size-lg);
  font-weight: 600;
  line-height: var(--rs-line-height-tight);
  letter-spacing: -0.01em;
  color: var(--rs-text);
}

.index-page__intro {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-normal);
  color: var(--rs-muted);
}

.index-page__table-wrap {
  overflow-x: auto;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius);
  background: var(--rs-surface);
}

:global([data-rs-theme='dark']) .index-page__table-wrap {
  background: var(--rs-surface-elevated);
}

.index-page__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--rs-font-size-sm);
}

.index-page__table th,
.index-page__table td {
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  text-align: left;
}

.index-page__table th {
  font-weight: 600;
  color: var(--rs-muted);
}

.index-page__table tbody tr:last-child td {
  border-bottom: 0;
}

.index-page__table tbody tr:hover td {
  background: var(--rs-item-hover);
}

.index-page__muted {
  color: var(--rs-placeholder);
}

.index-page__hint {
  margin: var(--rs-space-xl) 0 0;
  font-size: var(--rs-font-size-xs);
  line-height: var(--rs-line-height-normal);
  color: var(--rs-muted);
}

code {
  color: var(--rs-primary);
  font-size: var(--rs-font-size-xs);
}
</style>
