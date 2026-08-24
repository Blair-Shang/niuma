<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useKingbaseDatabaseCreateForm } from '@/modules/kingbase/composables/useKingbaseDatabaseCreateForm'
import { useKingbaseDdlDialog } from '@/modules/kingbase/composables/useKingbaseDdlDialog'
import { useKingbaseDdlExec } from '@/modules/kingbase/composables/useKingbaseDdlExec'

const { t } = useI18n()
const { open, pending, store } = useKingbaseDdlDialog()
const { exec, busy } = useKingbaseDdlExec()
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
} = useKingbaseDatabaseCreateForm()

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
    layout="form"
    tone="default"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <form class="nm-kb-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <div class="nm-kb-ddl-dialog__field nm-kb-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.kingbase.ddl.dbName') }}</RsLabel>
          <RsInput
            v-model="dbName"
            :disabled="formDisabled"
            :placeholder="t('modules.kingbase.ddl.dbNamePh')"
            @keydown.enter="onConfirm"
          />
        </div>

        <div class="nm-kb-ddl-dialog__grid">
          <div class="nm-kb-ddl-dialog__field">
            <RsTooltip icon :content="t('modules.kingbase.ddl.dbOwnerHint')" side="top" align="start">
              <RsLabel>{{ t('modules.kingbase.ddl.dbOwner') }}</RsLabel>
            </RsTooltip>
            <RsSelect
              v-model="dbOwner"
              :options="ownerOptions"
              :disabled="formDisabled"
              searchable
            />
          </div>
          <div class="nm-kb-ddl-dialog__field">
            <RsTooltip
              icon
              :content="t('modules.kingbase.ddl.dbEncodingHint')"
              side="top"
              align="start"
            >
              <RsLabel>{{ t('modules.kingbase.ddl.dbEncoding') }}</RsLabel>
            </RsTooltip>
            <RsSelect
              v-model="dbEncoding"
              :options="encodingOptions"
              :disabled="formDisabled"
              searchable
            />
          </div>
        </div>

        <div class="nm-kb-ddl-dialog__grid">
          <div class="nm-kb-ddl-dialog__field">
            <RsTooltip
              icon
              :content="t('modules.kingbase.ddl.dbTemplateHint')"
              side="top"
              align="start"
            >
              <RsLabel>{{ t('modules.kingbase.ddl.dbTemplate') }}</RsLabel>
            </RsTooltip>
            <RsSelect
              v-model="dbTemplate"
              :options="templateOptions"
              :disabled="formDisabled"
              searchable
            />
          </div>
          <div class="nm-kb-ddl-dialog__field">
            <RsTooltip
              icon
              :content="t('modules.kingbase.ddl.dbLcCollateHint')"
              side="top"
              align="start"
            >
              <RsLabel>{{ t('modules.kingbase.ddl.dbLcCollate') }}</RsLabel>
            </RsTooltip>
            <RsSelect
              v-model="dbLcCollate"
              :options="collationOptions"
              :disabled="formDisabled"
              searchable
            />
          </div>
        </div>

        <div class="nm-kb-ddl-dialog__field nm-kb-ddl-dialog__field--full">
          <RsTooltip
            icon
            :content="t('modules.kingbase.ddl.dbLcCtypeHint')"
            side="top"
            align="start"
          >
            <RsLabel>{{ t('modules.kingbase.ddl.dbLcCtype') }}</RsLabel>
          </RsTooltip>
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
      <RsButton variant="primary" :loading="busy" :disabled="!canConfirm" @click="onConfirm">
        {{ t('modules.kingbase.ddl.confirmCreate') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./kingbase-ddl-dialog.css"></style>
