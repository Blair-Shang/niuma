<script setup lang="ts">
import { RsConfirmDialog } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSqlServerDdlDialog } from '@/modules/sqlserver/composables/useSqlServerDdlDialog'
import { useSqlServerDdlExec } from '@/modules/sqlserver/composables/useSqlServerDdlExec'
import { sqlserverDropTableSeed, sqlserverTruncateSeed } from '@/modules/sqlserver/sql-seed'

const { t } = useI18n()
const { open, pending, store } = useSqlServerDdlDialog()
const { exec, busy } = useSqlServerDdlExec()

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'danger') return
  const schema = req.schema?.trim()
  const name = req.name.trim()
  if (!schema || !name) return
  let sql = ''
  if (req.action === 'truncate_table') {
    sql = sqlserverTruncateSeed(schema, name, req.database)
  } else if (req.action === 'drop_table') {
    sql = sqlserverDropTableSeed(schema, name, req.database)
  }
  if (!sql.trim()) return
  await exec(sql, {
    database: req.database,
    successMessage: t('modules.sqlserver.ddl.done'),
  })
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
    :confirm-text="t('modules.sqlserver.ddl.confirmExec')"
    :cancel-text="t('common.cancel')"
    :confirm-loading="busy"
    :auto-close-on-confirm="false"
    :show-overlay="false"
    @confirm="onConfirm"
    @cancel="store.clear()"
  />
</template>
