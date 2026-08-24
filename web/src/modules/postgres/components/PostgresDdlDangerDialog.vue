<script setup lang="ts">
import { RsConfirmDialog } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PostgresDdlParams } from '@/api/types/postgres'
import { usePostgresDdlDialog } from '@/modules/postgres/composables/usePostgresDdlDialog'
import { usePostgresDdlExec } from '@/modules/postgres/composables/usePostgresDdlExec'
import type { PostgresPendingDdlAction } from '@/modules/postgres/stores/ddl-actions'

const { t } = useI18n()
const { open, pending, store } = usePostgresDdlDialog()
const { exec, busy } = usePostgresDdlExec()

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')

function buildPayload(req: PostgresPendingDdlAction): PostgresDdlParams {
  return {
    action: req.action,
    profileId: req.profileId,
    database: req.database,
    schema: req.schema,
    name: req.name,
    args: req.args,
    oid: req.oid,
    table: req.table,
  }
}

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (
    !req ||
    req.kind === 'rename' ||
    req.kind === 'create_database' ||
    req.kind === 'create_schema' ||
    req.kind === 'alter_owner' ||
    req.kind === 'grant'
  ) {
    return
  }
  await exec(buildPayload(req))
}
</script>

<template>
  <RsConfirmDialog
    v-model:open="open"
    :title="title"
    :description="description"
    width="sm"
    tone="danger"
    confirm-variant="danger"
    :confirm-text="t('modules.postgres.ddl.confirmExec')"
    :cancel-text="t('common.cancel')"
    :confirm-loading="busy"
    :auto-close-on-confirm="false"
    :show-overlay="false"
    @confirm="onConfirm"
    @cancel="store.clear()"
  />
</template>
