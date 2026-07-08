<script setup lang="ts">
import { computed } from 'vue'
import {
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
} from './reka'
import { useRsI18n } from '../composables/useRsI18n'
import type { RsMenuItem } from './menu-utils'
import RsIcon from './RsIcon.vue'
import RsMenuItems from './RsMenuItems.vue'

const props = withDefaults(
  defineProps<{
    items: RsMenuItem[]
    activeKey?: string
    openKeys: string[]
    collapsed?: boolean
    mode?: 'vertical' | 'horizontal'
    depth?: number
  }>(),
  {
    collapsed: false,
    mode: 'vertical',
    depth: 0,
  },
)

const emit = defineEmits<{
  select: [key: string]
  'toggle-open': [key: string, open: boolean]
}>()

const { t } = useRsI18n()
const isCollapsedVertical = computed(() => props.mode === 'vertical' && props.collapsed)
const canExpandSubmenu = computed(() => !isCollapsedVertical.value)

function isOpen(key: string) {
  return props.openKeys.includes(key)
}

function isActive(key: string) {
  return props.activeKey === key
}

function selectLeaf(item: RsMenuItem) {
  if (item.disabled) return
  emit('select', item.key)
}

function toggleOpen(key: string, open: boolean) {
  if (!canExpandSubmenu.value) return
  emit('toggle-open', key, open)
}
</script>

<template>
  <ul class="rs-menu__list" :class="{ 'rs-menu__list--nested': depth > 0 }">
    <li v-for="item in items" :key="item.key" class="rs-menu__node">
      <div
        class="rs-menu__entry"
        :class="{
          'rs-menu__entry--submenu': !!item.children?.length,
          'rs-menu__entry--active': isActive(item.key),
          'rs-menu__entry--disabled': item.disabled,
        }"
        :style="{
          '--rs-menu-depth': mode === 'vertical' && !collapsed ? depth : 0,
        }"
      >
        <CollapsibleRoot
          v-if="item.children?.length && canExpandSubmenu"
          :open="isOpen(item.key)"
          class="rs-menu__collapsible"
          @update:open="(open) => toggleOpen(item.key, open)"
        >
          <CollapsibleTrigger
            class="rs-menu__item rs-menu__item--submenu-trigger"
            :class="{ 'rs-menu__item--active': isActive(item.key) }"
            :disabled="item.disabled"
            :aria-label="collapsed ? item.label : undefined"
            :title="collapsed ? item.label : undefined"
          >
            <RsIcon v-if="item.icon" :name="item.icon" :size="16" class="rs-menu__icon" />
            <span v-if="!collapsed" class="rs-menu__label">{{ item.label }}</span>
            <RsIcon
              v-if="!collapsed"
              name="chevron-down"
              :size="14"
              class="rs-menu__submenu-arrow"
              :label="isOpen(item.key) ? t('menu.collapseSubmenu') : t('menu.expandSubmenu')"
            />
          </CollapsibleTrigger>
          <CollapsibleContent class="rs-menu__submenu">
            <RsMenuItems
              :items="item.children"
              :active-key="activeKey"
              :open-keys="openKeys"
              :collapsed="collapsed"
              :mode="mode"
              :depth="depth + 1"
              @select="emit('select', $event)"
              @toggle-open="(key, open) => emit('toggle-open', key, open)"
            />
          </CollapsibleContent>
        </CollapsibleRoot>

        <button
          v-else
          type="button"
          class="rs-menu__item"
          :class="{ 'rs-menu__item--active': isActive(item.key) }"
          :disabled="item.disabled"
          :aria-current="isActive(item.key) ? 'page' : undefined"
          :aria-label="collapsed ? item.label : undefined"
          :title="collapsed ? item.label : undefined"
          @click="selectLeaf(item)"
        >
          <RsIcon v-if="item.icon" :name="item.icon" :size="16" class="rs-menu__icon" />
          <span v-if="!collapsed" class="rs-menu__label">{{ item.label }}</span>
        </button>
      </div>
    </li>
  </ul>
</template>
