<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { usePostgresDdlActionStore } from '@/modules/postgres/stores/ddl-actions'
import PostgresDatabaseCreateDialog from './PostgresDatabaseCreateDialog.vue'
import PostgresDdlDangerDialog from './PostgresDdlDangerDialog.vue'
import PostgresDdlOwnerDialog from './PostgresDdlOwnerDialog.vue'
import PostgresDdlRenameDialog from './PostgresDdlRenameDialog.vue'
import PostgresSchemaCreateDialog from './PostgresSchemaCreateDialog.vue'

const store = usePostgresDdlActionStore()
const { pending } = storeToRefs(store)

const dialogKind = computed(() => pending.value?.kind ?? 'danger')
</script>

<template>
  <PostgresDatabaseCreateDialog v-if="dialogKind === 'create_database'" />
  <PostgresSchemaCreateDialog v-else-if="dialogKind === 'create_schema'" />
  <PostgresDdlOwnerDialog v-else-if="dialogKind === 'alter_owner'" />
  <PostgresDdlRenameDialog v-else-if="dialogKind === 'rename'" />
  <PostgresDdlDangerDialog v-else-if="pending" />
</template>
