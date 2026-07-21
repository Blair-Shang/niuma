<script setup lang="ts">
/**
 * 引用卡 / 工具调用块：轻量结构化展示，失败时回退纯文本。
 */
import { computed } from 'vue'
import { RsIcon } from '@niuma/ui'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  kind: 'ref' | 'tool'
  source: string
}>()

const { t } = useI18n()

type RefPayload = {
  type?: string
  title?: string
  path?: string
  id?: string
  label?: string
  name?: string
}

const parsed = computed((): RefPayload | null => {
  try {
    const v = JSON.parse(props.source.trim()) as RefPayload
    if (v && typeof v === 'object') {
      return v
    }
  } catch {
    // plain text fallback
  }
  return null
})

const title = computed(() => {
  const p = parsed.value
  if (!p) {
    return props.kind === 'tool' ? t('ai.toolCall') : t('ai.reference')
  }
  return p.title || p.label || p.name || p.path || p.id || (props.kind === 'tool' ? t('ai.toolCall') : t('ai.reference'))
})

const subtitle = computed(() => {
  const p = parsed.value
  if (!p) {
    return props.source.trim()
  }
  const parts = [p.type, p.path, p.id].filter(Boolean)
  return parts.join(' · ')
})
</script>

<template>
  <div class="nm-ai-card" :class="`nm-ai-card--${kind}`">
    <div class="nm-ai-card__icon" aria-hidden="true">
      <RsIcon :name="kind === 'tool' ? 'wrench' : 'file-text'" :size="14" />
    </div>
    <div class="nm-ai-card__body">
      <div class="nm-ai-card__title">{{ title }}</div>
      <div v-if="subtitle" class="nm-ai-card__sub">{{ subtitle }}</div>
      <pre v-if="!parsed" class="nm-ai-card__raw">{{ source }}</pre>
    </div>
  </div>
</template>

<style scoped>
.nm-ai-card {
  display: flex;
  gap: 10px;
  margin: 0.65em 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 3.5%, transparent);
}

.nm-ai-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 8px;
  color: var(--rs-muted);
  background: color-mix(in srgb, var(--rs-text) 6%, transparent);
}

.nm-ai-card--tool .nm-ai-card__icon {
  color: color-mix(in srgb, var(--nm-aurora-a) 70%, var(--rs-text));
  background: color-mix(in srgb, var(--nm-aurora-a) 12%, transparent);
}

.nm-ai-card__body {
  min-width: 0;
  flex: 1;
}

.nm-ai-card__title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--rs-text);
}

.nm-ai-card__sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--rs-muted);
  overflow-wrap: anywhere;
}

.nm-ai-card__raw {
  margin: 6px 0 0;
  font-size: 11px;
  white-space: pre-wrap;
  color: var(--rs-muted);
}
</style>
