<script setup lang="ts">
import { RsButton, RsDialog } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { KingbaseDdlParams } from '@/api/types/kingbase'
import { useKingbaseDdlDialog } from '@/modules/kingbase/composables/useKingbaseDdlDialog'
import { useKingbaseDdlExec } from '@/modules/kingbase/composables/useKingbaseDdlExec'
import type { KingbasePendingDdlAction } from '@/modules/kingbase/stores/ddl-actions'

const { t } = useI18n()
const { open, pending, store } = useKingbaseDdlDialog()
const { exec, busy } = useKingbaseDdlExec()

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')

function buildPayload(req: KingbasePendingDdlAction): KingbaseDdlParams {
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
  if (
    !req ||
    req.kind === 'rename' ||
    req.kind === 'create_database' ||
    req.kind === 'create_schema' ||
    req.kind === 'alter_owner'
  ) {
    return
  }
  await exec(buildPayload(req))
}
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="title"
    width="sm"
    layout="confirm"
    tone="danger"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      {{ description }}
    </template>

    <template #footer>
      <RsButton variant="ghost" :disabled="busy" @click="store.clear()">
        {{ t('common.cancel') }}
      </RsButton>
      <RsButton variant="danger" :loading="busy" @click="onConfirm">
        {{ t('modules.kingbase.ddl.confirmExec') }}
      </RsButton>
    </template>
  </RsDialog>
</template>
