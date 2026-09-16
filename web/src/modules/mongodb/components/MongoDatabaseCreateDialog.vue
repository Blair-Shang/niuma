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

const dbName = ref('')
const collectionName = ref('')

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const canConfirm = computed(() => {
  if (!pending.value || pending.value.kind !== 'create_database') return false
  return isValidMongoDatabaseName(dbName.value) && isValidMongoCollectionName(collectionName.value)
})

watch(
  () => pending.value,
  (req) => {
    if (req?.kind !== 'create_database') return
    dbName.value = req.name || ''
    collectionName.value = req.createOptions?.collection || ''
  },
  { immediate: true },
)

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'create_database' || !canConfirm.value) return
  await exec({
    newName: dbName.value.trim(),
    createOptions: { collection: collectionName.value.trim() },
  })
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
      <form class="nm-mongo-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <p class="nm-mongo-ddl-dialog__hint">
          {{ t('modules.mongodb.ddl.createDatabaseHint') }}
        </p>
        <div class="nm-mongo-ddl-dialog__field nm-mongo-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.mongodb.ddl.dbName') }}</RsLabel>
          <RsInput
            v-model="dbName"
            :disabled="busy"
            :placeholder="t('modules.mongodb.ddl.dbNamePh')"
          />
        </div>
        <div class="nm-mongo-ddl-dialog__field nm-mongo-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.mongodb.ddl.collectionName') }}</RsLabel>
          <RsInput
            v-model="collectionName"
            :disabled="busy"
            :placeholder="t('modules.mongodb.ddl.collectionNamePh')"
            @keydown.enter="onConfirm"
          />
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
        {{ t('modules.mongodb.ddl.confirmCreate') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./mongo-ddl-dialog.css"></style>
