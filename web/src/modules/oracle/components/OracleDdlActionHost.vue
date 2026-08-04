<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useOracleDdlActionStore } from '@/modules/oracle/stores/ddl-actions'
import OracleDdlDangerDialog from './OracleDdlDangerDialog.vue'
import OracleDdlRenameDialog from './OracleDdlRenameDialog.vue'
import OracleSchemaCreateDialog from './OracleSchemaCreateDialog.vue'

const store = useOracleDdlActionStore()
const { pending } = storeToRefs(store)

const dialogKind = computed(() => pending.value?.kind ?? 'danger')
</script>

<template>
  <OracleSchemaCreateDialog v-if="dialogKind === 'create_schema'" />
  <OracleDdlRenameDialog v-else-if="dialogKind === 'rename'" />
  <OracleDdlDangerDialog v-else-if="pending" />
</template>
