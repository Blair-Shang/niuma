<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useOracleDdlActionStore } from '@/modules/oracle/stores/ddl-actions'
import OracleDdlDangerDialog from './OracleDdlDangerDialog.vue'
import OracleDdlRenameDialog from './OracleDdlRenameDialog.vue'

const store = useOracleDdlActionStore()
const { pending } = storeToRefs(store)

const dialogKind = computed(() => pending.value?.kind ?? 'danger')
</script>

<template>
  <OracleDdlRenameDialog v-if="dialogKind === 'rename'" />
  <OracleDdlDangerDialog v-else-if="pending" />
</template>
