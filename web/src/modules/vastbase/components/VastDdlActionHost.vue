<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useVastDdlActionStore } from '@/modules/vastbase/stores/ddl-actions'
import VastDatabaseCreateDialog from './VastDatabaseCreateDialog.vue'
import VastDdlDangerDialog from './VastDdlDangerDialog.vue'
import VastDdlGrantDialog from './VastDdlGrantDialog.vue'
import VastDdlOwnerDialog from './VastDdlOwnerDialog.vue'
import VastDdlRenameDialog from './VastDdlRenameDialog.vue'
import VastSchemaCreateDialog from './VastSchemaCreateDialog.vue'

const store = useVastDdlActionStore()
const { pending } = storeToRefs(store)

const dialogKind = computed(() => pending.value?.kind ?? 'danger')
</script>

<template>
  <VastDatabaseCreateDialog v-if="dialogKind === 'create_database'" />
  <VastSchemaCreateDialog v-else-if="dialogKind === 'create_schema'" />
  <VastDdlOwnerDialog v-else-if="dialogKind === 'alter_owner'" />
  <VastDdlGrantDialog v-else-if="dialogKind === 'grant'" />
  <VastDdlRenameDialog v-else-if="dialogKind === 'rename'" />
  <VastDdlDangerDialog v-else-if="pending" />
</template>
