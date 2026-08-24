<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PostgresDdlParams } from '@/api/types/postgres'
import { usePostgresDdlDialog } from '@/modules/postgres/composables/usePostgresDdlDialog'
import { usePostgresDdlExec } from '@/modules/postgres/composables/usePostgresDdlExec'
import type { PostgresPendingDdlAction } from '@/modules/postgres/stores/ddl-actions'

const { t } = useI18n()
const { open, pending, store } = usePostgresDdlDialog()
const { exec, busy } = usePostgresDdlExec()

const schemaName = ref('')

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const canConfirm = computed(
  () => pending.value?.kind === 'create_schema' && schemaName.value.trim().length > 0,
)

watch(
  () => pending.value,
  (req) => {
    if (req?.kind === 'create_schema') {
      schemaName.value = req.name ?? 'new_schema'
    }
  },
  { immediate: true },
)

function buildPayload(req: PostgresPendingDdlAction): PostgresDdlParams {
  return {
    action: req.action,
    profileId: req.profileId,
    database: req.database,
    name: schemaName.value.trim(),
  }
}

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'create_schema' || !canConfirm.value) return
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
          <RsLabel required>{{ t('modules.postgres.ddl.schemaName') }}</RsLabel>
          <RsInput
            v-model="schemaName"
            :disabled="busy"
            :placeholder="t('modules.postgres.ddl.schemaNamePh')"
            @keydown.enter="onConfirm"
          />
        </div>
      </form>
    </template>

    <template #footer>
      <RsButton variant="ghost" :disabled="busy" @click="store.clear()">
        {{ t('common.cancel') }}
      </RsButton>
      <RsButton variant="primary" :loading="busy" :disabled="!canConfirm" @click="onConfirm">
        {{ t('modules.postgres.ddl.confirmCreateSchema') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./postgres-ddl-dialog.css"></style>
