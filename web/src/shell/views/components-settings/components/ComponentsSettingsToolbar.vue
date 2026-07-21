<script setup lang="ts">
import { RsButton, RsTooltip } from '@niuma/ui'
import { useI18n } from 'vue-i18n'

defineProps<{
  loading: boolean
}>()

const emit = defineEmits<{
  refresh: []
}>()

const { t } = useI18n()
</script>

<template>
  <header class="nm-components__toolbar">
    <div class="nm-components__toolbar-main">
      <div class="nm-components__title-row">
        <h1 class="nm-section-title">{{ t('settings.components') }}</h1>
        <RsTooltip side="bottom" align="start">
          <RsButton
            variant="ghost"
            size="sm"
            icon="info"
            icon-only
            :aria-label="t('settings.componentsTooltip')"
          />
          <template #content>
            <div class="nm-components__tooltip">
              <p>{{ t('settings.componentsDesc') }}</p>
              <p>{{ t('settings.componentsHint') }}</p>
            </div>
          </template>
        </RsTooltip>
      </div>
    </div>
    <RsTooltip :content="t('settings.componentsRefresh')" side="top">
      <RsButton variant="ghost" size="sm" :disabled="loading" @click="emit('refresh')">
        {{ t('settings.componentsRefresh') }}
      </RsButton>
    </RsTooltip>
  </header>
</template>

<style scoped>
.nm-components__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-md);
  flex-shrink: 0;
  padding: var(--rs-space-lg) var(--rs-space-xl);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 3%, var(--rs-surface-elevated));
}

.nm-components__toolbar-main {
  min-width: 0;
}

.nm-components__title-row {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.nm-components__tooltip {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-width: 18rem;
  line-height: 1.45;
}

.nm-components__tooltip p {
  margin: 0;
}
</style>
