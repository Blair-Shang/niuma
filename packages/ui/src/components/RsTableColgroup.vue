<script setup lang="ts" generic="T extends object = Record<string, unknown>">
import type { RsTableColumn } from './table-utils'

defineProps<{
  columns: RsTableColumn<T>[]
}>()
</script>

<template>
  <colgroup>
    <col
      v-for="column in columns"
      :key="column.key"
      :style="{ width: typeof column.width === 'number' ? `${column.width}px` : column.width }"
    >
  </colgroup>
</template>
