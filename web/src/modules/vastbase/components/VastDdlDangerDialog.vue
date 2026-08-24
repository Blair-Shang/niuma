<script setup lang="ts">
import { RsConfirmDialog } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { VastDdlParams } from '@/api/types/vastbase'
import { useVastDdlDialog } from '@/modules/vastbase/composables/useVastDdlDialog'
import { useVastDdlExec } from '@/modules/vastbase/composables/useVastDdlExec'
import type { VastPendingDdlAction } from '@/modules/vastbase/stores/ddl-actions'

const { t } = useI18n()
const { open, pending, store } = useVastDdlDialog()
const { exec, busy } = useVastDdlExec()

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')

function buildPayload(req: VastPendingDdlAction): VastDdlParams {
  return {
    action: req.action,
    profileId: req.profileId,
    database: req.database,
    schema: req.schema,
    name: req.name,
    args: req.args,
    oid: req.oid,
  }
}

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind === 'rename' || req.kind === 'create_database' || req.kind === 'create_schema' || req.kind === 'alter_owner') return
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
    :confirm-text="t('modules.vastbase.ddl.confirmExec')"
    :cancel-text="t('common.cancel')"
    :confirm-loading="busy"
    :auto-close-on-confirm="false"
    :show-overlay="false"
    @confirm="onConfirm"
    @cancel="store.clear()"
  />
</template>
