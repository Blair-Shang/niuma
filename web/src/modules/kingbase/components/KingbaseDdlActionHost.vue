<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useKingbaseDdlActionStore } from '@/modules/kingbase/stores/ddl-actions'
import KingbaseDatabaseCreateDialog from './KingbaseDatabaseCreateDialog.vue'
import KingbaseDdlDangerDialog from './KingbaseDdlDangerDialog.vue'
import KingbaseDdlOwnerDialog from './KingbaseDdlOwnerDialog.vue'
import KingbaseDdlRenameDialog from './KingbaseDdlRenameDialog.vue'
import KingbaseSchemaCreateDialog from './KingbaseSchemaCreateDialog.vue'

const store = useKingbaseDdlActionStore()
const { pending } = storeToRefs(store)

const dialogKind = computed(() => pending.value?.kind ?? 'danger')
</script>

<template>
  <KingbaseDatabaseCreateDialog v-if="dialogKind === 'create_database'" />
  <KingbaseSchemaCreateDialog v-else-if="dialogKind === 'create_schema'" />
  <KingbaseDdlOwnerDialog v-else-if="dialogKind === 'alter_owner'" />
  <KingbaseDdlRenameDialog v-else-if="dialogKind === 'rename'" />
  <KingbaseDdlDangerDialog v-else-if="pending" />
</template>
