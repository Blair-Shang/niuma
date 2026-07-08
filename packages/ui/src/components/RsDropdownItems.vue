<script setup lang="ts">
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioItem,
} from './reka'
import {
  isDropdownItemGroup,
  type RsDropdownItem,
  type RsDropdownItems,
} from './dropdown-utils'
import RsIcon from './RsIcon.vue'

withDefaults(
  defineProps<{
    items: RsDropdownItems
    /** true：单选互斥；false：操作项 */
    selectable?: boolean
  }>(),
  {
    selectable: false,
  },
)

const emit = defineEmits<{
  select: [value: string]
}>()

function onActionSelect(item: RsDropdownItem) {
  if (item.disabled) return
  emit('select', item.value)
}
</script>

<template>
  <template v-for="(entry, index) in items" :key="index">
    <DropdownMenuGroup v-if="isDropdownItemGroup(entry)" class="rs-dropdown__group">
      <DropdownMenuLabel class="rs-dropdown__group-label">
        {{ entry.label }}
      </DropdownMenuLabel>
      <template v-if="selectable">
        <DropdownMenuRadioItem
          v-for="item in entry.options"
          :key="item.value"
          :value="item.value"
          :disabled="item.disabled"
          class="rs-dropdown__item"
        >
          <RsIcon v-if="item.icon" :name="item.icon" :size="16" class="rs-dropdown__item-icon" />
          <span class="rs-dropdown__item-label">{{ item.label }}</span>
        </DropdownMenuRadioItem>
      </template>
      <template v-else>
        <DropdownMenuItem
          v-for="item in entry.options"
          :key="item.value"
          :disabled="item.disabled"
          class="rs-dropdown__item"
          @select="onActionSelect(item)"
        >
          <RsIcon v-if="item.icon" :name="item.icon" :size="16" class="rs-dropdown__item-icon" />
          <span class="rs-dropdown__item-label">{{ item.label }}</span>
        </DropdownMenuItem>
      </template>
    </DropdownMenuGroup>

    <DropdownMenuRadioItem
      v-else-if="selectable"
      :key="entry.value"
      :value="entry.value"
      :disabled="entry.disabled"
      class="rs-dropdown__item"
    >
      <RsIcon v-if="entry.icon" :name="entry.icon" :size="16" class="rs-dropdown__item-icon" />
      <span class="rs-dropdown__item-label">{{ entry.label }}</span>
    </DropdownMenuRadioItem>

    <DropdownMenuItem
      v-else
      :key="entry.value"
      :disabled="entry.disabled"
      class="rs-dropdown__item"
      @select="onActionSelect(entry)"
    >
      <RsIcon v-if="entry.icon" :name="entry.icon" :size="16" class="rs-dropdown__item-icon" />
      <span class="rs-dropdown__item-label">{{ entry.label }}</span>
    </DropdownMenuItem>
  </template>
</template>
