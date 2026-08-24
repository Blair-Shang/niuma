<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel, RsSelect } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMysqlDdlDialog } from '@/modules/mysql/composables/useMysqlDdlDialog'
import { useMysqlDdlExec } from '@/modules/mysql/composables/useMysqlDdlExec'
import {
  MYSQL_CHARSET_VALUES,
  collationsForCharset,
  normalizeMysqlCharset,
  normalizeMysqlCollation,
} from '@/modules/mysql/mysql-charset'

const { t } = useI18n()
const { open, pending, store } = useMysqlDdlDialog()
const { exec, busy } = useMysqlDdlExec()

const dbName = ref('')
const charset = ref('utf8mb4')
const collation = ref('')

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const canConfirm = computed(() => {
  if (!pending.value || pending.value.kind !== 'create_database') return false
  return dbName.value.trim().length > 0
})

const charsetOptions = computed(() =>
  MYSQL_CHARSET_VALUES.map((v) => ({ value: v, label: v })),
)

const collationOptions = computed(() =>
  collationsForCharset(charset.value).map((v) => ({ value: v, label: v })),
)

watch(
  () => pending.value,
  (req) => {
    if (req?.kind === 'create_database') {
      dbName.value = req.name || ''
      charset.value = normalizeMysqlCharset(req.createOptions?.charset, 'utf8mb4')
      collation.value = normalizeMysqlCollation(charset.value, req.createOptions?.collation)
    }
  },
  { immediate: true },
)

watch(charset, (cs) => {
  collation.value = normalizeMysqlCollation(cs, collation.value)
})

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'create_database' || !canConfirm.value) return
  await exec({
    newName: dbName.value.trim(),
    createOptions: {
      charset: charset.value,
      collation: collation.value,
    },
  })
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
      <form class="nm-mysql-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <div class="nm-mysql-ddl-dialog__field nm-mysql-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.mysql.ddl.dbName') }}</RsLabel>
          <RsInput
            v-model="dbName"
            :disabled="busy"
            :placeholder="t('modules.mysql.ddl.dbNamePh')"
            @keydown.enter="onConfirm"
          />
        </div>

        <div class="nm-mysql-ddl-dialog__grid">
          <div class="nm-mysql-ddl-dialog__field">
            <RsLabel>{{ t('modules.mysql.ddl.dbCharset') }}</RsLabel>
            <RsSelect
              v-model="charset"
              :options="charsetOptions"
              :disabled="busy"
              searchable
            />
          </div>
          <div class="nm-mysql-ddl-dialog__field">
            <RsLabel>{{ t('modules.mysql.ddl.dbCollation') }}</RsLabel>
            <RsSelect
              v-model="collation"
              clearable
              :options="collationOptions"
              :disabled="busy"
              searchable
              :placeholder="t('modules.mysql.form.collationDefault')"
            />
          </div>
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
        {{ t('modules.mysql.ddl.confirmCreate') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./mysql-ddl-dialog.css"></style>
