<script setup lang="ts">
import { RsConfirmDialog } from '@niuma/ui'
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
  <RsConfirmDialog
    v-model:open="open"
    :title="title"
    :description="description"
    width="sm"
    :tone="isDanger ? 'danger' : 'default'"
    :confirm-variant="isDanger ? 'danger' : 'primary'"
    :confirm-text="t('modules.sqlite.maintain.confirmExec')"
    :cancel-text="t('common.cancel')"
    :confirm-loading="busy"
    :auto-close-on-confirm="false"
    :show-overlay="false"
    @confirm="onConfirm"
    @cancel="store.clear()"
  />
</template>
