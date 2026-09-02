<script setup lang="ts">
/**
 * JSON 树节点：递归展开对象/数组，超长一层分页。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  defaultNodeOpen,
  isJsonContainer,
  jsonEntries,
  jsonKind,
  jsonPreview,
  JSON_TREE_PAGE,
} from './json-tree'

defineOptions({ name: 'AiJsonNode' })

const props = withDefaults(
  defineProps<{
    label?: string
    value: unknown
    depth?: number
    /** 为 true 时不渲染本层行，只铺子节点（根容器）。 */
    bare?: boolean
    expandTick?: number
    collapseTick?: number
  }>(),
  {
    label: '',
    depth: 0,
    bare: false,
    expandTick: 0,
    collapseTick: 0,
  },
)

const { t } = useI18n()

const container = computed(() => isJsonContainer(props.value))
const kids = computed(() => jsonEntries(props.value))
const kind = computed(() => jsonKind(props.value))
const preview = computed(() => jsonPreview(props.value))

const open = ref(defaultNodeOpen(props.depth, props.value))
const limit = ref(JSON_TREE_PAGE)

const visibleKids = computed(() => kids.value.slice(0, limit.value))
const hiddenCount = computed(() => Math.max(0, kids.value.length - limit.value))

watch(
  () => props.expandTick,
  (tick, prev) => {
    if (tick === prev) {
      return
    }
    open.value = true
    limit.value = Math.max(limit.value, kids.value.length)
  },
)

watch(
  () => props.collapseTick,
  (tick, prev) => {
    if (tick === prev) {
      return
    }
    if (props.depth > 0) {
      open.value = false
    }
  },
)

function toggle(): void {
  if (!container.value) {
    return
  }
  open.value = !open.value
}

function showMore(): void {
  limit.value += JSON_TREE_PAGE
}
</script>

<template>
  <template v-if="bare && container">
    <AiJsonNode
      v-for="e in visibleKids"
      :key="e.key"
      :label="e.key"
      :value="e.value"
      :depth="depth + 1"
      :expand-tick="expandTick"
      :collapse-tick="collapseTick"
    />
    <li v-if="hiddenCount > 0" class="nm-ai-json__more">
      <button type="button" class="nm-ai-json__more-btn" @click="showMore">
        {{ t('ai.jsonMore', { n: hiddenCount }) }}
      </button>
    </li>
  </template>
  <li v-else-if="bare" class="nm-ai-json__item">
    <div class="nm-ai-json__row">
      <span class="nm-ai-json__val" :data-kind="kind">{{ preview }}</span>
    </div>
  </li>
  <li v-else class="nm-ai-json__item">
    <div
      class="nm-ai-json__row"
      :class="{ 'is-toggle': container }"
      :role="container ? 'button' : undefined"
      :tabindex="container ? 0 : undefined"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <span class="nm-ai-json__twist" :class="{ 'is-leaf': !container }">
        {{ container ? (open ? '▾' : '▸') : '' }}
      </span>
      <span class="nm-ai-json__key">{{ label }}</span>
      <span class="nm-ai-json__val" :data-kind="kind">{{ preview }}</span>
    </div>
    <ul v-if="container && open" class="nm-ai-json__kids">
      <AiJsonNode
        v-for="e in visibleKids"
        :key="e.key"
        :label="e.key"
        :value="e.value"
        :depth="depth + 1"
        :expand-tick="expandTick"
        :collapse-tick="collapseTick"
      />
      <li v-if="hiddenCount > 0" class="nm-ai-json__more">
        <button type="button" class="nm-ai-json__more-btn" @click="showMore">
          {{ t('ai.jsonMore', { n: hiddenCount }) }}
        </button>
      </li>
    </ul>
  </li>
</template>

<style scoped>
.nm-ai-json__item {
  list-style: none;
  margin: 0;
  padding: 0;
}

.nm-ai-json__row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 1px 0;
  border-radius: 4px;
  min-width: 0;
}

.nm-ai-json__row.is-toggle {
  cursor: pointer;
}

.nm-ai-json__row.is-toggle:hover {
  background: color-mix(in srgb, var(--rs-text) 5%, transparent);
}

.nm-ai-json__twist {
  flex: 0 0 12px;
  width: 12px;
  color: var(--rs-muted);
  font-size: 10px;
  line-height: 1.55;
  user-select: none;
}

.nm-ai-json__twist.is-leaf {
  visibility: hidden;
}

.nm-ai-json__key {
  flex: 0 1 auto;
  color: color-mix(in srgb, var(--nm-aurora-a) 70%, var(--rs-text));
  word-break: break-all;
}

.nm-ai-json__val {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--rs-muted);
  overflow-wrap: anywhere;
}

.nm-ai-json__val[data-kind='string'] {
  color: color-mix(in srgb, var(--nm-aurora-e, #34d399) 70%, #c3e88d);
}

.nm-ai-json__val[data-kind='number'] {
  color: #f78c6c;
}

.nm-ai-json__val[data-kind='boolean'] {
  color: color-mix(in srgb, var(--nm-aurora-a) 55%, #c792ea);
}

.nm-ai-json__val[data-kind='null'] {
  color: var(--rs-muted);
  font-style: italic;
}

.nm-ai-json__kids {
  margin: 0;
  padding: 0 0 0 14px;
  list-style: none;
  border-left: 1px solid var(--rs-border-subtle);
}

.nm-ai-json__more {
  list-style: none;
  padding: 2px 0 2px 18px;
}

.nm-ai-json__more-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: color-mix(in srgb, var(--nm-aurora-a) 70%, var(--rs-text));
  font-size: 11px;
  cursor: pointer;
}

.nm-ai-json__more-btn:hover {
  text-decoration: underline;
}
</style>
