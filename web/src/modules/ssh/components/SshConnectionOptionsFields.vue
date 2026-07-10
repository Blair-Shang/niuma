<script setup lang="ts">
import { DEFAULT_SSH_OPTIONS } from '@/api/types/ssh'
import { ConnectionTimeoutFields } from '@/modules/connection'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

/** SSH 专属连接选项字段（供 ConnectionFormDialog #options 插槽使用）。 */
defineProps<{
  form: ConnectionFormState
}>()
</script>

<template>
  <ConnectionTimeoutFields :form="form" :default-seconds="DEFAULT_SSH_OPTIONS.timeout_seconds" />
</template>
