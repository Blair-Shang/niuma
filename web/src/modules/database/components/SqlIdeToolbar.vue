<script setup lang="ts">
/**
 * IDE 图标工具条：identity 只读展示库/对象名；items 声明图标按钮、分段切换、过滤输入。
 * 过滤框回车发出 filterSubmit。槽位只留给 Popover 触发器等无法用 items 表达的控件。
 */
import { computed, useSlots } from 'vue'
import { RsIcon, RsInput } from '@niuma/ui'
import SqlIdeToolbarItems from './SqlIdeToolbarItems.vue'
import SqlQueryIdentity from './SqlQueryIdentity.vue'
import {
  isSqlIdeToolbarAction,
  isSqlIdeToolbarFilter,
  isSqlIdeToolbarModes,
  isSqlIdeToolbarSep,
  type SqlIdeToolbarAction,
  type SqlIdeToolbarFilter,
  type SqlIdeToolbarIdentityPart,
  type SqlIdeToolbarItem,
  type SqlIdeToolbarModes,
  type SqlIdeToolbarSep,
} from '../types/sql-ide-toolbar'

const props = withDefaults(
  defineProps<{
    label: string
    identity?: string
    identityIcon?: string
    identityTitle?: string
    /** 多段只读身份；有值时优先于 identity 字符串 */
    identityParts?: SqlIdeToolbarIdentityPart[]
    items?: SqlIdeToolbarItem[]
    identityGrow?: boolean
  }>(),
  {
    identity: '',
    identityIcon: 'database',
    identityTitle: '',
    identityParts: () => [],
    items: () => [],
    identityGrow: false,
  },
)

const emit = defineEmits<{
  action: [key: string]
  mode: [itemKey: string, value: string]
  filter: [itemKey: string, value: string]
  /** 过滤框回车，供需要显式应用条件的页面使用 */
  filterSubmit: [itemKey: string]
}>()

const slots = useSlots()

const modeItems = computed((): SqlIdeToolbarModes[] =>
  props.items.filter(isSqlIdeToolbarModes),
)

const filterItems = computed((): SqlIdeToolbarFilter[] =>
  props.items.filter(isSqlIdeToolbarFilter),
)

const buttonItems = computed((): Array<SqlIdeToolbarAction | SqlIdeToolbarSep> =>
  props.items.filter(
    (item): item is SqlIdeToolbarAction | SqlIdeToolbarSep =>
      isSqlIdeToolbarAction(item) || isSqlIdeToolbarSep(item),
  ),
)

const leadItems = computed(() =>
  buttonItems.value.filter((item) => (item.align ?? 'lead') === 'lead'),
)

const trailItems = computed(() =>
  buttonItems.value.filter((item) => item.align === 'trail'),
)

const trailModes = computed(() =>
  modeItems.value.filter((item) => (item.align ?? 'trail') === 'trail'),
)

const leadModes = computed(() =>
  modeItems.value.filter((item) => item.align === 'lead'),
)

const leadFilters = computed(() =>
  filterItems.value.filter((item) => item.align === 'lead'),
)

const trailFilters = computed(() =>
  filterItems.value.filter((item) => (item.align ?? 'trail') === 'trail'),
)

const resolvedIdentityParts = computed((): SqlIdeToolbarIdentityPart[] => {
  const parts = props.identityParts.filter((part) => part.text.trim().length > 0)
  if (parts.length > 0) return parts
  const text = props.identity.trim()
  if (!text) return []
  return [{ text, icon: props.identityIcon, title: props.identityTitle || text }]
})

const identityTooltip = computed(() => {
  if (props.identityTitle) return props.identityTitle
  return resolvedIdentityParts.value.map((part) => part.text).join('.')
})

const showIdentity = computed(
  () => resolvedIdentityParts.value.length > 0 || Boolean(slots.identity),
)

const showLeadSep = computed(
  () =>
    showIdentity.value &&
    (leadItems.value.length > 0 ||
      leadModes.value.length > 0 ||
      leadFilters.value.length > 0 ||
      Boolean(slots['lead-start']) ||
      Boolean(slots['lead-end'])),
)

const showTrail = computed(
  () =>
    trailItems.value.length > 0 ||
    trailModes.value.length > 0 ||
    trailFilters.value.length > 0 ||
    Boolean(slots.trail),
)
</script>

<template>
  <header class="nm-sql-tb" role="toolbar" :aria-label="label">
    <div class="nm-sql-tb__lead">
      <div
        v-if="showIdentity"
        class="nm-sql-tb__scope"
        :class="{ 'nm-sql-tb__scope--grow': identityGrow }"
        :title="identityTooltip"
      >
        <slot name="identity">
          <template v-for="(part, index) in resolvedIdentityParts" :key="`${part.text}-${index}`">
            <span v-if="index > 0" class="nm-sql-tb__scope-dot" aria-hidden="true">.</span>
            <SqlQueryIdentity :icon="part.icon || identityIcon" :title="part.title || part.text">
              {{ part.text }}
            </SqlQueryIdentity>
          </template>
        </slot>
      </div>
      <span v-if="showLeadSep" class="nm-sql-tb__sep" aria-hidden="true" />
      <slot name="lead-start" />
      <SqlIdeToolbarItems :items="leadItems" @action="emit('action', $event)" />
      <template v-for="group in leadModes" :key="group.key">
        <div class="nm-sql-tb__modes" role="tablist" :aria-label="group.label">
          <button
            v-for="option in group.options"
            :key="option.key"
            type="button"
            class="nm-sql-tb__mode"
            :class="{ 'nm-sql-tb__mode--active': group.value === option.key }"
            role="tab"
            :aria-selected="group.value === option.key"
            @click="emit('mode', group.key, option.key)"
          >
            {{ option.label }}
          </button>
        </div>
      </template>
      <template v-for="item in leadFilters" :key="item.key">
        <RsInput
          class="nm-sql-tb__filter"
          size="sm"
          clearable
          :model-value="item.value"
          :placeholder="item.placeholder"
          :disabled="item.disabled"
          :aria-label="item.placeholder || item.key"
          spellcheck="false"
          @update:model-value="emit('filter', item.key, $event)"
          @keydown.enter.prevent="emit('filterSubmit', item.key)"
        >
          <template #prefix>
            <RsIcon :name="item.icon || 'search'" :size="13" />
          </template>
        </RsInput>
      </template>
      <slot name="lead-end" />
    </div>
    <div v-if="showTrail" class="nm-sql-tb__trail">
      <slot name="trail" />
      <template v-for="group in trailModes" :key="group.key">
        <div class="nm-sql-tb__modes" role="tablist" :aria-label="group.label">
          <button
            v-for="option in group.options"
            :key="option.key"
            type="button"
            class="nm-sql-tb__mode"
            :class="{ 'nm-sql-tb__mode--active': group.value === option.key }"
            role="tab"
            :aria-selected="group.value === option.key"
            @click="emit('mode', group.key, option.key)"
          >
            {{ option.label }}
          </button>
        </div>
      </template>
      <template v-for="item in trailFilters" :key="item.key">
        <RsInput
          class="nm-sql-tb__filter"
          size="sm"
          clearable
          :model-value="item.value"
          :placeholder="item.placeholder"
          :disabled="item.disabled"
          :aria-label="item.placeholder || item.key"
          spellcheck="false"
          @update:model-value="emit('filter', item.key, $event)"
          @keydown.enter.prevent="emit('filterSubmit', item.key)"
        >
          <template #prefix>
            <RsIcon :name="item.icon || 'search'" :size="13" />
          </template>
        </RsInput>
      </template>
      <SqlIdeToolbarItems :items="trailItems" @action="emit('action', $event)" />
    </div>
  </header>
</template>

<style scoped src="./sql-ide-toolbar.css"></style>
