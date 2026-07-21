<script setup lang="ts">
import { RsIcon } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import type { ToolComponentBundle } from '@/api/types/components'
import {
  bundleDisplayName,
  bundleHealthClass,
  bundleIcon,
  bundleSummary,
} from '../utils/presentation'

defineProps<{
  bundles: ToolComponentBundle[]
  selectedBundleId: string | null
}>()

const emit = defineEmits<{
  select: [bundleId: string]
}>()

const { t, te } = useI18n()
</script>

<template>
  <aside class="nm-components__sidebar" :aria-label="t('settings.componentsBundlesTitle')">
    <div class="nm-components__sidebar-title">{{ t('settings.componentsBundlesTitle') }}</div>
    <nav class="nm-components__bundle-nav">
      <button
        v-for="bundle in bundles"
        :key="bundle.bundleId"
        type="button"
        class="nm-components__bundle-item"
        :class="{ 'nm-components__bundle-item--active': selectedBundleId === bundle.bundleId }"
        @click="emit('select', bundle.bundleId)"
      >
        <span class="nm-components__bundle-icon" aria-hidden="true">
          <RsIcon :name="bundleIcon(bundle)" :size="16" />
        </span>
        <span class="nm-components__bundle-text min-w-0">
          <span class="nm-components__bundle-name truncate">{{ bundleDisplayName(t, te, bundle) }}</span>
          <span class="nm-components__bundle-meta">
            {{ t('settings.componentsToolCount', { count: bundle.tools.length }) }}
            ·
            {{ t('settings.componentsReadySummary', bundleSummary(bundle)) }}
          </span>
        </span>
        <span
          class="nm-components__health"
          :class="bundleHealthClass(bundle)"
          :title="t('settings.componentsReadySummary', bundleSummary(bundle))"
          aria-hidden="true"
        />
      </button>
    </nav>
  </aside>
</template>

<style scoped>
.nm-components__sidebar {
  display: flex;
  flex-direction: column;
  width: 14.5rem;
  flex-shrink: 0;
  border-right: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 2%, var(--rs-surface-elevated));
}

.nm-components__sidebar-title {
  padding: var(--rs-space-sm) var(--rs-space-md);
  font-size: var(--nm-font-caption);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rs-muted);
}

.nm-components__bundle-nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0 var(--rs-space-sm) var(--rs-space-sm);
}

.nm-components__bundle-item {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  width: 100%;
  padding: var(--rs-space-sm) var(--rs-space-sm) var(--rs-space-sm) calc(var(--rs-space-sm) - 2px);
  border: none;
  border-left: 2px solid transparent;
  border-radius: 0 var(--rs-radius-sm) var(--rs-radius-sm) 0;
  background: transparent;
  color: var(--rs-text);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast),
    border-color var(--rs-transition-fast);
}

.nm-components__bundle-item:hover {
  background: var(--rs-item-hover);
}

.nm-components__bundle-item--active {
  border-left-color: var(--rs-primary);
  background: color-mix(in srgb, var(--rs-primary) 10%, transparent);
  color: var(--rs-primary);
}

.nm-components__bundle-item--active .nm-components__bundle-meta {
  color: color-mix(in srgb, var(--rs-primary) 70%, var(--rs-muted));
}

.nm-components__bundle-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  flex-shrink: 0;
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, var(--rs-text) 6%, transparent);
}

.nm-components__bundle-item--active .nm-components__bundle-icon {
  background: color-mix(in srgb, var(--rs-primary) 16%, transparent);
  color: var(--rs-primary);
}

.nm-components__bundle-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.nm-components__bundle-name {
  font-weight: 500;
  line-height: 1.3;
}

.nm-components__bundle-meta {
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-components__health {
  width: 0.5rem;
  height: 0.5rem;
  flex-shrink: 0;
  border-radius: 999px;
}

.nm-components__health--full {
  background: var(--rs-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-success) 18%, transparent);
}

.nm-components__health--partial {
  background: var(--rs-warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-warning) 18%, transparent);
}

.nm-components__health--none {
  background: var(--rs-muted);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-muted) 18%, transparent);
}

@media (max-width: 48rem) {
  .nm-components__sidebar {
    width: auto;
    border-right: none;
    border-bottom: 1px solid var(--rs-border-subtle);
  }

  .nm-components__bundle-nav {
    max-height: 10rem;
    overflow-y: auto;
  }
}
</style>
