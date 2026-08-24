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
  dbTablespace,
  dbLcCollate,
  dbLcCtype,
  dbConnLimit,
  ownerOptions,
  encodingOptions,
  templateOptions,
  tablespaceOptions,
  collationOptions,
  formDisabled,
  nameError,
  templateOverrideHint,
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
          <p v-if="dbName.trim() && nameError" class="nm-pg-create-db__error">{{ nameError }}</p>
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
              virtual
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
              virtual
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
              virtual
            />
          </div>
          <div class="nm-kb-ddl-dialog__field">
            <RsTooltip
              icon
              :content="t('modules.postgres.ddl.dbTablespaceHint')"
              side="top"
              align="start"
            >
              <RsLabel>{{ t('modules.postgres.ddl.dbTablespace') }}</RsLabel>
            </RsTooltip>
            <RsSelect
              v-model="dbTablespace"
              :options="tablespaceOptions"
              :disabled="formDisabled"
              searchable
              virtual
            />
          </div>
        </div>

        <p v-if="templateOverrideHint" class="nm-pg-create-db__hint">{{ templateOverrideHint }}</p>

        <div class="nm-kb-ddl-dialog__grid">
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
              virtual
            />
          </div>
          <div class="nm-kb-ddl-dialog__field">
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
              virtual
            />
          </div>
        </div>

        <div class="nm-kb-ddl-dialog__field">
          <RsTooltip
            icon
            :content="t('modules.postgres.ddl.dbConnLimitHint')"
            side="top"
            align="start"
          >
            <RsLabel>{{ t('modules.postgres.ddl.dbConnLimit') }}</RsLabel>
          </RsTooltip>
          <RsInput
            v-model="dbConnLimit"
            :disabled="formDisabled"
            :placeholder="t('modules.postgres.ddl.dbConnLimitPh')"
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
<style scoped>
.nm-pg-create-db__error {
  margin: 0;
  color: var(--rs-danger, var(--rs-color-danger));
  font-size: var(--rs-font-size-xs);
}
.nm-pg-create-db__hint {
  margin: 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}
</style>
