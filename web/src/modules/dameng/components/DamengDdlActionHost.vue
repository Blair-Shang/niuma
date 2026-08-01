<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useDamengDdlActionStore } from '@/modules/dameng/stores/ddl-actions'
import DamengDdlDangerDialog from './DamengDdlDangerDialog.vue'
import DamengDdlRenameDialog from './DamengDdlRenameDialog.vue'
import DamengSchemaCreateDialog from './DamengSchemaCreateDialog.vue'

const store = useDamengDdlActionStore()
const { pending } = storeToRefs(store)

const dialogKind = computed(() => pending.value?.kind ?? 'danger')
</script>

<template>
  <DamengSchemaCreateDialog v-if="dialogKind === 'create_schema'" />
  <DamengDdlRenameDialog v-else-if="dialogKind === 'rename'" />
  <DamengDdlDangerDialog v-else-if="pending" />
</template>
