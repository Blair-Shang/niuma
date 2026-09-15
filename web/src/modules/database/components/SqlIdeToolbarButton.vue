<script setup lang="ts">
/**
 * SQL IDE 工具条图标按钮：查询顶栏与对象脚本顶栏、以及插入工具条槽位共用。
 */
import { RsIcon } from '@niuma/ui'

withDefaults(
  defineProps<{
    icon: string
    title?: string
    disabled?: boolean
    variant?: 'default' | 'run'
  }>(),
  {
    title: '',
    disabled: false,
    variant: 'default',
  },
)
</script>

<template>
  <button
    type="button"
    class="nm-sql-tb__btn"
    :class="{ 'nm-sql-tb__btn--run': variant === 'run' }"
    :disabled="disabled"
    :aria-label="title"
    :title="title"
  >
    <RsIcon
      :name="icon"
      size="md"
      :stroke-width="variant === 'run' ? 2.25 : undefined"
    />
  </button>
</template>

<style scoped src="./sql-ide-toolbar.css"></style>
