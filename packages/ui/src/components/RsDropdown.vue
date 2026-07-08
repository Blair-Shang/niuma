<script setup lang="ts">
import { computed } from 'vue'
import {
  type AcceptableValue,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from './reka'
import { useRsI18n } from '../composables/useRsI18n'
import { flattenDropdownItems, type RsDropdownItems as RsDropdownData } from './dropdown-utils'
import RsDropdownItems from './RsDropdownItems.vue'
import RsIcon from './RsIcon.vue'

const model = defineModel<string>()

const props = withDefaults(
  defineProps<{
    items: RsDropdownData
    placeholder?: string
    disabled?: boolean
    /** 选中后是否在触发器回显选项 label；false 时固定显示 placeholder（操作菜单） */
    showSelected?: boolean
  }>(),
  {
    disabled: false,
    showSelected: true,
  },
)

const { t } = useRsI18n()
const resolvedPlaceholder = computed(() => props.placeholder ?? t('dropdown.placeholder'))

const emit = defineEmits<{
  select: [value: string]
}>()

const flatItems = computed(() => flattenDropdownItems(props.items))

const selectedItem = computed(() =>
  flatItems.value.find((item) => item.value === model.value),
)

const displayLabel = computed(() => {
  if (!props.showSelected) return resolvedPlaceholder.value
  return selectedItem.value?.label ?? resolvedPlaceholder.value
})

const isPlaceholderDisplay = computed(() => {
  if (!props.showSelected) return false
  return !selectedItem.value
})

function onSelect(value: AcceptableValue) {
  if (typeof value === 'string') {
    model.value = value
    emit('select', value)
  }
}
</script>

<template>
  <DropdownMenuRoot
    class="rs-dropdown"
    :class="{ 'rs-dropdown--action': !showSelected }"
  >
    <DropdownMenuTrigger class="rs-dropdown__trigger" :disabled="disabled">
      <span class="rs-dropdown__value">
        <span
          class="rs-dropdown__label"
          :class="{ 'rs-dropdown__label--placeholder': isPlaceholderDisplay }"
        >
          {{ displayLabel }}
        </span>
      </span>
      <RsIcon name="chevron-down" :size="16" class="rs-dropdown__icon" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent class="rs-dropdown__content" :side-offset="4">
        <DropdownMenuRadioGroup
          v-if="showSelected"
          v-model="model"
          @update:model-value="onSelect"
        >
          <RsDropdownItems :items="items" selectable />
        </DropdownMenuRadioGroup>
        <RsDropdownItems v-else :items="items" @select="onSelect" />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<style>
/* Dropdown 为浮层菜单，样式独立于 RsSelect 列表，对齐 RsContextMenu / 设计规范 */
.rs-dropdown {
  display: inline-block;
  min-width: 10rem;
}

.rs-dropdown--action {
  min-width: auto;
}

.rs-dropdown__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  width: 100%;
  min-height: var(--rs-control-height-md);
  padding: 0 var(--rs-space-md);
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-input-border, var(--rs-border));
  background: var(--rs-input-bg);
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-normal);
  cursor: pointer;
  box-shadow: var(--rs-input-shadow, none);
  transition:
    border-color var(--rs-transition-fast),
    box-shadow var(--rs-transition-fast),
    background var(--rs-transition-fast);
}

.rs-dropdown__trigger:hover:not([data-disabled]) {
  border-color: var(--rs-input-border-hover, var(--rs-border));
}

.rs-dropdown__trigger:focus-visible {
  outline: none;
  border-color: var(--rs-focus-border, var(--rs-primary));
  background: var(--rs-input-bg);
  box-shadow:
    var(--rs-input-shadow, none),
    0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.rs-dropdown__trigger[data-disabled] {
  opacity: 0.38;
  cursor: not-allowed;
  background: var(--rs-surface-hover);
}

.rs-dropdown__value {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.rs-dropdown__label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rs-dropdown__label--placeholder {
  color: var(--rs-placeholder);
}

.rs-dropdown__icon {
  flex-shrink: 0;
  color: var(--rs-muted);
}

.rs-dropdown__content {
  z-index: var(--rs-z-dropdown);
  min-width: var(--reka-dropdown-menu-trigger-width);
  padding: var(--rs-space-xs);
  border-radius: var(--rs-radius);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface-elevated);
  box-shadow: var(--rs-shadow);
  outline: none;
  overflow: hidden;
}

.rs-dropdown__group + .rs-dropdown__group {
  margin-top: var(--rs-space-md);
  padding-top: 0;
  border-top: 1px solid var(--rs-border-subtle);
}

.rs-dropdown__group-label {
  display: block;
  padding: 0.375rem var(--rs-space-md) 0.125rem;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
  letter-spacing: 0.04em;
  line-height: var(--rs-line-height-tight);
  user-select: none;
}

.rs-dropdown__group + .rs-dropdown__group .rs-dropdown__group-label {
  position: relative;
  top: -0.55em;
  margin-bottom: 0.125rem;
  padding: 0 0.375rem;
  margin-left: var(--rs-space-md);
  width: fit-content;
  max-width: calc(100% - var(--rs-space-md) * 2);
  background: var(--rs-surface-elevated);
  line-height: 1;
}

.rs-dropdown__item {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-radius: var(--rs-radius-sm);
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-tight);
  color: var(--rs-text);
  cursor: pointer;
  outline: none;
  user-select: none;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.rs-dropdown__item-icon {
  flex-shrink: 0;
  color: var(--rs-muted);
}

.rs-dropdown__item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rs-dropdown__item[data-highlighted] {
  background: var(--rs-item-hover);
}

.rs-dropdown__item[data-state='checked'] {
  color: var(--rs-primary);
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
}

.rs-dropdown__item[data-disabled] {
  opacity: 0.38;
  cursor: not-allowed;
}
</style>
