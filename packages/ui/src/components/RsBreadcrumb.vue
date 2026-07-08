<script setup lang="ts">
import { computed } from 'vue'
import { useRsI18n } from '../composables/useRsI18n'
import { buildBreadcrumbRenderItems } from './breadcrumb-utils'
import RsBreadcrumbItems from './RsBreadcrumbItems.vue'

const { t } = useRsI18n()

export interface RsBreadcrumbItem {
  label: string
  to?: string
  href?: string
}

const props = defineProps<{
  items: RsBreadcrumbItem[]
}>()

const renderItems = computed(() => buildBreadcrumbRenderItems(props.items))
</script>

<template>
  <nav class="rs-breadcrumb" :aria-label="t('breadcrumb.label')">
    <RsBreadcrumbItems :items="renderItems" :separator-label="t('breadcrumb.separator')" />
  </nav>
</template>

<style>
.rs-breadcrumb__list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rs-breadcrumb__item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.rs-breadcrumb__link {
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
  text-decoration: none;
  padding: 0.125rem 0.25rem;
  border-radius: var(--rs-radius-xs);
  transition:
    color var(--rs-transition-fast),
    background var(--rs-transition-fast);
}
.rs-breadcrumb__link:hover:not(.rs-breadcrumb__link--current) {
  color: var(--rs-primary);
  background: var(--rs-surface-hover);
}
.rs-breadcrumb__link--current {
  color: var(--rs-text);
  font-weight: 500;
  pointer-events: none;
}
.rs-breadcrumb__sep {
  color: var(--rs-muted);
}
</style>
