<script setup lang="ts">
import {
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from './reka'
import {
  RS_CONTEXT_MENU_ARROW_SIZE,
  RS_CONTEXT_MENU_ICON_SIZE,
  type RsContextMenuItem,
} from './context-menu-utils'
import RsContextMenuItems from './RsContextMenuItems.vue'
import RsIcon from './RsIcon.vue'

defineProps<{
  items: RsContextMenuItem[]
}>()

const emit = defineEmits<{
  select: [item: RsContextMenuItem]
}>()

function onSelect(item: RsContextMenuItem) {
  if (item.disabled || item.separator) return
  emit('select', item)
}
</script>

<template>
  <template v-for="item in items" :key="item.key">
    <!-- 分隔线 -->
    <ContextMenuSeparator v-if="item.separator" class="rs-context-menu__separator" />

    <!-- 子菜单 -->
    <ContextMenuSub v-else-if="item.children?.length">
      <ContextMenuSubTrigger
        class="rs-context-menu__item"
        :class="{ 'rs-context-menu__item--danger': item.danger }"
        :disabled="item.disabled"
      >
        <span class="rs-context-menu__icon-cell">
          <RsIcon v-if="item.icon" :name="item.icon" :size="RS_CONTEXT_MENU_ICON_SIZE" />
        </span>
        <span class="rs-context-menu__label">{{ item.label }}</span>
        <RsIcon name="chevron-right" :size="RS_CONTEXT_MENU_ARROW_SIZE" class="rs-context-menu__arrow" />
      </ContextMenuSubTrigger>
      <ContextMenuPortal>
        <ContextMenuSubContent class="rs-context-menu__sub-content rs-motion-reduce" :side-offset="1" :align-offset="-6">
          <RsContextMenuItems :items="item.children" @select="emit('select', $event)" />
        </ContextMenuSubContent>
      </ContextMenuPortal>
    </ContextMenuSub>

    <!-- 普通菜单项 -->
    <ContextMenuItem
      v-else
      class="rs-context-menu__item"
      :class="{ 'rs-context-menu__item--danger': item.danger }"
      :disabled="item.disabled"
      @select="onSelect(item)"
    >
      <span class="rs-context-menu__icon-cell">
        <RsIcon v-if="item.icon" :name="item.icon" :size="RS_CONTEXT_MENU_ICON_SIZE" />
      </span>
      <span class="rs-context-menu__label">{{ item.label }}</span>
      <span v-if="item.shortcut" class="rs-context-menu__shortcut">{{ item.shortcut }}</span>
    </ContextMenuItem>
  </template>
</template>
