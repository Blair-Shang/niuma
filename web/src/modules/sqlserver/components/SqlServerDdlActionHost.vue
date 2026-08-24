<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, defineAsyncComponent } from 'vue'
import { useSqlServerDdlActionStore } from '@/modules/sqlserver/stores/ddl-actions'
import SqlServerDatabaseCreateDialog from './SqlServerDatabaseCreateDialog.vue'

const SqlServerDdlDangerDialog = defineAsyncComponent(() => import('./SqlServerDdlDangerDialog.vue'))
const SqlServerSchemaCreateDialog = defineAsyncComponent(
  () => import('./SqlServerSchemaCreateDialog.vue'),
)

const store = useSqlServerDdlActionStore()
const { pending } = storeToRefs(store)

const dialogKind = computed(() => pending.value?.kind ?? null)
</script>

<template>
  <SqlServerDatabaseCreateDialog v-if="dialogKind === 'create_database'" />
  <SqlServerSchemaCreateDialog v-else-if="dialogKind === 'create_schema'" />
  <SqlServerDdlDangerDialog v-else-if="dialogKind === 'danger'" />
</template>
