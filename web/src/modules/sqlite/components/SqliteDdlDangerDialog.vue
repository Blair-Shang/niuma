<script setup lang="ts">
import { RsConfirmDialog } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSqliteDdlDialog } from '@/modules/sqlite/composables/useSqliteDdlDialog'
import { useSqliteDdlExec } from '@/modules/sqlite/composables/useSqliteDdlExec'

const { t } = useI18n()
const { open, pending, store } = useSqliteDdlDialog()
const { exec, busy } = useSqliteDdlExec()

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind === 'rename') return
  await exec()
}
</script>

<template>
  <RsConfirmDialog
    v-model:open="open"
    :title="title"
    :description="description"
    width="sm"
    tone="danger"
    confirm-variant="danger"
    :confirm-text="t('modules.sqlite.ddl.confirmExec')"
    :cancel-text="t('common.cancel')"
    :confirm-loading="busy"
    :auto-close-on-confirm="false"
    :show-overlay="false"
    @confirm="onConfirm"
    @cancel="store.clear()"
  />
</template>
