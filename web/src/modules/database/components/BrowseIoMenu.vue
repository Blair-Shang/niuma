<script setup lang="ts">
/** 浏览面板导入 / 导出下拉菜单项列表（样式统一）。 */
import { RsIcon } from '@niuma/ui'

defineProps<{
  items: Array<{
    key: string
    label: string
    icon?: string
    disabled?: boolean
  }>
}>()

const emit = defineEmits<{
  select: [key: string]
}>()
</script>

<template>
  <div class="nm-browse-io-menu">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="nm-browse-io-menu__item"
      :disabled="item.disabled"
      @pointerdown.stop.prevent="!item.disabled && emit('select', item.key)"
    >
      <RsIcon v-if="item.icon" :name="item.icon" :size="14" />
      <span>{{ item.label }}</span>
    </button>
    <slot />
  </div>
</template>

<style scoped>
.nm-browse-io-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px;
  min-width: 11rem;
}

.nm-browse-io-menu__item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.55rem;
  border: 0;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.nm-browse-io-menu__item > span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.nm-browse-io-menu__item:hover:not(:disabled) {
  background: var(--rs-bg-muted, rgba(127, 127, 127, 0.12));
}

.nm-browse-io-menu__item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
