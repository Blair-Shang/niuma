<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useSqliteDdlActionStore } from '@/modules/sqlite/stores/ddl-actions'
import SqliteDdlDangerDialog from './SqliteDdlDangerDialog.vue'
import SqliteDdlRenameDialog from './SqliteDdlRenameDialog.vue'
import SqliteDbPropertiesDialog from './SqliteDbPropertiesDialog.vue'

const store = useSqliteDdlActionStore()
const { pending } = storeToRefs(store)

const dialogKind = computed(() => pending.value?.kind ?? 'danger')
</script>

<template>
  <SqliteDdlRenameDialog v-if="dialogKind === 'rename'" />
  <SqliteDdlDangerDialog v-else-if="pending" />
  <SqliteDbPropertiesDialog />
</template>
