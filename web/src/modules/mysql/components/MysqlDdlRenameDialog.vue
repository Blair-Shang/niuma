<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMysqlDdlDialog } from '@/modules/mysql/composables/useMysqlDdlDialog'
import { useMysqlDdlExec } from '@/modules/mysql/composables/useMysqlDdlExec'

const { t } = useI18n()
const { open, pending, store } = useMysqlDdlDialog()
const { exec, busy } = useMysqlDdlExec()

const newName = ref('')

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const canConfirm = computed(() => {
  if (!pending.value || pending.value.kind !== 'rename') return false
  const next = newName.value.trim()
  return next.length > 0 && next !== pending.value.name
})

watch(
  () => pending.value,
  (req) => {
    if (req?.kind === 'rename') {
      newName.value = req.newName ?? req.name ?? ''
    }
  },
  { immediate: true },
)

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'rename' || !canConfirm.value) return
  await exec({ newName: newName.value.trim() })
}
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="title"
    :description="description"
    width="sm"
    layout="confirm"
    tone="default"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <div class="nm-mysql-ddl-dialog__form">
        <div class="nm-mysql-ddl-dialog__field nm-mysql-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.mysql.ddl.currentName') }}</RsLabel>
          <RsInput :model-value="pending?.name ?? ''" disabled />
        </div>
        <div class="nm-mysql-ddl-dialog__field nm-mysql-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.mysql.ddl.newName') }}</RsLabel>
          <RsInput v-model="newName" :disabled="busy" @keydown.enter="onConfirm" />
        </div>
      </div>
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
        {{ t('modules.mysql.ddl.confirmRename') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./mysql-ddl-dialog.css"></style>
