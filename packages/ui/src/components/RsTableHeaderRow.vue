<script setup lang="ts" generic="T extends import('./table-utils').RsTableRowData = Record<string, unknown>">
import type { RsTableColumn } from './table-utils'

defineProps<{
  columns: RsTableColumn<T>[]
}>()
</script>

<template>
  <tr>
    <th
      v-for="column in columns"
      :key="column.key"
      scope="col"
      class="rs-table-header-row__cell"
      :style="{ width: typeof column.width === 'number' ? `${column.width}px` : column.width }"
    >      <slot :name="column.key" :column="column">{{ column.title }}</slot>
    </th>
  </tr>
</template>

<style scoped>
.rs-table-header-row__cell {
  padding: var(--rs-space-sm) var(--rs-space-md);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  text-align: left;
}
</style>
