<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMongoDdlDialog } from '@/modules/mongodb/composables/useMongoDdlDialog'
import { useMongoDdlExec } from '@/modules/mongodb/composables/useMongoDdlExec'
import {
  isValidMongoCollectionName,
  isValidMongoDatabaseName,
} from '@/modules/mongodb/utils/catalog-names'

const { t } = useI18n()
const { open, pending, store } = useMongoDdlDialog()
const { exec, busy } = useMongoDdlExec()

const newName = ref('')

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const canConfirm = computed(() => {
  const req = pending.value
  if (!req || req.kind !== 'rename') return false
  const next = newName.value.trim()
  if (!next || next === req.name) return false
  if (req.action === 'rename_database') return isValidMongoDatabaseName(next)
  return isValidMongoCollectionName(next)
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
    layout="form"
    tone="default"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <div class="nm-mongo-ddl-dialog__form">
        <div class="nm-mongo-ddl-dialog__field nm-mongo-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.mongodb.ddl.currentName') }}</RsLabel>
          <RsInput :model-value="pending?.name ?? ''" disabled />
        </div>
        <div class="nm-mongo-ddl-dialog__field nm-mongo-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.mongodb.ddl.newName') }}</RsLabel>
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
        {{ t('modules.mongodb.ddl.confirmRename') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./mongo-ddl-dialog.css"></style>
