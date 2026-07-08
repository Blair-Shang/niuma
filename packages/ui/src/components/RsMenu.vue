<script setup lang="ts">
import { watch } from 'vue'
import { useRsI18n } from '../composables/useRsI18n'
import {
  findMenuParentKeys,
  isMenuItemGroup,
  type RsMenuItems as RsMenuData,
} from './menu-utils'
import RsMenuItems from './RsMenuItems.vue'

const model = defineModel<string>()
const openKeys = defineModel<string[]>('openKeys', { default: () => [] })

const props = withDefaults(
  defineProps<{
    items: RsMenuData
    mode?: 'vertical' | 'horizontal'
    collapsed?: boolean
  }>(),
  {
    mode: 'vertical',
    collapsed: false,
  },
)

const emit = defineEmits<{
  select: [key: string]
}>()

const { t } = useRsI18n()

function onSelect(key: string) {
  model.value = key
  emit('select', key)
}

function onToggleOpen(key: string, open: boolean) {
  const next = new Set(openKeys.value)
  if (open) {
    next.add(key)
  } else {
    next.delete(key)
  }
  openKeys.value = [...next]
}

watch(
  () => model.value,
  (key) => {
    if (!key) {
      return
    }
    const parents = findMenuParentKeys(props.items, key)
    if (!parents.length) {
      return
    }
    const next = new Set(openKeys.value)
    for (const parentKey of parents) {
      next.add(parentKey)
    }
    openKeys.value = [...next]
  },
  { immediate: true },
)
</script>

<template>
  <nav
    class="rs-menu"
    :class="[`rs-menu--${mode}`, { 'rs-menu--collapsed': collapsed }]"
    :aria-label="t('menu.label')"
  >
    <ul class="rs-menu__root-list">
      <template v-for="(entry, index) in items" :key="index">
        <li v-if="isMenuItemGroup(entry)" class="rs-menu__group">
          <span v-if="!collapsed" class="rs-menu__group-label">{{ entry.label }}</span>
          <RsMenuItems
            :items="entry.children"
            :active-key="model"
            :open-keys="openKeys"
            :collapsed="collapsed"
            :mode="mode"
            @select="onSelect"
            @toggle-open="onToggleOpen"
          />
        </li>

        <li v-else :key="entry.key" class="rs-menu__group rs-menu__group--plain">
          <RsMenuItems
            :items="[entry]"
            :active-key="model"
            :open-keys="openKeys"
            :collapsed="collapsed"
            :mode="mode"
            @select="onSelect"
            @toggle-open="onToggleOpen"
          />
        </li>
      </template>
    </ul>
  </nav>
</template>

<style>
.rs-menu {
  display: block;
}
.rs-menu__root-list,
.rs-menu__list {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rs-menu--horizontal > .rs-menu__root-list {
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.rs-menu__group-label {
  display: block;
  padding: 0.5rem 0.5rem 0.25rem;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
  letter-spacing: 0.04em;
  line-height: var(--rs-line-height-tight);
  user-select: none;
}
.rs-menu--collapsed .rs-menu__group-label {
  display: none;
}
.rs-menu__group {
  list-style: none;
}
.rs-menu__group--plain > .rs-menu__list {
  margin: 0;
}
.rs-menu__entry {
  list-style: none;
}
.rs-menu__node {
  list-style: none;
}
.rs-menu--horizontal > .rs-menu__root-list > .rs-menu__group {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}
.rs-menu__collapsible {
  display: block;
}
.rs-menu__item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  min-height: var(--rs-control-height-md);
  padding: 0 0.5rem;
  padding-left: calc(0.5rem + var(--rs-menu-depth, 0) * 0.875rem);
  border: none;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--rs-transition-fast),
    background var(--rs-transition-fast);
}
.rs-menu--horizontal .rs-menu__item {
  width: auto;
  min-width: 0;
  padding-left: 0.5rem;
  padding-right: 0.5rem;
}
.rs-menu--collapsed .rs-menu__item {
  justify-content: center;
  padding: 0;
  width: var(--rs-control-height-md);
  margin: 0 auto;
}
.rs-menu--collapsed .rs-menu__list--nested {
  display: none;
}
.rs-menu__item:hover:not(:disabled):not(.rs-menu__item--active) {
  color: var(--rs-text);
  background: var(--rs-surface-hover);
}
.rs-menu__item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
.rs-menu__item--active {
  color: var(--rs-primary);
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
  font-weight: 500;
}
.rs-menu__item:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.rs-menu__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-menu__submenu-arrow {
  flex-shrink: 0;
  color: var(--rs-muted);
  transition: transform var(--rs-transition-fast);
}
.rs-menu__item--submenu-trigger[data-state='open'] .rs-menu__submenu-arrow {
  transform: rotate(180deg);
}
.rs-menu__submenu {
  overflow: hidden;
}
.rs-menu__list--nested {
  margin-top: 0.125rem;
}
.rs-menu--horizontal > .rs-menu__root-list > .rs-menu__group > .rs-menu__group-label {
  display: none;
}
.rs-menu--horizontal > .rs-menu__root-list > .rs-menu__group > .rs-menu__list {
  margin-top: 0;
  flex-direction: row;
  align-items: center;
  gap: 0.25rem;
}
.rs-menu--horizontal .rs-menu__entry--submenu .rs-menu__submenu {
  position: absolute;
  top: calc(100% + 0.25rem);
  left: 0;
  z-index: 50;
  min-width: 10rem;
  padding: 0.25rem;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface-elevated);
  box-shadow: var(--rs-shadow);
}
.rs-menu--horizontal .rs-menu__entry--submenu .rs-menu__list--nested {
  flex-direction: column;
  align-items: stretch;
  flex-wrap: nowrap;
  margin-top: 0;
}
</style>
