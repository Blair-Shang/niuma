<script setup lang="ts">
/**
 * 轻量 JSON 树（P3）：折叠查看，避免大对象撑爆气泡。
 */
import { computed, ref } from 'vue'

const props = defineProps<{
  source: string
}>()

const open = ref(true)
const parsed = computed(() => {
  try {
    return JSON.parse(props.source.trim()) as unknown
  } catch {
    return null
  }
})

function preview(v: unknown, depth = 0): string {
  if (depth > 3) {
    return '…'
  }
  if (v === null) return 'null'
  if (typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `Array(${v.length})`
  return `Object(${Object.keys(v as object).length})`
}

const entries = computed(() => {
  const v = parsed.value
  if (!v || typeof v !== 'object') {
    return [] as Array<{ key: string; value: unknown }>
  }
  if (Array.isArray(v)) {
    return v.slice(0, 40).map((value, i) => ({ key: String(i), value }))
  }
  return Object.entries(v as Record<string, unknown>)
    .slice(0, 40)
    .map(([key, value]) => ({ key, value }))
})
</script>

<template>
  <div class="nm-ai-json">
    <button type="button" class="nm-ai-json__toggle" @click="open = !open">
      {{ open ? '▾' : '▸' }} JSON
      <span v-if="!parsed" class="nm-ai-json__bad">invalid</span>
    </button>
    <pre v-if="!parsed" class="nm-ai-json__raw">{{ source }}</pre>
    <ul v-else-if="open" class="nm-ai-json__tree">
      <li v-for="e in entries" :key="e.key">
        <span class="nm-ai-json__key">{{ e.key }}</span>
        <span class="nm-ai-json__val">{{ preview(e.value) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.nm-ai-json {
  margin: 0.65em 0;
  border-radius: 10px;
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--nm-elevated-bg) 80%, transparent);
  overflow: hidden;
}

.nm-ai-json__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--rs-muted);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}

.nm-ai-json__bad {
  color: var(--rs-danger);
}

.nm-ai-json__tree {
  margin: 0;
  padding: 0 10px 8px 22px;
  list-style: none;
  max-height: 12rem;
  overflow: auto;
  font-size: 11.5px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.nm-ai-json__key {
  color: color-mix(in srgb, var(--nm-aurora-a) 70%, var(--rs-text));
  margin-right: 8px;
}

.nm-ai-json__val {
  color: var(--rs-muted);
}

.nm-ai-json__raw {
  margin: 0;
  padding: 8px 10px;
  max-height: 10rem;
  overflow: auto;
  font-size: 11px;
  white-space: pre-wrap;
}
</style>
