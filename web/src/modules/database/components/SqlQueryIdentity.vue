<script setup lang="ts">
/**
 * 查询顶栏左侧上下文：引擎图标 + 当前库/schema。
 * Tab 已含连接名，此处不再重复；样式与 SqlQueryToolbar 同一套密度。
 */
import { RsIcon } from '@niuma/ui'

withDefaults(
  defineProps<{
    icon?: string
    title?: string
  }>(),
  {
    icon: 'database',
    title: '',
  },
)
</script>

<template>
  <div class="nm-sql-query-id" :title="title">
    <RsIcon :name="icon" size="sm" class="nm-sql-query-id__brand" />
    <span class="nm-sql-query-id__text">
      <slot />
    </span>
  </div>
</template>

<style scoped>
.nm-sql-query-id {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  width: max-content;
  max-width: 100%;
  min-width: 0;
  font-size: 12px;
  font-weight: 400;
  color: var(--rs-muted);
}

.nm-sql-query-id__brand {
  flex-shrink: 0;
  opacity: 0.75;
}

.nm-sql-query-id__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
