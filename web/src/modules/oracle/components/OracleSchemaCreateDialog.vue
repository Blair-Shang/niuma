<script setup lang="ts">
import { RsButton, RsCheckbox, RsDialog, RsInput, RsLabel, RsTooltip } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOracleDdlDialog } from '@/modules/oracle/composables/useOracleDdlDialog'
import { useOracleDdlExec } from '@/modules/oracle/composables/useOracleDdlExec'

const { t } = useI18n()
const { open, pending, store } = useOracleDdlDialog()
const { exec, busy } = useOracleDdlExec()

const schemaName = ref('')
const password = ref('')
const defaultTablespace = ref('USERS')
const temporaryTablespace = ref('TEMP')
const quotaUnlimited = ref(true)
const grantConnectResource = ref(true)

const title = computed(() => pending.value?.title ?? '')
const canConfirm = computed(() => {
  if (!pending.value || pending.value.kind !== 'create_schema') return false
  return (
    schemaName.value.trim().length > 0 &&
    password.value.length > 0 &&
    defaultTablespace.value.trim().length > 0
  )
})

watch(
  () => pending.value,
  (req) => {
    if (req?.kind === 'create_schema') {
      schemaName.value = req.name || ''
      password.value = req.createOptions?.password ?? ''
      defaultTablespace.value = req.createOptions?.defaultTablespace?.trim() || 'USERS'
      temporaryTablespace.value = req.createOptions?.temporaryTablespace?.trim() || 'TEMP'
      quotaUnlimited.value = req.createOptions?.quotaUnlimited !== false
      grantConnectResource.value = req.createOptions?.grantConnectResource !== false
    }
  },
  { immediate: true },
)

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'create_schema' || !canConfirm.value) return
  await exec({
    newName: schemaName.value.trim(),
    createOptions: {
      password: password.value,
      defaultTablespace: defaultTablespace.value.trim(),
      temporaryTablespace: temporaryTablespace.value.trim() || 'TEMP',
      quotaUnlimited: quotaUnlimited.value,
      grantConnectResource: grantConnectResource.value,
    },
  })
}
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="title"
    width="md"
    layout="form"
    tone="default"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <form class="nm-oracle-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <div class="nm-oracle-ddl-dialog__field nm-oracle-ddl-dialog__field--full">
          <RsTooltip
            icon
            :content="t('modules.oracle.ddl.createSchemaTip')"
            side="top"
            align="start"
          >
            <RsLabel required>{{ t('modules.oracle.ddl.schemaName') }}</RsLabel>
          </RsTooltip>
          <RsInput
            v-model="schemaName"
            :disabled="busy"
            :placeholder="t('modules.oracle.ddl.schemaNamePh')"
            autocomplete="off"
            @keydown.enter="onConfirm"
          />
        </div>

        <div class="nm-oracle-ddl-dialog__field nm-oracle-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.oracle.ddl.schemaPassword') }}</RsLabel>
          <RsInput
            v-model="password"
            type="password"
            :disabled="busy"
            :placeholder="t('modules.oracle.ddl.schemaPasswordPh')"
            autocomplete="new-password"
            @keydown.enter="onConfirm"
          />
        </div>

        <div class="nm-oracle-ddl-dialog__field nm-oracle-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.oracle.ddl.schemaDefaultTablespace') }}</RsLabel>
          <RsInput
            v-model="defaultTablespace"
            :disabled="busy"
            :placeholder="t('modules.oracle.ddl.schemaDefaultTablespacePh')"
            autocomplete="off"
            @keydown.enter="onConfirm"
          />
        </div>

        <div class="nm-oracle-ddl-dialog__field nm-oracle-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.oracle.ddl.schemaTempTablespace') }}</RsLabel>
          <RsInput
            v-model="temporaryTablespace"
            :disabled="busy"
            :placeholder="t('modules.oracle.ddl.schemaTempTablespacePh')"
            autocomplete="off"
            @keydown.enter="onConfirm"
          />
        </div>

        <div class="nm-oracle-ddl-dialog__field nm-oracle-ddl-dialog__field--full">
          <RsCheckbox v-model="quotaUnlimited" :disabled="busy">
            {{ t('modules.oracle.ddl.schemaQuotaUnlimited') }}
          </RsCheckbox>
        </div>

        <div class="nm-oracle-ddl-dialog__field nm-oracle-ddl-dialog__field--full">
          <RsCheckbox v-model="grantConnectResource" :disabled="busy">
            {{ t('modules.oracle.ddl.schemaGrantConnectResource') }}
          </RsCheckbox>
        </div>
      </form>
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
        {{ t('modules.oracle.ddl.confirmCreate') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./oracle-ddl-dialog.css"></style>
