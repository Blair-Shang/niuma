<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel, RsSelect, useRsToast } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { vastbaseApi } from '@/api'
import type { VastDdlParams } from '@/api/types/vastbase'
import { useVastDdlDialog } from '@/modules/vastbase/composables/useVastDdlDialog'
import { useVastDdlExec } from '@/modules/vastbase/composables/useVastDdlExec'
import type { VastPendingDdlAction } from '@/modules/vastbase/stores/ddl-actions'

const { t } = useI18n()
const toast = useRsToast()
const { open, pending, store } = useVastDdlDialog()
const { exec, busy } = useVastDdlExec()

const owner = ref('CURRENT_USER')
const ownerOptions = ref<RsSelectOptions>([{ value: 'CURRENT_USER', label: 'CURRENT_USER' }])
const loadingOptions = ref(false)

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const canConfirm = computed(
  () => pending.value?.kind === 'alter_owner' && owner.value.trim().length > 0,
)

async function loadOwners(req: VastPendingDdlAction): Promise<void> {
  loadingOptions.value = true
  try {
    const result = await vastbaseApi.metaDatabaseCreateOptions({
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
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.ddl.optionsLoadError'))
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

function buildPayload(req: VastPendingDdlAction): VastDdlParams {
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
      <form class="nm-vast-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <div class="nm-vast-ddl-dialog__field nm-vast-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.vastbase.ddl.currentName') }}</RsLabel>
          <RsInput :model-value="pending?.name ?? ''" disabled />
        </div>
        <div class="nm-vast-ddl-dialog__field nm-vast-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.vastbase.ddl.dbOwner') }}</RsLabel>
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
        {{ t('modules.vastbase.ddl.confirmAlterOwner') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./vast-ddl-dialog.css"></style>
