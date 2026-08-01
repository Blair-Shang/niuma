<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel, RsSelect, RsTooltip, useRsToast } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { kingbaseApi } from '@/api'
import type { KingbaseDdlParams } from '@/api/types/kingbase'
import { useKingbaseDdlDialog } from '@/modules/kingbase/composables/useKingbaseDdlDialog'
import { useKingbaseDdlExec } from '@/modules/kingbase/composables/useKingbaseDdlExec'
import type { KingbasePendingDdlAction } from '@/modules/kingbase/stores/ddl-actions'

const { t } = useI18n()
const toast = useRsToast()
const { open, pending, store } = useKingbaseDdlDialog()
const { exec, busy } = useKingbaseDdlExec()

const owner = ref('CURRENT_USER')
const ownerOptions = ref<RsSelectOptions>([{ value: 'CURRENT_USER', label: 'CURRENT_USER' }])
const loadingOptions = ref(false)

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const canConfirm = computed(
  () => pending.value?.kind === 'alter_owner' && owner.value.trim().length > 0,
)

async function loadOwners(req: KingbasePendingDdlAction): Promise<void> {
  loadingOptions.value = true
  try {
    const result = await kingbaseApi.metaDatabaseCreateOptions({
      profileId: req.profileId,
    })
    const opts = (result.owners ?? []).map((o) => ({
      value: o,
      label: o,
    }))
    if (!opts.some((o) => o.value === 'CURRENT_USER')) {
      opts.unshift({ value: 'CURRENT_USER', label: 'CURRENT_USER' })
    }
    ownerOptions.value = opts
    if (req.createOptions?.owner) {
      owner.value = req.createOptions.owner
    } else if (!opts.some((o) => o.value === owner.value)) {
      owner.value = 'CURRENT_USER'
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.kingbase.ddl.optionsLoadError'))
  } finally {
    loadingOptions.value = false
  }
}

watch(
  () => pending.value,
  (req) => {
    if (req?.kind === 'alter_owner') {
      owner.value = req.createOptions?.owner || 'CURRENT_USER'
      void loadOwners(req)
    }
  },
  { immediate: true },
)

function buildPayload(req: KingbasePendingDdlAction): KingbaseDdlParams {
  return {
    action: req.action,
    profileId: req.profileId,
    database: req.database,
    schema: req.schema,
    name: req.name,
    args: req.args,
    oid: req.oid,
    owner: owner.value.trim(),
  }
}

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'alter_owner' || !canConfirm.value) return
  await exec(buildPayload(req))
}
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="title"
    :description="description"
    width="sm"
    layout="confirm"
    tone="default"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <form class="nm-kb-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <div class="nm-kb-ddl-dialog__field nm-kb-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.kingbase.ddl.currentName') }}</RsLabel>
          <RsInput :model-value="pending?.name ?? ''" disabled />
        </div>
        <div class="nm-kb-ddl-dialog__field nm-kb-ddl-dialog__field--full">
          <RsTooltip icon :content="t('modules.kingbase.ddl.dbOwnerHint')" side="top" align="start">
            <RsLabel required>{{ t('modules.kingbase.ddl.dbOwner') }}</RsLabel>
          </RsTooltip>
          <RsSelect
            v-model="owner"
            :options="ownerOptions"
            :disabled="busy || loadingOptions"
            searchable
          />
        </div>
      </form>
    </template>

    <template #footer>
      <RsButton variant="ghost" :disabled="busy" @click="store.clear()">
        {{ t('common.cancel') }}
      </RsButton>
      <RsButton variant="primary" :loading="busy" :disabled="!canConfirm" @click="onConfirm">
        {{ t('modules.kingbase.ddl.confirmAlterOwner') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./kingbase-ddl-dialog.css"></style>
