<script setup lang="ts">
/**
 * 按声明列表渲染 IDE 工具条按钮 / 分隔线。
 */
import { RsButton } from '@niuma/ui'
import {
  isSqlIdeToolbarSep,
  sqlIdeToolbarIconButton,
  type SqlIdeToolbarAction,
  type SqlIdeToolbarSep,
} from '../types/sql-ide-toolbar'

defineProps<{
  items: Array<SqlIdeToolbarAction | SqlIdeToolbarSep>
}>()

const emit = defineEmits<{
  action: [key: string]
}>()
</script>

<template>
  <template v-for="item in items" :key="item.key">
    <span v-if="isSqlIdeToolbarSep(item)" class="nm-sql-tb__sep" aria-hidden="true" />
    <RsButton
      v-else
      v-bind="sqlIdeToolbarIconButton"
      :variant="item.active ? 'default' : sqlIdeToolbarIconButton.variant"
      :icon="item.icon"
      :icon-only="!item.label"
      :tone="item.tone"
      :disabled="item.disabled"
      :loading="item.loading"
      :tooltip="item.title"
      :aria-pressed="item.active || undefined"
      @click="emit('action', item.key)"
    >
      {{ item.label }}
    </RsButton>
  </template>
</template>

<style scoped src="./sql-ide-toolbar.css"></style>
