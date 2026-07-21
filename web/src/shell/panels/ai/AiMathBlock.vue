<script setup lang="ts">
/**
 * 块级数学公式（```math / ```latex）。
 */
import { onMounted, ref, watch } from 'vue'
import { renderKatexHtml } from './markdown'

const props = defineProps<{
  source: string
  active: boolean
}>()

const html = ref('')
const failed = ref(false)

async function render(): Promise<void> {
  if (!props.active) {
    html.value = ''
    failed.value = false
    return
  }
  try {
    html.value = await renderKatexHtml(props.source.trim(), true)
    failed.value = false
  } catch {
    html.value = ''
    failed.value = true
  }
}

watch(
  () => [props.active, props.source] as const,
  () => {
    void render()
  },
)

onMounted(() => {
  void render()
})
</script>

<template>
  <div class="nm-ai-math-block">
    <div v-if="!active" class="nm-ai-math-block__pending">…</div>
    <div v-else-if="failed" class="nm-ai-math-block__raw">{{ source }}</div>
    <div v-else class="nm-ai-math-block__body" v-html="html" />
  </div>
</template>

<style scoped>
.nm-ai-math-block {
  margin: 0.65em 0;
  padding: 10px 12px;
  overflow-x: auto;
  border-radius: 10px;
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--nm-elevated-bg) 70%, transparent);
  text-align: center;
}

.nm-ai-math-block__pending,
.nm-ai-math-block__raw {
  font-size: 12px;
  color: var(--rs-muted);
  text-align: left;
  white-space: pre-wrap;
}

.nm-ai-math-block__body {
  font-size: 15px;
  color: var(--rs-text);
}
</style>
