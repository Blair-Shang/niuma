<script setup lang="ts">
import { RsLoading } from '@niuma/ui'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div
    class="nm-components__workspace"
    aria-busy="true"
    :aria-label="t('settings.componentsLoading')"
  >
    <div class="nm-components__loading-banner">
      <RsLoading variant="spinner" size="sm" :label="t('settings.componentsLoading')" show-label />
    </div>
    <aside
      class="nm-components__sidebar nm-components__sidebar--skeleton"
      :aria-label="t('settings.componentsBundlesTitle')"
      aria-hidden="true"
    >
      <div class="nm-components__sidebar-title">{{ t('settings.componentsBundlesTitle') }}</div>
      <div v-for="item in 2" :key="item" class="nm-components__bundle-skeleton">
        <span class="nm-components__skel nm-components__skel--icon" />
        <span class="nm-components__skel-block">
          <span class="nm-components__skel nm-components__skel--title" />
          <span class="nm-components__skel nm-components__skel--meta" />
        </span>
      </div>
    </aside>
    <div class="nm-components__detail nm-components__detail--skeleton" aria-hidden="true">
      <div class="nm-components__detail-head">
        <div class="nm-components__detail-skeleton-head">
          <span class="nm-components__skel nm-components__skel--detail-icon" />
          <span class="nm-components__skel-block">
            <span class="nm-components__skel nm-components__skel--detail-title" />
            <span class="nm-components__skel nm-components__skel--detail-meta" />
          </span>
        </div>
        <div class="nm-components__detail-skeleton-actions">
          <span class="nm-components__skel nm-components__skel--btn" />
          <span class="nm-components__skel nm-components__skel--btn" />
        </div>
      </div>
      <div class="nm-components__tool-grid">
        <div v-for="item in 3" :key="item" class="nm-components__tool-skeleton">
          <span class="nm-components__skel nm-components__skel--tool-title" />
          <span class="nm-components__skel nm-components__skel--tool-path" />
          <span class="nm-components__skel nm-components__skel--tool-actions" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nm-components__loading-banner {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--rs-surface) 78%, transparent);
  backdrop-filter: blur(1px);
}

.nm-components__workspace {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--rs-surface-elevated);
}

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

.nm-components__detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--rs-space-md);
  min-width: 0;
  min-height: 0;
  padding: var(--rs-space-md) var(--rs-space-lg) var(--rs-space-lg);
  overflow-y: auto;
}

.nm-components__detail--skeleton {
  pointer-events: none;
  opacity: 0.72;
}

.nm-components__detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
  width: 100%;
}

.nm-components__bundle-skeleton {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm);
}

.nm-components__detail-skeleton-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
}

.nm-components__detail-skeleton-actions {
  display: flex;
  gap: 0.375rem;
  flex-shrink: 0;
}

.nm-components__tool-skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: var(--rs-space-md);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  background: var(--rs-surface);
}

.nm-components__skel-block {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.nm-components__skel {
  display: block;
  border-radius: var(--rs-radius-sm);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--rs-text) 6%, transparent) 25%,
    color-mix(in srgb, var(--rs-text) 10%, transparent) 50%,
    color-mix(in srgb, var(--rs-text) 6%, transparent) 75%
  );
  background-size: 200% 100%;
  animation: nm-components-shimmer 1.2s ease-in-out infinite;
}

.nm-components__skel--icon {
  width: 1.75rem;
  height: 1.75rem;
  flex-shrink: 0;
}

.nm-components__skel--title {
  width: 72%;
  height: 0.8rem;
}

.nm-components__skel--meta {
  width: 52%;
  height: 0.65rem;
}

.nm-components__skel--detail-icon {
  width: 2.25rem;
  height: 2.25rem;
  flex-shrink: 0;
  border-radius: var(--rs-radius-md);
}

.nm-components__skel--detail-title {
  width: 9rem;
  height: 0.95rem;
}

.nm-components__skel--detail-meta {
  width: 14rem;
  height: 0.7rem;
}

.nm-components__skel--btn {
  width: 5.5rem;
  height: 1.75rem;
}

.nm-components__skel--tool-title {
  width: 45%;
  height: 0.85rem;
}

.nm-components__skel--tool-path {
  width: 100%;
  height: 2.25rem;
}

.nm-components__skel--tool-actions {
  width: 62%;
  height: 1.5rem;
}

@keyframes nm-components-shimmer {
  0% {
    background-position: 200% 0;
  }

  100% {
    background-position: -200% 0;
  }
}

@media (max-width: 48rem) {
  .nm-components__workspace {
    flex-direction: column;
  }

  .nm-components__sidebar {
    width: auto;
    border-right: none;
    border-bottom: 1px solid var(--rs-border-subtle);
  }
}
</style>
