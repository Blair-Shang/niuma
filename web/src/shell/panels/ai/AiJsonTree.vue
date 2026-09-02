<script setup lang="ts">
/**
 * JSON 树：递归展开完整结构，支持复制与原文/结构切换。
 */
import { copyTextToClipboard } from '@niuma/ui'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AiJsonNode from './AiJsonNode.vue'
import { prettyJson } from './json-tree'

const props = defineProps<{
  source: string
}>()

const { t } = useI18n()
const open = ref(true)
const mode = ref<'tree' | 'raw'>('tree')
const copied = ref(false)
const expandTick = ref(0)
const collapseTick = ref(0)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

type ParseResult = { ok: true; value: unknown } | { ok: false }

const parsed = computed((): ParseResult => {
  try {
    return { ok: true, value: JSON.parse(props.source.trim()) as unknown }
  } catch {
    return { ok: false }
  }
})

const pretty = computed(() => {
  if (!parsed.value.ok) {
    return props.source
  }
  return prettyJson(parsed.value.value, props.source)
})

function expandAll(): void {
  open.value = true
  mode.value = 'tree'
  expandTick.value += 1
}

function collapseNested(): void {
  collapseTick.value += 1
}

async function copyJson(): Promise<void> {
  const ok = await copyTextToClipboard(pretty.value)
  if (!ok) {
    copied.value = false
    return
  }
  copied.value = true
  if (copiedTimer) {
    clearTimeout(copiedTimer)
  }
  copiedTimer = setTimeout(() => {
    copied.value = false
    copiedTimer = null
  }, 1600)
}

onBeforeUnmount(() => {
  if (copiedTimer) {
    clearTimeout(copiedTimer)
  }
})
</script>

<template>
  <div class="nm-ai-json">
    <div class="nm-ai-json__head">
      <button type="button" class="nm-ai-json__toggle" @click="open = !open">
        {{ open ? '▾' : '▸' }} JSON
        <span v-if="!parsed.ok" class="nm-ai-json__bad">invalid</span>
      </button>
      <div class="nm-ai-json__actions">
        <button
          v-if="parsed.ok"
          type="button"
          class="nm-ai-json__act"
          @click="mode = mode === 'tree' ? 'raw' : 'tree'"
        >
          {{ mode === 'tree' ? t('ai.jsonRaw') : t('ai.jsonTree') }}
        </button>
        <button
          v-if="parsed.ok && mode === 'tree'"
          type="button"
          class="nm-ai-json__act"
          @click="expandAll"
        >
          {{ t('ai.expandCode') }}
        </button>
        <button
          v-if="parsed.ok && mode === 'tree'"
          type="button"
          class="nm-ai-json__act"
          @click="collapseNested"
        >
          {{ t('ai.collapseCode') }}
        </button>
        <button type="button" class="nm-ai-json__act" @click="copyJson">
          {{ copied ? t('ai.copiedCode') : t('ai.copyCode') }}
        </button>
      </div>
    </div>
    <pre v-if="open && (!parsed.ok || mode === 'raw')" class="nm-ai-json__raw">{{ pretty }}</pre>
    <ul v-else-if="open && parsed.ok && mode === 'tree'" class="nm-ai-json__tree">
      <AiJsonNode
        :value="parsed.value"
        :depth="0"
        bare
        :expand-tick="expandTick"
        :collapse-tick="collapseTick"
      />
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

.nm-ai-json__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding: 4px 6px 4px 10px;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 3.5%, transparent);
}

.nm-ai-json__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 2px 0;
  border: none;
  background: transparent;
  color: var(--rs-muted);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}

.nm-ai-json__actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.nm-ai-json__act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--rs-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}

.nm-ai-json__act:hover {
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
  color: var(--rs-text);
}

.nm-ai-json__bad {
  color: var(--rs-danger);
  font-weight: 500;
}

.nm-ai-json__tree {
  margin: 0;
  padding: 6px 10px 8px;
  list-style: none;
  max-height: 32rem;
  overflow: auto;
  font-size: 11.5px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  line-height: 1.55;
}

.nm-ai-json__raw {
  margin: 0;
  padding: 8px 10px;
  max-height: 32rem;
  overflow: auto;
  font-size: 11.5px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
