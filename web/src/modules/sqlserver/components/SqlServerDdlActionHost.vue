<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useSqlServerDdlActionStore } from '@/modules/sqlserver/stores/ddl-actions'
import SqlServerDatabaseCreateDialog from './SqlServerDatabaseCreateDialog.vue'
import SqlServerDdlDangerDialog from './SqlServerDdlDangerDialog.vue'
import SqlServerSchemaCreateDialog from './SqlServerSchemaCreateDialog.vue'

const store = useSqlServerDdlActionStore()
const { pending } = storeToRefs(store)

const dialogKind = computed(() => pending.value?.kind ?? null)
</script>

<template>
  <SqlServerDatabaseCreateDialog v-if="dialogKind === 'create_database'" />
  <SqlServerSchemaCreateDialog v-else-if="dialogKind === 'create_schema'" />
  <SqlServerDdlDangerDialog v-else-if="dialogKind === 'danger'" />
</template>
