<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { VastDdlParams } from '@/api/types/vastbase'
import { useVastDdlDialog } from '@/modules/vastbase/composables/useVastDdlDialog'
import { useVastDdlExec } from '@/modules/vastbase/composables/useVastDdlExec'
import type { VastPendingDdlAction } from '@/modules/vastbase/stores/ddl-actions'

const { t } = useI18n()
const { open, pending, store } = useVastDdlDialog()
const { exec, busy } = useVastDdlExec()

const newName = ref('')

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const showCurrentName = computed(
  () =>
    pending.value?.kind === 'rename' &&
    (pending.value?.action === 'rename_database' ||
      pending.value?.action === 'rename_schema'),
)
const canConfirm = computed(() => {
  if (!pending.value || pending.value.kind !== 'rename') return false
  return newName.value.trim().length > 0
})

watch(
  () => pending.value,
  (req) => {
    if (req?.kind === 'rename') {
      newName.value = req.newName ?? req.name ?? ''
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
    newName: newName.value.trim(),
  }
}

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'rename' || !canConfirm.value) return
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
    <div class="nm-vast-ddl-dialog__form">
      <div v-if="showCurrentName" class="nm-vast-ddl-dialog__field nm-vast-ddl-dialog__field--full">
        <RsLabel>{{ t('modules.vastbase.ddl.currentName') }}</RsLabel>
        <RsInput :model-value="pending?.name ?? ''" disabled />
      </div>
      <div class="nm-vast-ddl-dialog__field nm-vast-ddl-dialog__field--full">
        <RsLabel required>{{ t('modules.vastbase.ddl.newName') }}</RsLabel>
        <RsInput v-model="newName" :disabled="busy" @keydown.enter="onConfirm" />
      </div>
    </div>
    </template>

    <template #footer>
      <RsButton variant="ghost" :disabled="busy" @click="store.clear()">
        {{ t('common.cancel') }}
      </RsButton>
      <RsButton
        variant="primary"
        :loading="busy"
        :disabled="!canConfirm"
        @click="onConfirm"
      >
        {{ t('modules.vastbase.ddl.confirmRename') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./vast-ddl-dialog.css"></style>
