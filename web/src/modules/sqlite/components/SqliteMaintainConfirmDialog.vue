<script setup lang="ts">
import { RsButton, RsDialog } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSqliteMaintainExec } from '@/modules/sqlite/composables/useSqliteMaintainExec'
import { useSqliteMaintainActionStore } from '@/modules/sqlite/stores/maintain-actions'

const { t } = useI18n()
const store = useSqliteMaintainActionStore()
const { pending, busy } = storeToRefs(store)
const { execConfirm } = useSqliteMaintainExec()

const open = computed({
  get: () => pending.value?.kind === 'confirm',
  set: (v: boolean) => {
    if (!v && !busy.value) store.clear()
  },
})

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const isDanger = computed(
  () => pending.value?.action === 'vacuum' || pending.value?.action === 'wal_checkpoint',
)

async function onConfirm(): Promise<void> {
  await execConfirm()
}
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="title"
    width="sm"
    layout="confirm"
    :tone="isDanger ? 'danger' : 'default'"
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
      <RsButton
        :variant="isDanger ? 'danger' : 'primary'"
        :loading="busy"
        @click="onConfirm"
      >
        {{ t('modules.sqlite.maintain.confirmExec') }}
      </RsButton>
    </template>
  </RsDialog>
</template>
