<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel, RsSelect, RsTooltip, useRsToast } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { postgresApi } from '@/api'
import type { PostgresDdlParams } from '@/api/types/postgres'
import { usePostgresDdlDialog } from '@/modules/postgres/composables/usePostgresDdlDialog'
import { usePostgresDdlExec } from '@/modules/postgres/composables/usePostgresDdlExec'
import type { PostgresPendingDdlAction } from '@/modules/postgres/stores/ddl-actions'

const { t } = useI18n()
const toast = useRsToast()
const { open, pending, store } = usePostgresDdlDialog()
const { exec, busy } = usePostgresDdlExec()

const owner = ref('CURRENT_USER')
const ownerOptions = ref<RsSelectOptions>([{ value: 'CURRENT_USER', label: 'CURRENT_USER' }])
const loadingOptions = ref(false)

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const canConfirm = computed(
  () => pending.value?.kind === 'alter_owner' && owner.value.trim().length > 0,
)

async function loadOwners(req: PostgresPendingDdlAction): Promise<void> {
  loadingOptions.value = true
  try {
    const result = await postgresApi.metaDatabaseCreateOptions({
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
    toast.error(e instanceof Error ? e.message : t('modules.postgres.ddl.optionsLoadError'))
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

function buildPayload(req: PostgresPendingDdlAction): PostgresDdlParams {
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
    layout="form"
    tone="default"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <form class="nm-kb-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <div class="nm-kb-ddl-dialog__field nm-kb-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.postgres.ddl.currentName') }}</RsLabel>
          <RsInput :model-value="pending?.name ?? ''" disabled />
        </div>
        <div class="nm-kb-ddl-dialog__field nm-kb-ddl-dialog__field--full">
          <RsTooltip icon :content="t('modules.postgres.ddl.dbOwnerHint')" side="top" align="start">
            <RsLabel required>{{ t('modules.postgres.ddl.dbOwner') }}</RsLabel>
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
        {{ t('modules.postgres.ddl.confirmAlterOwner') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./postgres-ddl-dialog.css"></style>
