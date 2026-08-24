<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel, RsTooltip, useRsToast } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useSqlServerDdlDialog } from '@/modules/sqlserver/composables/useSqlServerDdlDialog'
import { useSqlServerDdlExec } from '@/modules/sqlserver/composables/useSqlServerDdlExec'
import { isProtectedSchema } from '@/modules/sqlserver/conn-tree-shared'
import { sqlserverCreateSchemaSql } from '@/modules/sqlserver/sql-seed'

const { t } = useI18n()
const toast = useRsToast()
const nav = useConnectionNavigation()
const { open, pending, store } = useSqlServerDdlDialog()
const { exec, busy } = useSqlServerDdlExec()

const schemaName = ref('')
const owner = ref('')
const nameTouched = ref(false)

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')

const nameError = computed((): 'empty' | 'reserved' | undefined => {
  const name = schemaName.value.trim()
  if (!name) return 'empty'
  if (isProtectedSchema(name)) return 'reserved'
  return undefined
})
const visibleNameError = computed(() => {
  if (!nameError.value) return undefined
  if (nameError.value === 'empty' && !nameTouched.value) return undefined
  return nameError.value
})

const canConfirm = computed(() => pending.value?.kind === 'create_schema' && !nameError.value)

const previewSql = computed(() => {
  if (nameError.value) return ''
  return sqlserverCreateSchemaSql(schemaName.value.trim(), owner.value.trim())
})

watch(
  () => pending.value,
  (req) => {
    if (req?.kind !== 'create_schema') return
    schemaName.value = ''
    owner.value = ''
    nameTouched.value = false
  },
  { immediate: true },
)

watch(schemaName, () => {
  nameTouched.value = true
})

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'create_schema' || !canConfirm.value) return
  const sql = previewSql.value.trim()
  if (!sql) return
  await exec(sql, {
    database: req.database,
    successMessage: t('modules.sqlserver.createSchema.createOk', { name: schemaName.value.trim() }),
  })
}

function onScriptToQuery(): void {
  const req = pending.value
  const sql = previewSql.value.trim()
  if (!req || !sql || !canConfirm.value) return
  const resourcePath = req.database
    ? { segments: [{ kind: 'database' as const, name: req.database }] }
    : undefined
  nav.connect(req.conn, { resourcePath, initialTab: 'query', initialSql: sql })
  store.clear()
}

async function onCopySql(): Promise<void> {
  const sql = previewSql.value.trim()
  if (!sql) return
  try {
    await navigator.clipboard.writeText(sql)
    toast.success(t('modules.sqlserver.createDb.copySqlOk'))
  } catch {
    toast.error(t('modules.sqlserver.createDb.copySqlFailed'))
  }
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
      <form class="nm-sqlserver-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <div class="nm-sqlserver-ddl-dialog__field nm-sqlserver-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.sqlserver.createSchema.schemaName') }}</RsLabel>
          <RsInput
            v-model="schemaName"
            :disabled="busy"
            :placeholder="t('modules.sqlserver.createSchema.schemaNamePh')"
            @keydown.enter.prevent="onConfirm"
          />
          <p v-if="visibleNameError" class="nm-sqlserver-ddl-dialog__error">
            {{ t(`modules.sqlserver.createSchema.nameError.${visibleNameError}`) }}
          </p>
        </div>

        <div class="nm-sqlserver-ddl-dialog__field nm-sqlserver-ddl-dialog__field--full">
          <RsTooltip icon :content="t('modules.sqlserver.createSchema.ownerHint')" side="top" align="start">
            <RsLabel>{{ t('modules.sqlserver.createSchema.owner') }}</RsLabel>
          </RsTooltip>
          <RsInput
            v-model="owner"
            :disabled="busy"
            :placeholder="t('modules.sqlserver.createSchema.ownerPh')"
            @keydown.enter.prevent="onConfirm"
          />
        </div>

        <div class="nm-sqlserver-ddl-dialog__field nm-sqlserver-ddl-dialog__field--full">
          <div class="nm-sqlserver-ddl-dialog__preview-head">
            <RsLabel>{{ t('modules.sqlserver.createDb.previewSql') }}</RsLabel>
            <RsButton size="sm" variant="ghost" :disabled="!previewSql" @click="onCopySql">
              {{ t('modules.sqlserver.createDb.copySql') }}
            </RsButton>
          </div>
          <pre class="nm-sqlserver-ddl-dialog__preview">{{ previewSql || '—' }}</pre>
        </div>
      </form>
    </template>
    <template #footer>
      <RsButton variant="ghost" :disabled="busy" @click="store.clear()">
        {{ t('common.cancel') }}
      </RsButton>
      <RsButton variant="ghost" :disabled="!canConfirm || busy" @click="onScriptToQuery">
        {{ t('modules.sqlserver.createDb.scriptToQuery') }}
      </RsButton>
      <RsButton variant="primary" :loading="busy" :disabled="!canConfirm" @click="onConfirm">
        {{ t('modules.sqlserver.createSchema.confirmCreate') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./sqlserver-ddl-dialog.css"></style>
