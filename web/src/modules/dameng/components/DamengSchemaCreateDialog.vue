<script setup lang="ts">
import { RsButton, RsCheckbox, RsDialog, RsInput, RsLabel, RsTooltip } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDamengDdlDialog } from '@/modules/dameng/composables/useDamengDdlDialog'
import { useDamengDdlExec } from '@/modules/dameng/composables/useDamengDdlExec'

const { t } = useI18n()
const { open, pending, store } = useDamengDdlDialog()
const { exec, busy } = useDamengDdlExec()

const schemaName = ref('')
const password = ref('')
const grantResource = ref(true)

const title = computed(() => pending.value?.title ?? '')
const canConfirm = computed(() => {
  if (!pending.value || pending.value.kind !== 'create_schema') return false
  return schemaName.value.trim().length > 0 && password.value.length > 0
})

watch(
  () => pending.value,
  (req) => {
    if (req?.kind === 'create_schema') {
      schemaName.value = req.name || ''
      password.value = req.createOptions?.password ?? ''
      grantResource.value = req.createOptions?.grantResource !== false
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
      grantResource: grantResource.value,
    },
  })
}
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="title"
    width="md"
    layout="confirm"
    tone="default"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <form class="nm-dameng-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <div class="nm-dameng-ddl-dialog__field nm-dameng-ddl-dialog__field--full">
          <RsTooltip
            icon
            :content="t('modules.dameng.ddl.createSchemaTip')"
            side="top"
            align="start"
          >
            <RsLabel required>{{ t('modules.dameng.ddl.schemaName') }}</RsLabel>
          </RsTooltip>
          <RsInput
            v-model="schemaName"
            :disabled="busy"
            :placeholder="t('modules.dameng.ddl.schemaNamePh')"
            autocomplete="off"
            @keydown.enter="onConfirm"
          />
        </div>

        <div class="nm-dameng-ddl-dialog__field nm-dameng-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.dameng.ddl.schemaPassword') }}</RsLabel>
          <RsInput
            v-model="password"
            type="password"
            :disabled="busy"
            :placeholder="t('modules.dameng.ddl.schemaPasswordPh')"
            autocomplete="new-password"
            @keydown.enter="onConfirm"
          />
        </div>

        <div class="nm-dameng-ddl-dialog__field nm-dameng-ddl-dialog__field--full">
          <RsCheckbox v-model="grantResource" :disabled="busy">
            {{ t('modules.dameng.ddl.schemaGrantResource') }}
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
        {{ t('modules.dameng.ddl.confirmCreate') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./dameng-ddl-dialog.css"></style>
