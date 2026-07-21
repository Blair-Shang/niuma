<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useMysqlDdlActionStore } from '@/modules/mysql/stores/ddl-actions'
import MysqlDatabaseCreateDialog from './MysqlDatabaseCreateDialog.vue'
import MysqlDdlDangerDialog from './MysqlDdlDangerDialog.vue'
import MysqlDdlRenameDialog from './MysqlDdlRenameDialog.vue'

const store = useMysqlDdlActionStore()
const { pending } = storeToRefs(store)

const dialogKind = computed(() => pending.value?.kind ?? 'danger')
</script>

<template>
  <MysqlDatabaseCreateDialog v-if="dialogKind === 'create_database'" />
  <MysqlDdlRenameDialog v-else-if="dialogKind === 'rename'" />
  <MysqlDdlDangerDialog v-else-if="pending" />
</template>
