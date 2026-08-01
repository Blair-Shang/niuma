<script setup lang="ts">
import { RsButton, RsDialog } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDamengDdlDialog } from '@/modules/dameng/composables/useDamengDdlDialog'
import { useDamengDdlExec } from '@/modules/dameng/composables/useDamengDdlExec'

const { t } = useI18n()
const { open, pending, store } = useDamengDdlDialog()
const { exec, busy } = useDamengDdlExec()

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind === 'rename' || req.kind === 'create_schema') return
  await exec()
}
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="title"
    width="sm"
    layout="confirm"
    tone="danger"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      {{ description }}
    </template>

    <template #footer>
      <RsButton variant="ghost" :disabled="busy" @click="store.clear()">
        {{ t('common.cancel') }}
      </RsButton>
      <RsButton variant="danger" :loading="busy" @click="onConfirm">
        {{ t('modules.dameng.ddl.confirmExec') }}
      </RsButton>
    </template>
  </RsDialog>
</template>
