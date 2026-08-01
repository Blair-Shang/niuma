<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useClickHouseDdlActionStore } from '@/modules/clickhouse/stores/ddl-actions'
import ClickHouseDatabaseCreateDialog from './ClickHouseDatabaseCreateDialog.vue'
import ClickHouseDdlDangerDialog from './ClickHouseDdlDangerDialog.vue'
import ClickHouseDdlRenameDialog from './ClickHouseDdlRenameDialog.vue'

const store = useClickHouseDdlActionStore()
const { pending } = storeToRefs(store)

const dialogKind = computed(() => pending.value?.kind ?? 'danger')
</script>

<template>
  <ClickHouseDatabaseCreateDialog v-if="dialogKind === 'create_database'" />
  <ClickHouseDdlRenameDialog v-else-if="dialogKind === 'rename'" />
  <ClickHouseDdlDangerDialog v-else-if="pending" />
</template>
