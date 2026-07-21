<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVastDatabaseCreateForm } from '@/modules/vastbase/composables/useVastDatabaseCreateForm'
import { useVastDdlDialog } from '@/modules/vastbase/composables/useVastDdlDialog'
import { useVastDdlExec } from '@/modules/vastbase/composables/useVastDdlExec'

const { t } = useI18n()
const { open, pending, store } = useVastDdlDialog()
const { exec, busy } = useVastDdlExec()
const {
  dbName,
  dbOwner,
  dbEncoding,
  dbTemplate,
  dbLcCollate,
  dbLcCtype,
  ownerOptions,
  encodingOptions,
  templateOptions,
  collationOptions,
  formDisabled,
  canConfirm,
  buildPayload,
} = useVastDatabaseCreateForm()

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'create_database' || !canConfirm.value) return
  await exec(buildPayload(req))
}
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="title"
    :description="description"
    width="md"
    layout="confirm"
    tone="default"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
    <form
      class="nm-vast-ddl-dialog__form"
      autocomplete="off"
      @submit.prevent="onConfirm"
    >
      <div class="nm-vast-ddl-dialog__field nm-vast-ddl-dialog__field--full">
        <RsLabel required>{{ t('modules.vastbase.ddl.dbName') }}</RsLabel>
        <RsInput
          v-model="dbName"
          :disabled="formDisabled"
          :placeholder="t('modules.vastbase.ddl.dbNamePh')"
          @keydown.enter="onConfirm"
        />
      </div>

      <div class="nm-vast-ddl-dialog__grid">
        <div class="nm-vast-ddl-dialog__field">
          <RsTooltip icon :content="t('modules.vastbase.ddl.dbOwnerHint')" side="top" align="start">
            <RsLabel>{{ t('modules.vastbase.ddl.dbOwner') }}</RsLabel>
          </RsTooltip>
          <RsSelect
            v-model="dbOwner"
            :options="ownerOptions"
            :disabled="formDisabled"
            searchable
          />
        </div>
        <div class="nm-vast-ddl-dialog__field">
          <RsLabel>{{ t('modules.vastbase.ddl.dbEncoding') }}</RsLabel>
          <RsSelect
            v-model="dbEncoding"
            :options="encodingOptions"
            :disabled="formDisabled"
            searchable
          />
        </div>
      </div>

      <div class="nm-vast-ddl-dialog__grid">
        <div class="nm-vast-ddl-dialog__field">
          <RsTooltip icon :content="t('modules.vastbase.ddl.dbTemplateHint')" side="top" align="start">
            <RsLabel>{{ t('modules.vastbase.ddl.dbTemplate') }}</RsLabel>
          </RsTooltip>
          <RsSelect
            v-model="dbTemplate"
            :options="templateOptions"
            :disabled="formDisabled"
            searchable
          />
        </div>
        <div class="nm-vast-ddl-dialog__field">
          <RsLabel>{{ t('modules.vastbase.ddl.dbLcCollate') }}</RsLabel>
          <RsSelect
            v-model="dbLcCollate"
            :options="collationOptions"
            :disabled="formDisabled"
            searchable
          />
        </div>
      </div>

      <div class="nm-vast-ddl-dialog__field nm-vast-ddl-dialog__field--full">
        <RsLabel>{{ t('modules.vastbase.ddl.dbLcCtype') }}</RsLabel>
        <RsSelect
          v-model="dbLcCtype"
          :options="collationOptions"
          :disabled="formDisabled"
          searchable
        />
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
        {{ t('modules.vastbase.ddl.confirmCreate') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./vast-ddl-dialog.css"></style>
