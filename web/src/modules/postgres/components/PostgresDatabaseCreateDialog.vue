<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePostgresDatabaseCreateForm } from '@/modules/postgres/composables/usePostgresDatabaseCreateForm'
import { usePostgresDdlDialog } from '@/modules/postgres/composables/usePostgresDdlDialog'
import { usePostgresDdlExec } from '@/modules/postgres/composables/usePostgresDdlExec'

const { t } = useI18n()
const { open, pending, store } = usePostgresDdlDialog()
const { exec, busy } = usePostgresDdlExec()
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
} = usePostgresDatabaseCreateForm()

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
          <RsLabel required>{{ t('modules.postgres.ddl.dbName') }}</RsLabel>
          <RsInput
            v-model="dbName"
            :disabled="formDisabled"
            :placeholder="t('modules.postgres.ddl.dbNamePh')"
            @keydown.enter="onConfirm"
          />
        </div>

        <div class="nm-kb-ddl-dialog__grid">
          <div class="nm-kb-ddl-dialog__field">
            <RsTooltip icon :content="t('modules.postgres.ddl.dbOwnerHint')" side="top" align="start">
              <RsLabel>{{ t('modules.postgres.ddl.dbOwner') }}</RsLabel>
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
              :content="t('modules.postgres.ddl.dbEncodingHint')"
              side="top"
              align="start"
            >
              <RsLabel>{{ t('modules.postgres.ddl.dbEncoding') }}</RsLabel>
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
              :content="t('modules.postgres.ddl.dbTemplateHint')"
              side="top"
              align="start"
            >
              <RsLabel>{{ t('modules.postgres.ddl.dbTemplate') }}</RsLabel>
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
              :content="t('modules.postgres.ddl.dbLcCollateHint')"
              side="top"
              align="start"
            >
              <RsLabel>{{ t('modules.postgres.ddl.dbLcCollate') }}</RsLabel>
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
            :content="t('modules.postgres.ddl.dbLcCtypeHint')"
            side="top"
            align="start"
          >
            <RsLabel>{{ t('modules.postgres.ddl.dbLcCtype') }}</RsLabel>
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
        {{ t('modules.postgres.ddl.confirmCreate') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./postgres-ddl-dialog.css"></style>
