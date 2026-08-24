<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, defineAsyncComponent } from 'vue'
import { usePostgresDdlActionStore } from '@/modules/postgres/stores/ddl-actions'
import PostgresDatabaseCreateDialog from './PostgresDatabaseCreateDialog.vue'

const PostgresSchemaCreateDialog = defineAsyncComponent(
  () => import('./PostgresSchemaCreateDialog.vue'),
)
const PostgresDdlOwnerDialog = defineAsyncComponent(() => import('./PostgresDdlOwnerDialog.vue'))
const PostgresGrantDialog = defineAsyncComponent(() => import('./PostgresGrantDialog.vue'))
const PostgresDdlRenameDialog = defineAsyncComponent(() => import('./PostgresDdlRenameDialog.vue'))
const PostgresDdlDangerDialog = defineAsyncComponent(() => import('./PostgresDdlDangerDialog.vue'))

const store = usePostgresDdlActionStore()
const { pending } = storeToRefs(store)

const dialogKind = computed(() => pending.value?.kind ?? 'danger')
</script>

<template>
  <PostgresDatabaseCreateDialog v-if="dialogKind === 'create_database'" />
  <PostgresSchemaCreateDialog v-else-if="dialogKind === 'create_schema'" />
  <PostgresDdlOwnerDialog v-else-if="dialogKind === 'alter_owner'" />
  <PostgresGrantDialog v-else-if="dialogKind === 'grant'" />
  <PostgresDdlRenameDialog v-else-if="dialogKind === 'rename'" />
  <PostgresDdlDangerDialog v-else-if="pending" />
</template>
