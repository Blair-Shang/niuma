<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useMongoDdlActionStore } from '@/modules/mongodb/stores/ddl-actions'
import MongoDatabaseCreateDialog from './MongoDatabaseCreateDialog.vue'
import MongoDdlRenameDialog from './MongoDdlRenameDialog.vue'

const store = useMongoDdlActionStore()
const { pending } = storeToRefs(store)

const dialogKind = computed(() => pending.value?.kind ?? 'rename')
</script>

<template>
  <MongoDatabaseCreateDialog v-if="dialogKind === 'create_database'" />
  <MongoDdlRenameDialog v-else-if="pending" />
</template>
